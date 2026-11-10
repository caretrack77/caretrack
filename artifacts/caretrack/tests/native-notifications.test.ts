// Android scheduling logic with the Capacitor notification plugin replaced by an in-memory list
// of pending alarms.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Pending = { id: number; title: string; body: string; schedule?: { at: Date }; channelId?: string; extra?: Record<string, unknown> };
const phone = vi.hoisted(() => ({ pending: new Map<number, Pending>(), shown: [] as Pending[], permission: "granted" }));

vi.mock("../src/native", () => ({ isNativeApp: true }));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: phone.permission }),
    requestPermissions: async () => ({ display: phone.permission }),
    createChannel: async () => {},
    addListener: async () => ({ remove: async () => {} }),
    getPending: async () => ({ notifications: [...phone.pending.values()] }),
    schedule: async ({ notifications }: { notifications: Pending[] }) => {
      for (const n of notifications) {
        if (n.schedule) phone.pending.set(n.id, n); // same ID replaces, like Android
        else phone.shown.push(n);
      }
    },
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => { for (const n of notifications) phone.pending.delete(n.id); },
    removeAllDeliveredNotifications: async () => {},
    checkExactNotificationSetting: async () => ({ exact_alarm: "granted" }),
  },
}));

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  const data = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  // The same message library the service worker uses (assigns globalThis.CareTrackWellness).
  new Function(readFileSync(fileURLToPath(new URL("../public/wellness.js", import.meta.url)), "utf8"))();
});

const N = await import("../src/native-notifications");
const at = (h: number, m = 0, day = 10) => new Date(2026, 10, day, h, m, 0, 0);
const dose = (id: number, time: Date, status = "scheduled") => ({ id, status, scheduledTime: time.toISOString(), medicationName: "Metformin", dosage: "500 mg" });
const WELLNESS = 1_900_000_000;
const wellnessPending = () => [...phone.pending.values()].filter((n) => n.id >= WELLNESS).sort((a, b) => +a.schedule!.at - +b.schedule!.at);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(7, 0));
  phone.pending.clear(); phone.shown = []; phone.permission = "granted";
  localStorage.removeItem("caretrack-wellness-native");
});
afterEach(() => vi.useRealTimers());

describe("medication reminders on the phone", () => {
  it("schedules upcoming doses once, however often the list is synced", async () => {
    const doses = [dose(11, at(8)), dose(12, at(20)), dose(13, at(6), "taken")];
    await N.syncNativeDoseReminders(doses);
    await N.syncNativeDoseReminders(doses);
    await N.syncNativeDoseReminders(doses);
    expect([...phone.pending.keys()].sort()).toEqual([11, 12]);
    const reminder = phone.pending.get(11)!;
    expect(reminder.title).toBe("CareTrack dose reminder: Metformin");
    expect(reminder.channelId).toBe(N.DOSE_CHANNEL);
    expect(+reminder.schedule!.at).toBe(+at(8));
  });

  it("cancels the reminder when the dose is logged, and moves it when rescheduled", async () => {
    await N.syncNativeDoseReminders([dose(11, at(8)), dose(12, at(20))]);
    await N.syncNativeDoseReminders([dose(11, at(8), "taken"), dose(12, at(21))]);
    expect(phone.pending.has(11)).toBe(false);
    expect(+phone.pending.get(12)!.schedule!.at).toBe(+at(21));
  });

  it("does nothing without notification permission", async () => {
    phone.permission = "denied";
    await N.syncNativeDoseReminders([dose(11, at(8))]);
    expect(phone.pending.size).toBe(0);
  });
});

describe("wellness tips on the phone", () => {
  it("schedules 4 tips a day for 5 days between 8 AM and 9 PM, with no repeats", async () => {
    await N.syncNativeWellness({ frequency: "normal", name: "Alex Morgan" });
    const tips = wellnessPending();
    expect(tips).toHaveLength(20);
    for (const t of tips) {
      const h = t.schedule!.at.getHours();
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThan(21);
      expect(t.title).toMatch(/^(💧|💪|🩺|✨) /);
      expect(t.channelId).toBe(N.WELLNESS_CHANNEL);
    }
    const bodies = tips.map((t) => t.body);
    for (let i = 0; i < bodies.length; i++) expect(bodies.slice(Math.max(0, i - 15), i)).not.toContain(bodies[i]);
  });

  it("re-syncing replaces tips instead of adding more, and keeps each day's times", async () => {
    await N.syncNativeWellness({ frequency: "normal", name: "Alex" });
    const first = wellnessPending().map((t) => +t.schedule!.at);
    await N.syncNativeWellness({ frequency: "normal", name: "Alex" });
    await N.syncNativeWellness({ frequency: "normal", name: "Alex" });
    expect(wellnessPending().map((t) => +t.schedule!.at)).toEqual(first);
  });

  it("2 a day when set to low; none when off; dose reminders are left alone", async () => {
    await N.syncNativeDoseReminders([dose(11, at(9))]);
    await N.syncNativeWellness({ frequency: "low", name: "Alex" });
    expect(wellnessPending()).toHaveLength(10);
    await N.syncNativeWellness({ frequency: "off", name: "Alex" });
    expect(wellnessPending()).toHaveLength(0);
    expect(phone.pending.has(11)).toBe(true);
  });

  it("personalizes today's tips from today's doses only", async () => {
    vi.setSystemTime(at(17, 0));
    const doses = [dose(1, at(8), "taken"), dose(2, at(13), "taken")];
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      localStorage.removeItem("caretrack-wellness-native");
      await N.syncNativeWellness({ frequency: "normal", name: "Alex Morgan", doses });
      const today = wellnessPending().filter((t) => t.schedule!.at.getDate() === 10);
      today.forEach((t) => seen.add(t.body));
      wellnessPending().filter((t) => t.schedule!.at.getDate() !== 10).forEach((t) => expect(t.body).not.toMatch(/doses? today|scheduled for today/));
    }
    expect([...seen]).toContain("Great job, Alex! You've taken all 2 doses scheduled for today. 🎉");
  });

  it("sign-out removes every scheduled reminder and tip", async () => {
    await N.syncNativeDoseReminders([dose(11, at(9))]);
    await N.syncNativeWellness({ frequency: "normal", name: "Alex" });
    await N.clearNativeNotifications();
    expect(phone.pending.size).toBe(0);
  });

  it("'Send a tip now' shows one immediately", async () => {
    await N.previewNativeWellness("Alex");
    expect(phone.shown).toHaveLength(1);
    expect(phone.shown[0].channelId).toBe(N.WELLNESS_CHANNEL);
  });
});
