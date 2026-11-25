/* Che Conti Devastanti — i suoni (dal 17/11/2026, motore rifatto il 25/11/2026 sui fatti del telefono di Francesco).
   Registrazioni vere con licenza CC0 (Freesound e Kenney), tagliate e pareggiate da fai_suoni.py: niente sintesi.
   Suonano con Web Audio, che sull'iPhone si mescola con la musica (non ferma Spotify) e tace col silenzioso.

   COSA HA DETTO IL TELEFONO (diagnosi del 25/11/2026, iOS 27.2)
   - un audio aperto con comodo va in 80-100 ms, e i suoni dopo partono in 0-2 ms;
   - un audio aperto SUBITO DOPO averne chiuso un altro dice «running» e ha l'orologio piantato a 0,01-0,03 s: non suona mai
     (5 volte su 5). Il motore del 24 chiudeva e riapriva apposta, per «rifare la sessione»: ogni suono arrivava con 1,4-1,7 s
     di ritardo, dalla riserva;
   - la riserva (un elemento <audio>, con l'audio appena chiuso) si è sentita tutte le volte;
   - una finestra confirm() sospende l'audio: l'app non ne apre più (conferma()).
   Il resto (letto nei sorgenti di WebKit) vale finché il telefono non lo smentisce: uscendo dall'app con l'audio aperto la
   sessione può restare «accesa» solo per la pagina, e si rimette a posto chiudendo l'ultimo audio con l'app davanti.

   LE REGOLE
   1. Il tipo è sempre «auto» (la riserva lo mette «ambient» mentre suona, poi lo rimette).
   2. L'audio si apre al primo suono, dentro il tocco, e resta aperto: si chiude dopo 30 s senza suoni, o perché è da buttare.
   3. Il suono parte subito, nel tocco: start() anche se l'audio si sta ancora svegliando (parte appena va, dall'inizio).
   4. Si controlla dopo: se entro 450 ms da un audio appena aperto (200 da uno che andava) l'orologio non cammina, quel suono si
      ferma, l'audio si butta e lo stesso suono esce dalla riserva.
   5. Dopo aver chiuso un audio non se ne apre un altro per 1,2 s: in quel tempo suona la riserva.
   6. Uscendo dall'app, con una chiamata o col microfono l'audio si sospende e si tiene; si chiude dopo, con l'app davanti (un
      secondo dopo il ritorno, o al primo dito).
   7. Un suono alla volta: uno nuovo ferma quello prima. Niente code. Dopo 1,5 s un suono è vecchio e non esce più.
   8. WebKit passa il permesso del tocco ai setTimeout fino a un secondo, purché nati dentro il tocco: per questo i controlli
      di un suono si fissano tutti quando viene chiesto.
   Il diario (Suoni.diario) tiene cosa è successo a ogni suono: Menù → Suoni → Copia diagnosi.

   Le prove: prova_suoni_iphone.js (l'iPhone finto: rifà il diario del 25/11 col motore di allora) e prova_motore_suoni,
   prova_suoni_dai_tasti e prova_orecchio in prova_conti.py (Web Audio vero, muto).
   window.__CONTI_MUTO (banco di prova): non apre l'audio del computer, segna soltanto cosa avrebbe suonato;
   window.__CONTI_SUBITO finge un telefono che lascia suonare prima del tocco. */
(function () {
  'use strict';
  const SIGLE = [
    { id: 'sigla-oro', nome: 'Fanfara d\'oro' },
    { id: 'sigla-fanfara', nome: 'Fanfara' },
    { id: 'sigla-corno', nome: 'Corno di guerra' },
    { id: 'sigla-tada', nome: 'Ta-da' }
  ];
  const SALDO = [
    { id: 'saldo-devastante', nome: 'Devastante' },
    { id: 'saldo-cassa', nome: 'Cassa' },
    { id: 'saldo-tesoro', nome: 'Tesoro' }
  ];
  // il saldo di ogni conto ha il suo suono; le feste hanno il loro al posto della sigla (feste.js)
  const CONTI = { contanti: 'saldo-contanti', digitale: 'saldo-digitale', cripto: 'saldo-cripto' };
  const FESTE = ['festa-natale', 'festa-capodanno', 'festa-trombetta', 'festa-halloween', 'festa-pasqua'];
  const NOMI = SIGLE.concat(SALDO).map(s => s.id)
    .concat(Object.values(CONTI), FESTE, ['entrata', 'uscita', 'spostamento', 'elimina']);
  const RIPOSO_MS = 30000;    // dopo l'ultimo suono l'audio resta aperto: chi ne chiede un altro non aspetta niente
  const FREDDO_MS = 450;      // un audio appena aperto ci mette 80-100 ms: oltre, è piantato
  const CALDO_MS = 200;       // uno che andava già
  const QUARANTENA_MS = 1200; // dopo aver chiuso un audio, prima di aprirne un altro
  const SCADENZA_MS = 1500;   // oltre, il suono è vecchio: non si suona più
  const DOPO_MIC_MS = 500;    // il microfono dell'iPhone si chiude un attimo dopo che l'app lo sa
  const DITO_MS = 400;        // col dito appena appoggiato l'audio non si chiude da solo
  const RITORNO_MS = 1000;    // tornando, l'app è attiva 0,3-0,7 s dopo che la pagina è visibile
  const ATTESA_MS = 420;      // quanto si aspetta che l'audio di prima finisca di chiudersi (di solito 20-80 ms)
  const APPUNTAMENTI = [12, 25, 40, 60, 85, 115, 150, 190, 240, 290, 340, 430];
  const CONTROLLI = [40, 80, 120, 160, 200, 250, 300, 350, 400, 450, 500];
  const suonati = [];   // per le prove: cosa ha suonato (o avrebbe suonato), in ordine
  const muto = () => !!window.__CONTI_MUTO;
  const ora = () => performance.now();
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const IPHONE = 'standalone' in navigator;   // esiste solo su iPhone e iPad

  let audio = null;          // l'audio aperto: { c, sano, malato, daChiudere, svegliato }
  let chiusura = null;       // la chiusura in corso
  let chiusoA = -1e9;        // quando si è chiuso l'ultimo
  let sospetto = false;      // usciti con la riserva che suonava: la sessione va ripulita (pulisci)
  let pausa = false;         // il microfono
  let micFine = -1e9;        // quando il microfono ha finito
  let richiesta = null;      // il suono chiesto e non ancora sentito partire: uno solo
  let attivi = [];           // il suono che va adesso
  let riserva = null;        // l'elemento <audio> che sta suonando
  let timerRiposo = null, rinnovi = 0, ultimoDito = -1e9;

  // ---------------------------------------------------------------- il diario (per capire un difetto senza indovinare)
  const CHIAVE = ((window.EDIZIONE && window.EDIZIONE.chiave) || 'conti') + '.suoni';
  let salute = { chiesti: 0, partiti: 0, riserva: 0, persi: 0, ms: [] }, righe = [], daScrivere = null;
  try {
    const d = JSON.parse(localStorage.getItem(CHIAVE) || 'null');
    if (d && d.salute && Array.isArray(d.righe)) { salute = Object.assign(salute, d.salute); righe = d.righe.slice(-90); }
  } catch (e) { /* si riparte da vuoto */ }
  function scriviDiario() {
    clearTimeout(daScrivere);
    daScrivere = null;
    try { localStorage.setItem(CHIAVE, JSON.stringify({ salute, righe })); } catch (e) { /* non grave */ }
  }
  function nota(cosa) {
    if (muto()) return;
    const d = new Date(Date.now()), p = n => String(n).padStart(2, '0');
    righe.push(p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' + cosa);
    if (righe.length > 90) righe.splice(0, righe.length - 90);
    if (!daScrivere) daScrivere = setTimeout(scriviDiario, 4000);
  }
  function statoBreve() {
    let s = '';
    try { const a = navigator.audioSession; if (a) s = ' tipo=' + a.type + (a.state ? ' sessione=' + a.state : ''); } catch (e) { /* non c'è */ }
    return (audio ? audio.c.state + ' ' + audio.c.currentTime.toFixed(2) + 's ' + audio.c.sampleRate : 'chiuso') + s;
  }

  // ---------------------------------------------------------------- scaricare e decodificare, una volta, a parte
  const buffer = {};         // nome → AudioBuffer, validi per sempre qualunque cosa succeda all'audio che suona
  const byte = {};           // nome → Blob dell'mp3, per la riserva
  const inArrivo = {};
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
  // a 48000, quella dell'iPhone: così il suono non viene ricampionato mentre suona. Se l'audio a parte non riesce (o non
  // c'è: telefoni molto vecchi), con quello che suona
  function decodifica(ab) {
    const copia = ab.slice(0);   // decodeAudioData consuma i byte che riceve
    let d = null;
    try { d = OAC ? (decodificatore || (decodificatore = new OAC(1, 1, 48000))) : null; } catch (e) { d = null; }
    return decodificaCon(d, ab).catch(() => decodificaCon(audio && audio.c, copia));
  }
  function carica(n) {
    if (muto() || !NOMI.includes(n)) return Promise.resolve(false);
    if (buffer[n]) return Promise.resolve(true);
    return inArrivo[n] || (inArrivo[n] = fetch('suoni/' + n + '.mp3')
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(ab => {
        try { byte[n] = new Blob([ab.slice(0)], { type: 'audio/mpeg' }); } catch (e) { /* senza riserva */ }
        return AC ? decodifica(ab) : null;
      })
      .then(b => { if (b) buffer[n] = b; }, () => { /* riprova la prossima volta */ })
      .then(() => { delete inArrivo[n]; return !!buffer[n]; }));
  }
  // prima quelli che serviranno subito; si può richiamare: rifà solo i mancanti (una rete caduta non li perde)
  function prepara(prima) {
    if (muto()) return Promise.resolve(0);
    const ordine = (prima || []).concat(NOMI).filter((n, i, l) => l.indexOf(n) === i && !buffer[n]);
    return ordine.reduce((p, n) => p.then(() => carica(n)), Promise.resolve()).then(() => Object.keys(buffer).length);
  }

  // ---------------------------------------------------------------- aprire e spegnere l'audio (regole 1, 2, 5, 6)
  function tipo(t) {
    try { if (navigator.audioSession && navigator.audioSession.type !== t) navigator.audioSession.type = t; } catch (e) { /* non c'è */ }
  }
  // sempre, anche se dice già «auto»: dopo una ricarica il tipo imposto dalla pagina di prima resta nel processo
  try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (e) { /* non c'è */ }
  // aspetta una promessa, ma non più di ms (sull'iPhone ce ne sono che non rispondono mai)
  function entro(fa, ms) {
    let p = null;
    try { p = fa(); } catch (e) { /* già chiuso */ }
    return Promise.race([Promise.resolve(p).catch(() => {}), new Promise(ok => setTimeout(ok, ms))]);
  }
  function apri() {
    if (!AC || muto()) return null;
    tipo('auto');
    let c = null;
    try { c = new AC({ latencyHint: 'interactive' }); } catch (e) { try { c = new AC(); } catch (e2) { c = null; } }
    if (!c) return null;
    const a = audio = { c, sano: false, malato: false, daChiudere: false, insistito: false, svegliato: -1e9 };
    rinnovi++;
    c.addEventListener('statechange', () => {
      if (c.state !== 'interrupted') return;   // una chiamata, Siri, la sveglia, o si sta uscendo
      a.sano = false; a.daChiudere = true;
      if (a === audio) { fermaTutti(); clearTimeout(timerRiposo); }   // se no dopo la chiamata ne suonerebbe il resto
      entro(() => c.suspend(), 50);
      nota('interrotto');
    });
    svegli(a);
    programmaRiposo();
    return a;
  }
  // un campione muto e resume(): sull'iPhone è questo, dentro il tocco, che apre davvero l'audio
  function svegli(a) {
    if (a.c.state === 'running' || a.c.state === 'closed') return;
    a.svegliato = ora();
    try {
      const s = a.c.createBufferSource();
      s.buffer = a.c.createBuffer(1, 1, 22050);
      s.connect(a.c.destination);
      s.start(0);
    } catch (e) { /* niente */ }
    try { a.c.resume().catch(() => {}); } catch (e) { /* niente */ }
  }
  // spegnere per bene: suspend() dice a WebKit che non suona più niente (e spegne la sessione), close() libera il resto
  function spegni(perche) {
    const a = audio;
    clearTimeout(timerRiposo);
    if (!a) return chiusura || Promise.resolve();
    const sfuma = attivi.length && a.c.state === 'running' && !a.malato ? 50 : 0;
    fermaTutti();
    audio = null;
    chiusoA = ora();
    if (perche) nota(perche);
    const prima = chiusura || Promise.resolve();
    const p = prima
      .then(() => (sfuma ? new Promise(ok => setTimeout(ok, sfuma)) : 0))
      .then(() => { if (!riserva) tipo('auto'); return a.c.state === 'running' ? entro(() => a.c.suspend(), 250) : 0; })
      .then(finitoMicrofono)
      .then(() => (a.c.state === 'closed' ? 0 : entro(() => a.c.close(), 400)))
      .then(() => { chiusoA = Math.max(chiusoA, ora()); if (chiusura === p) chiusura = null; });
    chiusura = p;
    return p;
  }
  function programmaRiposo() {
    clearTimeout(timerRiposo);
    const resta = Math.max(0, ...attivi.map(v => v.finisce - ora()));
    timerRiposo = setTimeout(() => {
      if (document.hidden || !audio || pausa) return;
      if (richiesta || ora() - ultimoDito < DITO_MS || attivi.some(v => v.finisce > ora())) { programmaRiposo(); return; }
      spegni('');
    }, resta + (window.__CONTI_RIPOSO || RIPOSO_MS));
  }

  // ---------------------------------------------------------------- un suono (regole 3-5, 7)
  function ferma1(v) {
    try {
      if (v.c.state === 'running') { const t = v.c.currentTime; v.g.gain.setTargetAtTime(0, t, 0.012); v.s.stop(t + 0.06); }
      else { v.g.gain.value = 0; v.s.stop(0); }   // l'audio non andava ancora: quel suono non deve uscire quando si sveglia
    } catch (e) { /* già finito */ }
  }
  function fermaTutti() { const l = attivi; attivi = []; l.forEach(ferma1); }
  function suonaSu(a, r) {
    const c = a.c, b = buffer[r.nome], quando = c.currentTime + (c.state === 'running' ? 0.005 : 0);
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = b;
    g.gain.value = r.opz.volume === undefined ? 1 : r.opz.volume;
    s.connect(g); g.connect(c.destination);
    s.start(quando);
    const voce = { s, g, c, r, nome: r.nome, inizio: quando, fine: quando + b.duration, finisce: ora() + b.duration * 1000 };
    attivi.push(voce);
    s.onended = () => { attivi = attivi.filter(v => v !== voce); };
    programmaRiposo();
    return voce;
  }
  function segnaPartito(r, come, ms) {
    if (come === 'partiti') salute.partiti++; else salute.riserva++;
    salute.ms = salute.ms.concat(ms).slice(-40);
    nota((come === 'partiti' ? 'ok ' : 'riserva ') + r.nome + ' ' + ms + ' ms');
  }
  // il suono chiesto, dentro il tocco
  function parti(r) {
    if (r !== richiesta || r.voce || r.conRiserva || document.hidden || pausa) return;
    const mic = micFine + DOPO_MIC_MS - ora();
    if (mic > 0) return;   // il microfono si sta chiudendo: ci riprovano gli appuntamenti
    if (!buffer[r.nome] && (inArrivo[r.nome] || !byte[r.nome])) return;   // sta arrivando: ci riprova carica()
    if (!AC || !buffer[r.nome]) { conRiserva(r, 'senza audio web'); return; }
    if (audio && audio.pulizia && ora() - r.t0 < ATTESA_MS) return;
    if (audio && (audio.malato || audio.daChiudere)) spegni(audio.pulizia ? '' : 'chiuso al tocco');
    if (sospetto && !audio && !chiusura) { pulisci(); return; }
    // l'audio di prima si sta chiudendo: la riserva parte quando ha finito (è il chiudere che rimette a posto la sessione)
    if (chiusura && ora() - r.t0 < ATTESA_MS) return;   // ci riprovano gli appuntamenti
    if (chiusura || ora() - chiusoA < QUARANTENA_MS) { conRiserva(r, 'audio appena chiuso'); return; }
    // il permesso del tocco è scaduto: un audio nuovo non partirebbe, la riserva sì
    if (IPHONE && !(audio && audio.c.state === 'running') && navigator.userActivation && !navigator.userActivation.isActive) { conRiserva(r, 'tocco scaduto'); return; }
    const a = audio || apri();
    if (!a) { conRiserva(r, 'niente audio'); return; }
    svegli(a);
    try {
      r.t = a.c.currentTime;
      r.voce = suonaSu(a, r);
      r.audio = a;
      r.caldo = a.sano && a.c.state === 'running';
      r.da = ora();
    } catch (e) { a.malato = true; conRiserva(r, 'start rifiutato'); return; }
    controlla(r);
  }
  // si era usciti mentre suonava la riserva (o un audio si stava chiudendo): la sessione può essere rimasta accesa solo per la
  // pagina, e allora tutto andrebbe muto. Si apre un audio e lo si chiude, che la rimette a posto; questo suono va con la riserva
  function pulisci() {
    sospetto = false;
    const a = apri();
    if (!a) return;
    a.daChiudere = a.pulizia = true;
    const fine = ora() + 180;
    const guarda = () => {
      if (a !== audio) return;
      if (a.c.state === 'running' || ora() > fine) spegni('sessione ripulita'); else setTimeout(guarda, 12);
    };
    guarda();
  }
  // dopo: l'orologio cammina davvero? (un audio piantato arriva al massimo a 0,03 s)
  function controlla(r) {
    if (r !== richiesta || !r.voce || r.conRiserva || pausa || document.hidden) return;
    const a = r.audio, fatti = a.c.currentTime - r.t, da = ora() - r.da;
    // quando va, resume() una volta ancora: su iOS 26 e 27 la prima richiesta può partire senza accendere la sessione
    if (a.c.state === 'running' && !a.insistito) { a.insistito = true; try { a.c.resume().catch(() => {}); } catch (e) { /* niente */ } }
    if (a === audio && a.c.state === 'running' && fatti > 0.06) {
      a.sano = true;
      richiesta = null;
      segnaPartito(r, 'partiti', Math.max(0, Math.round(ora() - r.t0 - fatti * 1000)));
      const t1 = a.c.currentTime;
      setTimeout(() => ancora(r, a, t1), 160);
      return;
    }
    if (da >= (r.caldo ? CALDO_MS : FREDDO_MS) || a !== audio) { salta(r, a, r.caldo ? 'fermo' : 'non parte'); return; }
    if (a.c.state !== 'running' && ora() - a.svegliato > 110) svegli(a);
  }
  // partito, e poi si ferma (una finestra di sistema, l'uscita audio che cambia): lo stesso suono dalla riserva
  function ancora(r, a, t) {
    if (a !== audio || richiesta || !attivi.includes(r.voce) || document.hidden || pausa) return;
    if (a.c.state === 'running' && a.c.currentTime > t + 0.05) return;
    if (ora() - r.t0 < 900) { richiesta = r; salta(r, a, 'fermo appena partito'); }
    else { a.malato = true; nota('fermo a metà · ' + statoBreve()); }
  }
  function salta(r, a, perche) {
    const v = r.voce;
    r.voce = null;
    if (v) { attivi = attivi.filter(x => x !== v); ferma1(v); }
    nota(perche + ' · ' + statoBreve());
    a.malato = true;
    conRiserva(r, '');
  }
  function suona(nome, opz) {
    if (!nome || nome === 'nessuno') return false;
    suonati.push(nome);
    if (pausa) libera();   // l'app chiede un suono solo a microfono spento
    if (muto()) return true;
    if (document.hidden) return false;
    const r = { nome, opz: opz || {}, t0: ora(), voce: null, conRiserva: false };
    salute.chiesti++;
    if (riserva) fineRiserva();
    fermaTutti();
    richiesta = r;
    parti(r);
    if (!r.voce && !r.conRiserva) carica(nome).then(() => parti(r));
    // i controlli nascono tutti qui, dentro il tocco (regola 8)
    const base = Math.max(0, Math.ceil(micFine + DOPO_MIC_MS - ora()));
    for (const ms of APPUNTAMENTI) setTimeout(() => parti(r), base + ms);
    for (const ms of CONTROLLI) setTimeout(() => controlla(r), base + ms);
    setTimeout(() => scaduto(r), base + SCADENZA_MS);
    return true;
  }
  function scaduto(r) {
    if (r !== richiesta || r.conRiserva) return;
    if (r.voce && r.audio === audio && audio.c.state === 'running' && audio.c.currentTime > r.t + 0.06) { controlla(r); return; }
    richiesta = null;
    if (r.voce) { const v = r.voce; r.voce = null; attivi = attivi.filter(x => x !== v); ferma1(v); }
    salute.persi++;
    nota('PERSO ' + r.nome + ' · ' + (buffer[r.nome] ? '' : 'suono non arrivato · ') + statoBreve());
    scriviDiario();
  }

  // ---------------------------------------------------------------- 4 e 5. la riserva: un elemento <audio>
  // Serve «ambient» mentre suona (se no fermerebbe Spotify e suonerebbe anche col silenzioso). Un attimo prima della
  // fine: muto, «auto», pausa. In quest'ordine WebKit spegne la sessione; con «ambient» ancora messo non lo farebbe.
  function conRiserva(r, perche) {
    if (!byte[r.nome] || pausa || document.hidden) return;   // resta in attesa: ci pensa scaduto()
    r.conRiserva = true;
    if (perche) nota(perche);
    if (audio) spegni('');
    let url = '';
    try {
      url = URL.createObjectURL(byte[r.nome]);
      const el = new Audio(url);
      el.setAttribute('playsinline', '');
      tipo('ambient');
      const mia = riserva = { el, r, url, timer: 0 };
      const durata = buffer[r.nome] ? buffer[r.nome].duration : 3.4;
      const rotta = e => {
        if (riserva !== mia) return;
        r.conRiserva = false;
        if (e) nota('riserva rifiutata: ' + ((e && e.name) || 'errore'));
        fineRiserva();
        if (richiesta === null) richiesta = r;
        scaduto(r);
      };
      mia.timer = setTimeout(() => rotta(null), 4500);
      el.addEventListener('ended', () => { if (riserva === mia) fineRiserva(); });
      Promise.resolve(el.play()).then(() => {
        if (riserva !== mia) return;
        if (richiesta === r) richiesta = null;
        segnaPartito(r, 'riserva', Math.round(ora() - r.t0));
        clearTimeout(mia.timer);
        mia.timer = setTimeout(() => { if (riserva === mia) fineRiserva(); }, Math.max(120, durata * 1000 - 60));
      }, rotta);
    } catch (e) {
      r.conRiserva = false;
      tipo('auto');
      if (url) try { URL.revokeObjectURL(url); } catch (e2) { /* */ }
      scaduto(r);
    }
  }
  function fineRiserva() {
    const m = riserva;
    if (!m) return;
    riserva = null;
    clearTimeout(m.timer);
    try { m.el.muted = true; } catch (e) { /* */ }
    tipo('auto');
    try { m.el.pause(); m.el.removeAttribute('src'); m.el.load(); } catch (e) { /* */ }
    try { URL.revokeObjectURL(m.url); } catch (e) { /* */ }
    if (richiesta === m.r) richiesta = null;
  }

  // ---------------------------------------------------------------- 6. uscire, tornare, il microfono
  function metteVia() {   // l'audio aperto mentre si esce: sospeso e tenuto, si chiude tornando
    richiesta = null;
    if (riserva || chiusura || (audio && audio.pulizia)) sospetto = true;
    if (riserva) fineRiserva();
    if (!audio) return;
    clearTimeout(timerRiposo);
    audio.daChiudere = true;
    fermaTutti();
    const a = audio;
    entro(() => a.c.suspend(), 50);
  }
  function chiudiTornando() {
    if (document.hidden || pausa || richiesta || !audio || !audio.daChiudere) return;
    if (ora() - ultimoDito < DITO_MS) { setTimeout(chiudiTornando, DITO_MS); return; }
    spegni('chiuso al ritorno');
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (audio) nota('uscito con l\'audio aperto'); metteVia(); scriviDiario(); return; }
    if (audio && audio.daChiudere) setTimeout(chiudiTornando, RITORNO_MS);
  });
  window.addEventListener('pagehide', () => { metteVia(); scriviDiario(); });
  document.addEventListener('pointerdown', e => {
    ultimoDito = ora();
    if (e.target && e.target.closest && e.target.closest('#microfono')) return;   // chiudere adesso capiterebbe mentre parte il microfono
    if (audio && (audio.daChiudere || audio.malato) && !pausa && !richiesta) spegni('chiuso al dito');
  }, { capture: true, passive: true });
  // finché un suono aspetta l'audio, ogni tocco lo risveglia (se il primo evento del tocco non era bastato)
  ['touchend', 'click', 'keydown'].forEach(n => document.addEventListener(n, () => {
    if (richiesta && richiesta.voce && audio && !audio.daChiudere && !pausa) svegli(audio);
  }, { capture: true, passive: true }));

  let chiAspettaIlMic = [];
  function finitoMicrofono() { return pausa ? new Promise(ok => chiAspettaIlMic.push(ok)) : 0; }
  // prima del microfono: niente suoni; l'audio resta aperto e zitto, si chiude dopo
  function ferma() {
    pausa = true;
    richiesta = null;
    if (riserva) fineRiserva();
    clearTimeout(timerRiposo);
    if (!audio) return;
    audio.daChiudere = true;
    for (const v of attivi) { try { v.s.stop(); } catch (e) { /* */ } }
    attivi = [];
  }
  // il microfono ha finito (l'app lo dice appena lo sa)
  function libera() {
    if (!pausa) return;
    pausa = false;
    micFine = ora();
    chiusoA = Math.max(chiusoA, micFine + DOPO_MIC_MS);   // anche la fine del microfono spegne la sessione (regola 5)
    setTimeout(() => {
      if (pausa) return;
      chiAspettaIlMic.splice(0).forEach(f => f());
      if (!document.hidden && audio && audio.daChiudere && !richiesta) spegni('');
    }, DOPO_MIC_MS);
  }

  // La sigla appena aperta, se il telefono lo lascia fare senza un tocco. Sull'iPhone mai (WebKit vuole un tocco): non
  // si prova nemmeno, perché un audio aperto mentre l'app sta ancora diventando attiva è uno di quelli che si guastano.
  function provaSubito(nome) {
    if (!nome || nome === 'nessuno') return Promise.resolve(false);
    if (muto()) {
      if (!window.__CONTI_SUBITO) return Promise.resolve(false);
      suonati.push(nome);
      return Promise.resolve(true);
    }
    if (IPHONE || !AC || pausa || richiesta) return Promise.resolve(false);
    const a = audio || apri();
    if (!a) return Promise.resolve(false);
    return new Promise(ok => {
      const fine = ora() + 600;
      const guarda = () => {
        if (a !== audio || richiesta) { ok(false); return; }   // intanto è arrivato un tocco: l'audio adesso è suo
        if (a.c.state === 'running') { ok(true); return; }
        if (ora() > fine) { spegni(''); ok(false); return; }
        setTimeout(guarda, 30);
      };
      guarda();
    }).then(va => (va ? carica(nome).then(c => (c && !richiesta ? suona(nome) : false)) : false));
  }
  // Il primo tocco entro «finoA» millisecondi: chiama alTocco(evento) una volta sola. Touchend e click: sono quelli che
  // sull'iPhone aprono l'audio di sicuro. Uno scorrimento non conta: si aspetta il prossimo.
  function alPrimoTocco(alTocco, finoA) {
    let fatto = false, x0 = null, y0 = 0;
    const scade = ora() + (finoA || 12000);
    const giu = e => { const p = e.touches ? e.touches[0] : e; if (p) { x0 = p.clientX; y0 = p.clientY; } };
    const su = e => {
      if (fatto) return;
      if (ora() > scade) { togli(); return; }
      const p = e.changedTouches ? e.changedTouches[0] : e;
      if (x0 !== null && p && p.clientX !== undefined && e.type !== 'click' && Math.hypot(p.clientX - x0, p.clientY - y0) > 12) return;   // ha scorso
      fatto = true;
      togli();
      alTocco(e);
    };
    const EVENTI = [['pointerdown', giu], ['touchstart', giu], ['touchend', su], ['click', su], ['keydown', su]];
    const togli = () => { fatto = true; EVENTI.forEach(([n, f]) => document.removeEventListener(n, f, true)); };
    EVENTI.forEach(([n, f]) => document.addEventListener(n, f, true));
    return togli;
  }

  // apre l'audio senza un suono (le prove): dopo il riposo si spegne da solo
  function sblocca() {
    if (muto() || !AC || pausa || chiusura) return null;
    const a = audio || apri();
    if (a) svegli(a);
    return a && a.c;
  }
  function testoDiario() {
    const m = salute.ms.length ? Math.round(salute.ms.reduce((x, y) => x + y, 0) / salute.ms.length) : 0;
    return ['Diagnosi dei suoni', navigator.userAgent, 'icona=' + (navigator.standalone === undefined ? '?' : navigator.standalone) + ' · ' + statoBreve(),
      'chiesti ' + salute.chiesti + ', partiti ' + salute.partiti + ', riserva ' + salute.riserva + ', persi ' + salute.persi + ', in media ' + m + ' ms']
      .concat(righe).join('\n');
  }

  window.Suoni = { NOMI, SIGLE, SALDO, CONTI, FESTE, prepara, sblocca, suona, provaSubito, ferma, libera, alPrimoTocco, suonati: () => suonati.slice(),
    stato: () => (audio ? audio.c.state : muto() ? 'muto' : 'chiuso'), pronti: () => Object.keys(buffer).length,
    salute: () => Object.assign({}, salute, { ms: salute.ms.slice() }), diario: testoDiario,
    riposa: () => spegni(''), aperto: () => !!(audio || chiusura),
    staSuonando: () => !!(richiesta || riserva || attivi.some(v => v.finisce > ora())),
    // per le prove: cosa sta suonando adesso, cosa aspetta, quante volte si è aperto un audio nuovo, l'audio stesso
    attivi: () => attivi.map(v => ({ nome: v.nome, inizio: Math.round(v.inizio * 100) / 100 })),
    inAttesa: () => (richiesta && !richiesta.conRiserva ? richiesta.nome : null), conRiserva: () => (riserva ? riserva.r.nome : null),
    tempo: () => (audio ? audio.c.currentTime : 0), rinnovi: () => rinnovi, pausa: () => pausa, sospetto: () => sospetto, daButtare: () => !!(audio && (audio.malato || audio.daChiudere)),
    nota, __audio: () => audio && audio.c };
})();
