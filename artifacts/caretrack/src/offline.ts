// CareTrack offline mode (web and Android app).
//
// Reading: every successful API response is saved in IndexedDB for the signed-in user. When
// the server can't be reached, the saved copy is shown instead, so previously loaded pages
// keep working with no internet.
//
// Writing: the supported changes (dose status, health readings, symptom notes, messages) go
// through an "outbox" in IndexedDB. Each change is written to the device FIRST, then sent.
// If the server can't be reached it stays in the outbox, shows up on screen straight away
// (marked "waiting to sync") and is uploaded automatically when the connection returns:
// on the browser "online" event, when the app comes back to the foreground, and on a timer
// with back-off. A change is only removed from the device after the server confirmed it.
//
// Duplicates: every change has a random id that is sent as the `Idempotency-Key` header on
// each attempt; the server stores the first result and replays it for repeats.
// Conflicts: changes carry the time they were made (`x-caretrack-captured-at`); the server
// refuses an offline change that is older than a newer change made elsewhere, and the app
// asks the user what to do.
// Security: data is kept per server and per user; signing out removes the saved copies.
// Changes not yet uploaded stay on the device for the same user, so nothing they entered is
// lost, and are never sent with another user's session.
import { apiRequest, customFetch, isUnreachableStatus, OfflineError, setOfflineAdapter, type OfflineRequest } from '@workspace/api-client-react';
import { getServerUrl, isNativeApp } from './native';

// ---------------------------------------------------------------- types

export type SyncState = 'pending' | 'syncing' | 'retrying' | 'blocked' | 'conflict' | 'rejected';
type Kind = 'dose-status' | 'health-metric' | 'health-log' | 'message';
type Json = Record<string, unknown>;

export type OutboxEntry = {
  /** Random id; also the Idempotency-Key, so every retry is recognised by the server. */
  id: string;
  scope: string;
  userId: number;
  kind: Kind;
  method: string;
  path: string;
  body: Json;
  /** When the user made the change on the device (ISO). Kept through every retry. */
  capturedAt: string;
  createdAt: number;
  patientId: number;
  /** Dose id for dose changes. */
  entityId?: number;
  /** Negative id used for the record on screen until the server assigns a real one. */
  tempId: number;
  state: SyncState;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  /** Server's version of the record after a conflict. */
  current?: unknown;
  /** Re-send without the conflict check (user chose "keep my change"). */
  force?: boolean;
  label: string;
};

export type SyncSnapshot = {
  /** The browser has a network and the server answered the last request. */
  online: boolean;
  /** Changes on this device not yet confirmed by the server (all states). */
  total: number;
  waiting: number;
  syncing: boolean;
  retrying: number;
  nextRetryAt: number | null;
  /** Conflicts and rejected changes: need the user. */
  attention: OutboxEntry[];
  /** Session expired or account step needed before uploading. */
  blocked: number;
  /** Number of changes uploaded in the last sync run, shown briefly. */
  justSynced: number;
  lastSyncedAt: number | null;
  /** When the oldest saved copy currently on screen was downloaded (offline only). */
  showingSavedAt: number | null;
};

type Me = { id: number; name: string; role: string };

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = 'caretrack-data';
const CACHE = 'cache', OUTBOX = 'outbox', META = 'meta';
let dbPromise: Promise<IDBDatabase | null> | null = null;
/** Used only if IndexedDB can't be opened (very old or locked-down browsers): nothing survives a reload. */
const memory = { [CACHE]: new Map<string, unknown>(), [OUTBOX]: new Map<string, unknown>(), [META]: new Map<string, unknown>() };

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(CACHE);
        db.createObjectStore(OUTBOX, { keyPath: 'id' });
        db.createObjectStore(META);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void, fallback: () => T): Promise<T> {
  const db = await openDb();
  if (!db) return fallback();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request ? request.result : (undefined as T));
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
const idbGet = <T>(store: string, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>, () => memory[store as typeof CACHE].get(key) as T | undefined);
const idbPut = (store: string, value: unknown, key?: string) => tx<void>(store, 'readwrite', (s) => { s.put(value, store === OUTBOX ? undefined : key); }, () => { memory[store as typeof CACHE].set(key ?? (value as OutboxEntry).id, value); });
const idbDelete = (store: string, key: string) => tx<void>(store, 'readwrite', (s) => { s.delete(key); }, () => { memory[store as typeof CACHE].delete(key); });
const idbAll = <T>(store: string) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>, () => [...memory[store as typeof CACHE].values()] as T[]);
const idbKeys = (store: string) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys(), () => [...memory[store as typeof CACHE].keys()]);
const idbClear = (store: string) => tx<void>(store, 'readwrite', (s) => { s.clear(); }, () => { memory[store as typeof CACHE].clear(); });

// ---------------------------------------------------------------- scope (server + user)

const server = () => (isNativeApp ? getServerUrl() || 'no-server' : window.location.origin);
let me: Me | null = null;
const scope = () => (me ? `${server()}#${me.id}` : null);
const cacheKey = (path: string) => (path === '/api/auth/me' ? `${server()}#me` : `${scope()}|${path}`);

/** Never kept on the device: sign-in steps, file downloads and the live event stream. */
const NOT_SAVED = [/^\/api\/auth\/(?!me$)/, /^\/api\/events/, /^\/api\/lab-results\/\d+\/file/, /^\/api\/reports\/\d+\/(pdf|csv)/, /^\/api\/healthz/];
const savable = (path: string) => !NOT_SAVED.some((re) => re.test(path));

async function setMe(user: Me): Promise<void> {
  const changed = me?.id !== user.id;
  me = { id: user.id, name: user.name, role: user.role };
  if (!changed) return;
  await idbPut(META, { ...me, server: server() }, 'last-user');
  // A different person signed in on this device: drop everyone else's saved copies.
  const prefix = `${server()}#${user.id}|`;
  const keys = await idbKeys(CACHE);
  await Promise.all(keys.map(String).filter((k) => k.includes('|') && !k.startsWith(prefix)).map((k) => idbDelete(CACHE, k)));
  await reloadOutbox();
  await migrateLegacyQueue();
  void syncNow();
}

// ---------------------------------------------------------------- status store

let entries: OutboxEntry[] = [];
let reachable = typeof navigator === 'undefined' ? true : navigator.onLine;
let syncing = false;
let justSynced = 0, lastSyncedAt: number | null = null, showingSavedAt: number | null = null;
let justSyncedTimer = 0;
const listeners = new Set<() => void>();
const syncedListeners = new Set<() => void>();
let snapshot: SyncSnapshot = buildSnapshot();

function mine(): OutboxEntry[] {
  const s = scope();
  return s ? entries.filter((e) => e.scope === s) : [];
}
function buildSnapshot(): SyncSnapshot {
  const list = mine();
  const retrying = list.filter((e) => e.state === 'retrying');
  return {
    online: (typeof navigator === 'undefined' || navigator.onLine) && reachable,
    total: list.length,
    waiting: list.filter((e) => e.state === 'pending' || e.state === 'retrying' || e.state === 'syncing').length,
    syncing,
    retrying: retrying.length,
    nextRetryAt: retrying.length ? Math.min(...retrying.map((e) => e.nextAttemptAt)) : null,
    attention: list.filter((e) => e.state === 'conflict' || e.state === 'rejected'),
    blocked: list.filter((e) => e.state === 'blocked').length,
    justSynced,
    lastSyncedAt,
    showingSavedAt,
  };
}
function emit(): void {
  snapshot = buildSnapshot();
  listeners.forEach((listener) => listener());
}
export const subscribeSync = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getSyncSnapshot = () => snapshot;
/** Called after changes were uploaded, so screens can refresh from the server. */
export const onSyncComplete = (listener: () => void) => { syncedListeners.add(listener); return () => { syncedListeners.delete(listener); }; };

function setReachable(value: boolean): void {
  if (value === reachable) return;
  reachable = value;
  if (value) {
    showingSavedAt = null;
    void syncNow();
  }
  emit();
}

// Other tabs of the same app share the outbox.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('caretrack-sync') : null;
channel?.addEventListener('message', () => { void reloadOutbox(); });
async function reloadOutbox(): Promise<void> {
  entries = (await idbAll<OutboxEntry>(OUTBOX)).sort((a, b) => a.createdAt - b.createdAt);
  emit();
}
async function saveEntry(entry: OutboxEntry): Promise<void> {
  await idbPut(OUTBOX, entry);
  entries = [...entries.filter((e) => e.id !== entry.id), entry].sort((a, b) => a.createdAt - b.createdAt);
  channel?.postMessage('changed');
  emit();
}
async function removeEntry(id: string): Promise<void> {
  await idbDelete(OUTBOX, id);
  entries = entries.filter((e) => e.id !== id);
  channel?.postMessage('changed');
  emit();
}

// ---------------------------------------------------------------- what can be saved offline

type Rule = { kind: Kind; method: string; pattern: RegExp };
const RULES: Rule[] = [
  { kind: 'dose-status', method: 'PATCH', pattern: /^\/api\/doses\/(\d+)\/status$/ },
  { kind: 'health-metric', method: 'POST', pattern: /^\/api\/patients\/(\d+)\/health-metrics$/ },
  { kind: 'health-log', method: 'POST', pattern: /^\/api\/patients\/(\d+)\/health-logs$/ },
  { kind: 'message', method: 'POST', pattern: /^\/api\/patients\/(\d+)\/messages$/ },
];

const randomId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
let tempCounter = 0;
const nextTempId = () => -(Date.now() * 100 + (tempCounter++ % 100));
const APPLIES: SyncState[] = ['pending', 'syncing', 'retrying', 'blocked'];

function labelFor(kind: Kind, body: Json): string {
  if (kind === 'dose-status') return body.status === 'scheduled' ? 'Dose update undone' : `Dose marked ${String(body.status)}`;
  if (kind === 'health-metric') return `Health reading: ${String(body.metricType).replaceAll('_', ' ')} ${String(body.value)}${body.secondaryValue != null ? `/${String(body.secondaryValue)}` : ''} ${String(body.unit ?? '')}`.trim();
  if (kind === 'health-log') return `Symptom note: ${(body.symptoms as string[] | undefined)?.join(', ') || 'note'}`;
  return `Message: “${String(body.body).slice(0, 40)}${String(body.body).length > 40 ? '…' : ''}”`;
}

/** The record as it should appear on screen while the change waits to be uploaded. */
function localRecord(entry: OutboxEntry): Json {
  const base = { id: entry.tempId, patientId: entry.patientId, _sync: entry.state, _syncError: entry.lastError };
  if (entry.kind === 'health-metric') return { ...base, ...entry.body, secondaryValue: entry.body.secondaryValue ?? null, note: entry.body.note ?? null, recordedBy: entry.userId, outOfRange: false, active: true, createdAt: entry.capturedAt };
  if (entry.kind === 'health-log') return { ...base, symptoms: [], ...entry.body, notes: entry.body.notes ?? null, recordedBy: entry.userId, active: true, createdAt: entry.capturedAt };
  if (entry.kind === 'message') return { ...base, senderId: entry.userId, senderName: me?.name ?? 'You', senderRole: me?.role ?? 'patient', body: entry.body.body, createdAt: entry.capturedAt };
  const status = String(entry.body.status);
  return { _sync: entry.state, _syncError: entry.lastError, status, takenTime: status === 'taken' ? entry.body.takenAt ?? entry.capturedAt : null, loggedBy: status === 'scheduled' ? null : 'You · saved on this device' };
}

// ---------------------------------------------------------------- merging local changes into server data

type DoseLike = Json & { id: number };
const isArr = (v: unknown): v is Json[] => Array.isArray(v);

/** Applies `patch(dose)` to the doses inside a doses list or a patient detail response. */
function mapDoses(path: string, data: unknown, patch: (dose: DoseLike) => DoseLike): unknown {
  if (/^\/api\/doses(\?|$)/.test(path) && isArr(data)) return data.map((d) => patch(d as DoseLike));
  if (/^\/api\/patients\/\d+$/.test(path) && data && typeof data === 'object' && isArr((data as Json).recentDoses)) {
    return { ...(data as Json), recentDoses: ((data as Json).recentDoses as Json[]).map((d) => patch(d as DoseLike)) };
  }
  return data;
}
const listPath = (entry: OutboxEntry) => entry.kind === 'health-metric' ? `/api/patients/${entry.patientId}/health-metrics`
  : entry.kind === 'health-log' ? `/api/patients/${entry.patientId}/health-logs`
  : entry.kind === 'message' ? `/api/patients/${entry.patientId}/messages` : null;

/** Server data plus this user's changes that the server doesn't have yet. */
function overlay(path: string, data: unknown): unknown {
  const pending = mine();
  if (!pending.length) return data;
  let result = data;
  for (const entry of pending) {
    if (entry.kind === 'dose-status') {
      result = mapDoses(path, result, (dose) => {
        if (dose.id !== entry.entityId) return dose;
        // Conflicts and refused changes show the server's value, with a marker.
        return APPLIES.includes(entry.state) ? { ...dose, ...localRecord(entry) } : { ...dose, _sync: entry.state, _syncError: entry.lastError };
      });
      continue;
    }
    if (path !== listPath(entry) || !isArr(result)) continue;
    const local = localRecord(entry);
    // While uploading, the server's list may already include it.
    const already = result.some((row) => entry.kind === 'message'
      ? row.senderId === entry.userId && row.body === entry.body.body && String(row.createdAt) >= entry.capturedAt.slice(0, 16)
      : row.recordedAt && new Date(String(row.recordedAt)).getTime() === new Date(String(entry.body.recordedAt)).getTime() && row.id !== entry.tempId);
    if (already) continue;
    result = entry.kind === 'message' ? [...result, local] : [local, ...result];
  }
  return result;
}

/** After the server confirmed a change, update every saved copy so it is right offline too. */
async function commitToCache(entry: OutboxEntry, record: Json): Promise<void> {
  const prefix = `${scope()}|`;
  const keys = (await idbKeys(CACHE)).map(String).filter((k) => k.startsWith(prefix));
  for (const key of keys) {
    const path = key.slice(prefix.length);
    const saved = await idbGet<{ data: unknown; savedAt: number }>(CACHE, key);
    if (!saved) continue;
    let next: unknown = saved.data;
    if (entry.kind === 'dose-status') next = mapDoses(path, next, (dose) => (dose.id === record.id ? { ...dose, ...record } : dose));
    else if (path === listPath(entry) && isArr(next) && !next.some((row) => row.id === record.id)) next = entry.kind === 'message' ? [...next, record] : [record, ...next];
    if (next !== saved.data) await idbPut(CACHE, { data: next, savedAt: saved.savedAt }, key);
  }
}

// ---------------------------------------------------------------- sending

type Outcome =
  | { kind: 'ok'; data: Json }
  | { kind: 'unreachable'; error: string }
  | { kind: 'auth'; error: string }
  | { kind: 'blocked'; error: string }
  | { kind: 'conflict'; error: string; current: unknown }
  | { kind: 'rejected'; error: string; status: number };

const ACCOUNT_STEP_CODES = new Set(['PRIVACY_CONSENT_REQUIRED', 'PASSWORD_CHANGE_REQUIRED', 'MOBILE_APP_REQUIRED']);

async function send(entry: OutboxEntry): Promise<Outcome> {
  let response: Response;
  try {
    const { url, headers } = await apiRequest(entry.path);
    headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');
    headers.set('idempotency-key', entry.id);
    if (!entry.force) headers.set('x-caretrack-captured-at', entry.capturedAt);
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined;
    response = await fetch(url, { method: entry.method, headers, body: JSON.stringify(entry.body), signal });
  } catch {
    setReachable(false);
    return { kind: 'unreachable', error: 'No connection to the CareTrack server.' };
  }
  if (isUnreachableStatus(response.status)) {
    setReachable(false);
    return { kind: 'unreachable', error: 'The CareTrack server can’t be reached right now.' };
  }
  setReachable(true);
  const body = await response.json().catch(() => null) as (Json & { error?: string; code?: string; current?: unknown }) | null;
  const error = typeof body?.error === 'string' ? body.error : `The server answered ${response.status}.`;
  if (response.ok) return { kind: 'ok', data: body ?? {} };
  if (response.status === 401) return { kind: 'auth', error: 'Sign in again to upload this change.' };
  if (response.status === 403 && body?.code && ACCOUNT_STEP_CODES.has(body.code)) return { kind: 'blocked', error };
  if (response.status === 409 && body?.code === 'SYNC_CONFLICT') return { kind: 'conflict', error, current: body.current };
  // Still being processed by an earlier attempt, rate limited, or a server error: try again later.
  if (response.status === 409 || response.status === 429 || response.status >= 500) return { kind: 'unreachable', error };
  return { kind: 'rejected', error, status: response.status };
}

const backoff = (attempts: number) => Math.min(5 * 60_000, 2_000 * 2 ** Math.min(attempts, 8)) + Math.floor(Math.random() * 1_000);

/** Error thrown to a form when the server refused a change while online (same shape as API errors). */
class ChangeRefused extends Error {
  constructor(message: string, readonly status: number, readonly data = { error: message }) { super(message); }
}

async function applyOutcome(entry: OutboxEntry, outcome: Outcome): Promise<void> {
  if (outcome.kind === 'ok') {
    await removeEntry(entry.id);
    await commitToCache(entry, outcome.data);
    return;
  }
  if (outcome.kind === 'conflict') {
    if (outcome.current && typeof outcome.current === 'object') await commitToCache({ ...entry, kind: 'dose-status' }, outcome.current as Json);
    await saveEntry({ ...entry, state: 'conflict', lastError: outcome.error, current: outcome.current });
    return;
  }
  if (outcome.kind === 'rejected') { await saveEntry({ ...entry, state: 'rejected', lastError: outcome.error }); return; }
  if (outcome.kind === 'auth' || outcome.kind === 'blocked') { await saveEntry({ ...entry, state: 'blocked', lastError: outcome.error }); return; }
  const attempts = entry.attempts + 1;
  await saveEntry({ ...entry, state: 'retrying', attempts, nextAttemptAt: Date.now() + backoff(attempts), lastError: outcome.error });
}

// ---------------------------------------------------------------- the adapter used by every API call

async function handleMutation(request: OfflineRequest): Promise<{ data: unknown } | undefined> {
  const rule = RULES.find((r) => r.method === request.method && r.pattern.test(request.path));
  const s = scope();
  if (!rule || !me || !s) return undefined;
  let body: Json;
  try { body = request.body ? JSON.parse(request.body) as Json : {}; } catch { return undefined; }
  const id = Number(rule.pattern.exec(request.path)![1]);
  const capturedAt = new Date().toISOString();
  // Keep the moment it really happened, whenever it reaches the server.
  if (rule.kind === 'dose-status' && body.status === 'taken') body.takenAt ??= capturedAt;
  if (rule.kind === 'health-metric' || rule.kind === 'health-log') body.recordedAt ??= capturedAt;
  const patientId = rule.kind === 'dose-status' ? await dosePatientId(id) : id;
  const entry: OutboxEntry = {
    id: randomId(), scope: s, userId: me.id, kind: rule.kind, method: request.method, path: request.path, body,
    capturedAt, createdAt: Date.now(), patientId, entityId: rule.kind === 'dose-status' ? id : undefined,
    tempId: nextTempId(), state: 'pending', attempts: 0, nextAttemptAt: 0, label: labelFor(rule.kind, body),
  };
  // A newer change to the same dose replaces older ones that haven't been sent yet.
  if (rule.kind === 'dose-status') {
    for (const old of mine().filter((e) => e.kind === 'dose-status' && e.entityId === id && e.state !== 'syncing')) await removeEntry(old.id);
  }
  // Saved on the device before anything else, so closing the app now loses nothing.
  await saveEntry(entry);
  const queueAhead = mine().some((e) => e.id !== entry.id && APPLIES.includes(e.state) && e.state !== 'blocked');
  if (queueAhead || !navigator.onLine) {
    void syncNow();
    return { data: await optimistic(entry) };
  }
  // Marked as in flight so the background sync doesn't send it a second time meanwhile.
  await saveEntry({ ...entry, state: 'syncing', nextAttemptAt: Date.now() + 60_000 });
  const outcome = await send(entry);
  if (outcome.kind === 'ok') {
    await applyOutcome(entry, outcome);
    void syncNow();
    return { data: outcome.data };
  }
  if (outcome.kind === 'rejected' || outcome.kind === 'conflict' || outcome.kind === 'blocked') {
    // The user is online and sees the server's answer right away, as before offline mode.
    await removeEntry(entry.id);
    throw new ChangeRefused(outcome.error, outcome.kind === 'rejected' ? outcome.status : outcome.kind === 'conflict' ? 409 : 403);
  }
  await applyOutcome(entry, outcome);
  return { data: await optimistic({ ...entry, state: outcome.kind === 'auth' ? 'blocked' : 'retrying' }) };
}

async function optimistic(entry: OutboxEntry): Promise<Json> {
  if (entry.kind !== 'dose-status') return localRecord(entry);
  return { ...(await findCachedDose(entry.entityId!)), id: entry.entityId, ...localRecord(entry) };
}
async function findCachedDose(doseId: number): Promise<Json> {
  const prefix = `${scope()}|`;
  for (const key of (await idbKeys(CACHE)).map(String).filter((k) => k.startsWith(`${prefix}/api/doses`) || /\|\/api\/patients\/\d+$/.test(k))) {
    const saved = await idbGet<{ data: unknown }>(CACHE, key);
    const list = isArr(saved?.data) ? saved!.data : (saved?.data as Json | undefined)?.recentDoses;
    const dose = isArr(list) ? list.find((d) => d.id === doseId) : undefined;
    if (dose) return dose;
  }
  return {};
}
async function dosePatientId(doseId: number): Promise<number> {
  return Number((await findCachedDose(doseId)).patientId) || 0;
}

async function afterGet(request: OfflineRequest, data: unknown): Promise<unknown> {
  if (request.path === '/api/auth/me' && data && typeof data === 'object' && 'id' in data) {
    await setMe(data as Me);
    // Signed in again (or finished the privacy/password step): upload what was waiting for it.
    if (mine().some((e) => e.state === 'blocked')) void syncNow(true);
  }
  if (savable(request.path) && (me || request.path === '/api/auth/me') && !(data instanceof Blob)) {
    await idbPut(CACHE, { data, savedAt: Date.now() }, cacheKey(request.path)).catch(() => { /* storage full: still show live data */ });
  }
  return overlay(request.path, data);
}

async function onUnreachable(request: OfflineRequest): Promise<{ data: unknown } | undefined> {
  if (!savable(request.path)) return undefined;
  if (request.path !== '/api/auth/me' && !me) return undefined;
  const saved = await idbGet<{ data: unknown; savedAt: number }>(CACHE, cacheKey(request.path));
  if (!saved) return undefined;
  if (request.path === '/api/auth/me' && saved.data && typeof saved.data === 'object' && 'id' in saved.data) await setMe(saved.data as Me);
  showingSavedAt = showingSavedAt === null ? saved.savedAt : Math.min(showingSavedAt, saved.savedAt);
  emit();
  return { data: overlay(request.path, saved.data) };
}

// ---------------------------------------------------------------- automatic sync

let running: Promise<void> | null = null;
let rerun = false;

/** Uploads waiting changes, oldest first. Safe to call often; only one run at a time (across tabs too). */
export function syncNow(force = false): Promise<void> {
  if (running) { rerun = true; return running; }
  running = (async () => {
    try {
      const work = () => runSync(force);
      const locks = (navigator as Navigator & { locks?: { request: (name: string, options: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void> } }).locks;
      if (locks) await locks.request('caretrack-sync', { ifAvailable: true }, async (lock) => { if (lock) await work(); });
      else await work();
    } finally {
      running = null;
      if (rerun) { rerun = false; void syncNow(); }
    }
  })();
  return running;
}

async function runSync(force: boolean): Promise<void> {
  if (!me || !navigator.onLine) return;
  await reloadOutbox();
  const due = mine().filter((e) => e.state === 'pending' || (e.state === 'retrying' && (force || e.nextAttemptAt <= Date.now())) || (e.state === 'blocked' && force) || (e.state === 'syncing' && e.nextAttemptAt <= Date.now()));
  if (!due.length) return;
  syncing = true;
  emit();
  let uploaded = 0;
  try {
    for (const entry of due) {
      // If the app closes mid-upload, this entry is retried later (the server ignores the duplicate).
      await saveEntry({ ...entry, state: 'syncing', nextAttemptAt: Date.now() + 60_000 });
      const outcome = await send(entry);
      await applyOutcome(entry, outcome);
      if (outcome.kind === 'ok') uploaded += 1;
      // No connection or signed out: stop and keep the rest in order.
      if (outcome.kind === 'unreachable' || outcome.kind === 'auth') {
        for (const rest of due.slice(due.indexOf(entry) + 1)) {
          const latest = entries.find((e) => e.id === rest.id);
          if (latest && outcome.kind === 'auth') await saveEntry({ ...latest, state: 'blocked', lastError: outcome.error });
        }
        break;
      }
    }
  } finally {
    syncing = false;
    if (uploaded) {
      justSynced = uploaded;
      lastSyncedAt = Date.now();
      window.clearTimeout(justSyncedTimer);
      justSyncedTimer = window.setTimeout(() => { justSynced = 0; emit(); }, 6_000);
      syncedListeners.forEach((listener) => listener());
    }
    emit();
  }
}

// ---------------------------------------------------------------- actions for the sync panel

/** "Keep my change": send it again without the conflict check. */
export async function keepMine(id: string): Promise<void> {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  await saveEntry({ ...entry, state: 'pending', force: true, lastError: undefined, current: undefined, attempts: 0, nextAttemptAt: 0 });
  await syncNow();
}
/** Removes a change that was refused or lost a conflict. Only ever called by the user. */
export async function discardChange(id: string): Promise<void> {
  await removeEntry(id);
  syncedListeners.forEach((listener) => listener());
}
/** Tries waiting and blocked changes right away (e.g. after signing in again). */
export const retryAll = () => syncNow(true);

async function checkServerReachability(): Promise<void> {
  if (!navigator.onLine) {
    setReachable(false);
    return;
  }
  try {
    await customFetch('/api/healthz');
  } catch (error) {
    if (!(error instanceof OfflineError)) console.warn('CareTrack server health check failed', error);
  }
}

/** Waiting changes for the signed-in user, for the sign-out warning. */
export const unsyncedCount = () => mine().length;

/**
 * Sign-out: removes every saved copy of server data from this device. Changes not yet
 * uploaded are kept (they are the user's own entries) and upload when that user signs in again.
 */
export async function clearSavedData(): Promise<void> {
  me = null;
  showingSavedAt = null;
  await Promise.all([idbClear(CACHE), idbDelete(META, 'last-user')]).catch(() => {});
  emit();
}

// ---------------------------------------------------------------- start-up

/** Doses queued by the previous version of the app (localStorage), moved into the outbox. */
async function migrateLegacyQueue(): Promise<void> {
  let legacy: { id: number; status: string; takenAt: string }[] = [];
  try { legacy = JSON.parse(localStorage.getItem('caretrack-offline-doses') || '[]'); } catch { /* unreadable */ }
  if (!legacy.length || !me) return;
  const s = scope()!;
  for (const item of legacy) {
    const body: Json = { status: item.status, ...(item.status === 'taken' ? { takenAt: item.takenAt } : {}) };
    await saveEntry({
      id: randomId(), scope: s, userId: me.id, kind: 'dose-status', method: 'PATCH', path: `/api/doses/${item.id}/status`, body,
      capturedAt: item.takenAt, createdAt: Date.now(), patientId: await dosePatientId(item.id), entityId: item.id, tempId: nextTempId(),
      state: 'pending', attempts: 0, nextAttemptAt: 0, label: labelFor('dose-status', body),
    });
  }
  try { localStorage.removeItem('caretrack-offline-doses'); } catch { /* ignore */ }
}

/** Starts offline mode. Call once, after the Android server address is known. */
export async function initOffline(): Promise<void> {
  const last = await idbGet<Me & { server: string }>(META, 'last-user').catch(() => undefined);
  if (last && last.server === server()) me = { id: last.id, name: last.name, role: last.role };
  await reloadOutbox().catch(() => {});
  await migrateLegacyQueue().catch(() => {});
  // Entries interrupted mid-upload by the app closing go back to waiting.
  for (const e of entries.filter((x) => x.state === 'syncing')) await saveEntry({ ...e, state: 'pending' });
  setOfflineAdapter({ handleMutation, afterGet, onUnreachable, onReachable: setReachable });
  window.addEventListener('online', () => { void checkServerReachability(); void syncNow(); });
  window.addEventListener('offline', () => { emit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { void checkServerReachability(); void syncNow(); } });
  window.setInterval(() => {
    if (!reachable) void checkServerReachability();
    if (mine().some((e) => e.state !== 'conflict' && e.state !== 'rejected')) void syncNow();
  }, 15_000);
  emit();
  void checkServerReachability();
  void syncNow();
}

/** Marker on records shown from the device: undefined once the server has them. */
export const syncStateOf = (record: unknown): SyncState | undefined => (record && typeof record === 'object' ? (record as { _sync?: SyncState })._sync : undefined);
export const syncErrorOf = (record: unknown): string | undefined => (record && typeof record === 'object' ? (record as { _syncError?: string })._syncError : undefined);
