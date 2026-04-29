// ════════════════════════════════════════════════════════════════
//  Daily Operation System – Service Worker
//  Verwaltet Hintergrund-Benachrichtigungen
// ════════════════════════════════════════════════════════════════

const CACHE_NAME = 'dailyops-v1';

// Install & activate
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Cache-Strategie: App-Shell cachen
self.addEventListener('fetch', e => {
  if (e.request.url.includes('googleapis') || e.request.url.includes('gsi/client')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return resp;
    }))
  );
});

// ── Empfang von Nachrichten aus der Haupt-App ──────────────────
let scheduledBlocks = [];
let checkInterval = null;

self.addEventListener('message', e => {
  const data = e.data;
  if (!data) return;

  if (data.type === 'SCHEDULE') {
    // Neuen Zeitplan empfangen
    scheduledBlocks = data.blocks || [];

    // Interval starten (jede Minute prüfen)
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(checkAndNotify, 60 * 1000);
    checkAndNotify(); // Sofort einmal prüfen
  }

  if (data.type === 'NOTIFY') {
    // Direkte Notification-Anfrage aus dem Main Thread
    self.registration.showNotification(data.title, data.opts);
  }
});

// ── Zeitplan-Prüfung ──────────────────────────────────────────
function checkAndNotify() {
  const now = Date.now();
  const window60s = 60 * 1000;

  scheduledBlocks.forEach((block, idx) => {
    if (!block._sent && block.time <= now + window60s && block.time > now - window60s) {
      scheduledBlocks[idx]._sent = true;
      fireBlockNotification(block);
    }
  });
}

function fireBlockNotification(block) {
  const title = block.emoji + ' ' + block.title;
  const opts = {
    body: block.body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    silent: true,          // Stumm – kein Ton
    vibrate: [100, 50, 100],
    tag: 'dailyops-block-' + block.time,
    renotify: false,
    data: { time: block.time }
  };
  return self.registration.showNotification(title, opts);
}

// ── Notification Click ────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const c of clientList) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
