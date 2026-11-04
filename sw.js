const CACHE = 'golden-baccarat-v8';
const FILES = ['./', './index.html', './table.html', './minigame.html', './lounge.html', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  if (request.mode === 'navigate' || new URL(request.url).pathname.endsWith('/index.html')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request).then(hit => hit || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then(hit => hit || fetch(request)));
});
