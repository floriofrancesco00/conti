/* Conti — fa funzionare l'app senza rete.
   Tiene in memoria i file dell'app (non i dati: quelli stanno nel localStorage).
   A ogni pubblicazione cambia VERSIONE, il telefono scarica i file nuovi e butta i vecchi. */
const VERSIONE = '2026.11.07-1732';
const CACHE = 'conti-' + VERSIONE;
const FILE = [
  './',
  './index.html',
  './stile.css',
  './analizza.js',
  './app.js',
  './manifest.webmanifest',
  './icone/icona-180.png',
  './icone/icona-192.png',
  './icone/icona-512.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILE.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chiavi => Promise.all(chiavi.filter(k => k.startsWith('conti-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evento => {
  const richiesta = evento.request;
  if (richiesta.method !== 'GET' || new URL(richiesta.url).origin !== self.location.origin) return;
  evento.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(richiesta, { ignoreSearch: true }).then(trovata => {
        if (trovata) return trovata;
        return fetch(richiesta).catch(() =>
          richiesta.mode === 'navigate' ? cache.match('./') : Response.error());
      }))
  );
});
