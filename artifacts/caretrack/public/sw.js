// CareTrack offline support.
// Network first: always try the server, and keep a copy of every successful page and
// data response. When the internet (or the server) is down, the saved copy is shown,
// so patients can still see today's doses. Dose confirmations made offline are queued
// by the app and synced when the connection returns.
const CACHE = "caretrack-offline-v1";
const SHELL = "/__app-shell";
// Never cache sign-in requests or private files.
const SKIP = [/^\/api\/auth\/(login|logout|otp|change-password)/, /^\/api\/lab-results\//, /^\/api\/reports\/\d+\/(pdf|csv)/];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  // Sent on sign-out so another user of the same device can't see cached data.
  if (event.data === "clear-cache") event.waitUntil(caches.delete(CACHE));
  if (event.data?.type === "cache-dose-schedule") event.waitUntil(cacheDoseSchedule(event.data.doses));
});

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
async function cacheDoseSchedule(doses) {
  const db = await reminderDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(doses || [], "schedule");
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  scheduleCachedReminders(doses || []);
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
        data: { url: "/today", doseId: dose.id },
      });
    }, Math.min(delay, 2147483647));
    reminderTimers.set(dose.id, timer);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || SKIP.some((re) => re.test(url.pathname))) return;

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
        return new Response(JSON.stringify({ error: "You're offline and this information hasn't been saved on this device yet." }), {
          status: 503,
          headers: { "content-type": "application/json" },
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
