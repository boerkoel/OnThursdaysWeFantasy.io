// Service worker for the home-screen app. Keeps the site quick to open and
// usable on a weak connection, without ever showing stale scores when the
// network is available:
// - pages and live data (data/current/*.json): network first, cached copy
//   only as a fallback;
// - built assets (hashed file names never change): cache first;
// - everything else (logos, icons): cached copy immediately, refreshed in the
//   background.
const CACHE = "otwf-v1";
const BASE = "/OnThursdaysWeFantasy.io/";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([BASE, BASE + "manifest.webmanifest"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheKey = request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || refresh;
}

// Notifications from the alert service (worker/). A newer alert with the same
// tag (for example, the same matchup) replaces the older one.
self.addEventListener("push", event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || "On Thursdays We Fantasy", {
    body: data.body || "",
    icon: BASE + "icons/icon-192.png",
    badge: BASE + "icons/icon-192.png",
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || BASE }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || BASE;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const open = windows.find(w => w.url.startsWith(self.location.origin + BASE));
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, BASE));
  } else if (url.pathname.startsWith(BASE + "data/")) {
    // Polls add ?ts= to dodge caches; store one copy per file, not per request.
    event.respondWith(networkFirst(request, url.origin + url.pathname));
  } else if (url.pathname.startsWith(BASE + "assets/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
