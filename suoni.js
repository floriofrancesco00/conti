/* Che Conti Devastanti — i suoni (dal 17/11/2026, motore rifatto il 20/11/2026).
   Registrazioni vere con licenza CC0 (Freesound e Kenney), tagliate e pareggiate da fai_suoni.py: niente sintesi.
   Suonano con Web Audio, che sull'iPhone si mescola con la musica (non ferma Spotify) e tace col silenzioso.
   La sigla all'apertura (Suoni.provaSubito, poi il primo tocco se l'iPhone non lascia suonare prima), il suono del
   saldo a ogni tocco dell'occhio, quelli dei movimenti da Salva ed Elimina.

   Il motore, rifatto il 20/11/2026 («il suono continua ogni tanto a buggarsi: non voglio che si buggi mai più»).
   Su iPhone l'audio di una pagina può finire «interrotto» (sottofondo, una chiamata, Siri, il microfono) e non
   riprendersi più, nemmeno con un tocco; oppure dire «running» e restare muto. Le correzioni che funzionano sui telefoni
   veri (cercate il 20/11/2026) non lo riparano: lo buttano e ne aprono uno nuovo dentro un tocco. Quindi:
   1. I suoni si decodificano UNA volta, con un audio a parte che non suona (OfflineAudioContext): restano validi per
      sempre, qualunque cosa succeda all'audio che suona.
   2. L'audio che suona si apre solo dentro un tocco, e se ne apre uno nuovo (chiudendo il vecchio) quando: l'app torna
      dal sottofondo, si è usato il microfono, non è «running», non è ripartito entro un secondo, il suo orologio è fermo
      (dice di andare ma non va), un suono non è partito. E dopo 45 secondi senza suoni si chiude da solo: ogni volta che
      si usa l'app parte un audio fresco, che non ha passato chiamate, Siri o cuffie (e non tiene accesa la batteria).
   3. Il tipo di audio dell'iPhone (navigator.audioSession) si mette «ambient» per i suoni (si mescola con la musica,
      altoparlante, rispetta il silenzioso) e «auto» prima del microfono; nel cambio si chiude prima l'audio vecchio.
      Dopo il microfono l'iPhone poteva restare in «registrazione»: suoni bassi o nell'auricolare.
   4. Un suono alla volta: uno nuovo ferma quello prima (sfumato in 40 ms); solo il saldo dopo la sigla aspetta in coda.
   5. Mai suoni vecchi: se l'audio non è pronto aspetta soltanto l'ultimo chiesto, per un secondo al massimo.
   window.__CONTI_MUTO (banco di prova): non apre l'audio del computer, segna soltanto cosa avrebbe suonato;
   window.__CONTI_SUBITO finge un telefono che lascia suonare prima del tocco. */
(function () {
  'use strict';
  const SIGLE = [
    { id: 'sigla-oro', nome: 'Fanfara d\'oro' },
    { id: 'sigla-fanfara', nome: 'Fanfara' },
    { id: 'sigla-corno', nome: 'Corno di guerra' },
    { id: 'sigla-tada', nome: 'Ta-da' },
    { id: 'nessuno', nome: 'Nessuna' }
  ];
  const SALDO = [
    { id: 'saldo-devastante', nome: 'Devastante' },
    { id: 'saldo-cassa', nome: 'Cassa' },
    { id: 'saldo-tesoro', nome: 'Tesoro' },
    { id: 'nessuno', nome: 'Nessuno' }
  ];
  // il saldo di ogni conto ha il suo suono; le feste hanno il loro al posto della sigla (feste.js)
  const CONTI = { contanti: 'saldo-contanti', digitale: 'saldo-digitale', cripto: 'saldo-cripto' };
  const FESTE = ['festa-natale', 'festa-capodanno', 'festa-trombetta', 'festa-halloween', 'festa-pasqua'];
  const NOMI = SIGLE.concat(SALDO).map(s => s.id).filter(n => n !== 'nessuno')
    .concat(Object.values(CONTI), FESTE, ['entrata', 'uscita', 'spostamento', 'elimina']);
  const ATTESA_MS = 1000;
  const RIPOSO_MS = 45000;   // senza suoni per tanto, l'audio si chiude (il prossimo tocco ne apre uno nuovo)
  const suonati = [];   // per le prove: cosa ha suonato (o avrebbe suonato), in ordine
  const muto = () => !!window.__CONTI_MUTO;
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  let ctx = null;            // l'audio che suona: si apre solo dentro un tocco
  let daRifare = false;      // al prossimo tocco se ne apre uno nuovo
  let pausa = false;         // il microfono: niente audio dei suoni finché l'app non chiede di nuovo un suono
  let rinnovi = 0;           // quante volte si è aperto un audio nuovo (per le prove e per il menù)
  let attivi = [], inAttesa = null, orologio = null, ultimoUso = 0;
  const buffer = {};         // nome → AudioBuffer, decodificati una volta e validi per sempre
  let caricamento = null;

  // ---------------------------------------------------------------- 1. decodificare una volta, a parte
  let decodificatore = null;
  function decodificaCon(d, ab) {
    return new Promise((ok, ko) => {
      try {
        if (!d) { ko(new Error('niente audio')); return; }
        const p = d.decodeAudioData(ab, ok, ko);
        if (p && p.catch) p.catch(ko);
      } catch (e) { ko(e); }
    });
  }
  // con l'audio a parte; se lì non riesce (o non c'è: telefoni molto vecchi), con l'audio che suona
  function decodifica(ab) {
    const copia = ab.slice(0);   // decodeAudioData consuma i byte che riceve
    let d = null;
    try { d = OAC ? (decodificatore || (decodificatore = new OAC(1, 1, 44100))) : null; } catch (e) { d = null; }
    return decodificaCon(d, ab).catch(() => decodificaCon(ctx, copia));
  }
  // scarica e decodifica quelli che mancano; si può richiamare: rifà solo i mancanti (una rete caduta non li perde)
  function prepara() {
    if (muto()) return Promise.resolve(0);
    if (caricamento) return caricamento;
    const mancanti = NOMI.filter(n => !buffer[n]);
    if (!mancanti.length) return Promise.resolve(NOMI.length);
    caricamento = Promise.all(mancanti.map(n => fetch('suoni/' + n + '.mp3')
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(decodifica)
      .then(b => { buffer[n] = b; }, () => { /* riprova la prossima volta */ })))
      .then(() => { caricamento = null; return Object.keys(buffer).length; });
    return caricamento;
  }

  // ---------------------------------------------------------------- 2-3. l'audio che suona, sempre fresco
  function sessione(tipo) {
    try { if (navigator.audioSession && navigator.audioSession.type !== tipo) navigator.audioSession.type = tipo; } catch (e) { /* non c'è */ }
  }
  function chiudi() {
    if (ctx) {
      fermaTutti();
      const vecchio = ctx;
      ctx = null;
      try { vecchio.close().catch(() => {}); } catch (e) { /* già chiuso */ }
    }
    orologio = null;
  }
  // un audio nuovo: da chiamare dentro un tocco (sull'iPhone fuori da un tocco nasce fermo)
  function apri() {
    if (!AC || muto()) return null;
    sessione('auto');   // l'ordine delle correzioni che funzionano: «auto», chiudere il vecchio, «ambient», aprire
    chiudi();
    sessione('ambient');
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; } }
    daRifare = false;
    if (!ctx) return null;
    rinnovi++;
    ultimoUso = performance.now();
    ctx.addEventListener('statechange', riprova);
    svegli(ctx);
    return ctx;
  }
  // un campione muto e resume(): sull'iPhone è questo, dentro il tocco, che apre davvero l'audio
  function svegli(c) {
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
    } catch (e) { /* niente */ }
    if (c.state !== 'running') {
      try { c.resume().catch(() => {}); } catch (e) { /* niente */ }
      // non riparte entro un secondo: al prossimo tocco uno nuovo
      setTimeout(() => { if (c === ctx && c.state !== 'running') daRifare = true; }, ATTESA_MS);
    }
  }
  // dentro un tocco: l'audio deve essere pronto. Se c'è qualcosa che non va, uno nuovo.
  function sblocca() {
    if (muto() || !AC) return null;
    if (!ctx || daRifare || ctx.state === 'closed' || ctx.state === 'interrupted' || fermo()) return apri();
    if (ctx.state !== 'running') svegli(ctx);
    return ctx;
  }
  // l'orologio dell'audio non va avanti anche se dice «running»: è morto (succede sull'iPhone dopo il sottofondo)
  function fermo() {
    if (!ctx || ctx.state !== 'running' || !orologio) return false;
    const ms = performance.now() - orologio.quando;
    return ms > 700 && ctx.currentTime - orologio.t < 0.05;
  }
  function guardaOrologio() {
    if (!ctx || document.hidden) { orologio = null; return; }
    if (!attivi.length && !inAttesa && performance.now() - ultimoUso > (window.__CONTI_RIPOSO || RIPOSO_MS)) { chiudi(); daRifare = !pausa; return; }
    if (fermo()) daRifare = true;
    if (ctx.state === 'running') orologio = { t: ctx.currentTime, quando: performance.now() };
    else orologio = null;
  }
  setInterval(guardaOrologio, 1000);

  // ogni tocco controlla l'audio (prima di qualsiasi altro ascoltatore: suoni.js si carica prima dell'app), così il
  // suono che quel tocco chiederà trova l'audio già aperto. Uno scorrimento non conta: l'iPhone non lo prende per un tocco.
  let x0 = 0, y0 = 0;
  const giu = e => { const p = e.touches ? e.touches[0] : e; if (p) { x0 = p.clientX; y0 = p.clientY; } };
  const su = e => {
    if (pausa || !(ctx || daRifare)) return;   // la prima volta (e col microfono) l'audio si apre solo quando serve un suono
    const p = e.changedTouches ? e.changedTouches[0] : e;
    if (p && p.clientX !== undefined && Math.hypot(p.clientX - x0, p.clientY - y0) > 12) return;
    sblocca();
  };
  document.addEventListener('pointerdown', giu, { capture: true, passive: true });
  document.addEventListener('touchstart', giu, { capture: true, passive: true });
  ['pointerup', 'touchend', 'keydown'].forEach(n => document.addEventListener(n, su, { capture: true, passive: true }));
  // in sottofondo l'audio si chiude: tornando, il primo tocco ne apre uno nuovo
  document.addEventListener('visibilitychange', () => { if (document.hidden) { inAttesa = null; chiudi(); daRifare = true; } });
  window.addEventListener('pagehide', () => { inAttesa = null; chiudi(); daRifare = true; });

  // ---------------------------------------------------------------- 4-5. un suono alla volta, mai suoni vecchi
  function fermaTutti() {
    if (!ctx) { attivi = []; return; }
    const t = ctx.currentTime;
    for (const a of attivi) {
      try { a.g.gain.setTargetAtTime(0, t, 0.012); a.s.stop(t + 0.06); } catch (e) { /* già finito */ }
    }
    attivi = [];
  }
  function avvia(c, nome, opz) {
    const b = buffer[nome];
    if (!b || c !== ctx || c.state !== 'running') return false;
    try {
      const ora = c.currentTime;
      const sigla = attivi.find(a => a.nome.startsWith('sigla-') && a.fine > ora + 0.2);
      let quando = ora;
      if (opz.inCoda && sigla) {
        for (const a of attivi) if (a !== sigla) { try { a.s.stop(); } catch (e) { /* */ } }   // in coda: solo la sigla resta
        attivi = [sigla];
        quando = sigla.fine - 0.15;
      } else fermaTutti();
      const s = c.createBufferSource(), g = c.createGain();
      s.buffer = b;
      g.gain.value = opz.volume === undefined ? 1 : opz.volume;
      s.connect(g); g.connect(c.destination);
      s.start(quando);
      const voce = { s, g, nome, fine: quando + b.duration };
      attivi.push(voce);
      ultimoUso = performance.now() + b.duration * 1000;
      s.onended = () => { attivi = attivi.filter(a => a !== voce); };
      return true;
    } catch (e) {
      daRifare = true;   // un suono che non parte: al prossimo tocco un audio nuovo
      return false;
    }
  }
  function riprova() {
    if (!inAttesa) return;
    if (performance.now() - inAttesa.t > ATTESA_MS) { inAttesa = null; return; }
    if (ctx && ctx.state === 'running' && buffer[inAttesa.nome]) {
      const { nome, opz } = inAttesa;
      inAttesa = null;
      avvia(ctx, nome, opz);
    }
  }
  // opz.inCoda: se sta suonando la sigla, parte appena finisce (il primo tocco sull'occhio: sigla, poi saldo)
  function suona(nome, opz) {
    if (!nome || nome === 'nessuno') return false;
    opz = opz || {};
    suonati.push(nome);
    pausa = false;   // l'app chiede un suono solo a microfono spento
    if (muto()) return true;
    const c = sblocca();
    if (!c) return false;
    if (c.state === 'running' && buffer[nome] && avvia(c, nome, opz)) { inAttesa = null; return true; }
    // non pronto: aspetta lui solo (quello di prima, se c'era, non suona più), per un secondo al massimo
    const questa = inAttesa = { nome, opz, t: performance.now() };
    prepara().then(riprova);
    setTimeout(riprova, 150);
    setTimeout(riprova, 450);
    setTimeout(() => {
      if (inAttesa !== questa) return;
      if (ctx && ctx.state === 'running' && buffer[nome]) { inAttesa = null; avvia(ctx, nome, opz); return; }
      inAttesa = null;
      if (buffer[nome]) daRifare = true;   // c'era il suono ma non l'audio: al prossimo tocco uno nuovo
    }, ATTESA_MS);
    return true;
  }
  // La sigla appena aperta, se il telefono lo lascia fare senza un tocco: si prova un audio e si guarda se parte
  // davvero. Vero se ha suonato; falso se l'iPhone lo blocca (allora l'audio si chiude e la sigla aspetta il tocco).
  function provaSubito(nome) {
    if (!nome || nome === 'nessuno') return Promise.resolve(false);
    if (muto()) {
      if (!window.__CONTI_SUBITO) return Promise.resolve(false);
      suonati.push(nome);
      return Promise.resolve(true);
    }
    if (!AC || pausa) return Promise.resolve(false);
    const c = ctx || apri();
    if (!c) return Promise.resolve(false);
    return Promise.race([
      (c.state === 'running' ? Promise.resolve() : c.resume()).then(() => c.state === 'running', () => false),
      new Promise(ok => setTimeout(() => ok(false), 600))
    ]).then(va => {
      if (!va || c.state !== 'running' || c !== ctx) { if (c === ctx) { chiudi(); daRifare = !pausa; } return false; }   // il tocco dopo ne apre uno
      return prepara().then(() => (buffer[nome] ? suona(nome) : false));
    });
  }
  // prima del microfono: niente suoni, l'audio si chiude e l'iPhone torna «auto», così il microfono è tutto della voce;
  // il prossimo suono aprirà un audio nuovo, già «ambient» (dopo il microfono l'iPhone resta spesso in registrazione)
  function ferma() {
    pausa = true;
    inAttesa = null;
    chiudi();
    sessione('auto');
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
      fatto = true;
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

  window.Suoni = { NOMI, SIGLE, SALDO, CONTI, FESTE, prepara, sblocca, suona, provaSubito, ferma, alPrimoTocco, suonati: () => suonati.slice(),
    stato: () => (ctx ? ctx.state : muto() ? 'muto' : 'chiuso'), pronti: () => Object.keys(buffer).length,
    // per le prove: cosa sta suonando adesso, cosa aspetta, quante volte si è aperto un audio nuovo, l'audio stesso
    attivi: () => attivi.map(a => ({ nome: a.nome, inizio: Math.round((a.fine - (buffer[a.nome] ? buffer[a.nome].duration : 0)) * 100) / 100 })),
    inAttesa: () => (inAttesa ? inAttesa.nome : null), tempo: () => (ctx ? ctx.currentTime : 0),
    daRifare: () => daRifare, rinnovi: () => rinnovi, pausa: () => pausa, __audio: () => ctx };
})();
