import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const wellnessSource = readFileSync(`${publicDir}wellness.js`, "utf8");
const swSource = readFileSync(`${publicDir}sw.js`, "utf8");

type Msg = { id: string; category: string; title: string; body: string; periods?: string[]; when?: string };
type Wellness = {
  MESSAGES: Msg[];
  CATEGORIES: Record<string, { label: string; emoji: string }>;
  FREQUENCIES: Record<string, number[]>;
  RECENT_LIMIT: number;
  periodOf(d: Date): string;
  planDay(d: Date, f: string, rng?: () => number): { day: string; frequency: string; slots: { at: number; period: string; done: boolean }[] };
  activityFrom(doses: unknown[], now: Date): { total: number; taken: number; missed: number; remaining: number; doseTimes: number[] };
  decide(plan: unknown, now: number, opts?: { lastShownAt?: number; doseTimes?: number[] }): { slots: { at: number; done: boolean; skipped?: string }[]; deliver: number; nextAt: number | null };
  pickMessage(input: { period: string; activity?: unknown; recent?: string[]; lastCategory?: string; rng?: () => number }): Msg;
  render(msg: Msg, ctx: { name?: string; activity?: unknown }): { title: string; body: string; category: string };
  remember(recent: string[], id: string): string[];
};

let W: Wellness;
beforeAll(() => {
  const ctx = vm.createContext({});
  vm.runInContext(wellnessSource, ctx);
  W = (ctx as { CareTrackWellness: Wellness }).CareTrackWellness;
});

const at = (h: number, m = 0) => new Date(2026, 10, 10, h, m, 0, 0);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const noDoses = { total: 0, taken: 0, missed: 0, remaining: 0 };

describe("wellness message library", () => {
  it("has 20+ unique messages in every category, each with a title, text and emoji", () => {
    expect(W.MESSAGES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(W.MESSAGES.map((m) => m.id)).size).toBe(W.MESSAGES.length);
    for (const category of ["hydration", "motivation", "tip", "quote"]) {
      expect(W.MESSAGES.filter((m) => m.category === category).length).toBeGreaterThanOrEqual(5);
      expect(W.CATEGORIES[category].emoji).toBeTruthy();
    }
    for (const m of W.MESSAGES) {
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.body.length).toBeLessThan(140); // short enough for a notification
    }
  });

  it("shows the category, emoji and fills in the user's first name and dose counts", () => {
    const p2 = W.MESSAGES.find((m) => m.id === "p2")!;
    const n = W.render(p2, { name: "Ana Santos", activity: { total: 3, taken: 1, remaining: 2 } });
    expect(n.title).toBe("💪 Motivation · Nice progress");
    expect(n.body).toBe("You've taken 1 of 3 doses today. Keep going, Ana!");
    expect(W.render(p2, { activity: { total: 3, taken: 1, remaining: 2 } }).body).toBe("You've taken 1 of 3 doses today. Keep going!");
    const p1 = W.MESSAGES.find((m) => m.id === "p1")!;
    expect(W.render(p1, { activity: { total: 1, taken: 1, remaining: 0 } }).body).toContain("all 1 dose scheduled");
    for (const m of W.MESSAGES) expect(W.render(m, { name: "Ana", activity: { total: 2, taken: 1, remaining: 1 } }).body).not.toMatch(/[{}]/);
  });
});

describe("message selection", () => {
  it("only picks messages that fit the time of day", () => {
    const rng = seeded(7);
    for (let i = 0; i < 300; i++) {
      const msg = W.pickMessage({ period: "morning", activity: noDoses, rng });
      expect(!msg.periods || msg.periods.includes("morning")).toBe(true);
    }
  });

  it("does not repeat a message until many others have been shown", () => {
    const rng = seeded(42);
    let recent: string[] = [];
    let last: string | undefined;
    const shown: string[] = [];
    for (let i = 0; i < 120; i++) {
      const msg = W.pickMessage({ period: ["morning", "afternoon", "evening"][i % 3], activity: noDoses, recent, lastCategory: last, rng });
      shown.push(msg.id);
      recent = W.remember(recent, msg.id);
      last = msg.category;
    }
    for (let i = 0; i < shown.length; i++) {
      const window = shown.slice(Math.max(0, i - 15), i);
      expect(window).not.toContain(shown[i]);
    }
    // Same category is never shown twice in a row.
    const cats = shown.map((id) => W.MESSAGES.find((m) => m.id === id)!.category);
    for (let i = 1; i < cats.length; i++) expect(cats[i]).not.toBe(cats[i - 1]);
  });

  it("uses personalized dose messages only when they apply", () => {
    const rng = seeded(3);
    for (let i = 0; i < 200; i++) {
      const msg = W.pickMessage({ period: "afternoon", activity: noDoses, rng });
      expect(msg.when).toBeUndefined();
    }
    const allTaken = { total: 2, taken: 2, missed: 0, remaining: 0 };
    const picks = Array.from({ length: 200 }, () => W.pickMessage({ period: "afternoon", activity: allTaken, rng }).id);
    expect(picks).toContain("p1");
    expect(picks).not.toContain("p2");
    expect(picks).not.toContain("p4");
  });
});

describe("daily scheduling", () => {
  it("spreads tips across morning, afternoon and evening between 8 AM and 9 PM", () => {
    const plan = W.planDay(at(0, 5), "normal", seeded(9));
    expect(plan.slots.map((s) => s.period)).toEqual(["morning", "afternoon", "afternoon", "evening"]);
    for (const s of plan.slots) {
      const h = new Date(s.at).getHours();
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThan(21);
    }
    expect(W.planDay(at(0), "low").slots).toHaveLength(2);
    expect(W.planDay(at(0), "off").slots).toHaveLength(0);
  });

  it("delivers one due slot, skips stale ones and never floods after the device was asleep", () => {
    const plan = { slots: [at(9).getTime(), at(12).getTime(), at(15).getTime(), at(19).getTime()].map((t) => ({ at: t, period: "x", done: false })) };
    const r = W.decide(plan, at(15, 20).getTime());
    expect(r.deliver).toBe(2);
    expect(r.slots.slice(0, 2).every((s) => s.done && s.skipped === "stale")).toBe(true);
    expect(r.nextAt).toBe(at(19).getTime());
    // Device woke up 2 hours late: nothing is sent late.
    const late = W.decide(plan, at(17, 30).getTime());
    expect(late.deliver).toBe(-1);
  });

  it("keeps a minimum gap and gives way to a dose reminder", () => {
    const plan = { slots: [{ at: at(12).getTime(), period: "afternoon", done: false }] };
    const tooSoon = W.decide(plan, at(12, 1).getTime(), { lastShownAt: at(11, 30).getTime() });
    expect(tooSoon.deliver).toBe(-1);
    expect(tooSoon.nextAt).toBe(at(12, 30).getTime());
    const dose = W.decide(plan, at(12, 1).getTime(), { doseTimes: [at(12, 5).getTime()] });
    expect(dose.deliver).toBe(-1);
    expect(dose.nextAt).toBe(at(12, 16).getTime());
    // After being moved once for a dose, it is delivered.
    expect(W.decide({ slots: dose.slots }, at(12, 16).getTime(), { doseTimes: [at(12, 5).getTime()] }).deliver).toBe(0);
  });

  it("counts only today's doses for personalization", () => {
    const a = W.activityFrom([
      { status: "taken", scheduledTime: at(8).toISOString() },
      { status: "scheduled", scheduledTime: at(20).toISOString() },
      { status: "missed", scheduledTime: new Date(2026, 10, 9, 8).toISOString() },
    ], at(12));
    expect(a).toMatchObject({ total: 2, taken: 1, remaining: 1, missed: 0 });
  });
});

// ---- The real service worker, run offline in a sandbox ----
function memoryIndexedDb() {
  const data = new Map<string, unknown>();
  const later = (fn: () => void) => Promise.resolve().then(fn);
  const db = {
    transaction() {
      const tx: { oncomplete?: () => void; onerror?: () => void; objectStore: () => unknown } = {
        objectStore: () => ({
          get(key: string) {
            const req: { result?: unknown; onsuccess?: () => void } = {};
            later(() => { req.result = structuredClone(data.get(key)); req.onsuccess?.(); });
            return req;
          },
          put(value: unknown, key: string) {
            data.set(key, structuredClone(value));
            later(() => tx.oncomplete?.());
          },
        }),
      };
      return tx;
    },
  };
  return {
    data,
    open() {
      const req: { result?: unknown; onsuccess?: () => void } = {};
      later(() => { req.result = db; req.onsuccess?.(); });
      return req;
    },
  };
}

function loadServiceWorker() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const shown: { title: string; options: { body: string; tag: string; data: { kind?: string } } }[] = [];
  const idb = memoryIndexedDb();
  const ctx: Record<string, unknown> = vm.createContext({
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] ||= []).push(fn),
    registration: { showNotification: async (title: string, options: never) => { shown.push({ title, options }); } },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    indexedDB: idb,
    caches: { delete: async () => true },
    Notification: { permission: "granted" },
    Date, setTimeout, clearTimeout, console, structuredClone,
    // No fetch: wellness notifications must work without any network access.
  });
  ctx.importScripts = () => vm.runInContext(wellnessSource, ctx);
  vm.runInContext("var self = this;", ctx); // in a worker, `self` is the global scope
  vm.runInContext(swSource, ctx);
  const dispatch = async (type: string, data?: unknown) => {
    const waits: Promise<unknown>[] = [];
    for (const fn of listeners[type] || []) fn({ data, tag: data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { dispatch, shown, idb, ctx };
}

describe("service worker wellness notifications (offline)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
  afterEach(() => { vi.useRealTimers(); });

  const config = { enabled: true, frequency: "normal", name: "Ana Santos" };

  it("shows a categorized local notification when a slot is due, with no network", async () => {
    vi.setSystemTime(at(7, 55));
    const sw = loadServiceWorker();
    await sw.dispatch("message", { type: "wellness-config", config });
    expect(sw.shown).toHaveLength(0); // before 8 AM nothing is sent
    const state = sw.idb.data.get("wellness-state") as { plan: { slots: { at: number }[] } };
    expect(state.plan.slots).toHaveLength(4);

    vi.setSystemTime(state.plan.slots[0].at + 1000);
    await sw.dispatch("message", { type: "wellness-tick" });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toMatch(/^(💧|💪|🩺|✨) (Hydration|Motivation|Health Tip|Inspirational Quote) · /);
    expect(sw.shown[0].options.tag).toBe("caretrack-wellness");
    expect(sw.shown[0].options.data.kind).toBe("wellness");
  });

  it("does not send duplicates when several wake-ups happen at once", async () => {
    vi.setSystemTime(at(7, 0));
    const sw = loadServiceWorker();
    await sw.dispatch("message", { type: "wellness-config", config });
    const slots = (sw.idb.data.get("wellness-state") as { plan: { slots: { at: number }[] } }).plan.slots;
    vi.setSystemTime(slots[0].at + 5000);
    await Promise.all([
      sw.dispatch("message", { type: "wellness-tick" }),
      sw.dispatch("message", { type: "wellness-tick" }),
      sw.dispatch("periodicsync", "caretrack-wellness"),
      sw.dispatch("activate"),
    ]);
    expect(sw.shown).toHaveLength(1);
  });

  it("delivers at most 4 per day across the whole day, all different", async () => {
    vi.setSystemTime(at(6, 0));
    const sw = loadServiceWorker();
    await sw.dispatch("message", { type: "wellness-config", config });
    for (let t = at(6).getTime(); t < at(23, 59).getTime(); t += 5 * 60 * 1000) {
      vi.setSystemTime(t);
      await sw.dispatch("message", { type: "wellness-tick" });
    }
    expect(sw.shown.length).toBeGreaterThanOrEqual(3); // one can be dropped by the 60-minute gap
    expect(sw.shown.length).toBeLessThanOrEqual(4);
    expect(new Set(sw.shown.map((n) => n.options.body)).size).toBe(sw.shown.length);
  });

  it("fires from its own timer while the worker stays awake", async () => {
    vi.setSystemTime(at(7, 0));
    const sw = loadServiceWorker();
    await sw.dispatch("message", { type: "wellness-config", config });
    const first = (sw.idb.data.get("wellness-state") as { plan: { slots: { at: number }[] } }).plan.slots[0].at;
    await vi.advanceTimersByTimeAsync(first - Date.now() + 2000);
    expect(sw.shown).toHaveLength(1);
  });

  it("respects the off setting, missing permission and sign-out", async () => {
    vi.setSystemTime(at(9, 0));
    const sw = loadServiceWorker();
    await sw.dispatch("message", { type: "wellness-config", config: { enabled: false, frequency: "off" } });
    // 9:30 PM is after every delivery window, so re-enabling below can't send a scheduled tip.
    vi.setSystemTime(at(21, 30));
    await sw.dispatch("message", { type: "wellness-tick" });
    expect(sw.shown).toHaveLength(0);

    await sw.dispatch("message", { type: "wellness-config", config });
    await sw.dispatch("message", "clear-cache");
    expect(sw.idb.data.get("wellness-config")).toBeNull();
    await sw.dispatch("message", { type: "wellness-preview" });
    expect(sw.shown).toHaveLength(1); // a manual preview still works
    (sw.ctx as { Notification: { permission: string } }).Notification.permission = "denied";
    await sw.dispatch("message", { type: "wellness-preview" });
    expect(sw.shown).toHaveLength(1);
  });

  it("keeps existing dose reminders working, and restores them after the worker restarts", async () => {
    vi.setSystemTime(at(9, 0));
    const doses = [{ id: 7, status: "scheduled", scheduledTime: at(9, 30).toISOString(), medicationName: "Metformin", dosage: "500 mg" }];
    const sw = loadServiceWorker();
    await sw.dispatch("message", { type: "cache-dose-schedule", doses });
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(sw.shown.map((n) => n.title)).toContain("CareTrack dose reminder: Metformin");

    // A fresh worker (browser killed the old one) reloads the schedule from IndexedDB.
    vi.setSystemTime(at(9, 0));
    const restarted = loadServiceWorker();
    restarted.idb.data.set("schedule", doses);
    await restarted.dispatch("activate");
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(restarted.shown.map((n) => n.title)).toEqual(["CareTrack dose reminder: Metformin"]);
  });

  it("personalizes tips from the cached dose schedule", async () => {
    vi.setSystemTime(at(14, 0));
    const sw = loadServiceWorker();
    await sw.dispatch("message", { type: "cache-dose-schedule", doses: [
      { id: 1, status: "taken", scheduledTime: at(8).toISOString(), medicationName: "A" },
      { id: 2, status: "taken", scheduledTime: at(13).toISOString(), medicationName: "B" },
    ] });
    await sw.dispatch("message", { type: "wellness-config", config });
    const bodies = new Set<string>();
    for (let i = 0; i < 40; i++) {
      vi.setSystemTime(at(14, 0).getTime() + i * 1000);
      await sw.dispatch("message", { type: "wellness-preview" });
      bodies.add(sw.shown[sw.shown.length - 1].options.body);
    }
    expect([...bodies]).toContain("Great job, Ana! You've taken all 2 doses scheduled for today. 🎉");
  });
});
