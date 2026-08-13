// Service Worker — עבודה אופליין + קליטת צילומי מסך משותפים.
//
// אסטרטגיה: רשת קודם, מטמון כרשת ביטחון.
//
// הגרסה הקודמת עשתה ההפך — מטמון קודם — וזו הייתה טעות: המשתמש המשיך
// להריץ קוד ישן ימים אחרי שהתיקון נפרס, בלי שום סימן. באפליקציה של
// 100KB החיסכון בזמן טעינה זניח מול המחיר של להריץ גרסה מיושנת.
// אופליין עדיין עובד במלואו, כי כל כישלון רשת נופל למטמון.

const CACHE = 'kesef-v5';
const SHELL = [
  './', './index.html', './style.css', './app.js', './db.js', './ai.js',
  './taxonomy.js', './charts.js', './insights.js', './stats.js', './crypto.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // מודיעים ללשוניות פתוחות שיש קוד חדש, כדי שיציעו רענון
    for (const c of await self.clients.matchAll({ type: 'window' })) {
      c.postMessage({ type: 'sw-updated', cache: CACHE });
    }
  })());
});

/* ---------- IndexedDB מינימלי לאחסון הצילום המשותף ---------- */

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kesef', 5);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['tx', 'rules', 'fixed', 'meta', 'pending', 'snapshots', 'accounts', 'budgets', 'streams']) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, {
            keyPath: s === 'meta' ? 'k' : (s === 'rules' ? 'key' : (s === 'budgets' ? 'key' : 'id')),
          });
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

/** רשת עם תקרת זמן — כדי שרשת גרועה לא תתקע את האפליקציה */
function fromNetwork(request, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // יעד השיתוף — אנדרואיד שולח לכאן POST עם התמונה
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('image').filter(f => f && f.size);
        if (files.length) await stashPending(files);
      } catch (_) { /* ממשיכים בכל מקרה */ }
      return Response.redirect(url.pathname.replace(/share$/, '') + '?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith((async () => {
    try {
      const res = await fromNetwork(e.request);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      if (e.request.mode === 'navigate') {
        return (await caches.match('./index.html')) || (await caches.match('./')) ||
          new Response('אופליין ואין עותק שמור', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      throw new Error('offline');
    }
  })());
});
