// service-worker.js
// Caches the app shell so PM loads offline and can be installed to your home
// screen. Bump CACHE_VERSION whenever you change cached files.
//
// Next step for "notify even when the app is closed": handle a 'push' event
// here and call self.registration.showNotification(...). That needs a small
// push server to send the messages — see README.

const CACHE_VERSION = 'pm-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/data.js',
  './js/storage.js',
  './js/notifications.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
