/* Offline: app code network-first (always newest when online, cache when offline); big assets (models, GLB, CDN libs) cache-first. */
const V = 'padel-coach-v5';
const SHELL = ['./', 'index.html', 'app.js', 'ghost.js', 'bench.html', 'engine/core.js', 'engine/mock.js', 'engine/onnx.js', 'engine/remote.js', 'ghost3d.js', 'techniques.json', 'release.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url), fresh = u.origin === location.origin && !/\.(onnx|glb|usdz|mp4|png)$/.test(u.pathname);
  const put = res => { if (res.ok && (u.origin === location.origin || u.hostname === 'cdn.jsdelivr.net')) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; };
  e.respondWith(fresh
    ? fetch(r).then(put).catch(() => caches.match(r))
    : caches.match(r).then(m => m || fetch(r).then(put)));
});
