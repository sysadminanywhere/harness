const CACHE_NAME = 'harness-shell-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/board.js', '/project.js', '/planner.js', '/i18n.js', '/favicon.svg', '/manifest.json'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => { if (new URL(event.request.url).origin !== self.location.origin || event.request.method !== 'GET') return; event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then((response) => response || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))); });
