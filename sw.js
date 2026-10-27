const CACHE_NAME = "sparta-field-v38";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/local-workspace.js",
  "/money.js",
  "/auth-flow.js",
  "/team-access.js",
  "/team-access.css",
  "/buyer-cloud.js",
  "/buyer-ui.js",
  "/buyer-ui.css",
  "/cash-ledger.js",
  "/cash-book.js",
  "/workspace-reset-core.js",
  "/workspace-maintenance.js",
  "/warehouse-core.js",
  "/warehouse-ui.js",
  "/warehouse-cloud.js",
  "/warehouse.css",
  "/supabase-config.js",
  "/supabase-js.umd.js",
  "/assets/solar-background.png",
  "/assets/sparta-logo.jpeg",
  "/assets/pwa/apple-touch-icon.png",
  "/assets/pwa/icon-192.png",
  "/assets/pwa/icon-512.png",
  "/manifest.webmanifest"
];
const SHELL_PATHS = new Set(APP_SHELL);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("sparta-field-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only known application assets belong in the offline cache. APIs, signed
  // downloads, documents and unknown routes always pass through to the network.
  if (request.method !== "GET" || url.origin !== self.location.origin || !SHELL_PATHS.has(url.pathname)) return;
  const key = url.pathname;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && response.type !== "opaque") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(key, copy)));
    }
    return response;
  }).catch(() => caches.match(key).then((cached) => cached || Response.error())));
});
