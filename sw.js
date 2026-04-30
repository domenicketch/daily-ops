// ════════════════════════════════════════════════════════════════
//  DayEngine – Service Worker v3.0
//  • Vollständiges Offline-Caching aller App-Assets
//  • Hintergrund-Benachrichtigungen auch bei geschlossenem Tab
//  • Cache-first für App-Shell, Network-pass für Google APIs
// ════════════════════════════════════════════════════════════════

const APP_CACHE   = 'dayengine-v3';
const FONT_CACHE  = 'dayengine-fonts-v1';

const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── INSTALL ─────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(c => {
        return Promise.allSettled(APP_SHELL.map(url =>
          c.add(url).catch(err => console.warn('[SW] Cache miss:', url, err))
        ));
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== APP_CACHE && k !== FONT_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Google APIs / Auth → immer Network, nie cachen
  if (url.includes('googleapis.com') ||
      url.includes('accounts.google.com') ||
      url.includes('gsi/client')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Google Fonts CSS → Stale-While-Revalidate
  if (url.includes('fonts.googleapis.com')) {
    e.respondWith(
      caches.open(FONT_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const fresh = fetch(e.request)
          .then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; })
          .catch(() => null);
        return cached || fresh;
      })
    );
    return;
  }

  // Google Fonts Dateien → Cache first
  if (url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(FONT_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        const r = await fetch(e.request);
        if (r.ok) cache.put(e.request, r.clone());
        return r;
      })
    );
    return;
  }

  // App Shell + alles andere → Cache first, Network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (r.ok && e.request.method === 'GET') {
          caches.open(APP_CACHE).then(c => c.put(e.request, r.clone()));
        }
        return r;
      }).catch(() => {
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ════════════════════════════════════════════════════════════════
//  BENACHRICHTIGUNGS-ENGINE
//  Blöcke kommen per postMessage rein.
//  Alle 30 Sek. prüft der SW ob ein Block fällig ist.
//  Funktioniert im Hintergrund, solange der Browser noch läuft.
// ════════════════════════════════════════════════════════════════

let scheduledBlocks = [];
let checkLoop = null;

function startLoop() {
  if (checkLoop) return;
  checkLoop = setInterval(checkAndFire, 30_000);
  checkAndFire();
}

function stopLoop() {
  clearInterval(checkLoop);
  checkLoop = null;
}

function checkAndFire() {
  if (!scheduledBlocks.length) { stopLoop(); return; }
  const now = Date.now();
  const WINDOW = 45_000; // 45-Sekunden Toleranzfenster

  scheduledBlocks.forEach((b, i) => {
    if (!b._fired && b.time <= now && b.time > now - WINDOW) {
      scheduledBlocks[i]._fired = true;
      doNotify(b);
    }
  });

  // Alte Blöcke bereinigen
  scheduledBlocks = scheduledBlocks.filter(b => b.time > now - 300_000);
  if (scheduledBlocks.length && scheduledBlocks.every(b => b._fired)) stopLoop();
}

async function doNotify(block) {
  const title = `${block.emoji} ${block.title}`;
  await self.registration.showNotification(title, {
    body:    block.body,
    icon:    './icon-192.png',
    badge:   './icon-192.png',
    // false = System-Ton spielt wenn App geschlossen
    // Custom-Ton spielt der Main Thread wenn App offen ist
    silent:  false,
    vibrate: [200, 100, 200, 100, 100],
    tag:     `de-${block.time}`,
    renotify: false,
    requireInteraction: false,
    data: { time: block.time },
  });

  // Main Thread (falls offen) informieren → Custom-Ton abspielen
  const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  clients.forEach(c => c.postMessage({ type:'PLAY_SOUND', block }));
}

// ── MESSAGES ────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;

  switch (e.data.type) {

    case 'SCHEDULE': {
      const incoming = (e.data.blocks || []).map(b => ({ ...b, _fired: false }));
      const existing = new Set(scheduledBlocks.map(b => b.time));
      incoming.forEach(b => { if (!existing.has(b.time)) scheduledBlocks.push(b); });
      startLoop();
      // Antwort an Client
      e.source?.postMessage({ type:'SCHEDULE_ACK', count: scheduledBlocks.length });
      break;
    }

    case 'NOTIFY': {
      self.registration.showNotification(e.data.title, {
        ...e.data.opts,
        icon:  './icon-192.png',
        badge: './icon-192.png',
        silent: false,
      });
      break;
    }

    case 'CLEAR_SCHEDULE': {
      scheduledBlocks = [];
      stopLoop();
      break;
    }

    case 'PING': {
      // Keepalive vom Main Thread
      e.source?.postMessage({ type:'PONG', ts: Date.now() });
      break;
    }
  }
});

// ── NOTIFICATION CLICK ───────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});

// ── PUSH (Server-Integration bereit) ────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const d = e.data.json();
    e.waitUntil(
      self.registration.showNotification(d.title || 'DayEngine', {
        body:    d.body || '',
        icon:    './icon-192.png',
        badge:   './icon-192.png',
        silent:  false,
        vibrate: [200, 100, 200],
      })
    );
  } catch(err) { console.warn('[SW] Push error:', err); }
});
