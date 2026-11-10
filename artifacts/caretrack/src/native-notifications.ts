// Android notifications for the CareTrack app: medication reminders and wellness tips are
// scheduled with Android's alarm system (@capacitor/local-notifications), so they appear on
// time with no internet and while the app is closed. In the browser the service worker
// (public/sw.js) does this job instead, and these functions do nothing.
//
// Duplicates are avoided with stable IDs: a dose always uses its dose ID, so re-scheduling it
// replaces the pending alarm instead of adding a second one. Wellness tips use their own range.
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { isNativeApp } from './native';

type Dose = { id: number; status: string; scheduledTime: string; medicationName: string; dosage?: string | null };
type Activity = { total: number; taken: number; missed: number; remaining: number; doseTimes: number[] };
type Message = { id: string; category: string };
type Plan = { day: string; frequency: string; slots: { at: number; period: string }[] };
type WellnessLib = {
  dayKey(d: Date): string;
  periodOf(d: Date): string;
  planDay(d: Date, frequency: string): Plan;
  activityFrom(doses: Dose[], now: Date): Activity;
  pickMessage(input: { period: string; activity?: Activity; recent?: string[]; lastCategory?: string }): Message;
  render(msg: Message, ctx: { name?: string; activity?: Activity }): { title: string; body: string; category: string };
  remember(recent: string[], id: string): string[];
};

export const DOSE_CHANNEL = 'dose-reminders';
export const WELLNESS_CHANNEL = 'wellness-tips';
const DOSE_ID_LIMIT = 1_800_000_000; // dose notifications use the dose ID (always below this)
const WELLNESS_BASE = 1_900_000_000; // wellness tips use 1,900,000,000 and up
const PREVIEW_ID = WELLNESS_BASE - 1;
const WELLNESS_DAYS = 5; // tips are scheduled this many days ahead, refreshed whenever the app opens
const DOSE_HORIZON = 2 * 24 * 60 * 60 * 1000;
const MINUTE = 60_000;
const STATE_KEY = 'caretrack-wellness-native';

let wellness: Promise<WellnessLib> | null = null;
/** The shared wellness message library (public/wellness.js), bundled with the app. */
function loadWellness(): Promise<WellnessLib> {
  const existing = (window as unknown as { CareTrackWellness?: WellnessLib }).CareTrackWellness;
  if (existing) return Promise.resolve(existing);
  wellness ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/wellness.js';
    script.onload = () => resolve((window as unknown as { CareTrackWellness: WellnessLib }).CareTrackWellness);
    script.onerror = () => { wellness = null; reject(new Error('wellness library missing')); };
    document.head.appendChild(script);
  });
  return wellness;
}

let channelsReady: Promise<void> | null = null;
/** Creates the Android notification channels and opens the right screen when a notification is tapped. */
export function setupNativeNotifications(navigate: (path: string) => void): void {
  if (!isNativeApp) return;
  channelsReady ??= Promise.all([
    LocalNotifications.createChannel({ id: DOSE_CHANNEL, name: 'Medication reminders', description: 'Reminders when a dose is due', importance: 5, visibility: 1, vibration: true }),
    LocalNotifications.createChannel({ id: WELLNESS_CHANNEL, name: 'Wellness tips', description: 'Hydration reminders, health tips, motivation and quotes', importance: 3, visibility: 1 }),
  ]).then(() => undefined).catch(() => undefined);
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const url = (action.notification.extra as { url?: string } | undefined)?.url;
    if (url) navigate(url);
  });
}

export type NativePermission = 'granted' | 'denied' | 'prompt';
export async function notificationPermission(): Promise<NativePermission> {
  if (!isNativeApp) return 'denied';
  const { display } = await LocalNotifications.checkPermissions();
  return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
}
/** Asks for the Android 13+ notification permission (once; Android remembers a refusal). */
export async function requestNotificationPermission(): Promise<NativePermission> {
  if (!isNativeApp) return 'denied';
  const { display } = await LocalNotifications.requestPermissions();
  return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
}
/** Android 12+ may delay alarms unless "Alarms & reminders" is allowed for the app. */
export async function exactAlarmsAllowed(): Promise<boolean> {
  if (!isNativeApp) return true;
  try { return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted'; } catch { return true; }
}
export async function openExactAlarmSettings(): Promise<void> {
  try { await LocalNotifications.changeExactNotificationSetting(); } catch { /* older Android: always exact */ }
}

async function pendingIds(): Promise<Map<number, LocalNotificationSchema>> {
  const { notifications } = await LocalNotifications.getPending();
  return new Map(notifications.map((n) => [n.id, n as LocalNotificationSchema]));
}

/**
 * Keeps phone alarms in line with the dose list: schedules upcoming doses, and cancels the
 * reminder of a dose that was taken, skipped or rescheduled. Safe to call repeatedly.
 */
export async function syncNativeDoseReminders(doses: Dose[]): Promise<void> {
  if (!isNativeApp || (await notificationPermission()) !== 'granted') return;
  await channelsReady;
  const pending = await pendingIds();
  const now = Date.now();
  const cancel: { id: number }[] = [];
  const schedule: LocalNotificationSchema[] = [];
  for (const dose of doses) {
    if (dose.id <= 0 || dose.id >= DOSE_ID_LIMIT) continue;
    const at = new Date(dose.scheduledTime).getTime();
    const wanted = dose.status === 'scheduled' && at > now && at - now < DOSE_HORIZON;
    const existing = pending.get(dose.id);
    if (!wanted) { if (existing) cancel.push({ id: dose.id }); continue; }
    const existingAt = existing?.schedule?.at ? new Date(existing.schedule.at).getTime() : null;
    if (existingAt === at) continue; // already scheduled for this time
    schedule.push({
      id: dose.id,
      title: `CareTrack dose reminder: ${dose.medicationName}`,
      body: `${dose.dosage || 'Dose'} is due now. Open CareTrack to log it.`,
      schedule: { at: new Date(at), allowWhileIdle: true },
      channelId: DOSE_CHANNEL,
      extra: { url: '/today', kind: 'dose', doseId: dose.id },
    });
  }
  if (cancel.length) await LocalNotifications.cancel({ notifications: cancel });
  if (schedule.length) await LocalNotifications.schedule({ notifications: schedule });
}

type WellnessState = {
  plans: Record<string, Plan>;
  scheduled: { id: number; at: number; messageId: string; category: string }[];
  recent: string[];
  lastCategory?: string;
};
const readState = (): WellnessState => {
  try { return { plans: {}, scheduled: [], recent: [], ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') }; } catch { return { plans: {}, scheduled: [], recent: [] }; }
};
const writeState = (state: WellnessState) => { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage full */ } };

let wellnessQueue: Promise<void> = Promise.resolve();
/** One wellness update at a time, so two quick changes can't schedule the same tips twice. */
function queued(task: () => Promise<void>): Promise<void> {
  wellnessQueue = wellnessQueue.then(task, task).catch(() => undefined);
  return wellnessQueue;
}

/**
 * Schedules the next few days of wellness tips on the phone: the same random daily slots,
 * time-of-day matching and no-repeat rules as the web version. Today's tips are personalized
 * from today's doses; each call replaces the previously scheduled tips.
 */
export function syncNativeWellness(options: { frequency: 'off' | 'low' | 'normal'; name: string; doses?: Dose[] }): Promise<void> {
  return queued(async () => {
    if (!isNativeApp) return;
    const pending = await pendingIds();
    const old = [...pending.keys()].filter((id) => id >= WELLNESS_BASE).map((id) => ({ id }));
    if (old.length) await LocalNotifications.cancel({ notifications: old });

    const W = await loadWellness();
    const state = readState();
    const now = Date.now();
    // Tips whose time has passed were shown: remember them so they aren't repeated soon.
    for (const item of state.scheduled.filter((s) => s.at <= now).sort((a, b) => a.at - b.at)) {
      state.recent = W.remember(state.recent, item.messageId);
      state.lastCategory = item.category;
    }
    state.scheduled = [];
    const today = W.dayKey(new Date(now));
    for (const day of Object.keys(state.plans)) if (day < today) delete state.plans[day];

    if (options.frequency === 'off' || (await notificationPermission()) !== 'granted') { writeState(state); return; }
    await channelsReady;

    const activity = W.activityFrom(options.doses || [], new Date(now));
    let recent = state.recent;
    let last = state.lastCategory;
    const notifications: LocalNotificationSchema[] = [];
    for (let offset = 0; offset < WELLNESS_DAYS; offset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      const key = W.dayKey(date);
      // A day's random times are kept once chosen, so reopening the app never adds extra tips.
      if (!state.plans[key] || state.plans[key].frequency !== options.frequency) state.plans[key] = W.planDay(date, options.frequency);
      for (const slot of state.plans[key].slots) {
        let at = slot.at;
        if (at <= now) continue;
        if (activity.doseTimes.some((t) => Math.abs(t - at) < 10 * MINUTE)) at += 15 * MINUTE; // don't clash with a dose reminder
        const dayActivity = offset === 0 ? activity : undefined;
        const message = W.pickMessage({ period: slot.period, activity: dayActivity, recent, lastCategory: last });
        const note = W.render(message, { name: options.name, activity: dayActivity });
        recent = W.remember(recent, message.id);
        last = message.category;
        const id = WELLNESS_BASE + notifications.length;
        notifications.push({
          id, title: note.title, body: note.body, largeBody: note.body,
          schedule: { at: new Date(at), allowWhileIdle: true },
          channelId: WELLNESS_CHANNEL,
          extra: { url: '/', kind: 'wellness', category: note.category },
        });
        state.scheduled.push({ id, at, messageId: message.id, category: message.category });
      }
    }
    writeState(state);
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  });
}

/** "Send a tip now" in the notification settings. */
export function previewNativeWellness(name: string, doses: Dose[] = []): Promise<void> {
  return queued(async () => {
    if (!isNativeApp || (await notificationPermission()) !== 'granted') return;
    await channelsReady;
    const W = await loadWellness();
    const state = readState();
    const now = new Date();
    const activity = W.activityFrom(doses, now);
    const message = W.pickMessage({ period: W.periodOf(now), activity, recent: state.recent, lastCategory: state.lastCategory });
    const note = W.render(message, { name, activity });
    state.recent = W.remember(state.recent, message.id);
    state.lastCategory = message.category;
    writeState(state);
    await LocalNotifications.schedule({ notifications: [{ id: PREVIEW_ID, title: note.title, body: note.body, largeBody: note.body, channelId: WELLNESS_CHANNEL, extra: { url: '/', kind: 'wellness' } }] });
  });
}

/** Sign-out: removes every scheduled reminder and tip so the next person on this phone gets none. */
export async function clearNativeNotifications(): Promise<void> {
  if (!isNativeApp) return;
  try {
    const pending = await pendingIds();
    if (pending.size) await LocalNotifications.cancel({ notifications: [...pending.keys()].map((id) => ({ id })) });
    await LocalNotifications.removeAllDeliveredNotifications();
  } catch { /* nothing scheduled */ }
  try { localStorage.removeItem(STATE_KEY); } catch { /* storage unavailable */ }
}
