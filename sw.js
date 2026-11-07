/* Conti — fa funzionare l'app senza rete.
   Tiene in memoria i file dell'app (non i dati: quelli stanno nel localStorage).
   A ogni pubblicazione cambia VERSIONE, il telefono scarica i file nuovi e butta i vecchi. */
importScripts('edizione.js');
const PREFISSO = (self.EDIZIONE && self.EDIZIONE.cache) || 'conti-';
const VERSIONE = '2026.11.07-1938';
const CACHE = PREFISSO + VERSIONE;
const FILE = [
  './',
  './index.html',
  './edizione.js',
  './stile.css',
  './analizza.js',
  './app.js',
  './manifest.webmanifest',
  './icone/icona-180.png',
  './icone/icona-192.png',
  './icone/icona-512.png'
];

// Gli sfondi stanno in una memoria a parte che non cambia a ogni versione dell'app:
// si scaricano una volta sola. Se cambiano le foto, cambia SFONDI_CACHE.
const SFONDI_CACHE = PREFISSO + 'sfondi-1';
// solo le memorie di questa edizione: «conti-2026…» non tocca «conti-riccardo-2026…» sullo stesso dominio
const mia = k => k.startsWith(PREFISSO) && /^(\d|sfondi-)/.test(k.slice(PREFISSO.length));
const SFONDI = ['dolomiti', 'venezia', 'veliero', 'fuji', 'stelle', 'castello', 'bosco', 'aurora']
  .flatMap(n => ['./sfondi/' + n + '.webp', './sfondi/' + n + '-mini.webp'])
  .concat(['./sfondi/sfondi.json']);

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILE.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => caches.open(SFONDI_CACHE))
      .then(cache => Promise.all(SFONDI.map(u => cache.match(u).then(c => c || cache.add(u).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chiavi => Promise.all(chiavi.filter(k => mia(k) && k !== CACHE && k !== SFONDI_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evento => {
  const richiesta = evento.request;
  if (richiesta.method !== 'GET' || new URL(richiesta.url).origin !== self.location.origin) return;
  evento.respondWith(
    caches.match(richiesta, { ignoreSearch: true }).then(trovata => {
      if (trovata) return trovata;
      return fetch(richiesta).then(risposta => {
        // uno sfondo non ancora in memoria: lo si tiene per la prossima volta senza rete
        if (risposta.ok && new URL(richiesta.url).pathname.includes('/sfondi/')) {
          const copia = risposta.clone();
          caches.open(SFONDI_CACHE).then(c => c.put(richiesta, copia));
        }
        return risposta;
      }).catch(() => richiesta.mode === 'navigate' ? caches.match('./', { ignoreSearch: true }) : Response.error());
    })
  );
});
