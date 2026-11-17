// CareTrack offline support: the app's screens.
// Network first: always try the server, and keep a copy of every page, script, style and
// image it loads, so the website opens without internet. API data is NOT cached here:
// the app saves it per signed-in user in IndexedDB and queues changes made offline
// (see src/offline.ts), which works the same in the browser and the Android app.
// Wellness tips (motivation, hydration, health tips, quotes) are stored on the device and
// shown as local notifications, so they also work with no internet. See wellness.js.
importScripts("/wellness.js");
const Wellness = self.CareTrackWellness;

// v2: API responses are no longer kept here; activation deletes the v1 cache that had them.
const CACHE = "caretrack-shell-v2";
const SHELL = "/__app-shell";
const cacheable = (url) => url.origin === self.location.origin && !url.pathname.startsWith("/api/");

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().catch(() => {}).then(() => self.skipWaiting()));
});
/**
 * Saves the start page and the scripts/styles it references during installation. On the very
 * first visit these load before the worker is in control, so without this an offline refresh
 * would find the page but not its code.
 */
async function precacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch(new Request("/", { cache: "reload" }));
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put("/", response.clone());
  await cache.put(SHELL, response);
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|svg|png|webmanifest))"/g)].map((m) => m[1]);
  await Promise.all([...new Set(assets)].map((path) => cache.add(path).catch(() => {})));
}
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([
  self.clients.claim(),
  // Best effort: a failed clean-up must not stop the reminders below from being restored.
  Promise.resolve().then(() => caches.keys()).then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))).catch(() => {}),
  wakeUp(),
])));

self.addEventListener("message", (event) => {
  // Sent on sign-out so another user of the same device doesn't get their reminders. (The cache
  // here only holds the app's screens; saved patient data is removed by the app itself.)
  if (event.data === "clear-cache") event.waitUntil(clearLocalReminders());
  if (event.data?.type === "cache-dose-schedule") event.waitUntil(cacheDoseSchedule(event.data.doses));
  if (event.data?.type === "wellness-config") event.waitUntil(idbPut("wellness-config", event.data.config).then(wellnessTick));
  if (event.data?.type === "wellness-tick") event.waitUntil(wakeUp());
  if (event.data?.type === "wellness-preview") event.waitUntil(wellnessPreview());
});

// Chrome can wake an installed app a few times a day, even while it is closed.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === WELLNESS_TAG) event.waitUntil(wakeUp());
});

/** Runs whenever the worker wakes: re-arms dose reminders and checks for a due wellness tip. */
async function wakeUp() {
  if (reminderTimers.size === 0) scheduleCachedReminders((await idbGet("schedule")) || []);
  await wellnessTick();
}

const DB_NAME = "caretrack-offline";
const DB_STORE = "reminders";
function reminderDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function idbGet(key) {
  const db = await reminderDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function idbPut(key, value) {
  const db = await reminderDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function cacheDoseSchedule(doses) {
  await idbPut("schedule", doses || []);
  scheduleCachedReminders(doses || []);
}
async function clearLocalReminders() {
  reminderTimers.forEach((timer) => clearTimeout(timer));
  reminderTimers.clear();
  clearTimeout(wellnessTimer);
  await Promise.all([idbPut("schedule", []), idbPut("wellness-config", null), idbPut("wellness-state", null)]);
}
const reminderTimers = new Map();
function scheduleCachedReminders(doses) {
  reminderTimers.forEach((timer) => clearTimeout(timer));
  reminderTimers.clear();
  for (const dose of doses) {
    if (dose.status !== "scheduled") continue;
    const delay = new Date(dose.scheduledTime).getTime() - Date.now();
    if (delay < 0 || delay > 2 * 24 * 60 * 60 * 1000) continue;
    const timer = setTimeout(async () => {
      if (!("showNotification" in self.registration)) return;
      await self.registration.showNotification(`CareTrack dose reminder: ${dose.medicationName}`, {
        body: `${dose.dosage || "Dose"} is due now.`,
        tag: `dose-${dose.id}`, icon: "/icon-192.png", badge: "/icon-192.png",
        // Not silent: the phone plays its notification sound and vibrates. It stays until
        // the person taps or swipes it away, so a reminder isn't missed.
        silent: false, vibrate: [200, 100, 200], requireInteraction: true,
        data: { url: "/today", doseId: dose.id },
      });
    }, Math.min(delay, 2147483647));
    reminderTimers.set(dose.id, timer);
  }
}

// ---- Wellness notifications ----
// Today's random delivery times, recently shown messages and the last time one was shown are
// kept in IndexedDB, so the plan survives the worker restarting and needs no server.
const WELLNESS_TAG = "caretrack-wellness";
let wellnessTimer = null;
let wellnessLock = Promise.resolve();
/** One check at a time, so two wake-ups can't send the same tip twice. */
function withWellnessLock(task) {
  const run = wellnessLock.then(task, task);
  wellnessLock = run.catch(() => {});
  return run;
}
function canNotify() {
  return typeof Notification !== "undefined" && Notification.permission === "granted" && "showNotification" in self.registration;
}
async function showWellness(state, config, doses, now) {
  const activity = Wellness.activityFrom(doses, new Date(now));
  const message = Wellness.pickMessage({
    period: Wellness.periodOf(new Date(now)), activity, recent: state.recent, lastCategory: state.lastCategory,
  });
  const note = Wellness.render(message, { name: config?.name, activity });
  state.recent = Wellness.remember(state.recent, message.id);
  state.lastCategory = message.category;
  state.lastShownAt = now;
  await idbPut("wellness-state", state); // saved first, so a crash can't cause a repeat
  await self.registration.showNotification(note.title, {
    body: note.body,
    tag: WELLNESS_TAG, // a new tip replaces an unread one instead of piling up
    icon: "/favicon.svg", badge: "/favicon.svg",
    data: { url: "/", kind: "wellness", category: note.category, messageId: note.id },
  });
}
function wellnessTick() {
  return withWellnessLock(async () => {
    clearTimeout(wellnessTimer);
    const config = await idbGet("wellness-config");
    if (!config?.enabled || config.frequency === "off") return;
    const now = Date.now();
    const today = new Date(now);
    const state = (await idbGet("wellness-state")) || { recent: [] };
    if (state.plan?.day !== Wellness.dayKey(today) || state.plan?.frequency !== config.frequency) {
      state.plan = Wellness.planDay(today, config.frequency);
    }
    const doses = (await idbGet("schedule")) || [];
    const { doseTimes } = Wellness.activityFrom(doses, today);
    const result = Wellness.decide(state.plan, now, { lastShownAt: state.lastShownAt, doseTimes });
    state.plan = { ...state.plan, slots: result.slots };
    if (result.deliver >= 0 && canNotify()) await showWellness(state, config, doses, now);
    else await idbPut("wellness-state", state);
    // Works while the worker stays awake; otherwise the next wake-up catches up.
    if (result.nextAt) wellnessTimer = setTimeout(wellnessTick, Math.min(Math.max(result.nextAt - now, 1000), 2147483647));
  });
}
/** "Send a tip now" in the notification settings, for trying it out. */
function wellnessPreview() {
  return withWellnessLock(async () => {
    if (!canNotify()) return;
    const state = (await idbGet("wellness-state")) || { recent: [] };
    await showWellness(state, await idbGet("wellness-config"), (await idbGet("schedule")) || [], Date.now());
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!cacheable(url)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => {
            cache.put(request, copy.clone());
            if (request.mode === "navigate") cache.put(SHELL, copy);
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = (await caches.match(request)) || (request.mode === "navigate" ? await caches.match(SHELL) : undefined);
        if (cached) return cached;
        return new Response("You're offline and this page hasn't been saved on this device yet.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/today";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "navigate" in client);
    return existing ? existing.navigate(url) : self.clients.openWindow(url);
  }));
});
