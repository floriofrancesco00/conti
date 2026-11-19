/* Che Conti Devastanti — i suoni (dal 17/11/2026).
   Registrazioni vere con licenza CC0 (Freesound e Kenney), tagliate e pareggiate da fai_suoni.py: niente sintesi.
   Suonano con Web Audio, che sull'iPhone si mescola con la musica (non ferma Spotify) e tace col silenzioso.
   17/11/2026 sera: la sigla all'apertura (Suoni.provaSubito, poi il primo tocco se l'iPhone non lascia suonare prima),
   il suono del saldo a ogni tocco dell'occhio, quelli dei movimenti da Salva ed Elimina.
   window.__CONTI_MUTO (banco di prova): non apre l'audio del computer, segna soltanto cosa avrebbe suonato;
   window.__CONTI_SUBITO finge un telefono che lascia suonare prima del tocco. */
(function () {
  'use strict';
  const SIGLE = [
    { id: 'sigla-oro', nome: 'Fanfara d\'oro', sotto: 'Trombe, poi le monete del «Devastante»' },
    { id: 'sigla-fanfara', nome: 'Fanfara', sotto: 'Solo le trombe' },
    { id: 'sigla-corno', nome: 'Corno di guerra', sotto: 'Un corno, come prima di una battaglia' },
    { id: 'sigla-tada', nome: 'Ta-da', sotto: 'Corta e allegra' },
    { id: 'nessuno', nome: 'Nessuna', sotto: 'L\'app si apre in silenzio' }
  ];
  const SALDO = [
    { id: 'saldo-devastante', nome: 'Devastante', sotto: 'Un colpo, poi una manciata di monete che cade' },
    { id: 'saldo-cassa', nome: 'Cassa', sotto: 'Il «ka-ching» di un registratore di cassa' },
    { id: 'saldo-tesoro', nome: 'Tesoro', sotto: 'Un forziere che si apre' },
    { id: 'nessuno', nome: 'Nessuno', sotto: 'Il saldo si mostra in silenzio' }
  ];
  // 18/11/2026: il saldo di ogni conto ha il suo suono; le feste hanno il loro al posto della sigla (feste.js)
  const CONTI = { contanti: 'saldo-contanti', digitale: 'saldo-digitale', cripto: 'saldo-cripto' };
  const FESTE = ['festa-natale', 'festa-capodanno', 'festa-trombetta', 'festa-halloween', 'festa-pasqua'];
  const NOMI = SIGLE.concat(SALDO).map(s => s.id).filter(n => n !== 'nessuno')
    .concat(Object.values(CONTI), FESTE, ['entrata', 'uscita', 'spostamento', 'elimina']);
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
  // i file si scaricano e si decodificano una volta sola (il service worker li tiene anche senza rete)
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
  // Un suono alla volta, e mai suoni vecchi (19/11/2026). Francesco: «ogni tanto si bloccano, e quando li apri tutti e
  // tre insieme fanno il suono tutti e tre insieme, si sovrappongono». Era così: con l'audio del telefono in pausa
  // (app tornata dal sottofondo, dopo il microfono, appena aperta coi suoni ancora da decodificare) i suoni si mettevano
  // in fila invece di sparire, e alla ripresa partivano tutti insieme. Ora:
  //  - un suono nuovo ferma quello che sta suonando (sfumandolo in 40 ms); solo «inCoda» (il saldo dopo la sigla) aspetta;
  //  - se l'audio non è pronto, aspetta soltanto l'ultimo suono chiesto, e solo per ATTESA_MS: poi si butta.
  const ATTESA_MS = 1000;
  let attivi = [], inAttesa = null, bloccato = 0;
  function fermaTutti(c) {
    const t = c.currentTime;
    for (const a of attivi) {
      try { a.g.gain.setTargetAtTime(0, t, 0.012); a.s.stop(t + 0.06); } catch (e) { /* già finito */ }
    }
    attivi = [];
  }
  function avvia(c, nome, opz) {
    const b = buffer[nome];
    if (!b || c.state !== 'running') return false;
    const ora = c.currentTime;
    const sigla = attivi.find(a => a.nome.startsWith('sigla-') && a.fine > ora + 0.2);
    let quando = ora;
    if (opz.inCoda && sigla) {
      for (const a of attivi) if (a !== sigla) { try { a.s.stop(); } catch (e) { /* */ } }   // in coda: solo la sigla resta
      attivi = [sigla];
      quando = sigla.fine - 0.15;
    } else fermaTutti(c);
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = b;
    g.gain.value = opz.volume === undefined ? 1 : opz.volume;
    s.connect(g); g.connect(c.destination);
    s.start(quando);
    const voce = { s, g, nome, fine: quando + b.duration };
    attivi.push(voce);
    s.onended = () => { attivi = attivi.filter(a => a !== voce); };
    return true;
  }
  function riprova() {
    if (!inAttesa) return;
    const c = contesto();
    if (!c || performance.now() - inAttesa.t > ATTESA_MS) { inAttesa = null; return; }
    if (c.state === 'running' && buffer[inAttesa.nome]) {
      const { nome, opz } = inAttesa;
      inAttesa = null;
      avvia(c, nome, opz);
    }
  }
  // opz.inCoda: se sta suonando la sigla, parte appena finisce (il primo tocco sull'occhio: sigla, poi saldo)
  function suona(nome, opz) {
    if (!nome || nome === 'nessuno') return false;
    opz = opz || {};
    suonati.push(nome);
    if (muto()) return true;
    const c = bloccato ? rifai() : contesto();
    if (!c) return false;
    sblocca();
    if (c.state === 'running' && buffer[nome]) { inAttesa = null; bloccato = 0; return avvia(c, nome, opz); }
    // non pronto: aspetta lui solo (quello di prima, se c'era, non suona più)
    const questa = inAttesa = { nome, opz, t: performance.now() };
    if (!c.__ascolta) { c.__ascolta = true; c.addEventListener('statechange', riprova); }
    prepara().then(riprova);
    setTimeout(riprova, 250);
    setTimeout(riprova, 600);
    setTimeout(() => {
      if (inAttesa !== questa) return;   // è suonato, o ne è arrivato un altro
      if (c.state === 'running' && buffer[nome]) { inAttesa = null; avvia(c, nome, opz); return; }
      inAttesa = null;
      // dopo un tocco l'audio non è ripartito: l'iPhone a volte lo lascia bloccato dopo il sottofondo. Al prossimo
      // tocco se ne apre uno nuovo (i suoni già decodificati si riusano: non appartengono all'audio vecchio)
      if (buffer[nome] && c.state !== 'running') bloccato++;
    }, ATTESA_MS);
    return true;
  }
  // un audio nuovo al posto di quello bloccato, dentro il tocco
  function rifai() {
    try { if (ctx && ctx.close) ctx.close().catch(() => {}); } catch (e) { /* già chiuso */ }
    ctx = null;
    attivi = [];
    bloccato = 0;
    return contesto();
  }
  // La sigla appena aperta, se il telefono lo lascia fare senza un tocco: si prova ad aprire l'audio e si guarda se
  // parte davvero. Vero se ha suonato; falso se l'iPhone lo blocca (allora la sigla aspetta il primo tocco).
  function provaSubito(nome) {
    if (!nome || nome === 'nessuno') return Promise.resolve(false);
    if (muto()) {
      if (!window.__CONTI_SUBITO) return Promise.resolve(false);
      suonati.push(nome);
      return Promise.resolve(true);
    }
    const c = contesto();
    if (!c) return Promise.resolve(false);
    return Promise.race([
      (c.state === 'running' ? Promise.resolve() : c.resume()).then(() => c.state === 'running', () => false),
      new Promise(ok => setTimeout(() => ok(false), 600))
    ]).then(va => {
      if (!va || c.state !== 'running') return false;
      return prepara().then(() => (buffer[nome] ? suona(nome) : false));
    });
  }
  // prima del microfono: l'audio dei suoni si mette in pausa, così non contende il microfono al riconoscimento della
  // voce (il prossimo suono lo riapre da solo, sempre dentro un tocco)
  function ferma() {
    inAttesa = null;
    if (ctx) fermaTutti(ctx);
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
    // per le prove: cosa sta suonando adesso (nome e quando finisce) e cosa aspetta
    attivi: () => attivi.map(a => ({ nome: a.nome, inizio: Math.round((a.fine - (buffer[a.nome] ? buffer[a.nome].duration : 0)) * 100) / 100 })),
    inAttesa: () => (inAttesa ? inAttesa.nome : null), tempo: () => (ctx ? ctx.currentTime : 0), bloccato: () => bloccato };
})();
