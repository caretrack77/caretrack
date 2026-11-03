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
});

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
