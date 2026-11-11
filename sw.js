/* Conti — fa funzionare l'app senza rete.
   Tiene in memoria i file dell'app (non i dati: quelli stanno nel localStorage).
   A ogni pubblicazione cambia VERSIONE, il telefono scarica i file nuovi e butta i vecchi. */
importScripts('edizione.js');
const PREFISSO = (self.EDIZIONE && self.EDIZIONE.cache) || 'conti-';
const VERSIONE = '2026.11.11-1415';
const CACHE = PREFISSO + VERSIONE;
const FILE = [
  './',
  './index.html',
  './edizione.js',
  './stile.css',
  './analizza.js',
  './voce.js',
  './voce-lavoro.js',
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
    Promise.all(FILE.map(u =>
      // «?v=» salta anche la memoria di GitHub. Ogni file si legge subito (se no tiene occupata la sua connessione e
      // gli altri restano in coda per sempre) e si mettono in memoria solo quando sono arrivati tutti, della stessa
      // versione: un app.js di un'altra versione romperebbe l'app, e allora si rinuncia (la pagina ci riprova da sola)
      fetch(new Request(u + '?v=' + VERSIONE, { cache: 'reload' })).then(async r => {
        if (!r.ok) throw new Error(u + ' ' + r.status);
        const corpo = await r.blob();
        if (u === './app.js' && !(await corpo.text()).includes("const VERSIONE = '" + VERSIONE + "'")) throw new Error('app.js di un\'altra versione');
        return [u, new Response(corpo, { status: r.status, statusText: r.statusText, headers: r.headers })];
      })))
      .then(coppie => caches.open(CACHE).then(cache => Promise.all(coppie.map(([u, r]) => cache.put(u, r)))))
      .then(() => caches.open(SFONDI_CACHE))
      .then(cache => Promise.all(SFONDI.map(u => cache.match(u).then(c => c || cache.add(u).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

// La pagina chiede quale versione ha il service worker («Cerca aggiornamenti»): Safari non lo dice da solo.
self.addEventListener('message', evento => {
  if (evento.data === 'versione' && evento.ports && evento.ports[0]) evento.ports[0].postMessage(VERSIONE);
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chiavi => Promise.all(chiavi.filter(k => mia(k) && k !== CACHE && k !== SFONDI_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La libreria della voce (transformers.js e il suo motore WebAssembly) arriva da jsDelivr la prima volta che si usa
// il microfono: la si tiene in una memoria sua, così poi la voce funziona anche senza rete. Il modello invece lo
// tiene la libreria stessa nella memoria «transformers-cache».
const VOCE_CACHE = PREFISSO + 'voce-1';
const VOCE_HOST = 'cdn.jsdelivr.net';

// Intestazioni che rendono la pagina «isolata» (crossOriginIsolated): così il riconoscimento vocale può usare più
// thread insieme, 2,5-3 volte più veloce sul PC (10/11/2026). GitHub Pages non le manda: le aggiunge il service worker
// a tutto quello che serve dal suo sito. Se il telefono le ignora non si rompe niente: si resta a un thread.
function isolata(risposta) {
  if (!risposta || risposta.type === 'opaque' || risposta.type === 'opaqueredirect' || !risposta.status) return risposta;
  const h = new Headers(risposta.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(risposta.body, { status: risposta.status, statusText: risposta.statusText, headers: h });
}

self.addEventListener('fetch', evento => {
  const richiesta = evento.request;
  if (richiesta.method !== 'GET') return;
  const indirizzo = new URL(richiesta.url);
  if (indirizzo.hostname === VOCE_HOST && /^\/npm\/(@huggingface\/transformers|onnxruntime-web)@/.test(indirizzo.pathname)) {
    evento.respondWith(caches.open(VOCE_CACHE).then(cache => cache.match(richiesta).then(trovata => trovata ||
      fetch(richiesta).then(risposta => { if (risposta.ok) cache.put(richiesta, risposta.clone()); return risposta; }))));
    return;
  }
  if (indirizzo.origin !== self.location.origin) return;
  evento.respondWith(
    caches.match(richiesta, { ignoreSearch: true }).then(trovata => {
      if (trovata) return isolata(trovata);
      return fetch(richiesta).then(risposta => {
        // uno sfondo non ancora in memoria: lo si tiene per la prossima volta senza rete
        if (risposta.ok && new URL(richiesta.url).pathname.includes('/sfondi/')) {
          const copia = risposta.clone();
          caches.open(SFONDI_CACHE).then(c => c.put(richiesta, copia));
        }
        return isolata(risposta);
      }).catch(() => richiesta.mode === 'navigate' ? caches.match('./', { ignoreSearch: true }).then(isolata) : Response.error());
    })
  );
});
