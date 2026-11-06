const CACHE_NAME = "bak-snacks-v7";

const APP_FILES = [
    './',
    './backup.html',
    './cashbook.html',
    './index.html',
    './production.html',
    './purchases.html',
    './raw-materials.html',
    './receipt.html',
    './settings.html',
    './css/backup.css',
    './css/cashbook.css',
    './css/production.css',
    './css/purchases.css',
    './css/raw-materials.css',
    './css/receipt.css',
    './css/settings.css',
    './css/style.css',
    './js/app.js',
    './js/backup.js',
    './js/cashbook.js',
    './js/production.js',
    './js/purchases.js',
    './js/pwa.js',
    './js/raw-materials.js',
    './js/receipt.js',
    './js/security.js',
    './js/settings.js',
    './manifest.json',
    './icon.svg'
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES))
    );
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key =>
                    key.startsWith("bak-snacks-") && key !== CACHE_NAME
                ).map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                if (response.ok &&
                    new URL(event.request.url).origin === self.location.origin) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache =>
                        cache.put(event.request, copy)
                    );
                }
                return response;
            }).catch(() => {
                if (event.request.mode === "navigate") {
                    return caches.match("./index.html");
                }
                return Response.error();
            });
        })
    );
});
