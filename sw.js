// Strateji Radar service worker: uygulama kabuğu önbelleği, Web Push, bildirime dokununca derin bağlantı
const VERSION = '__BUILD__';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.json', './app/config.js', './app/data.js', './app/store.js', './app/fmt.js', './app/calc.js', './app/chart.js', './app/ui.js', './app/views.js', './app/views2.js', './app/settings.js', './app/order.js', './app/live.js', './app/direction.js', './app/traders.js', './app/broker.js', './app/star.js', './config/params.json', './config/star.json', './config/symbols.json', './config/sessions.json', './icons/icon-192.png', './icons/icon-512.png'];
const LIB = 'https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // HTTP önbelleğini atla (GitHub Pages 10 dk önbellekler): yeni sürüm eski dosyalarla dolmasın
    await c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    try { await c.add(new Request(LIB, { mode: 'no-cors' })); } catch { /* çevrimdışı kurulum */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== DATA) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Veri JSON'ları: ağ öncelikli, olmazsa son kopya
  if (url.hostname === 'raw.githubusercontent.com' || url.pathname.includes('/data/')) {
    e.respondWith((async () => {
      const key = url.origin + url.pathname;
      try {
        const r = await fetch(e.request);
        if (r.ok) (await caches.open(DATA)).put(key, r.clone());
        return r;
      } catch {
        const c = await (await caches.open(DATA)).match(key);
        return c ?? new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
      }
    })());
    return;
  }
  // Kabuk ve kütüphane: önbellek öncelikli, arka planda tazele
  if (url.origin === location.origin || url.href === LIB) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const hit = await c.match(e.request, { ignoreSearch: url.origin === location.origin });
      const net = fetch(url.origin === location.origin ? new Request(e.request.url, { cache: 'no-cache' }) : e.request).then((r) => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => null);
      return hit ?? (await net) ?? (await c.match('./index.html'));
    })());
  }
});

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('strateji', 2);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('trades')) d.createObjectStore('trades', { keyPath: 'id' }); if (!d.objectStoreNames.contains('notifs')) d.createObjectStore('notifs', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function openTradeFor(signal) {
  try {
    const d = await idb();
    const all = await new Promise((res) => { const r = d.transaction('trades', 'readonly').objectStore('trades').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
    return all.some((t) => !t.result && (t.signal_id === signal || t.setupId === signal));
  } catch { return true; }
}
async function remember(n) {
  try {
    const d = await idb();
    await new Promise((res) => { const t = d.transaction('notifs', 'readwrite'); const s = t.objectStore('notifs'); s.put(n); const lim = Date.now() - 30 * 86400000; s.openCursor().onsuccess = (ev) => { const cur = ev.target.result; if (cur) { if (cur.value.t < lim) cur.delete(); cur.continue(); } }; t.oncomplete = res; t.onerror = res; });
  } catch { /* yok say */ }
}
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { title: 'Strateji Radar', body: e.data?.text() ?? '' }; }
  let title = p.title || 'Strateji Radar';
  const opts = { body: p.body || '', tag: p.tag || undefined, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: p.url || './#/ozet' }, requireInteraction: p.kind === 'tam', silent: !!p.silent, vibrate: p.silent ? undefined : p.kind === 'tam' ? [200, 100, 200] : [100] };
  e.waitUntil((async () => {
    // İşlem bildirimi (TP/SL/haber/ÇIKIŞ): bu cihazda o sinyal için açık işlem yoksa sessiz ve "(girmedin)" etiketli
    if (p.signal && (p.kind === 'trade' || /ÇIKIŞ/.test(title))) {
      const mine = await openTradeFor(p.signal);
      if (!mine) { title = `(girmedin) ${title}`; opts.silent = true; opts.vibrate = undefined; }
    }
    await remember({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, t: Date.now(), title, body: opts.body, url: opts.data.url, kind: p.kind });
    await self.registration.showNotification(title, opts);
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'push' });
  })());
});
// Uygulamadan "önbelleği yenile" isteği
self.addEventListener('message', (e) => {
  if (e.data?.type === 'clear-shell') e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== DATA) await caches.delete(k); })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#/ozet', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if (w.url.startsWith(self.registration.scope)) { await w.focus(); w.postMessage({ type: 'navigate', url }); return; } }
    await self.clients.openWindow(url);
  })());
});
