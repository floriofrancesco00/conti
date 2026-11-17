/* Che Conti Devastanti — i suoni (17/11/2026).
   Registrazioni vere con licenza CC0 (Freesound e Kenney), tagliate e pareggiate da fai_suoni.py: niente sintesi.
   Suonano con Web Audio, che sull'iPhone si mescola con la musica (non ferma Spotify) e tace col silenzioso.
   L'iPhone non lascia suonare una pagina prima che la si tocchi: il suono d'apertura parte al primo tocco
   (Suoni.alPrimoTocco), tutti gli altri nascono già da un tocco (Salva, Elimina).
   window.__CONTI_MUTO (banco di prova): non apre l'audio del computer, segna soltanto cosa avrebbe suonato. */
(function () {
  'use strict';
  const NOMI = ['apertura-devastante', 'apertura-cassa', 'apertura-tesoro', 'entrata', 'uscita', 'spostamento', 'elimina'];
  const APERTURE = [
    { id: 'apertura-devastante', nome: 'Devastante', sotto: 'Un colpo, poi una manciata di monete che cade' },
    { id: 'apertura-cassa', nome: 'Cassa', sotto: 'Il «ka-ching» di un registratore di cassa' },
    { id: 'apertura-tesoro', nome: 'Tesoro', sotto: 'Un forziere che si apre' },
    { id: 'nessuno', nome: 'Nessuno', sotto: 'L\'app si apre in silenzio' }
  ];
  const suonati = [];   // per le prove: cosa ha suonato (o avrebbe suonato), in ordine
  const muto = () => !!window.__CONTI_MUTO;
  let ctx = null, caricamento = null;
  const buffer = {};

  function contesto() {
    if (ctx || muto()) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = null; }
    return ctx;
  }
  // i file si scaricano e si decodificano una volta sola, quando l'app è ferma (il service worker li tiene senza rete)
  function prepara() {
    if (caricamento) return caricamento;
    if (muto()) return (caricamento = Promise.resolve(0));
    const c = contesto();
    if (!c) return (caricamento = Promise.resolve(0));
    caricamento = Promise.all(NOMI.map(n => fetch('suoni/' + n + '.mp3')
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(ab => new Promise((ok, ko) => c.decodeAudioData(ab, ok, ko)))
      .then(b => { buffer[n] = b; return 1; }, () => 0)))
      .then(v => v.reduce((a, x) => a + x, 0));
    return caricamento;
  }
  // dentro un tocco: l'iPhone apre l'audio (e lo riapre dopo che l'app è stata in sottofondo, stato «interrupted»)
  function sblocca() {
    const c = contesto();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    try {   // un campione muto: su qualche iOS è questo, non resume(), che apre davvero l'audio
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
    } catch (e) { /* niente */ }
  }
  function suona(nome, volume) {
    if (!nome || nome === 'nessuno') return false;
    suonati.push(nome);
    if (muto()) return true;
    const c = contesto();
    if (!c) return false;
    sblocca();
    const via = () => {
      const b = buffer[nome];
      if (!b) return false;
      const s = c.createBufferSource(), g = c.createGain();
      s.buffer = b;
      g.gain.value = volume === undefined ? 1 : volume;
      s.connect(g); g.connect(c.destination);
      s.start(0);
      return true;
    };
    if (buffer[nome]) return via();
    // non ancora pronto (il primo tocco appena aperta): suona appena è decodificato, se non è passato troppo
    const t0 = performance.now();
    prepara().then(() => { if (performance.now() - t0 < 1500) via(); });
    return true;
  }
  // prima del microfono: l'audio dei suoni si mette in pausa, così non contende il microfono al riconoscimento della
  // voce (il prossimo suono lo riapre da solo, sempre dentro un tocco)
  function ferma() {
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
  }
  // Il primo tocco entro «finoA» millisecondi: chiama alTocco(evento) una volta sola. Pointerup e touchend, non
  // pointerdown: l'iPhone apre l'audio solo alla fine del tocco. Uno scorrimento non conta: si aspetta il prossimo.
  function alPrimoTocco(alTocco, finoA) {
    let fatto = false, x0 = 0, y0 = 0;
    const scade = performance.now() + (finoA || 12000);
    const giu = e => { const p = e.touches ? e.touches[0] : e; x0 = p.clientX; y0 = p.clientY; };
    const su = e => {
      if (fatto) return;
      if (performance.now() > scade) { togli(); return; }
      const p = e.changedTouches ? e.changedTouches[0] : e;
      if (p && Math.hypot(p.clientX - x0, p.clientY - y0) > 12) return;   // ha scorso, non toccato
      fatto = true;
      togli();
      alTocco(e);
    };
    const togli = () => {
      document.removeEventListener('pointerdown', giu, true);
      document.removeEventListener('pointerup', su, true);
      document.removeEventListener('touchend', su, true);
      document.removeEventListener('keydown', su, true);
    };
    document.addEventListener('pointerdown', giu, true);
    document.addEventListener('pointerup', su, true);
    document.addEventListener('touchend', su, true);
    document.addEventListener('keydown', su, true);
    return togli;
  }

  window.Suoni = { NOMI, APERTURE, prepara, sblocca, suona, ferma, alPrimoTocco, suonati: () => suonati.slice(),
    stato: () => (ctx ? ctx.state : muto() ? 'muto' : 'chiuso'), pronti: () => Object.keys(buffer).length };
})();
