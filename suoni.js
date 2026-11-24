/* Che Conti Devastanti — i suoni (dal 17/11/2026, motore rifatto il 24/11/2026).
   Registrazioni vere con licenza CC0 (Freesound e Kenney), tagliate e pareggiate da fai_suoni.py: niente sintesi.
   Suonano con Web Audio, che sull'iPhone si mescola con la musica (non ferma Spotify) e tace col silenzioso.
   La sigla all'apertura (al primo tocco sull'iPhone), il suono del saldo a ogni tocco dell'occhio, quelli dei movimenti
   da Salva ed Elimina.

   PERCHÉ È STATO RIFATTO (24/11/2026: «continua a buggarsi l'audio, non voglio più vedere errori»). Sull'iPhone la
   «sessione audio» accesa è in tre posti: per la pagina, per il processo audio di Safari, per iOS. Uscendo dall'app (o con
   una chiamata) iOS spegne la sua senza dirlo al processo audio, che continua a crederla accesa e non la riaccende più: da
   lì ogni audio nuovo parte «running», con l'orologio che va, e muto (RemoteAudioSessionProxyManager in WebKit; i diari di
   due iPhone veri in moku-labs/game#169). Si torna a posto solo quando la pagina chiede di spegnerla: in TUTTE le versioni
   succede chiudendo l'ultimo audio con l'app davanti; sospenderlo basta solo in alcune, e in quella in sviluppo non basta
   niente se la pagina impone un tipo (navigator.audioSession.type). Il motore del 20/11 teneva l'audio aperto 45 secondi,
   imponeva «ambient» e guariva al tocco dopo. «Ambient» non serviva: in «auto» il Web Audio da solo prende già quella
   categoria. La prima versione del 24/11 spegneva con suspend() e riaccendeva con resume(): su iOS 26 non guariva niente,
   su iOS 27 ammutoliva. Trovato lo stesso giorno leggendo i sorgenti delle versioni uscite, non solo quello in sviluppo.

   LE REGOLE DI QUESTO MOTORE
   1. Il tipo è sempre «auto». L'unica eccezione è la riserva (punto 6), che lo rimette prima di finire.
   2. L'audio si apre solo quando serve un suono, dentro un tocco, e 3 secondi dopo l'ultimo suono si spegne per bene:
      prima suspend() e poi close(). A riposo non c'è niente di aperto, quindi uscendo dall'app, con una chiamata o con
      Siri non c'è niente che si possa guastare.
   3. Se si esce (o arriva una chiamata) mentre l'audio è ancora aperto lo si sospende e lo si TIENE: chiuderlo in quel
      momento può non spegnere la sessione. Si chiude dopo: tornando, un secondo dopo (quando l'app è davvero attiva) o al
      primo dito appoggiato se arriva prima.
   4. Dopo qualunque cosa sospetta (interruzione, ricarica della pagina, un audio non partito, uscita mentre la sessione
      poteva essere accesa) l'audio dopo si apre, si chiude e si riapre prima di suonare: è il chiudere che spegne la
      sessione dappertutto, e riaprendo la si accende davvero. Dopo un'interruzione lo fanno tutti per un minuto, perché
      finché dura (il telefono che squilla) non serve.
   5. Si suona solo quando l'audio va DAVVERO: «running» e l'orologio che avanza. Quando va, resume() una volta ancora:
      su iOS 26 e 27 la prima richiesta può partire senza accendere la sessione, la seconda la accende. Se non va in 0,65 s
      se ne apre un altro.
   6. Se non va nemmeno quello, la riserva: un elemento <audio> con lo stesso suono. Nessun suono resta in fila: dopo
      1,25 s dal tocco non si suona più, e un suono nuovo prende il posto di quello che aspettava.
   7. Un suono alla volta: uno nuovo ferma quello prima (sfumato in 40 ms), chiunque sia. Niente code: il suono di un
      tasto si sente quando lo si tocca o mai (fino al 24/11/2026 l'occhio aspettava la fine della sigla: sembrava muto).
   8. Prima del microfono i suoni si fermano, ma l'audio (se è ancora aperto) resta aperto e zitto: spegnerlo lì potrebbe
      spegnere la sessione sotto al microfono che sta partendo. Si chiude mezzo secondo dopo che il microfono ha finito,
      e prima di allora non si suona.
   9. WebKit passa il permesso del tocco ai setTimeout fino a un secondo, purché nati dentro il tocco: per questo gli
      appuntamenti di un suono si fissano tutti quando viene chiesto.
   Il diario (Suoni.diario) tiene cosa è successo a ogni suono: Menù → Suoni → Copia diagnosi.

   Le prove: prova_suoni_iphone.js (l'iPhone finto, con le regole della sessione audio lette in WebKit) e
   prova_motore_suoni in prova_conti.py (Web Audio vero, muto).
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
  const RIPOSO_MS = 3000;     // dopo l'ultimo suono, l'audio si spegne (intanto chi ne chiede un altro non aspetta niente)
  const SECONDO_MS = 650;     // l'audio non è ancora partito: se ne apre un altro (le cuffie possono metterci 0,6 s)
  const RISERVA_MS = 950;     // nemmeno quello: la riserva (entro 1 s vale ancora il permesso del tocco)
  const SCADENZA_MS = 1250;   // oltre, il suono è vecchio: non si suona più
  const FERMO_MS = 200;       // l'orologio andava e non va più da tanto: è guasto (appena aperto invece può metterci mezzo secondo)
  const DOPO_MIC_MS = 500;    // il microfono dell'iPhone si chiude un attimo dopo che l'app lo sa
  const DITO_MS = 400;        // col dito appena appoggiato l'audio non si chiude da solo
  const DUBBIO_MIC_MS = 8000; // dettato e salvato subito non serve rifare la sessione; più tardi sì (in mezzo può essere squillato)
  const RITORNO_MS = 1000;    // tornando, l'app è attiva 0,3-0,7 s dopo che la pagina è visibile
  const APPUNTAMENTI = [16, 33, 50, 70, 90, 115, 140, 170, 200, 235, 275, 320, 370, 430, 500, 570, 640, 700, 750, 800, 860, 920];
  const suonati = [];   // per le prove: cosa ha suonato (o avrebbe suonato), in ordine
  const muto = () => !!window.__CONTI_MUTO;
  const ora = () => performance.now();
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const IPHONE = 'standalone' in navigator;   // esiste solo su iPhone e iPad

  let audio = null;          // l'audio aperto: { c, sano, ciclo, daChiudere, t1, q1, svegliato, mosso, insistito }
  let chiusura = null;       // la chiusura in corso: se ne apre un altro solo dopo
  let sospetto = false;      // la sessione potrebbe essere accesa solo per la pagina: il prossimo audio la rifà (regola 4)
  let dubbioFino = -1e9;     // fino ad allora il sospetto resta: durante un'interruzione WebKit non spegne la sessione
  let interrottoA = -1e9;
  let accesa = false;        // WebKit può avere la sessione accesa (un audio o il microfono, e nessuna chiusura dopo)
  let rifattaA = -1e9;       // quando la si è rifatta l'ultima volta
  let pausa = false;         // il microfono
  let micFine = -1e9;        // quando il microfono ha finito
  let richiesta = null;      // il suono chiesto e non ancora partito: uno solo
  let attivi = [];           // i suoni che vanno adesso
  let riserva = null;        // l'elemento <audio> che sta suonando
  let timerRiposo = null, rinnovi = 0, ultimoDito = -1e9;

  // ---------------------------------------------------------------- il diario (per capire un difetto senza indovinare)
  const CHIAVE = ((window.EDIZIONE && window.EDIZIONE.chiave) || 'conti') + '.suoni';
  let salute = { chiesti: 0, partiti: 0, secondo: 0, riserva: 0, persi: 0, ms: [] }, righe = [], daScrivere = null;
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

  // ---------------------------------------------------------------- aprire e spegnere l'audio (regole 1-4)
  function tipo(t) {
    try { if (navigator.audioSession && navigator.audioSession.type !== t) navigator.audioSession.type = t; } catch (e) { /* non c'è */ }
  }
  // sempre, anche se dice già «auto»: dopo una ricarica il tipo imposto dalla pagina di prima resta nel processo (e tiene
  // accesa la sessione), mentre quello della pagina nuova riparte da «auto». Scriverlo li rimette d'accordo.
  try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (e) { /* non c'è */ }
  try {
    const n = performance.getEntriesByType('navigation')[0];
    if (n && n.type === 'reload') sospetto = true;   // la pagina di prima poteva aver lasciato la sessione a metà
  } catch (e) { /* non si sa */ }
  // aspetta una promessa, ma non più di ms (sull'iPhone ce ne sono che non rispondono mai)
  function entro(fa, ms) {
    let p = null;
    try { p = fa(); } catch (e) { /* già chiuso */ }
    return Promise.race([Promise.resolve(p).catch(() => {}), new Promise(ok => setTimeout(ok, ms))]);
  }
  function sospetta(ms) { sospetto = true; dubbioFino = Math.max(dubbioFino, ora() + (ms || 0)); }
  function apri() {
    if (!AC || muto()) return null;
    tipo('auto');
    let c = null;
    try { c = new AC({ latencyHint: 'interactive' }); } catch (e) { try { c = new AC(); } catch (e2) { c = null; } }
    if (!c) return null;
    const a = audio = { c, sano: false, ciclo: (sospetto || (accesa && ora() - micFine > DUBBIO_MIC_MS)) && ora() - rifattaA > 1500, daChiudere: false, t1: null, q1: 0, svegliato: -1e9, mosso: false, insistito: false };
    rinnovi++;
    accesa = true;
    c.addEventListener('statechange', () => {
      if (c.state === 'interrupted') {   // una chiamata, Siri, la sveglia; o si sta uscendo, e allora il dubbio non serve
        if (!document.hidden) { interrottoA = ora(); sospetta(60000); }
        sospetto = true; a.sano = false; a.daChiudere = true;
        if (a === audio) { fermaTutti(); clearTimeout(timerRiposo); }   // se no dopo la chiamata ne suonerebbe il resto
        entro(() => c.suspend(), 50);
        nota('interrotto');
      }
      avanza();
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
    const sfuma = attivi.length ? 50 : 0;
    // l'audio tenuto mentre si era fuori, chiuso adesso che l'app è davanti: la sessione è spenta davvero, niente da rifare
    const pulito = a.daChiudere && !document.hidden && ora() > dubbioFino;
    fermaTutti();
    audio = null;
    if (perche) nota(perche);
    const prima = chiusura || Promise.resolve();
    const p = prima
      .then(() => (sfuma ? new Promise(ok => setTimeout(ok, sfuma)) : 0))
      .then(() => { if (!riserva) tipo('auto'); return a.c.state === 'running' ? entro(() => a.c.suspend(), 250) : 0; })
      .then(finitoMicrofono)
      .then(() => (a.c.state === 'closed' ? 0 : entro(() => a.c.close(), 400)))
      .then(() => {
        if (!document.hidden && a.c.state === 'closed' && ora() > dubbioFino) {
          if (pulito) sospetto = false;
          if (chiusura === p && !pausa) accesa = false;
        }
        if (chiusura === p) { chiusura = null; avanza(); }
      });
    chiusura = p;
    return p;
  }
  // un audio guasto: si butta, e il prossimo rifà la sessione
  function scarta(perche) {
    sospetto = true;
    nota(perche + ' · ' + statoBreve());
    return spegni('');
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
  // la sessione spenta e riaccesa davvero, prima di suonare (regola 4): questo audio si chiude, il prossimo suona
  function rifai() {
    rifattaA = ora();
    nota('sessione rifatta');
    if (ora() > dubbioFino) sospetto = false;
    spegni('');
  }
  // l'audio va davvero? «running» e l'orologio che avanza; se c'è un sospetto, prima si rifà la sessione
  function pronto(a) {
    if (a.c.state !== 'running') { a.sano = false; a.t1 = null; return false; }
    if (a.sano) return true;
    if (!a.insistito) { a.insistito = true; try { a.c.resume().catch(() => {}); } catch (e) { /* niente */ } }   // regola 5
    if (a.t1 === null) { a.t1 = a.c.currentTime; a.q1 = ora(); return false; }
    if (a.c.currentTime - a.t1 < 0.004) {
      if (a.mosso && ora() - a.q1 > FERMO_MS) scarta('orologio fermo');
      return false;
    }
    a.mosso = true;
    if (a.ciclo) { rifai(); return false; }
    a.sano = true;
    return true;
  }

  // ---------------------------------------------------------------- un suono (regole 5-7)
  function fermaTutti() {
    for (const v of attivi) {
      try { const t = v.c.currentTime; v.g.gain.setTargetAtTime(0, t, 0.012); v.s.stop(t + 0.06); } catch (e) { /* già finito */ }
    }
    attivi = [];
  }
  function suonaSu(a, r, quando) {
    const c = a.c, b = buffer[r.nome];
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = b;
    g.gain.value = r.opz.volume === undefined ? 1 : r.opz.volume;
    s.connect(g); g.connect(c.destination);
    s.start(quando);
    const voce = { s, g, c, r, nome: r.nome, inizio: quando, fine: quando + b.duration, finisce: ora() + (quando - c.currentTime + b.duration) * 1000 };
    attivi.push(voce);
    s.onended = () => { attivi = attivi.filter(v => v !== voce); };
    programmaRiposo();
    return voce;
  }
  function avvia(a, r) {
    const c = a.c;
    try {
      fermaTutti();
      const t = c.currentTime;
      const voce = suonaSu(a, r, t + 0.01);
      r.partito = true;
      if (richiesta === r) richiesta = null;
      segnaPartito(r, r.secondo ? 'secondo' : 'partiti');
      setTimeout(() => controlla(a, r, voce, t), 180);
      return true;
    } catch (e) {
      scarta('start rifiutato');   // si riprova col prossimo audio, agli appuntamenti di questo suono
      return false;
    }
  }
  function segnaPartito(r, come) {
    const ms = Math.round(ora() - r.t0);
    if (come === 'partiti' || come === 'secondo') salute.partiti++;
    if (come !== 'partiti') salute[come]++;
    salute.ms = salute.ms.concat(ms).slice(-40);
    nota((come === 'partiti' ? 'ok ' : come === 'secondo' ? 'ok al secondo audio ' : 'riserva ') + r.nome + ' ' + ms + ' ms');
  }
  // dopo 180 ms: sta andando? Se è fermo si guarda ancora dopo 150 ms: un audio che parte a scatti va lasciato stare (farlo
  // ricominciare si sentirebbe doppio). Se non si muove proprio, lo stesso suono ricomincia su un altro.
  function controlla(a, r, voce, t) {
    const inCorso = () => attivi.includes(voce) && !document.hidden && !pausa && !richiesta;
    const va = da => a === audio && a.c.state === 'running' && a.c.currentTime > da;
    if (!inCorso() || va(t + 0.08)) return;
    const fermo = a.c.currentTime;
    setTimeout(() => {
      if (!inCorso() || va(fermo + 0.01)) return;
      attivi = attivi.filter(v => v !== voce);
      if (a === audio) scarta('fermo appena partito');
      if (ora() - r.t0 < RISERVA_MS) { r.partito = false; r.secondo = true; richiesta = r; avanza(); }
    }, 150);
  }
  // il prossimo passo del suono chiesto: si chiama dal tocco, agli appuntamenti e ogni volta che cambia qualcosa
  function avanza() {
    const r = richiesta;
    if (!r || r.partito || r.conRiserva || document.hidden || pausa) return;
    if (chiusura || ora() < micFine + DOPO_MIC_MS) return;
    if (audio && audio.daChiudere) { spegni('chiuso al tocco'); return; }
    const a = audio || apri();
    if (!a) return;
    if (!pronto(a)) { if (audio === a && ora() - a.svegliato > 80) svegli(a); return; }
    if (buffer[r.nome]) avvia(a, r);
  }
  function altroAudio(r) {
    if (r !== richiesta || r.partito || r.conRiserva || pausa || document.hidden) return;
    if (!buffer[r.nome]) return;   // manca il suono, non l'audio
    // ci è quasi: buttarlo adesso farebbe solo più tardi
    if (chiusura || (audio && ((audio.mosso && audio.c.state === 'running') || ora() - rifattaA < 550))) return;
    r.secondo = true;
    if (audio) scarta('non parte');
    avanza();
  }
  function suona(nome, opz) {
    if (!nome || nome === 'nessuno') return false;
    opz = opz || {};
    suonati.push(nome);
    if (pausa) libera();   // l'app chiede un suono solo a microfono spento
    if (muto()) return true;
    if (document.hidden) return false;
    const r = { nome, opz, t0: ora(), partito: false, secondo: false, conRiserva: false };
    salute.chiesti++;
    carica(nome).then(avanza);
    if (riserva) fineRiserva();
    richiesta = r;
    // dopo un'interruzione l'audio di prima può essere partito mentre durava, quindi muto: non ci si fida (regola 4)
    // (rifatta da poco va bene, se non era ancora mentre squillava)
    if (audio && audio.sano && ora() < dubbioFino && (ora() - rifattaA > 1500 || rifattaA - interrottoA < 4000)) { fermaTutti(); audio.sano = false; audio.daChiudere = true; }
    if (!AC) { conRiserva(r); return true; }
    // il permesso del tocco è scaduto (una conferma lasciata aperta più di 5 secondi): l'audio nuovo non partirebbe,
    // la riserva sì, perché siamo ancora dentro il suo tocco
    if (IPHONE && !(audio && audio.sano) && navigator.userActivation && !navigator.userActivation.isActive && byte[nome]) { conRiserva(r); return true; }
    avanza();
    // gli appuntamenti nascono tutti qui, dentro il tocco (regola 9); dopo il microfono partono quando si può
    const base = Math.max(0, Math.ceil(micFine + DOPO_MIC_MS - ora()));
    for (const ms of APPUNTAMENTI) setTimeout(avanza, base + ms);
    setTimeout(() => altroAudio(r), base + SECONDO_MS);
    setTimeout(() => { if (r === richiesta && !r.partito && !r.conRiserva) conRiserva(r); }, base + RISERVA_MS);
    setTimeout(() => scaduto(r), base + SCADENZA_MS);
    return true;
  }
  function scaduto(r) {
    if (r !== richiesta || r.partito || r.conRiserva) return;
    richiesta = null;
    salute.persi++;
    nota('PERSO ' + r.nome + ' · ' + (buffer[r.nome] ? '' : 'suono non arrivato · ') + statoBreve());
    scriviDiario();
  }

  // ---------------------------------------------------------------- 6. la riserva: un elemento <audio>
  // Serve «ambient» mentre suona (se no fermerebbe Spotify e suonerebbe anche col silenzioso). Un attimo prima della
  // fine: muto, «auto», pausa. In quest'ordine WebKit spegne la sessione; con «ambient» ancora messo non lo farebbe.
  function conRiserva(r) {
    if (!byte[r.nome] || pausa || document.hidden) return;   // resta in attesa: ci pensa scaduto()
    r.conRiserva = true;
    sospetto = true;
    if (audio) spegni('');
    let url = '';
    try {
      url = URL.createObjectURL(byte[r.nome]);
      const el = new Audio(url);
      el.setAttribute('playsinline', '');
      tipo('ambient');
      const mia = riserva = { el, r, url, timer: 0 };
      const durata = buffer[r.nome] ? buffer[r.nome].duration : 3.4;
      mia.timer = setTimeout(() => { if (riserva !== mia) return; r.conRiserva = false; richiesta = r; scaduto(r); fineRiserva(); }, 4500);
      el.addEventListener('ended', () => { if (riserva === mia) fineRiserva(); });
      Promise.resolve(el.play()).then(() => {
        if (riserva !== mia) return;
        if (richiesta === r) richiesta = null;
        segnaPartito(r, 'riserva');
        clearTimeout(mia.timer);
        mia.timer = setTimeout(() => { if (riserva === mia) fineRiserva(); }, Math.max(120, durata * 1000 - 60));
      }, e => {
        if (riserva !== mia) return;
        r.conRiserva = false;
        fineRiserva();
        nota('riserva rifiutata: ' + ((e && e.name) || 'errore'));
        if (richiesta === null) richiesta = r;
        scaduto(r);
      });
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

  // ---------------------------------------------------------------- 3 e 8. uscire, tornare, il microfono
  function metteVia() {   // l'audio aperto mentre si esce: sospeso e tenuto, si chiude tornando
    richiesta = null;
    if (riserva) fineRiserva();
    if (ora() - interrottoA < 800) dubbioFino = -1e9;   // l'interruzione era l'uscita dall'app
    if (chiusura || accesa) sospetto = true;
    if (!audio) return;
    clearTimeout(timerRiposo);
    sospetto = true;
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
  // l'app resta visibile ma non è più davanti (una chiamata, Siri): se la sessione poteva essere accesa, il prossimo la rifà
  window.addEventListener('blur', () => { if (accesa && !audio) sospetto = true; });
  document.addEventListener('pointerdown', e => {
    ultimoDito = ora();
    if (e.target && e.target.closest && e.target.closest('#microfono')) return;   // chiudere adesso capiterebbe mentre parte il microfono
    if (audio && audio.daChiudere && !pausa && !richiesta) spegni('chiuso al dito');
  }, { capture: true, passive: true });
  // finché un suono aspetta l'audio, ogni tocco lo risveglia (se il primo evento del tocco non era bastato)
  ['touchend', 'click', 'keydown'].forEach(n => document.addEventListener(n, () => {
    if (richiesta && !richiesta.partito && audio && !audio.daChiudere && !pausa) svegli(audio);
  }, { capture: true, passive: true }));

  let chiAspettaIlMic = [];
  function finitoMicrofono() { return pausa ? new Promise(ok => chiAspettaIlMic.push(ok)) : 0; }
  // prima del microfono: niente suoni; l'audio resta aperto e zitto, si chiude dopo (regola 8)
  function ferma() {
    pausa = true;
    accesa = true;   // su iOS 26 la fine del microfono non spegne la sessione
    richiesta = null;
    if (riserva) fineRiserva();
    clearTimeout(timerRiposo);
    if (!audio) return;
    sospetto = true;
    audio.daChiudere = true;
    for (const v of attivi) { try { v.s.stop(); } catch (e) { /* */ } }
    attivi = [];
  }
  // il microfono ha finito (l'app lo dice appena lo sa)
  function libera() {
    if (!pausa) return;
    pausa = false;
    micFine = ora();
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
      'chiesti ' + salute.chiesti + ', partiti ' + salute.partiti + ' (' + salute.secondo + ' al secondo audio), riserva ' + salute.riserva + ', persi ' + salute.persi + ', in media ' + m + ' ms']
      .concat(righe).join('\n');
  }

  window.Suoni = { NOMI, SIGLE, SALDO, CONTI, FESTE, prepara, sblocca, suona, provaSubito, ferma, libera, alPrimoTocco, suonati: () => suonati.slice(),
    stato: () => (audio ? audio.c.state : muto() ? 'muto' : 'chiuso'), pronti: () => Object.keys(buffer).length,
    salute: () => Object.assign({}, salute, { ms: salute.ms.slice() }), diario: testoDiario,
    riposa: () => spegni(''), aperto: () => !!(audio || chiusura),
    staSuonando: () => !!(richiesta || riserva || attivi.some(v => v.finisce > ora())),
    // per le prove: cosa sta suonando adesso, cosa aspetta, quante volte si è aperto un audio nuovo, l'audio stesso
    attivi: () => attivi.map(v => ({ nome: v.nome, inizio: Math.round(v.inizio * 100) / 100 })),
    inAttesa: () => (richiesta && !richiesta.partito ? richiesta.nome : null), conRiserva: () => (riserva ? riserva.r.nome : null),
    tempo: () => (audio ? audio.c.currentTime : 0), rinnovi: () => rinnovi, pausa: () => pausa, sospetto: () => sospetto, __audio: () => audio && audio.c };
})();
