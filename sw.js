const CACHE_NAME = "personal-ai-shell-v87";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./cloud.js",
  "./app.js",
  "./arena.js",
  "./arena-scene.js",
  "./battle-engine.js",
  "./assets/vendor/supabase.js",
  "./manifest.webmanifest",
  "./assets/icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Never replay authenticated/API data as if it were a fresh cloud snapshot.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")
      || event.request.headers.has("authorization")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(event.request))
        || (event.request.mode === "navigate" ? await caches.match("./index.html") : Response.error()))
  );
});
