// Service Worker — עבודה אופליין + קליטת צילומי מסך משותפים מהטלפון.

const CACHE = 'kesef-v1';
const SHELL = [
  './', './index.html', './app.js', './db.js', './ai.js', './taxonomy.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* ---------- IndexedDB מינימלי לאחסון הצילום המשותף ---------- */

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kesef', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['tx', 'rules', 'fixed', 'meta', 'pending', 'snapshots']) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: s === 'meta' ? 'k' : (s === 'rules' ? 'key' : 'id') });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function stashPending(files) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const t = db.transaction('pending', 'readwrite');
    const s = t.objectStore('pending');
    let i = 0;
    for (const f of files) {
      s.put({ id: `${Date.now()}-${i++}`, blob: f, name: f.name || 'shared.jpg', at: Date.now() });
    }
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

/* ---------- ניתוב ---------- */

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // יעד השיתוף — הטלפון שולח לכאן POST עם התמונה
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('image').filter(f => f && f.size);
        if (files.length) await stashPending(files);
      } catch (_) { /* ממשיכים בכל מקרה */ }
      const base = url.pathname.replace(/share$/, '');
      return Response.redirect(base + '?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // ניווט: רשת קודם, מטמון כגיבוי
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('./index.html').then(r => r || caches.match('./'))),
    );
    return;
  }

  // נכסים: מטמון קודם, ורענון ברקע
  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
