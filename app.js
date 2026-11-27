/* Conti — l'app. I dati stanno solo nel telefono: in localStorage e, dal 26/11/2026, anche in IndexedDB (vedi «la memoria»). */
(async function () {
  'use strict';

  const VERSIONE = '2026.11.27-1100';
  const ED = Object.assign({ nome: 'principale', titolo: 'Conti', chiave: 'conti.v1', chiavePref: 'conti.preferenze',
    inizioSulSerio: null, testoCopia: 'È la tua copia di sicurezza.', avvisoCopiato: 'Copiato' }, window.EDIZIONE || {});
  const CHIAVE = ED.chiave;
  const CHIAVE_PREF = ED.chiavePref;
  const INIZIO_SUL_SERIO = ED.inizioSulSerio;   // null nelle edizioni senza periodo di prova
  const A = window.Analizza;
  const V = window.Voce;
  const S = window.Suoni;   // dal 17/11/2026: registrazioni vere, vedi suoni.js
  const $ = id => document.getElementById(id);
  const GIORNO_MS = 86400000;
  const TIPI_DATI = ['uscita', 'entrata'];
  const SCHEMA = 2;   // 2 = dal 10/11/2026: niente più tipo «investimento», categorie coi nomi nuovi

  // ================================================================ dati
  function vuoto() {
    return {
      schema: SCHEMA,
      movimenti: [], imparate: {}, ultimoBackup: null,
      ricorrenti: [],          // movimenti fissi: si segnano da soli ogni mese
      categorie: null,         // null = quelle di partenza; altrimenti l'elenco personale per tipo
      // dal 15/11/2026 un saldo per conto: { importo, data, aggiornato } dichiarato da Francesco, o null
      saldi: { contanti: null, digitale: null, cripto: null },
      imparatiConti: {},       // parola → conto, dalle correzioni del conto («tabacchi» → contanti)
      tasse: { attiva: false, percentuale: 0, categorie: [], dal: null }
    };
  }
  // Fino al 14/11/2026 c'era un saldo solo, «conti e contanti» insieme (stato.saldo): va in Digitale, e l'app gli
  // chiede di separare i contanti (daDividere) finché non salva i saldi.
  function sistemaSaldi(s, vecchio) {
    if (!s.saldi || typeof s.saldi !== 'object') s.saldi = {};
    for (const c of A.CONTI) if (!s.saldi[c.id] || typeof s.saldi[c.id].importo !== 'number') s.saldi[c.id] = null;
    if (vecchio && typeof vecchio.importo === 'number' && !s.saldi.digitale) { s.saldi.digitale = vecchio; s.saldi.daDividere = true; }
    delete s.saldo;
    if (!s.imparatiConti || typeof s.imparatiConti !== 'object') s.imparatiConti = {};
    return s;
  }

  // Dati salvati con le versioni prima del 10/11/2026 (schema 1): si traducono una volta sola.
  // Serve anche all'importazione di un testo vecchio. Ripeterla non fa danni.
  function migra(s) {
    const R = A.RINOMINATE;
    const nome = (tipo, n) => (R[tipo] && R[tipo][n]) || n;
    // 1. gli investimenti diventano uscite («Investimenti») e i ritiri entrate («Ritirato dagli investimenti»)
    const converti = x => {
      if (x.tipo === 'investimento') {
        if (x.importo < 0) { x.tipo = 'entrata'; x.importo = -x.importo; x.categoria = A.RITIRATO; }
        else { x.tipo = 'uscita'; x.categoria = A.INVESTIMENTI; }
      } else x.categoria = nome(x.tipo, x.categoria);
    };
    s.movimenti.forEach(converti);
    s.ricorrenti.forEach(converti);
    for (const v of Object.values(s.imparate)) {
      if (!v || typeof v !== 'object') continue;
      if (v.tipo === 'investimento') { v.tipo = v.segno < 0 ? 'entrata' : 'uscita'; v.categoria = v.tipo === 'entrata' ? A.RITIRATO : A.INVESTIMENTI; }
      else v.categoria = nome(v.tipo, v.categoria);
      delete v.segno;
    }
    if (!Array.isArray(s.tasse.categorie)) s.tasse.categorie = [];
    s.tasse.categorie = s.tasse.categorie.map(c => nome('entrata', c));
    // 2. l'elenco personale delle categorie: nomi e simboli nuovi
    if (s.categorie && typeof s.categorie === 'object') {
      for (const tipo of TIPI_DATI) {
        const lista = Array.isArray(s.categorie[tipo]) ? s.categorie[tipo] : null;
        if (!lista) continue;
        const nuovi = new Set(A.CATEGORIE[tipo].map(c => A.normalizza(c.nome)));
        s.categorie[tipo] = lista.filter(p => {
          if (p.base && R[tipo][p.base]) {
            if (p.nome === p.base) p.nome = R[tipo][p.base];
            p.base = R[tipo][p.base];
          }
          const icone = A.ICONE_CAMBIATE[tipo] && A.ICONE_CAMBIATE[tipo][p.base];
          if (icone && p.icona === icone[0]) p.icona = icone[1];
          // una categoria sua con lo stesso nome di una nuova di partenza («Tabacchi»): diventa quella
          if (!p.base && nuovi.has(A.normalizza(p.nome)) && !lista.some(q => q !== p && q.base && A.normalizza(q.base) === A.normalizza(p.nome))) {
            p.base = A.CATEGORIE[tipo].find(c => A.normalizza(c.nome) === A.normalizza(p.nome)).nome;
          }
          // una categoria vuota creata per sbaglio provando l'app (chiesto di toglierla il 10/11/2026)
          const vuota = !p.base && !s.movimenti.some(m => m.tipo === tipo && m.categoria === p.nome) && !s.ricorrenti.some(r => r.tipo === tipo && r.categoria === p.nome);
          return !(vuota && /^(dksks|dsks)$/.test(A.normalizza(p.nome)));
        });
      }
      delete s.categorie.investimento;
    }
    s.schema = SCHEMA;
    return s;
  }

  // ================================================================ la memoria (26/11/2026, sua scelta: «memoria più grande»)
  // localStorage tiene circa 2,5 milioni di caratteri: a 8 movimenti al giorno, due anni e mezzo. Da qui ogni salvataggio va
  // anche in IndexedDB (DB_DATI), che ha lo spazio del telefono. Finché ci sta, localStorage resta la memoria che conta (apre
  // subito, senza aspettare niente); quando non ci sta più, al suo posto resta un segnaposto ({ inIdb: true, rev }) e l'app
  // si apre da IndexedDB. «rev» conta i salvataggi: dice se le due copie sono la stessa.
  // Corretto lo stesso giorno, dopo la prova su WebKit: IndexedDB scrive in differita, e chiudendo l'app subito dopo Salva
  // l'ultimo movimento si perdeva. Ora, quando non ci sta più tutto, in localStorage restano i movimenti RECENTI (gli
  // ultimi 24 mesi; se non bastano 12, poi 3) con «archivio: { dal, rev }», e in IndexedDB c'è tutto: all'apertura i
  // movimenti prima di «dal» si prendono da lì. Un salvataggio nuovo è subito in localStorage, come prima. «archivio.rev» è
  // l'ultimo salvataggio che ha cambiato i movimenti vecchi: se IndexedDB è più indietro, lo si dice.
  // Il segnaposto senza movimenti resta solo se nemmeno 3 mesi ci stanno.
  const DB_DATI = CHIAVE + '.dati';
  const LIMITE_LS = 1800000;   // caratteri: oltre, il segnaposto
  let dbDati = null, codaDati = Promise.resolve(), soloLettura = false, inIdb = false;
  function apriDbDati() {
    if (dbDati) return dbDati;
    dbDati = new Promise((ok, ko) => {
      if (!window.indexedDB) { ko(new Error('niente IndexedDB')); return; }
      const r = indexedDB.open(DB_DATI, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('stato');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
      r.onblocked = () => ko(new Error('bloccato'));
    });
    dbDati.catch(() => { dbDati = null; });
    return dbDati;
  }
  const entroMs = (p, ms) => Promise.race([p, new Promise((ok, ko) => setTimeout(() => ko(new Error('troppo lento')), ms))]);
  function leggiDati() {
    return entroMs(apriDbDati().then(db => new Promise((ok, ko) => {
      const r = db.transaction('stato', 'readonly').objectStore('stato').get('stato');
      r.onsuccess = () => ok(r.result || null);
      r.onerror = () => ko(r.error);
    })), 6000);
  }
  // in fila: l'ultimo salvataggio è sempre l'ultimo scritto
  function scriviDati(rev, testo) {
    const p = codaDati.then(() => apriDbDati()).then(db => new Promise((ok, ko) => {
      const tx = db.transaction('stato', 'readwrite');
      tx.objectStore('stato').put({ rev, testo, quando: Date.now() }, 'stato');
      tx.oncomplete = () => ok(true);
      tx.onerror = tx.onabort = () => ko(tx.error);
    }));
    codaDati = p.catch(() => {});
    return p;
  }
  async function carica() {
    let grezzo = null;
    try { grezzo = localStorage.getItem(CHIAVE); } catch (e) { grezzo = null; }
    let segnaposto = null;
    try { const d = grezzo && grezzo.length < 400 ? JSON.parse(grezzo) : null; if (d && d.inIdb) segnaposto = d; } catch (e) { /* è un testo vero */ }
    // i recenti qui, i vecchi in IndexedDB
    let arch = null;
    if (grezzo && !segnaposto && grezzo.includes('"archivio":{')) { try { const d = JSON.parse(grezzo); if (d && d.archivio && d.archivio.dal) arch = d.archivio; } catch (e) { /* sotto, come testo */ } }
    if (arch) {
      const s = daTesto(grezzo);
      let dati = null;
      try { dati = await leggiDati(); } catch (e) { soloLettura = true; return s; }   // niente salvataggi: si coprirebbero i vecchi
      inIdb = true;
      archivioDal = arch.dal;
      revArchivio = arch.rev || 0;
      let vecchi = null;
      try { vecchi = dati && dati.testo ? JSON.parse(dati.testo).movimenti.filter(m => m.data < arch.dal) : null; } catch (e) { vecchi = null; }
      if (!vecchi) { memoriaVecchiaPersa = true; return s; }
      if (!(dati.rev >= revArchivio)) memoriaIndietro = true;
      testoVecchi = JSON.stringify(vecchi);
      s.movimenti = vecchi.concat(s.movimenti);
      return s;
    }
    if (segnaposto || !grezzo) {
      let dati = null;
      try { dati = await leggiDati(); } catch (e) {
        // il segnaposto c'è ma IndexedDB non risponde: niente salvataggi, se no si coprirebbero i movimenti veri
        if (segnaposto) { soloLettura = true; return vuoto(); }
      }
      if (dati && dati.testo) {
        inIdb = !!segnaposto;
        if (segnaposto && !(dati.rev >= segnaposto.rev)) memoriaIndietro = true;
        return daTesto(dati.testo);
      }
      // il segnaposto c'è ma IndexedDB è vuoto: il telefono l'ha cancellato. Come la memoria persa: si offre l'ultima copia
      if (segnaposto) { memoriaPersa = true; return vuoto(); }
      return vuoto();
    }
    return daTesto(grezzo);
  }
  let memoriaIndietro = false, memoriaPersa = false, memoriaVecchiaPersa = false;
  let archivioDal = null, revArchivio = 0, testoVecchi = null;
  function daTesto(grezzo) {
    if (!grezzo) return vuoto();
    try {
      const d = JSON.parse(grezzo);
      if (d && Array.isArray(d.movimenti)) {
        const s = Object.assign(vuoto(), d);
        delete s.archivio;
        if (!Array.isArray(s.ricorrenti)) s.ricorrenti = [];
        if (!s.imparate || typeof s.imparate !== 'object') s.imparate = {};
        s.tasse = Object.assign(vuoto().tasse, s.tasse || {});
        if (!Array.isArray(s.tasse.categorie)) s.tasse.categorie = [];
        sistemaSaldi(s, d.saldo);
        if (!(d.schema >= SCHEMA)) {
          // prima di tradurli se ne tiene una copia così com'erano, per sicurezza
          try { localStorage.setItem(CHIAVE + '.schema1', grezzo); } catch (e) { /* spazio pieno: si va avanti */ }
          s.schema = 1; migra(s); s.daRileggere = true;
        }
        return s;
      }
    } catch (e) { /* sotto */ }
    // dati illeggibili: prima di ripartire da zero se ne tiene una copia, per non perderli col primo salvataggio
    try { localStorage.setItem(CHIAVE + '.illeggibile.' + Date.now(), grezzo); } catch (e) { /* spazio pieno */ }
    return vuoto();
  }
  let stato = await carica();
  // Viaggi e prestiti, tolti il 27/11/2026 (sua scelta: «non mi fanno impazzire», da ricordare per il futuro: il codice è in
  // strumenti/conti/da-riprendere/). Se ne avesse segnato qualcuno nel giorno in cui c'erano: il prestito diventa un'uscita
  // (o un'entrata) del suo conto, il viaggio si toglie. Al prossimo salvataggio resta così.
  for (const m of stato.movimenti) {
    if (m.tipo === 'spostamento' && (m.da === 'persone' || m.verso === 'persone')) {
      const esce = m.verso === 'persone';
      m.conto = esce ? m.da : m.verso;
      m.tipo = esce ? 'uscita' : 'entrata';
      m.categoria = A.ripiego(m.tipo, stato.categorie);
      delete m.da; delete m.verso; delete m.chi;
    }
    delete m.viaggio;
  }
  delete stato.viaggi;
  const maiSalvata = memoriaPersa || !stato.movimenti.length && !stato.rev && localStorage.getItem(CHIAVE) === null;   // prima apertura, o memoria persa: vedi offriCopia
  // la copia in IndexedDB di chi apre questa versione per la prima volta (e poi a ogni apertura, se fosse indietro)
  if (!soloLettura && !inIdb && localStorage.getItem(CHIAVE)) setTimeout(() => {
    leggiDati().catch(() => null).then(d => { if (!d || d.rev !== stato.rev || !d.testo) scriviDati(stato.rev || 0, JSON.stringify(stato)).catch(() => {}); });
  }, 2500);
  let persistenzaChiesta = false, nonSalvato = 0;

  // Lo spazio (17/11/2026). Safari dà a ogni sito circa 5 MB di localStorage, contati in caratteri da 2 byte: circa
  // 2,5 milioni di caratteri. Un movimento ne pesa circa 220: a 8 movimenti al giorno bastano circa 4 anni. Prima di
  // arrivarci l'app lo dice (al 60%), e allora i movimenti vanno spostati in IndexedDB, che ha spazio per molto di più.
  const SPAZIO_CARATTERI = 2500000;
  let pesoStato = 0, pesoAltro = null;
  function spazioUsato() {
    if (inIdb) return 0;   // i movimenti stanno in IndexedDB: lo spazio è quello del telefono
    if (pesoAltro === null) {
      pesoAltro = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k === CHIAVE) { if (!pesoStato) pesoStato = (localStorage.getItem(k) || '').length; continue; }
          pesoAltro += k.length + (localStorage.getItem(k) || '').length;
        }
      } catch (e) { /* niente */ }
    }
    return (pesoStato + pesoAltro + CHIAVE.length) / SPAZIO_CARATTERI;
  }
  function scrivi() {
    try {
      if (soloLettura) throw new Error('i movimenti non si sono letti: non si scrive sopra');
      stato.rev = (stato.rev || 0) + 1;
      const testo = JSON.stringify(stato);
      const dati = scriviDati(stato.rev, testo);
      let messo = false;
      if (testo.length <= LIMITE_LS) {
        try { localStorage.setItem(CHIAVE, testo); messo = true; inIdb = false; pesoStato = testo.length; } catch (e) { messo = false; }
      }
      if (!messo) {
        if (!window.indexedDB) throw new Error('niente IndexedDB');
        // non ci sta più: qui i recenti, i vecchi solo in IndexedDB (vedi «la memoria»)
        const o = oggi();
        for (const mesi of [24, 12, 3]) {
          const dal = A.isoDa(new Date(o.getFullYear(), o.getMonth() - mesi, 1));
          const vecchi = [], recenti = [];
          for (const m of stato.movimenti) (m.data < dal ? vecchi : recenti).push(m);
          const tv = JSON.stringify(vecchi);
          const rev = dal === archivioDal && tv === testoVecchi ? revArchivio : stato.rev;
          const leggero = JSON.stringify(Object.assign({}, stato, { movimenti: recenti, archivio: { dal, rev } }));
          if (leggero.length > LIMITE_LS) continue;
          try { localStorage.removeItem(CHIAVE); localStorage.setItem(CHIAVE, leggero); } catch (e) { continue; }
          archivioDal = dal; revArchivio = rev; testoVecchi = tv;
          messo = true; inIdb = true; pesoStato = 0;
          dati.catch(() => { mostraToast('Non riesco a salvare: spazio del telefono pieno?', null, null, 8000); });
          break;
        }
      }
      if (!messo) {
        // nemmeno tre mesi: qui solo il segnaposto (prima si toglie il testo vecchio, che occupa)
        archivioDal = null; testoVecchi = null;
        localStorage.removeItem(CHIAVE);
        localStorage.setItem(CHIAVE, JSON.stringify({ schema: SCHEMA, inIdb: true, rev: stato.rev, movimenti: [] }));
        inIdb = true;
        pesoStato = 0;
        dati.catch(() => { mostraToast('Non riesco a salvare: spazio del telefono pieno?', null, null, 8000); });
      }
      copiaTraPoco();
    } catch (e) {
      nonSalvato = 0;
      mostraToast('Non riesco a salvare: spazio del telefono pieno?', null, null, 8000);
      nonSalvato = Date.now();   // quello che si stava per dire («Modifica salvata») non deve coprirlo (25/11/2026)
      return false;
    }
    if (!persistenzaChiesta && navigator.storage && navigator.storage.persist) {
      persistenzaChiesta = true;
      navigator.storage.persist().catch(() => {});
    }
    return true;
  }
  // Le copie automatiche (24/11/2026), per quando segna tutto sul serio: una al giorno (l'ultima di ogni giorno) e una prima di
  // ogni cancellazione o ritorno, dentro il telefono ma in un'altra memoria (IndexedDB). Le ultime 21 giornaliere, la prima di
  // ogni mese per due anni, le ultime 8 «prima di…». Salvano da un tocco sbagliato o da un mio errore, non dal telefono perso.
  const DB_COPIE = CHIAVE + '.copie';
  let dbCopie = null, timerCopia = null;
  function apriDbCopie() {
    if (dbCopie) return dbCopie;
    dbCopie = new Promise((ok, ko) => {
      if (!window.indexedDB) { ko(new Error('niente IndexedDB')); return; }
      const r = indexedDB.open(DB_COPIE, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('copie', { keyPath: 'id' });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
      r.onblocked = () => ko(new Error('bloccato'));
    });
    dbCopie.catch(() => { dbCopie = null; });
    return dbCopie;
  }
  const conCopie = (modo, fa) => apriDbCopie().then(db => new Promise((ok, ko) => {
    const tx = db.transaction('copie', modo), r = fa(tx.objectStore('copie'));
    tx.oncomplete = () => ok(r && r.result);
    tx.onerror = tx.onabort = () => ko(tx.error);
  }));
  const elencoCopie = () => conCopie('readonly', s => s.getAll()).then(l => (l || []).sort((a, b) => b.quando - a.quando), () => []);
  function salvaCopia(motivo) {
    const testo = JSON.stringify(stato), quando = Date.now();
    const copia = { id: motivo ? 'm-' + quando : 'g-' + isoOggi(), quando, giorno: isoOggi(), motivo: motivo || '', movimenti: stato.movimenti.length, testo };
    return conCopie('readwrite', s => s.put(copia)).then(() => elencoCopie()).then(l => {
      const giornaliere = l.filter(c => !c.motivo), tieni = new Set(giornaliere.slice(0, 21).map(c => c.id));
      const prima = new Map();   // mese → la sua prima copia (l'elenco va dalla più nuova alla più vecchia)
      for (const c of giornaliere) prima.set(c.giorno.slice(0, 7), c.id);
      [...prima.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 24).forEach(([, id]) => tieni.add(id));
      l.filter(c => c.motivo).slice(0, 8).forEach(c => tieni.add(c.id));
      const via = l.filter(c => !tieni.has(c.id));
      return via.length ? conCopie('readwrite', s => { via.forEach(c => s.delete(c.id)); }) : null;
    }).catch(() => {});
  }
  // qualche secondo dopo l'ultima modifica; se è tutto vuoto la copia del giorno non si tocca (non deve coprire quella buona)
  function copiaTraPoco() {
    clearTimeout(timerCopia);
    timerCopia = setTimeout(() => { if (stato.movimenti.length || stato.ricorrenti.length || CONTI_ID.some(c => stato.saldi[c])) salvaCopia(''); }, 2500);
  }
  const nuovoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // preferenze dell'app: fuori dai movimenti, così non finiscono nell'esportazione
  function caricaPref() {
    try { return Object.assign({ sfondo: 'giorno' }, JSON.parse(localStorage.getItem(CHIAVE_PREF)) || {}); }
    catch (e) { return { sfondo: 'giorno' }; }
  }
  let pref = caricaPref();
  function scriviPref() { try { localStorage.setItem(CHIAVE_PREF, JSON.stringify(pref)); } catch (e) { /* non grave */ } }

  // ================================================================ formati e date
  // 1.234,56 € — fatto a mano: Intl in italiano non mette il punto sotto i 10.000 (2400 €).
  // Sempre al centesimo, anche nei riepiloghi (chiesto da Francesco il 10/11/2026). I conti sono in centesimi interi.
  function euro(cent) {
    const c = Math.round(Math.abs(cent));
    const intero = String(Math.floor(c / 100)), dec = String(c % 100).padStart(2, '0');
    return (cent < 0 && c > 0 ? '−' : '') + intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec + ' €';
  }
  // percentuale al centesimo: 12,35%
  const percento = (parte, tutto) => (tutto ? Math.round(parte / tutto * 10000) / 100 : 0).toFixed(2).replace('.', ',') + '%';
  const conSegno = cent => (cent > 0 ? '+' : '') + euro(cent);
  // Il saldo nascosto (15/11/2026, sua richiesta: «il saldo è nascosto a meno che non schiacci su un occhio»): il saldo
  // del mese, i saldi dei conti e la colonna Saldo dell'anno si vedono solo toccando l'occhio. Entrate, uscite e
  // movimenti restano visibili. Si rinasconde ogni volta che si apre l'app o ci si torna.
  let saldoVisibile = false;
  const COPERTO = '••••• €';
  const saldoEuro = cent => (saldoVisibile ? euro(cent) : COPERTO);
  const saldoConSegno = cent => (saldoVisibile ? conSegno(cent) : COPERTO);
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const GIORNI_BREVI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const maiuscola = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const oggi = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const isoOggi = () => A.isoDa(oggi());
  const daIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const chiaveMese = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  function meseDopo(k) {
    let [y, m] = k.split('-').map(Number);
    m++;
    if (m > 12) { m = 1; y++; }
    return y + '-' + String(m).padStart(2, '0');
  }

  // il giorno «g» del mese «k» ('AAAA-MM'): il 31 nei mesi più corti diventa l'ultimo giorno
  function dataNelMese(k, g) {
    const [y, m] = k.split('-').map(Number);
    return A.isoDa(new Date(y, m - 1, Math.min(g, new Date(y, m, 0).getDate())));
  }
  const corto = s => (s.length > 22 ? s.slice(0, 21) + '…' : s);

  function etichettaGiorno(iso) {
    const d = daIso(iso), diff = Math.round((oggi() - d) / GIORNO_MS);
    if (diff === 0) return 'Oggi';
    if (diff === 1) return 'Ieri';
    if (diff === 2) return 'L\'altro ieri';
    if (diff === -1) return 'Domani';
    const anno = d.getFullYear() !== oggi().getFullYear() ? ' ' + d.getFullYear() : '';
    return maiuscola(GIORNI_BREVI[d.getDay()] + ' ' + d.getDate() + ' ' + MESI[d.getMonth()].slice(0, 3)) + anno;
  }
  const etichettaTipo = tipo => (tipo === 'entrata' ? 'Entrata' : tipo === 'spostamento' ? '↔ Spostamento' : 'Uscita');
  const segnoDi = tipo => (tipo === 'entrata' ? '+' : tipo === 'spostamento' ? '' : '−');
  const altroTipo = tipo => (tipo === 'entrata' ? 'uscita' : 'entrata');
  function leggiEuro(s, permettiNegativo) {
    let t = String(s).replace(/[€\s]/g, '').replace('−', '-');
    let segno = 1;
    if (permettiNegativo && t.startsWith('-')) { segno = -1; t = t.slice(1); }
    t = t.replace(/[.,]$/, '').replace(/^([.,]\d)/, '0$1');   // «12,» e «,50» mentre si scrive
    if (!t) return null;
    let n;
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    else if (/^\d+([.,]\d{1,2})?$/.test(t)) n = parseFloat(t.replace(',', '.'));
    else return null;
    return segno * Math.round(n * 100);
  }
  const formatoPerCampo = cent => (Math.abs(cent) / 100).toFixed(2).replace('.', ',');

  // ================================================================ categorie (anche quelle personali)
  function categorie(tipo, anchenascoste) { return A.elenco(tipo, stato.categorie).filter(c => anchenascoste || !c.nascosta); }
  const iconaDi = (tipo, nome) => A.icona(tipo, nome, stato.categorie);
  const ripiegoDi = tipo => A.ripiego(tipo, stato.categorie);
  const valida = (tipo, nome) => categorie(tipo, true).some(c => c.nome === nome);
  function nomeDaBase(tipo, base) { const c = categorie(tipo, true).find(x => x.base === base); return c ? c.nome : base; }
  // il conto che sta guardando vale per le frasi che non ne nominano uno
  function opzioniAnalisi(extra) {
    return Object.assign({ oggi: oggi(), adesso: new Date(), imparate: stato.imparate, categorie: stato.categorie,
      conto: vista.conto, imparatiConti: stato.imparatiConti }, extra || {});
  }

  // ================================================================ i tre conti (15/11/2026)
  // Francesco: «tre fonti di dove si ha il denaro»: Contanti, Digitale (conti e carte) e Cripto. Ogni entrata e uscita
  // sta in uno dei tre (m.conto; quelle di prima del 15/11 sono in Digitale). Lo spostamento fra due conti (prelievo,
  // versamento, cripto comprate o vendute) è il tipo «spostamento», con m.da e m.verso: non è né entrata né uscita.
  const CONTI_ID = A.CONTI.map(c => c.id);
  const CONTI_LIQUIDI = ['contanti', 'digitale'];   // i mesi di autonomia: le cripto no (sua scelta del 15/11/2026)
  const infoConto = id => A.CONTI.find(c => c.id === id) || A.CONTI.find(c => c.id === A.CONTO_BASE);
  const nomeConto = id => { const c = infoConto(id); return c.icona + ' ' + c.nome; };
  const inConto = id => ({ contanti: 'in contanti', digitale: 'in digitale', cripto: 'in cripto' })[id] || '';
  const contoDi = m => (m && CONTI_ID.includes(m.conto) ? m.conto : A.CONTO_BASE);
  const eSpostamento = m => !!m && m.tipo === 'spostamento';
  // il movimento riguarda il conto c (null = tutti): uno spostamento sia dove parte sia dove arriva
  const tocca = (m, c) => !c || (eSpostamento(m) ? m.da === c || m.verso === c : contoDi(m) === c);
  const etichettaConto = x => (eSpostamento(x) ? nomeConto(x.da) + ' → ' + nomeConto(x.verso) : nomeConto(contoDi(x)));
  const altroConto = c => (c === A.CONTO_BASE ? 'contanti' : A.CONTO_BASE);
  // i campi del conto da src a dest (movimento o fisso): { conto } oppure, per gli spostamenti, { da, verso }
  function copiaConto(dest, src) {
    delete dest.conto; delete dest.da; delete dest.verso;
    if (eSpostamento(src)) {
      dest.da = CONTI_ID.includes(src.da) ? src.da : A.CONTO_BASE;
      dest.verso = CONTI_ID.includes(src.verso) && src.verso !== dest.da ? src.verso : altroConto(dest.da);
    } else dest.conto = contoDi(src);
    return dest;
  }

  // ================================================================ toast
  let timerToast = null;
  function mostraToast(testo, azione, alClic, durata) {
    if (Date.now() - nonSalvato < 1500) return;   // l'errore appena detto resta
    $('toastTesto').textContent = testo;
    const b = $('toastAzione');
    b.hidden = !azione;
    b.textContent = azione || '';
    b.onclick = () => { nascondiToast(); if (alClic) alClic(); };
    $('toast').hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(nascondiToast, durata || (azione ? 6000 : 3500));
  }
  function nascondiToast() { $('toast').hidden = true; }

  // ================================================================ aggiornamenti
  // Dal 10/11/2026 sera arrivano da soli, senza tocchi. Francesco: «voglio che li aggiorni direttamente sul mio
  // cellulare, senza che io debba schiacciare qualcosa». Prima si contava sul controllo di Safari e su reg.update()
  // tornando sull'app, e il telefono restava indietro.
  // 1. All'apertura, tornando sull'app, tornando la rete e ogni 2 minuti con l'app davanti si legge la versione
  //    pubblicata (sw.js scaricato senza nessuna memoria in mezzo). Se è più nuova la si fa installare al service
  //    worker; se Safari risponde con un sw.js vecchio, lo si registra con l'indirizzo della versione, che lo costringe.
  // 2. Arrivata, la pagina si ricarica da sola appena non gli toglie niente: frase vuota, microfono fermo, nessun
  //    foglio aperto, nessun «Annulla», e lui fermo da 2 secondi. Uscendo dall'app subito. Si riprova ogni 2 secondi.
  // 3. Ricaricata, un avviso dice che si è aggiornata e cosa c'è di nuovo (NOVITA la scrive pubblica.py --novita).
  // Safari risponde a reg.update() solo a installazione finita (provato su WebKit il 10/11/2026): la versione del
  // service worker gliela si chiede con un messaggio.
  const NOVITA = 'versione definitiva: tolti viaggi e prestiti, calendario più pulito';
  const CHIAVE_AGG = CHIAVE + '.aggiornamento';
  let versionePronta = false, timerPronta = null, controlloInCorso = null, ancoraUnaVolta = false, ultimoTocco = 0, ultimoControllo = null;
  ['pointerdown', 'keydown', 'input'].forEach(n => document.addEventListener(n, () => { ultimoTocco = Date.now(); }, true));
  const puoRicaricare = () => !campoFrase.value.trim() && statoVoce === 'fermo' && !(S && S.staSuonando()) &&
    ($('toast').hidden || $('toastAzione').hidden || $('toastAzione').textContent !== 'Annulla');
  function ricarica() {
    // mai in giro tondo: se due ricariche di fila non portano la versione nuova, ci si ferma fino alla prossima apertura
    let g = {};
    try { g = JSON.parse(sessionStorage.getItem(CHIAVE_AGG) || '{}'); } catch (e) { g = {}; }
    if (g.da === VERSIONE && g.volte >= 2 && Date.now() - g.quando < 300000) return false;
    try { sessionStorage.setItem(CHIAVE_AGG, JSON.stringify({ da: VERSIONE, volte: g.da === VERSIONE ? (g.volte || 0) + 1 : 1, quando: Date.now() })); } catch (e) {}
    // prima si chiude l'audio per bene: su iOS 26 quello della pagina di prima resterebbe a metà (24/11/2026)
    if (S && S.aperto()) Promise.race([S.riposa(), new Promise(ok => setTimeout(ok, 700))]).then(() => location.reload());
    else location.reload();
    return true;
  }
  // senzaAttesa: tornando sull'app, chiudendo un foglio o uscendo, non serve che sia fermo da 2 secondi.
  // Con l'app davanti non gli si toglie da sotto gli occhi quello che sta guardando: se ha scorso la pagina o è su un
  // altro mese o sull'anno, la versione nuova aspetta che esca dall'app o che ci torni (11/11/2026)
  const vistaIniziale = () => window.scrollY < 80 && vista.modo === 'mese' && !vista.filtro && !vista.conto &&
    vista.anno === oggi().getFullYear() && vista.mese === oggi().getMonth();
  function ricaricaSePuoi(senzaAttesa) {
    if (!versionePronta || foglioAperto() || !puoRicaricare()) return false;
    if (!senzaAttesa && !document.hidden && (Date.now() - ultimoTocco < 2000 || !vistaIniziale())) return false;
    return ricarica();
  }
  function prontaLaNuova() {
    if (versionePronta) return;
    versionePronta = true;
    if (ricaricaSePuoi()) return;
    clearInterval(timerPronta);
    timerPronta = setInterval(() => { if (ricaricaSePuoi()) clearInterval(timerPronta); }, 2000);
  }
  function versioneDelServiceWorker(reg) {
    const sw = (reg && reg.active) || navigator.serviceWorker.controller;
    if (!sw) return Promise.resolve(null);
    return new Promise(ok => {
      const canale = new MessageChannel();
      canale.port1.onmessage = e => ok(e.data);
      sw.postMessage('versione', [canale.port2]);
      setTimeout(() => ok(null), 3000);
    });
  }
  // la versione pubblicata: sw.js con un indirizzo sempre nuovo e senza memoria, né del telefono né di GitHub
  async function versionePubblicata() {
    try {
      const r = await fetch('sw.js?controllo=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      const m = (await r.text()).match(/const VERSIONE = '([^']+)'/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }
  function aspettaAttivo(sw, ms) {
    return new Promise(ok => {
      if (!sw) return ok();
      const guarda = () => { if (sw.state === 'activated' || sw.state === 'redundant') ok(); };
      sw.addEventListener('statechange', guarda);
      guarda();
      setTimeout(ok, ms);
    });
  }
  // fa installare al service worker la versione v: vero se ora ce l'ha
  async function installa(reg, v) {
    const ce = async r => (await versioneDelServiceWorker(r) || '') >= v;
    await reg.update().catch(() => {});
    await aspettaAttivo(reg.installing || reg.waiting, 60000);
    if (await ce(reg)) return true;
    // Safari ha preso un sw.js vecchio da qualche memoria: con un indirizzo nuovo lo deve riscaricare
    const forzata = await navigator.serviceWorker.register('sw.js?v=' + v, { updateViaCache: 'none' }).catch(() => null);
    if (!forzata) return false;
    await aspettaAttivo(forzata.installing || forzata.waiting, 60000);
    return ce(forzata);
  }
  // 'pronta' | 'ultima' | 'senza rete' | 'non arrivata' | 'nessuna'
  function controllaVersione() {
    if (versionePronta) return Promise.resolve('pronta');
    // chiesto mentre ne è in corso un altro: si rifà appena finisce, perché quello in corso può aver letto la versione
    // pubblicata un attimo prima della nuova (succedeva nel banco: il controllo che l'avrebbe trovata si perdeva)
    if (controlloInCorso) { ancoraUnaVolta = true; return controlloInCorso; }
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return Promise.resolve('nessuna');
    controlloInCorso = (async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return 'nessuna';
      const attiva = await versioneDelServiceWorker(reg);
      if (attiva && attiva > VERSIONE) { prontaLaNuova(); return 'pronta'; }   // già scaricata: manca solo ricaricare
      const v = await versionePubblicata();
      if (!v) return 'senza rete';
      ultimoControllo = new Date();
      if (v <= VERSIONE) return 'ultima';
      if (!(await installa(reg, v))) return 'non arrivata';
      prontaLaNuova();
      return 'pronta';
    })().catch(() => 'non arrivata').finally(() => {
      controlloInCorso = null;
      if (ancoraUnaVolta) { ancoraUnaVolta = false; setTimeout(controllaVersione, 0); }
    });
    return controlloInCorso;
  }
  async function cercaAggiornamenti() {
    mostraToast('Cerco la versione nuova…');
    if (controlloInCorso) await controlloInCorso;   // uno già partito può aver letto prima della pubblicazione: se ne fa uno nuovo
    const esito = await controllaVersione();
    if (esito === 'pronta') {
      if (puoRicaricare()) { mostraToast('Aggiorno…'); setTimeout(ricarica, 300); }
      else mostraToast('Versione nuova pronta: si mette da sola appena finisci');
      return;
    }
    mostraToast({ 'senza rete': 'Senza rete: ci riprova da sola quando torna', 'non arrivata': 'Non è arrivata: ci riprova da sola tra poco',
      nessuna: 'Qui gli aggiornamenti non si controllano' }[esito] || 'È già l\'ultima versione');
  }
  // appena aperta dopo un aggiornamento: l'avviso, quando lui la guarda. La versione vista l'ultima volta sta nel
  // telefono (dalla 2001). Le versioni fino alla 1716 non la segnavano: se l'app era già usata (movimenti o
  // preferenze) e la versione vista manca, viene da una di quelle, e l'avviso c'è lo stesso
  (function avvisoAggiornata() {
    const k = CHIAVE + '.versioneVista';
    let prima = null, giaUsata = false;
    try {
      prima = localStorage.getItem(k);
      giaUsata = localStorage.getItem(CHIAVE) !== null || localStorage.getItem(CHIAVE_PREF) !== null;
      localStorage.setItem(k, VERSIONE);
    } catch (e) { prima = null; }
    let g = null;
    try { g = JSON.parse(sessionStorage.getItem(CHIAVE_AGG) || 'null'); } catch (e) { g = null; }
    if (g && g.da !== VERSIONE) try { sessionStorage.removeItem(CHIAVE_AGG); } catch (e) {}
    const da = (g && g.da) || prima || (giaUsata ? '0' : null);
    if (!da || da >= VERSIONE) return;   // prima apertura, o la stessa versione
    const avvisa = () => mostraToast('✓ Aggiornata da sola' + (NOVITA ? '. Novità: ' + NOVITA : ''), null, null, NOVITA ? 7000 : 4000);
    if (!document.hidden) { setTimeout(avvisa, 500); return; }
    const quando = () => { if (document.hidden) return; document.removeEventListener('visibilitychange', quando); setTimeout(avvisa, 500); };
    document.addEventListener('visibilitychange', quando);
  })();

  // ================================================================ foglio dal basso
  // Si chiude toccando il velo, col tasto Esc o trascinandolo in giù (dal 10/11/2026), come i fogli dell'iPhone.
  let alChiudereFoglio = null, timerFoglio = null;
  // il foglio di sotto (modificando un movimento o un fisso si apre quello della categoria, del conto, del giorno):
  // chiudendo quello sopra col dito si torna lì. Prima si chiudeva tutto e le correzioni scritte si perdevano (24/11/2026).
  let foglioSotto = null;
  function apriFoglio(titolo, costruisci, alChiudere) {
    const corpo = $('foglioCorpo');
    // in cima prima di cambiare il contenuto: dopo, rimetterlo in cima costringeva a ricalcolare tutta la pagina
    // a metà (un terzo di secondo col menù e un anno di movimenti, misurato l'11/11/2026)
    if (!$('foglio').hidden) $('foglio').scrollTop = 0;
    corpo.textContent = '';
    const h = document.createElement('h2');
    h.id = 'foglioTitolo';
    h.textContent = titolo;
    corpo.appendChild(h);
    costruisci(corpo);
    alChiudereFoglio = alChiudere || null;
    nascondiToast();
    clearTimeout(timerFoglio);
    const f = $('foglio'), v = $('velo');
    const giaAperto = !f.hidden && !f.classList.contains('via');
    f.classList.remove('via');
    f.style.transform = ''; v.style.opacity = '';
    if (!giaAperto) f.classList.add('entra');   // parte già fuori schermo: niente calcolo nella posizione finale
    v.hidden = false;
    f.hidden = false;
    if (!giaAperto) requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('entra')));
  }
  function chiudiFoglio(animato) {
    const sotto = foglioSotto;
    foglioSotto = null;
    if (animato && sotto) { alChiudereFoglio = null; sotto(); return; }
    const f = $('foglio'), v = $('velo');
    const cb = alChiudereFoglio;
    alChiudereFoglio = null;
    clearTimeout(timerFoglio);
    if (animato && !f.hidden) {
      f.classList.add('via');
      f.style.transform = '';
      v.style.opacity = '0';
      timerFoglio = setTimeout(() => { f.hidden = true; v.hidden = true; f.classList.remove('via'); v.style.opacity = ''; }, 220);
    } else {
      f.hidden = true; v.hidden = true; f.classList.remove('via'); f.style.transform = ''; v.style.opacity = '';
    }
    if (cb) cb();
    if (versionePronta) setTimeout(() => ricaricaSePuoi(true), 400);
  }
  // al posto di confirm(): la finestra di sistema sospendeva l'audio dell'iPhone, e il suono dopo si perdeva (25/11/2026)
  function conferma(titolo, testo, si, alSi, torna) {
    if (torna) foglioSotto = torna;
    apriFoglio(titolo, corpo => {
      if (testo) corpo.appendChild(el('p', '', testo));
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-secondario', 'Annulla', () => chiudiFoglio(true)));
      const b = tasto('tasto-pericolo pieno', si, () => { chiudiFoglio(); alSi(); });
      b.id = 'confermaSi';
      riga.appendChild(b);
      corpo.appendChild(riga);
    });
  }
  const foglioAperto = () => !$('foglio').hidden && !$('foglio').classList.contains('via');

  // trascinare in giù: parte solo se il foglio è già scorso in cima (o dalla maniglia), così lo scorrimento resta normale
  // Dopo un trascinamento o una pressione lunga, il dito che si alza non deve «toccare» quello che c'è sotto
  // (un bottone del foglio, o del foglio nuovo che si è appena aperto sotto il dito).
  let silenzioClic = 0;
  document.addEventListener('click', e => { if (performance.now() < silenzioClic) { e.stopPropagation(); e.preventDefault(); } }, true);

  (function trascinaFoglio() {
    const f = $('foglio');
    let y0 = null, dy = 0, t0 = 0, attivo = false;
    f.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || f.classList.contains('via')) { y0 = null; return; }
      const daManiglia = !!e.target.closest('.maniglia');
      if (f.scrollTop > 0 && !daManiglia) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0; t0 = performance.now(); attivo = false;
    }, { passive: true });
    f.addEventListener('touchmove', e => {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      // in cima e verso il basso: subito, se no l'iPhone fa partire il «rimbalzo» e non lo lascia più fermare
      if (dy > 0 && f.scrollTop <= 0 && e.cancelable) e.preventDefault();
      if (!attivo) {
        if (dy > 6 && f.scrollTop <= 0) attivo = true;
        else { if (dy < -6) y0 = null; return; }
      }
      f.classList.add('trascina');
      f.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
      $('velo').style.opacity = String(Math.max(0.15, 1 - dy / 450));
    }, { passive: false });
    const fine = e => {
      if (y0 === null) return;
      y0 = null;
      f.classList.remove('trascina');
      if (!attivo) return;
      attivo = false;
      silenzioClic = performance.now() + 350;
      if (e && e.cancelable) e.preventDefault();
      const veloce = dy / Math.max(1, performance.now() - t0) > 0.5;
      if (dy > 120 || (dy > 50 && veloce)) chiudiFoglio(true);
      else { f.style.transform = ''; $('velo').style.opacity = ''; }
    };
    f.addEventListener('touchend', fine);
    f.addEventListener('touchcancel', fine);
  })();

  function el(tag, classe, testo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
  }
  // «🔁 Movimenti fissi»: il simbolo davanti va in un riquadro suo (24/11/2026)
  const SIMBOLO_DAVANTI = /^((?:\p{Extended_Pictographic}[\uFE0F\u200D\p{Emoji_Modifier}]*)+|↔|＋)\s+(?=\S)/u;
  function tasto(classe, testo, alClic) {
    const azione = / ?\bazione\b/.test(classe), m = azione && SIMBOLO_DAVANTI.exec(testo || '');
    const b = el('button', classe + (m ? ' con-icona' : ''), azione ? '' : testo);
    if (m) b.appendChild(el('span', 'azione-icona', m[1]));
    if (azione) b.appendChild(el('span', 'azione-testo', m ? testo.slice(m[0].length) : testo));
    b.type = 'button';
    b.addEventListener('click', alClic);
    return b;
  }
  function campo(etichetta, input) {
    const c = el('label', 'campo');
    c.appendChild(el('span', '', etichetta));
    c.appendChild(input);
    return c;
  }
  function inputTesto(valore, modo) {
    const i = el('input');
    i.autocomplete = 'off';
    if (modo) i.inputMode = modo;
    i.value = valore == null ? '' : valore;
    return i;
  }
  function interruttore(testo, acceso) {
    const l = el('label', 'interruttore');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = !!acceso;
    l.appendChild(c);
    l.appendChild(el('span', '', testo));
    return { etichetta: l, casella: c };
  }

  // ---------------------------------------------------------------- scelte riutilizzate
  // Dal 10/11/2026 i tipi sono due: toccando l'etichetta si passa dall'uno all'altro, senza foglio.
  // Dal 15/11/2026 c'è anche lo spostamento, che si sceglie dal conto: toccandolo si torna a Uscita.
  function scegliTipo(corrente, alScegliere) { alScegliere(corrente.tipo === 'spostamento' ? 'uscita' : altroTipo(corrente.tipo)); }

  // Il conto: Contanti, Digitale o Cripto, oppure uno spostamento fra due conti (da… a…).
  // corrente: { tipo, conto, da, verso, prima }; alScegliere(nuovo): { tipo, conto } o { tipo: 'spostamento', da, verso }.
  // Come per la categoria, la scelta vale toccando un conto o «Fatto»; chiudere il foglio non cambia niente.
  function scegliConto(corrente, alScegliere, comeSpostamento) {
    const spost = comeSpostamento !== undefined ? comeSpostamento : eSpostamento(corrente);
    const da = CONTI_ID.includes(corrente.da) ? corrente.da : contoDi(corrente);
    const verso = CONTI_ID.includes(corrente.verso) && corrente.verso !== da ? corrente.verso : altroConto(da);
    const prima = corrente.prima || (eSpostamento(corrente) ? 'uscita' : corrente.tipo);
    apriFoglio(spost ? 'Spostamento fra i conti' : 'Conto', corpo => {
      const fila = (scelto, alTocco, id) => {
        const g = el('div', 'griglia-conti');
        g.id = id;
        for (const c of A.CONTI) {
          const b = tasto('opzione conto-opzione', '', () => alTocco(c.id));
          b.dataset.conto = c.id;
          b.appendChild(el('span', 'conto-icona', c.icona));
          b.appendChild(el('span', 'conto-nome', c.nome));
          b.setAttribute('aria-pressed', String(c.id === scelto));
          g.appendChild(b);
        }
        return g;
      };
      if (!spost) {
        corpo.appendChild(el('p', 'nota-su', corrente.tipo === 'entrata' ? 'Dove arrivano i soldi?' : 'Da dove escono i soldi?'));
        corpo.appendChild(fila(contoDi(corrente), id => { chiudiFoglio(); alScegliere({ tipo: corrente.tipo, conto: id }); }, 'scegliConto'));
        const b = tasto('azione', '↔ È uno spostamento fra i tuoi conti',
          () => scegliConto({ tipo: 'spostamento', da: contoDi(corrente), verso: null, prima }, alScegliere, true));
        b.id = 'diventaSpostamento';
        b.style.marginTop = '14px';
        b.appendChild(el('small', '', 'Né entrata né uscita: prelievi, versamenti, cripto.'));
        corpo.appendChild(b);
        return;
      }
      const qui = Object.assign({}, corrente, { tipo: 'spostamento', da, verso, prima });
      // toccando come «da» il conto che era «a» (o il contrario) si scambiano
      corpo.appendChild(el('div', 'titoletto', 'Da'));
      corpo.appendChild(fila(da, id => scegliConto(Object.assign({}, qui, id === verso ? { da: id, verso: da } : { da: id }), alScegliere, true), 'spostaDa'));
      corpo.appendChild(el('div', 'titoletto', 'A'));
      corpo.appendChild(fila(verso, id => scegliConto(Object.assign({}, qui, id === da ? { da: verso, verso: id } : { verso: id }), alScegliere, true), 'spostaVerso'));
      corpo.appendChild(el('p', 'nota', 'Da ' + nomeConto(da) + ' a ' + nomeConto(verso) + '. Né entrata né uscita.'));
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-secondario', 'Non è uno spostamento', () => { chiudiFoglio(); alScegliere({ tipo: prima, conto: da }); }));
      const fatto = tasto('tasto-primario', 'Fatto', () => { chiudiFoglio(); alScegliere({ tipo: 'spostamento', da, verso }); });
      fatto.id = 'spostaFatto';
      riga.appendChild(fatto);
      corpo.appendChild(riga);
    });
  }
  // Tenere premuto un bottone (mezzo secondo, senza muovere il dito): per modificare una categoria dalla griglia.
  function tienePremuto(b, alTenere, alToccare) {
    let timer = null, x0 = 0, y0 = 0, tenuto = false;
    const ferma = () => { if (timer) { clearTimeout(timer); timer = null; } };
    b.addEventListener('touchstart', e => {
      tenuto = false;
      const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY;
      ferma();
      timer = setTimeout(() => { timer = null; tenuto = true; if (navigator.vibrate) navigator.vibrate(12); alTenere(); }, 520);
    }, { passive: true });
    b.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.hypot(t.clientX - x0, t.clientY - y0) > 10) ferma(); }, { passive: true });
    b.addEventListener('touchend', e => {
      ferma();
      if (tenuto) { silenzioClic = performance.now() + 250; if (e.cancelable) e.preventDefault(); }
    });
    b.addEventListener('touchcancel', ferma);
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.addEventListener('click', () => { if (tenuto) { tenuto = false; return; } alToccare(); });
  }

  // La griglia delle categorie. «✎ Modifica» (o tenere premuta una categoria) apre nome, simbolo ed eliminazione.
  function scegliCategoria(tipo, corrente, alScegliere, inModifica) {
    apriFoglio(inModifica ? 'Modifica le categorie' : 'Categoria', corpo => {
      const torna = modo => (vecchio, nuovo) => scegliCategoria(tipo, corrente === vecchio ? nuovo : corrente, alScegliere, modo);
      const ang = tasto('tasto-piccolo angolo', inModifica ? 'Fatto' : '✎ Modifica', () => scegliCategoria(tipo, corrente, alScegliere, !inModifica));
      ang.id = 'modificaCategorie';
      corpo.appendChild(ang);
      if (inModifica) corpo.appendChild(el('p', 'nota-su', 'Tocca per modificare.'));
      const g = el('div', 'griglia' + (inModifica ? ' in-modifica' : ''));
      for (const c of categorie(tipo, inModifica)) {
        const b = el('button', 'opzione' + (c.nascosta ? ' spenta' : ''), c.icona + '  ' + c.nome);
        b.type = 'button';
        if (inModifica) b.appendChild(el('span', 'matita', c.nascosta ? 'nascosta' : '✎'));
        b.setAttribute('aria-pressed', String(!inModifica && c.nome === corrente));
        const modifica = () => formCategoria(tipo, c, { alTornare: torna(inModifica) });
        tienePremuto(b, modifica, () => {
          if (inModifica) { modifica(); return; }
          chiudiFoglio(); alScegliere(c.nome);
        });
        g.appendChild(b);
      }
      g.appendChild(tasto('opzione larga tratteggiata', '＋  Nuova categoria', () => formCategoria(tipo, null, {
        alSalvare: inModifica ? null : nome => alScegliere(nome), alTornare: inModifica ? torna(true) : null })));
      corpo.appendChild(g);
    });
  }
  // I giorni del mese (1-31) da toccare, per le spese ricorrenti
  function grigliaGiorni(scelto, alScegliere) {
    const g = el('div', 'giorni-mese');
    g.id = 'giorniMese';
    for (let n = 1; n <= 31; n++) {
      const b = tasto('giorno-mese', String(n), () => alScegliere(n));
      b.dataset.giorno = String(n);
      b.setAttribute('aria-pressed', String(n === scelto));
      b.setAttribute('aria-label', 'Il ' + n + ' di ogni mese');
      g.appendChild(b);
    }
    return g;
  }
  // Testo sotto la griglia: cosa succede questo mese
  function notaRicorrente(giorno, inizio) {
    const ora = oggi();
    if (inizio === 'prossimo') return 'Dal ' + giorno + ' ' + MESI[(ora.getMonth() + 1) % 12] + '.';
    return giorno < ora.getDate() ? 'Questo mese conta già come pagato.' : 'Fino al ' + giorno + ' è «in arrivo».';
  }

  // «ripeti» (facoltativo) per la spesa ricorrente: { acceso, giorno, inizio: 'questo' | 'prossimo', senzaInizio,
  //   alCambiare({ acceso, giorno, inizio }), alFatto }. Con «Ogni mese» si sceglie il giorno del mese, non la data:
  //   «ogni 18 del mese» (10/11/2026: «Ieri, l'altro ieri, domani… devo poter dire ogni 18 del mese»).
  function scegliData(corrente, alScegliere, ripeti) {
    apriFoglio('Quando?', corpo => {
      if (ripeti) {
        const r = Object.assign({}, ripeti);
        if (!r.inizio) r.inizio = 'questo';
        if (!r.giorno) r.giorno = daIso(corrente).getDate();
        const cambia = diff => {
          const nuovo = Object.assign({}, r, diff);
          ripeti.alCambiare({ acceso: !!nuovo.acceso, giorno: nuovo.giorno, inizio: nuovo.inizio });
          scegliData(corrente, alScegliere, nuovo);
        };
        const seg = el('div', 'segmentato largo');
        seg.id = 'quandoRipeti';
        [[false, 'Una volta'], [true, '🔁 Ogni mese']].forEach(([v, nome]) => {
          const s = tasto('', nome, () => cambia({ acceso: v }));
          s.setAttribute('aria-pressed', String(!!r.acceso === v));
          seg.appendChild(s);
        });
        corpo.appendChild(seg);
        if (r.acceso) {
          corpo.appendChild(el('div', 'titoletto', 'Che giorno del mese?'));
          corpo.appendChild(grigliaGiorni(r.giorno, g => cambia({ giorno: g })));
          if (r.giorno > 28) corpo.appendChild(el('p', 'nota-su', 'Nei mesi che non hanno il ' + r.giorno + ' si segna l\'ultimo giorno del mese.'));
          if (!r.senzaInizio) {
            corpo.appendChild(el('div', 'titoletto', 'Da quando?'));
            const seg2 = el('div', 'segmentato largo');
            seg2.id = 'quandoInizio';
            [['questo', 'Da questo mese'], ['prossimo', 'Dal prossimo']].forEach(([k, nome]) => {
              const s = tasto('', nome, () => cambia({ inizio: k }));
              s.setAttribute('aria-pressed', String(r.inizio === k));
              seg2.appendChild(s);
            });
            corpo.appendChild(seg2);
            corpo.appendChild(el('p', 'nota', notaRicorrente(r.giorno, r.inizio)));
          } else {
            corpo.appendChild(el('p', 'nota', 'Dal mese prossimo, ogni ' + r.giorno + '.'));
          }
          const riga = el('div', 'riga-tasti');
          const fatto = tasto('tasto-primario', 'Fatto', () => { chiudiFoglio(); if (ripeti.alFatto) ripeti.alFatto(); else alScegliere(corrente); });
          fatto.id = 'quandoFatto';
          riga.appendChild(fatto);
          corpo.appendChild(riga);
          return;
        }
      }
      const g = el('div', 'griglia');
      g.style.marginTop = ripeti ? '12px' : '0';
      const base = oggi();
      [['Oggi', 0], ['Ieri', -1], ["L'altro ieri", -2]].forEach(([nome, n]) => {
        const iso = A.isoDa(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
        const b = tasto('opzione', nome, () => { chiudiFoglio(); alScegliere(iso); });
        b.setAttribute('aria-pressed', String(iso === corrente));
        g.appendChild(b);
      });
      corpo.appendChild(g);
      const inp = el('input');
      inp.type = 'date';
      inp.value = corrente;
      inp.max = A.isoDa(new Date(base.getFullYear() + 1, 11, 31));
      corpo.appendChild(campo('Un altro giorno', inp));
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', 'Usa questa data', () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) { inp.focus(); return; }
        chiudiFoglio(); alScegliere(inp.value);
      }));
      corpo.appendChild(riga);
    });
  }

  // ================================================================ inserimento a frase (uno o più movimenti)
  const campoFrase = $('frase');
  let proposte = [];   // come l'app ha letto ogni pezzo della frase
  let correnti = [];   // proposte + scelte a mano
  let scelte = [];     // per ogni pezzo: { tipo, categoria, data, ripeti, conto, da, verso } scelti toccando i bottoni

  function rileggi() {
    const testo = campoFrase.value;
    adattaAltezza();
    if (!testo.trim()) {
      proposte = []; correnti = []; scelte = [];
      $('anteprima').hidden = true;
      // le solite spese al posto del suggerimento; il suggerimento solo all'inizio, finché i movimenti sono pochi
      const solite = disegnaScorciatoie();
      $('suggerimento').hidden = true;   // dal 19/11/2026 niente suggerimento: basta la scritta nel riquadro
      return;
    }
    $('scorciatoie').hidden = true;
    const opz = opzioniAnalisi();
    const prima = proposte, sceltePrima = scelte;
    proposte = A.analizzaFrasi(testo, opz);
    // aggiungendo un pezzo alla frase, quello che ha scelto a mano per gli altri resta (24/11/2026: si perdeva tutto)
    if (scelte.length !== proposte.length) {
      const usate = new Set();
      scelte = proposte.map(p => {
        const k = prima.findIndex((x, i) => !usate.has(i) && sceltePrima[i] && (x.testo === p.testo || p.testo.startsWith(x.testo) || x.testo.startsWith(p.testo)));
        if (k < 0) return {};
        usate.add(k);
        return sceltePrima[k];
      });
    }
    correnti = proposte.map((p, i) => {
      const s = scelte[i];
      let r = p;
      if (s.tipo) {
        r = Object.assign(A.analizza(p.testo, Object.assign({}, opz, { tipo: s.tipo })), { testo: p.testo });
        if (!r.certo.data) r.data = p.data;   // la data ereditata dal resto della frase
      }
      r = Object.assign({}, r, { certo: Object.assign({}, r.certo) });
      if (s.categoria && valida(r.tipo, s.categoria)) { r.categoria = s.categoria; r.certo.categoria = true; }
      // il conto (15/11/2026): per uno spostamento da… a…, per il resto uno dei tre
      if (eSpostamento(r)) copiaConto(r, { tipo: 'spostamento', da: s.da || r.da || r.conto, verso: s.verso || r.verso });
      else if (s.conto) { r.conto = s.conto; r.certo.conto = true; }
      if (s.data) r.data = s.data;
      // una delle solite, finché la frase è quella: l'importo è quello di allora, anche se la frase lo leggesse diverso
      if (s.importo && s.testoSolita === testo) r.importo = s.importo;
      if (s.ripeti !== undefined) r.ripeti = s.ripeti;
      if (r.ripeti) {   // la data è il giorno scelto, in questo mese o nel prossimo
        r.giorno = s.giorno || r.giornoMese || daIso(r.data).getDate();
        r.inizio = s.inizio || 'questo';
        const k = chiaveMese(oggi());
        r.data = dataNelMese(r.inizio === 'prossimo' ? meseDopo(k) : k, r.giorno);
      }
      return r;
    });
    disegnaAnteprima();
  }

  function cambiaTipo(i) {
    const c = correnti[i];
    if (!c) return;
    scegliTipo(c, tipo => {
      if (eSpostamento(c)) { scelte[i].conto = c.da; delete scelte[i].da; delete scelte[i].verso; }   // resta dov'era partito
      scelte[i].tipo = tipo;
      if (scelte[i].categoria && !valida(tipo, scelte[i].categoria)) delete scelte[i].categoria;
      rileggi();
    });
  }
  function cambiaConto(i) {
    const c = correnti[i];
    if (!c) return;
    scegliConto(c, n => {
      const s = scelte[i];
      if (n.tipo === 'spostamento') { s.tipo = 'spostamento'; s.da = n.da; s.verso = n.verso; delete s.categoria; }
      else {
        if (eSpostamento(c)) s.tipo = n.tipo;   // non è più uno spostamento
        s.conto = n.conto;
        delete s.da; delete s.verso;
      }
      rileggi();
    });
  }
  function cambiaCategoria(i) {
    const c = correnti[i];
    if (!c) return;
    scegliCategoria(c.tipo, c.categoria, nome => { scelte[i].categoria = nome; rileggi(); });
  }
  function cambiaData(i) {
    const c = correnti[i];
    if (!c) return;
    scegliData(c.data, iso => { scelte[i].data = iso; rileggi(); }, {
      acceso: c.ripeti, giorno: c.giorno, inizio: c.inizio, alFatto: rileggi,
      alCambiare: v => { scelte[i].ripeti = v.acceso; scelte[i].giorno = v.giorno; scelte[i].inizio = v.inizio; rileggi(); }
    });
  }

  function disegnaAnteprima() {
    const multi = correnti.length > 1;
    $('anteprima').hidden = false;
    $('suggerimento').hidden = true;
    $('antSingolo').hidden = multi;
    $('antLista').hidden = !multi;
    const imp = $('antImporto');
    const avviso = $('antAvviso');
    const senzaImporto = correnti.filter(c => !(c.importo > 0));
    const futuri = correnti.filter(c => !c.ripeti && daIso(c.data) > oggi());
    const avanzati = correnti.flatMap(c => c.avanzati || []);   // importi della frase che nessuno ha preso
    const doppi = correnti.filter(c => c.importo > 0 && !c.ripeti && stato.movimenti.some(m => ugualeA(m, c)));
    if (!multi) {
      const c = correnti[0];
      const ct = $('chipTipo');
      ct.textContent = etichettaTipo(c.tipo);
      ct.classList.toggle('dubbio', !c.certo.tipo && !scelte[0].tipo && c.tipo !== 'uscita');
      $('chipConto').textContent = etichettaConto(c);
      const cc = $('chipCategoria');
      cc.hidden = eSpostamento(c);   // uno spostamento non ha categoria
      cc.textContent = iconaDi(c.tipo, c.categoria) + ' ' + c.categoria;
      cc.classList.toggle('dubbio', !c.certo.categoria && !scelte[0].categoria);
      $('chipData').textContent = etichettaQuando(c);
      if (c.importo > 0) { imp.textContent = segnoDi(c.tipo) + euro(c.importo); imp.classList.remove('manca'); }
      else { imp.textContent = 'Quanto?'; imp.classList.add('manca'); }
      $('antDescrizione').textContent = c.descrizione;
      $('salva').textContent = 'Salva';
    } else {
      const lista = $('antLista');
      lista.textContent = '';
      correnti.forEach((c, i) => {
        const r = el('div', 'ant-voce');
        const su = el('div', 'ant-voce-su');
        su.appendChild(el('span', 'ant-voce-desc', c.descrizione));
        su.appendChild(el('span', 'ant-voce-importo' + (c.importo > 0 ? '' : ' manca'), c.importo > 0 ? segnoDi(c.tipo) + euro(c.importo) : 'Quanto?'));
        r.appendChild(su);
        const chips = el('div', 'chips piccole');
        const t = tasto('chip scambia', etichettaTipo(c.tipo), () => cambiaTipo(i));
        t.classList.toggle('dubbio', !c.certo.tipo && !scelte[i].tipo && c.tipo !== 'uscita');
        chips.appendChild(t);
        chips.appendChild(tasto('chip chip-conto', etichettaConto(c), () => cambiaConto(i)));
        if (!eSpostamento(c)) {
          const k = tasto('chip', iconaDi(c.tipo, c.categoria) + ' ' + c.categoria, () => cambiaCategoria(i));
          k.classList.toggle('dubbio', !c.certo.categoria && !scelte[i].categoria);
          chips.appendChild(k);
        }
        chips.appendChild(tasto('chip', etichettaQuando(c), () => cambiaData(i)));
        r.appendChild(chips);
        lista.appendChild(r);
      });
      const somma = tipo => correnti.filter(c => c.tipo === tipo).reduce((a, c) => a + (c.importo || 0), 0);
      const uscite = somma('uscita'), entrate = somma('entrata'), spostati = somma('spostamento');
      imp.textContent = correnti.length + ' movimenti';
      imp.classList.remove('manca');
      $('antDescrizione').textContent = [uscite ? 'uscite ' + euro(uscite) : '', entrate ? 'entrate ' + euro(entrate) : '',
        spostati ? 'spostati ' + euro(spostati) : ''].filter(Boolean).join(' · ');
      $('salva').textContent = 'Salva tutti';
    }
    if (senzaImporto.length) {
      avviso.hidden = false;
      avviso.textContent = multi ? 'Manca l\'importo in «' + senzaImporto[0].descrizione + '».' : 'Manca l\'importo.';
    } else if (avanzati.length) {
      avviso.hidden = false;
      avviso.textContent = 'Fuori è rimasto ' + avanzati.map(euro).join(', ') + ': separalo con una virgola.';
    } else if (futuri.length) {
      avviso.hidden = false;
      avviso.textContent = 'La data è nel futuro: controllala.';
    } else if (doppi.length) {
      avviso.hidden = false;
      avviso.textContent = (multi ? '«' + corto(doppi[0].descrizione) + '» ' : '') + (multi ? 'è già segnato uguale ' : 'Già segnato uguale ') + etichettaGiorno(doppi[0].data).toLowerCase() + '.';
    } else avviso.hidden = true;
    $('salva').disabled = senzaImporto.length > 0;
  }

  // lo stesso movimento, già segnato lo stesso giorno (l'avviso non ferma niente: due caffè uguali si fanno)
  function ugualeA(m, c) {
    return m.data === c.data && m.tipo === c.tipo && m.importo === c.importo && A.normalizza(m.descrizione) === A.normalizza(c.descrizione) &&
      (eSpostamento(c) ? m.da === c.da && m.verso === c.verso : contoDi(m) === contoDi(c));
  }

  function adattaAltezza() {
    campoFrase.style.height = 'auto';
    campoFrase.style.height = Math.min(campoFrase.scrollHeight + 2, 200) + 'px';
  }

  const etichettaQuando = c => (c.ripeti
    ? '🔁 Ogni ' + (c.giorno || daIso(c.data).getDate()) + (c.inizio === 'prossimo' ? ', dal mese prossimo' : ' del mese')
    : etichettaGiorno(c.data));

  // ---------------------------------------------------------------- le solite (17/11/2026)
  // Le spese che ripete uguali (stessa descrizione, importo, tipo e conto) almeno due volte negli ultimi 90 giorni:
  // fino a quattro, sotto il riquadro vuoto. Un tocco le scrive già fatte (anche categoria e conto di allora), poi Salva.
  // Così il caffè di tutti i giorni sono due tocchi. I movimenti fissi no: si segnano già da soli.
  function soliteSpese() {
    const dal = A.isoDa(new Date(oggi().getTime() - 90 * GIORNO_MS)), oggiIso = isoOggi();
    const gruppi = new Map();
    for (const m of stato.movimenti) {
      if (m.ricorrente || m.data < dal || m.data > oggiIso || !m.descrizione || !(m.importo > 0) || !tocca(m, vista.conto)) continue;
      const k = [A.normalizza(m.descrizione), m.importo, m.tipo, eSpostamento(m) ? m.da + '>' + m.verso : contoDi(m)].join('|');
      const g = gruppi.get(k) || { m, n: 0, quando: '' };
      g.n++;
      const q = m.data + (m.creato || '');
      if (q > g.quando) { g.quando = q; g.m = m; }
      gruppi.set(k, g);
    }
    return [...gruppi.values()].filter(g => g.n >= 2).sort((a, b) => b.n - a.n || b.quando.localeCompare(a.quando)).slice(0, 4).map(g => g.m);
  }
  // l'importo come lo si scrive in una frase: «1,20», «50», «1800»
  const importoInFrase = c => (c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100));
  function disegnaScorciatoie() {
    const box = $('scorciatoie'), lista = $('scorciatoieLista');
    const solite = statoVoce === 'fermo' ? soliteSpese() : [];
    lista.textContent = '';
    for (const m of solite) {
      const b = tasto('chip senza-freccia solita', '', () => usaSolita(m));
      b.appendChild(el('span', 'solita-icona', eSpostamento(m) ? '↔' : iconaDi(m.tipo, m.categoria)));
      b.appendChild(el('span', 'solita-desc', m.descrizione));
      b.appendChild(el('span', 'solita-importo' + (m.tipo === 'entrata' ? ' entrata' : ''), (m.tipo === 'entrata' ? '+' : '') + euro(m.importo)));
      b.setAttribute('aria-label', 'Scrivi ' + m.descrizione + ' ' + euro(m.importo) + ', poi Salva');
      lista.appendChild(b);
    }
    box.hidden = !solite.length;
    return solite.length;
  }
  function usaSolita(m) {
    const testo = m.descrizione + ' ' + importoInFrase(m.importo);
    campoFrase.value = testo;
    scelte = [Object.assign({ tipo: m.tipo, importo: m.importo, testoSolita: testo },
      eSpostamento(m) ? { da: m.da, verso: m.verso } : { conto: contoDi(m), categoria: m.categoria })];
    rileggi();
  }

  function impara(descrizione, tipo, categoria) {
    for (const p of A.paroleSignificative(descrizione)) { delete stato.imparate[p]; stato.imparate[p] = { tipo, categoria }; }   // in fondo: è la più nuova
    const chiavi = Object.keys(stato.imparate);   // tetto: le ultime 600 parole
    if (chiavi.length > 600) for (const k of chiavi.slice(0, chiavi.length - 600)) delete stato.imparate[k];
  }

  // il conto corretto a mano: la volta dopo le stesse parole vanno lì da sole (se non si sta guardando un conto)
  function imparaConto(descrizione, conto) {
    if (!CONTI_ID.includes(conto)) return;
    for (const p of A.paroleSignificative(descrizione)) { delete stato.imparatiConti[p]; stato.imparatiConti[p] = conto; }
    const chiavi = Object.keys(stato.imparatiConti);   // tetto: le ultime 600 parole
    if (chiavi.length > 600) for (const k of chiavi.slice(0, chiavi.length - 600)) delete stato.imparatiConti[k];
  }

  function salvaFrase() {
    if (!correnti.length || correnti.some(c => !(c.importo > 0))) { campoFrase.focus(); return; }
    const daDove = $('salva').getBoundingClientRect();   // le monete partono da qui (dopo, l'anteprima sparisce)
    const adesso = new Date().toISOString();
    const testo = campoFrase.value.trim();
    const nuovi = [], fissi = [];
    correnti.forEach((c, i) => {
      const p = proposte[i];
      const spost = eSpostamento(c) || eSpostamento(p);
      if (p && !spost && (p.tipo !== c.tipo || p.categoria !== c.categoria)) impara(c.descrizione, c.tipo, c.categoria);
      if (p && !spost && scelte[i] && scelte[i].conto && scelte[i].conto !== p.conto && p.contoDa !== 'frase') imparaConto(c.descrizione, c.conto);
      const m = copiaConto({
        id: nuovoId(), data: c.data, tipo: c.tipo, importo: c.importo,
        categoria: c.categoria, descrizione: c.descrizione, testo: correnti.length > 1 ? c.testo : testo, creato: adesso
      }, c);
      // spese ricorrenti: diventano anche movimenti fissi, che si segnano da soli; «dal prossimo» per ora solo il fisso
      if (c.ripeti && c.inizio === 'prossimo') { fissi.push(creaFisso(m, c.giorno, true)); return; }
      nuovi.push(m);
      if (c.ripeti) fissi.push(creaFisso(m, c.giorno));
    });
    stato.movimenti.push(...nuovi);
    if (!scrivi()) {
      stato.movimenti.splice(stato.movimenti.length - nuovi.length, nuovi.length);
      stato.ricorrenti = stato.ricorrenti.filter(r => !fissi.includes(r));
      return;
    }
    campoFrase.value = '';
    scelte = [];
    rileggi();
    if (nuovi.length) {
      const d = daIso(nuovi[nuovi.length - 1].data);
      vista.anno = d.getFullYear();
      if (vista.modo === 'mese') vista.mese = d.getMonth();
    }
    disegna();
    const ids = new Set(nuovi.map(m => m.id));
    // il suono e il segno di quello che è appena entrato (17/11/2026): la cassa per le entrate, monete per le uscite
    const tipi = new Set(nuovi.concat(fissi).map(m => m.tipo));
    suonaMovimento(tipi.has('entrata') ? 'entrata' : tipi.has('uscita') ? 'uscita' : 'spostamento');
    illumina(ids);
    if (tipi.has('entrata')) pioggiaDiMonete(daDove);
    // se è finito in un conto diverso da quello che sta guardando, lo si dice: se no sembra sparito
    const altrove = vista.conto ? nuovi.filter(m => !tocca(m, vista.conto)) : [];
    const testoToast = (nuovi.length > 1 ? 'Salvati ' + nuovi.length + ' movimenti'
      : nuovi.length ? 'Salvato: ' + corto(nuovi[0].descrizione) + ' ' + euro(Math.abs(nuovi[0].importo))
        : 'Fisso salvato: ' + corto(fissi[0].descrizione) + ', dal mese prossimo')
      + (fissi.length ? ' · 🔁 ogni ' + [...new Set(fissi.map(r => r.giorno))].join(', ') : '')
      + (altrove.length === 1 && nuovi.length === 1 ? ' · in ' + nomeConto(contoDi(altrove[0])) : altrove.length ? ' · ' + altrove.length + ' in altri conti' : '');
    mostraToast(testoToast, 'Annulla', () => {
      stato.movimenti = stato.movimenti.filter(x => !ids.has(x.id));
      stato.ricorrenti = stato.ricorrenti.filter(r => !fissi.includes(r));
      scrivi();
      disegna();
    });
  }

  campoFrase.addEventListener('input', rileggi);
  campoFrase.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (correnti.length && correnti.every(c => c.importo > 0)) salvaFrase();
      else campoFrase.blur();
    }
  });
  $('salva').addEventListener('click', salvaFrase);
  $('chipTipo').addEventListener('click', () => cambiaTipo(0));
  $('chipConto').addEventListener('click', () => cambiaConto(0));
  $('chipCategoria').addEventListener('click', () => cambiaCategoria(0));
  $('chipData').addEventListener('click', () => cambiaData(0));

  // ================================================================ movimenti fissi (ricorrenti)
  // Ogni fisso: { id, descrizione, importo, tipo, categoria, giorno (1-31), attivo, dal ('AAAA-MM': primo mese ancora
  //   da fare), fatti: ['AAAA-MM'] }. Un mese «fatto» non si rifà più, anche se il movimento poi lo cancelli: così
  //   cancellare vuol dire «questo mese no».
  // Dal 10/11/2026 il movimento del mese si segna il 1° (con la data del suo giorno) e conta nel mese dal 1° all'ultimo
  // giorno: finché il giorno non arriva è «in arrivo» e il saldo attuale non lo toglie (saldoAttuale salta le date future).
  function generaRicorrenti(silenzioso) {
    const d = oggi(), ora = chiaveMese(d), adesso = new Date().toISOString();
    const nuovi = [];
    let cambiato = false;
    for (const r of stato.ricorrenti) {
      if (!Array.isArray(r.fatti)) r.fatti = [];
      if (!r.attivo) continue;
      let k = r.dal || ora, giri = 0;
      while (k <= ora && giri++ < 24) {
        const [y, m] = k.split('-').map(Number);
        const giorno = Math.min(r.giorno, new Date(y, m, 0).getDate());   // il 31 a febbraio diventa il 28/29
        const data = new Date(y, m - 1, giorno);
        if (!r.fatti.includes(k)) {
          nuovi.push(copiaConto({ id: nuovoId(), data: A.isoDa(data), tipo: r.tipo, importo: r.importo, categoria: r.categoria,
            descrizione: r.descrizione, testo: '', creato: adesso, ricorrente: r.id }, r));
          r.fatti.push(k);
        }
        k = meseDopo(k);
      }
      if ((r.dal || ora) < ora) { r.dal = ora; cambiato = true; }
      const prima = r.fatti.length;
      r.fatti = r.fatti.filter(x => x >= r.dal);
      if (r.fatti.length !== prima) cambiato = true;
    }
    if (nuovi.length) {
      stato.movimenti.push(...nuovi);
      scrivi();
      const n0 = nuovi[0];
      if (!silenzioso) mostraToast(nuovi.length === 1
        ? (n0.data > A.isoDa(d) ? 'In arrivo il ' + daIso(n0.data).getDate() + ': ' : 'Segnato da solo: ') + corto(n0.descrizione) + ' ' + euro(Math.abs(n0.importo))
        : 'Segnati da soli ' + nuovi.length + ' movimenti fissi del mese');
    } else if (cambiato) scrivi();
    return nuovi.length;
  }

  function totaleFissi() {
    const t = { uscite: 0, entrate: 0 };
    for (const r of stato.ricorrenti) {
      if (!r.attivo || eSpostamento(r)) continue;   // gli spostamenti fissi non sono né entrate né uscite
      if (r.tipo === 'entrata') t.entrate += r.importo; else t.uscite += r.importo;
    }
    return t;
  }

  function apriFissi() {
    apriFoglio('Movimenti fissi', corpo => {
      const t = totaleFissi();
      const somma = [t.uscite ? 'uscite ' + euro(t.uscite) : '', t.entrate ? 'entrate ' + euro(t.entrate) : ''].filter(Boolean);
      if (somma.length) corpo.appendChild(el('p', 'riassunto', 'Al mese: ' + somma.join(' · ')));
      const lista = el('div', 'elenco-righe');
      const ordinati = stato.ricorrenti.slice().sort((a, b) => a.giorno - b.giorno);
      for (const r of ordinati) {
        const b = el('button', 'mov');
        b.type = 'button';
        b.appendChild(riquadro(eSpostamento(r) ? '↔' : iconaDi(r.tipo, r.categoria)));
        const testi = el('span', 'mov-testi');
        testi.appendChild(el('span', 'mov-desc', r.descrizione));
        testi.appendChild(el('span', 'mov-cat', 'ogni ' + r.giorno + ' del mese · ' + (eSpostamento(r) ? etichettaConto(r)
          : r.categoria + ' · ' + infoConto(contoDi(r)).icona) + (r.attivo ? '' : ' · in pausa')));
        b.appendChild(testi);
        b.appendChild(el('span', 'mov-importo ' + r.tipo, segnoDi(r.tipo) + euro(Math.abs(r.importo))));
        b.addEventListener('click', () => apriFisso(r));
        lista.appendChild(b);
      }
      if (!ordinati.length) lista.appendChild(el('p', 'vuoto', 'Nessuno.'));
      corpo.appendChild(lista);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', '＋ Aggiungi', () => apriFisso(null)));
      corpo.appendChild(riga);
    });
  }

  // dopo (facoltativo): dopo Salva o Elimina, per tornare dove si era (il dettaglio dei mesi di autonomia)
  function apriFisso(esistente, dopo) {
    const nuovo = !esistente;
    const ora = chiaveMese(oggi());
    const b = esistente ? copiaConto(Object.assign({}, esistente, { importo: Math.abs(esistente.importo) }), esistente)
      : { descrizione: '', importo: 0, tipo: 'uscita', categoria: ripiegoDi('uscita'), giorno: oggi().getDate(), attivo: true,
        conto: vista.conto || A.CONTO_BASE };
    let sceltaMano = !nuovo, contoMano = !nuovo;
    let quando = 'questo';
    const disegnaForm = () => { foglioSotto = null; disegnaFisso(); };
    const disegnaFisso = () => apriFoglio(nuovo ? 'Nuovo movimento fisso' : 'Movimento fisso', corpo => {
      const inDesc = inputTesto(b.descrizione);
      inDesc.placeholder = 'Nome';
      inDesc.addEventListener('input', () => {
        if (sceltaMano) return;
        const r = A.analizza(inDesc.value, opzioniAnalisi());
        b.tipo = r.tipo; b.categoria = r.categoria;
        if (!contoMano || eSpostamento(r)) copiaConto(b, r);
        chipT.textContent = etichettaTipo(b.tipo);
        chipK.textContent = etichettaConto(b);
        chipC.hidden = eSpostamento(b);
        chipC.textContent = iconaDi(b.tipo, b.categoria) + ' ' + b.categoria;
      });
      corpo.appendChild(campo('Che cos\'è', inDesc));
      const inImp = inputTesto(b.scritto !== undefined ? b.scritto : b.importo ? formatoPerCampo(b.importo) : '', 'decimal');
      inImp.placeholder = '0,00';
      inImp.id = 'fissoImporto';
      corpo.appendChild(campo('Importo in euro', inImp));
      corpo.appendChild(el('div', 'titoletto', 'Che giorno del mese?'));
      corpo.appendChild(grigliaGiorni(b.giorno, g => { leggi(); b.giorno = g; disegnaForm(); }));
      if (b.giorno > 28) corpo.appendChild(el('p', 'nota-su', 'Nei mesi che non hanno il ' + b.giorno + ' si segna l\'ultimo giorno del mese.'));
      const chips = el('div', 'chips');
      chips.style.marginTop = '12px';
      const leggi = () => {
        b.descrizione = inDesc.value.trim();
        const v = leggiEuro(inImp.value);
        b.scritto = inImp.value;
        b.importo = v === null ? 0 : v;
      };
      const chipT = tasto('chip scambia', etichettaTipo(b.tipo), () => {
        leggi();
        scegliTipo(b, tipo => {
          if (eSpostamento(b)) { b.conto = b.da; delete b.da; delete b.verso; }
          sceltaMano = true; b.tipo = tipo;
          if (!valida(tipo, b.categoria)) b.categoria = ripiegoDi(tipo);
          disegnaForm();
        });
      });
      const chipK = tasto('chip chip-conto', etichettaConto(b), () => {
        leggi();
        foglioSotto = disegnaForm;
        scegliConto(b, n => {
          sceltaMano = true; contoMano = true;
          if (n.tipo === 'spostamento') { b.tipo = 'spostamento'; b.categoria = A.SPOSTAMENTO; }
          else if (eSpostamento(b)) { b.tipo = n.tipo; b.categoria = ripiegoDi(n.tipo); }
          copiaConto(b, n);
          disegnaForm();
        });
      });
      const chipC = tasto('chip', iconaDi(b.tipo, b.categoria) + ' ' + b.categoria, () => {
        leggi();
        foglioSotto = disegnaForm;
        scegliCategoria(b.tipo, b.categoria, nome => { sceltaMano = true; b.categoria = nome; disegnaForm(); });
      });
      chipC.hidden = eSpostamento(b);
      chips.appendChild(chipT);
      chips.appendChild(chipK);
      chips.appendChild(chipC);
      corpo.appendChild(chips);
      let attivo = null;
      if (nuovo) {
        corpo.appendChild(el('div', 'titoletto', 'Comincia'));
        const seg = el('div', 'segmentato largo');
        [['questo', 'Da questo mese'], ['prossimo', 'Dal prossimo']].forEach(([k, nome]) => {
          const s = tasto('', nome, () => { leggi(); quando = k; disegnaForm(); });
          s.setAttribute('aria-pressed', String(quando === k));
          seg.appendChild(s);
        });
        corpo.appendChild(seg);
        corpo.appendChild(el('p', 'nota', notaRicorrente(b.giorno, quando)));
      } else {
        attivo = interruttore('Attivo: si segna ogni mese', b.attivo);
        corpo.appendChild(attivo.etichetta);
      }
      const riga = el('div', 'riga-tasti');
      if (!nuovo) riga.appendChild(tasto('tasto-pericolo', 'Elimina', () => {
        leggi();
        const inArrivo = stato.movimenti.some(m => m.ricorrente === esistente.id && m.data > isoOggi());
        conferma('Eliminare «' + esistente.descrizione + '»?', 'I movimenti già passati restano' + (inArrivo ? ', quello in arrivo questo mese sparisce.' : '.'), 'Elimina', () => {
          aggiornaInArrivo(esistente, true);
          stato.ricorrenti = stato.ricorrenti.filter(r => r.id !== esistente.id);
          scrivi(); disegna();
          suonaMovimento('elimina');
          if (dopo) dopo();
          mostraToast('Movimento fisso eliminato');
        }, disegnaForm);
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        leggi();
        if (!b.descrizione) { mostraToast('Scrivi che cos\'è'); inDesc.focus(); return; }
        if (!(b.importo > 0)) { mostraToast('Importo non valido'); inImp.focus(); return; }
        const importo = b.importo;
        if (nuovo) {
          stato.ricorrenti.push(copiaConto({ id: nuovoId(), descrizione: b.descrizione, importo, tipo: b.tipo, categoria: b.categoria,
            giorno: b.giorno, attivo: true, dal: quando === 'questo' ? ora : meseDopo(ora), fatti: [], creato: new Date().toISOString() }, b));
        } else {
          const r = stato.ricorrenti.find(x => x.id === esistente.id);
          if (!r) { chiudiFoglio(); return; }
          const riattivato = attivo && attivo.casella.checked && !r.attivo;
          Object.assign(r, { descrizione: b.descrizione, importo, tipo: b.tipo, categoria: b.categoria, giorno: b.giorno, attivo: attivo ? attivo.casella.checked : r.attivo });
          copiaConto(r, b);
          if (riattivato) r.dal = ora;   // i mesi di pausa non si recuperano
          aggiornaInArrivo(r);
        }
        scrivi();
        chiudiFoglio();
        generaRicorrenti();
        disegna();
        suonaMovimento(b.tipo);
        if (dopo) dopo();
        if (nuovo) mostraToast('Movimento fisso salvato: ogni ' + b.giorno + ' del mese');
      }));
      corpo.appendChild(riga);
    });
    disegnaForm();
  }

  // I movimenti «in arrivo» (data futura) di un fisso seguono le sue modifiche; in pausa o eliminato («via») spariscono,
  // e il loro mese torna da fare (se lo riattivi, si risegna).
  function aggiornaInArrivo(r, via) {
    const oggiIso = isoOggi();
    const futuri = stato.movimenti.filter(m => m.ricorrente === r.id && m.data > oggiIso);
    if (via || !r.attivo) {
      const ids = new Set(futuri.map(m => m.id)), mesi = new Set(futuri.map(m => m.data.slice(0, 7)));
      stato.movimenti = stato.movimenti.filter(m => !ids.has(m.id));
      r.fatti = (r.fatti || []).filter(k => !mesi.has(k));
    } else {
      for (const m of futuri) copiaConto(Object.assign(m, { tipo: r.tipo, categoria: r.categoria, descrizione: r.descrizione,
        importo: r.importo, data: dataNelMese(m.data.slice(0, 7), r.giorno) }), r);
    }
    return futuri.length;
  }

  // Il movimento m diventa anche un fisso, ogni «giorno» del mese (se manca, quello della sua data): il suo mese
  // è già «fatto», i successivi si segnano da soli. Con «dalProssimo» m non si salva: comincia il mese dopo. Non salva.
  function creaFisso(m, giorno, dalProssimo) {
    const d = daIso(m.data), ora = chiaveMese(oggi()), suo = chiaveMese(d);
    const r = copiaConto({ id: nuovoId(), descrizione: m.descrizione, importo: m.importo, tipo: m.tipo, categoria: m.categoria,
      giorno: giorno || d.getDate(), attivo: true, dal: dalProssimo ? meseDopo(ora) : (suo > ora ? suo : ora),
      fatti: dalProssimo ? [] : [suo], creato: new Date().toISOString() }, m);
    if (dalProssimo) { stato.ricorrenti.push(r); return r; }
    // se questo mese c'è già un movimento con la stessa descrizione, non lo rifà
    const stesso = x => x.tipo === m.tipo && x.data.slice(0, 7) === ora && A.normalizza(x.descrizione) === A.normalizza(m.descrizione);
    if (!r.fatti.includes(ora) && stato.movimenti.some(stesso)) r.fatti.push(ora);
    m.ricorrente = r.id;
    stato.ricorrenti.push(r);
    return r;
  }
  function ripetiOgniMese(m, giorno) {
    const r = creaFisso(m, giorno);
    scrivi();
    generaRicorrenti();
    disegna();
    suonaMovimento(m.tipo);
    mostraToast('Si ripeterà ogni ' + r.giorno + ' del mese');
  }

  // ================================================================ saldi, tasse e mesi di autonomia
  // Dal 15/11/2026 un saldo per conto. Saldo di oggi = saldo dichiarato + i movimenti di quel conto venuti dopo (fino a
  // oggi), spostamenti compresi: tolti da dove partono, aggiunti dove arrivano. Quelli dello stesso giorno contano solo se
  // segnati dopo aver dichiarato il saldo. Gli investimenti sono uscite: escono dai soldi liquidi, i ritiri rientrano.
  function saldoAttuale(conto) {
    const s = stato.saldi[conto];
    if (!s) return null;
    const oggiIso = isoOggi();
    let v = s.importo;
    for (const m of stato.movimenti) {
      if (m.data > oggiIso) continue;
      if (!(m.data > s.data || (m.data === s.data && (m.creato || '') > (s.aggiornato || '')))) continue;
      if (eSpostamento(m)) { if (m.da === conto) v -= m.importo; if (m.verso === conto) v += m.importo; }
      else if (contoDi(m) === conto) v += m.tipo === 'entrata' ? m.importo : -m.importo;
    }
    return v;
  }
  // i soldi per i mesi di autonomia: contanti e digitale (null se non ha inserito nessuno dei due)
  function liquidi() {
    const v = CONTI_LIQUIDI.map(saldoAttuale);
    return v.every(x => x === null) ? null : v.reduce((a, x) => a + (x || 0), 0);
  }

  function accantonamento(m) {
    const t = stato.tasse;
    if (!t.attiva || !(t.percentuale > 0) || m.tipo !== 'entrata' || !t.categorie.includes(m.categoria) || (t.dal && m.data < t.dal)) return 0;
    return Math.round(m.importo * t.percentuale / 100);
  }
  function fondoTasse() {
    const t = stato.tasse;
    if (!t.attiva) return null;
    const oggiIso = isoOggi(), catTasse = nomeDaBase('uscita', 'Tasse e commercialista');
    let messi = 0, pagati = 0;
    for (const m of stato.movimenti) {
      if (m.data > oggiIso) continue;
      messi += accantonamento(m);
      if (m.tipo === 'uscita' && m.categoria === catTasse && (!t.dal || m.data >= t.dal)) pagati += m.importo;
    }
    return { messi, pagati, fondo: messi - pagati };
  }

  // Gli investimenti sono uscite, ma per i mesi di autonomia non contano: senza entrate si smette di investire.
  const catInvestimenti = () => nomeDaBase('uscita', A.INVESTIMENTI);
  const spesaVera = m => m.tipo === 'uscita' && m.categoria !== catInvestimenti();

  // Spesa media al mese sugli ultimi 3 mesi interi (non quello in corso). Un mese conta solo se l'app
  // c'era già all'inizio: il primo movimento deve essere entro il 7 di quel mese.
  function speseMedie() {
    if (!stato.movimenti.length) return null;
    const primo = stato.movimenti.reduce((a, m) => (m.data < a ? m.data : a), '9999-12-31');
    const d = oggi(), totali = [], dettaglio = [];
    for (let k = 1; k <= 3; k++) {
      const inizio = new Date(d.getFullYear(), d.getMonth() - k, 1);
      if (primo > A.isoDa(new Date(inizio.getFullYear(), inizio.getMonth(), 7))) break;
      const chiave = chiaveMese(inizio);
      totali.push(stato.movimenti.filter(m => spesaVera(m) && m.data.slice(0, 7) === chiave).reduce((a, m) => a + m.importo, 0));
      dettaglio.push([chiave, totali[totali.length - 1]]);
    }
    if (!totali.length) return null;
    return { media: Math.round(totali.reduce((a, b) => a + b, 0) / totali.length), mesi: totali.length, dettaglio };
  }

  function formatoMesi(x) {
    if (x <= 0) return '0 mesi';
    if (x >= 120) return 'oltre 10 anni';
    const t = Math.round(x * 100) / 100;
    return t.toFixed(2).replace('.', ',') + (t === 1 ? ' mese' : ' mesi');
  }

  // la riga di un conto nel riquadro: si tocca per correggerne il saldo
  function rigaSaldo(righe, nome, valore, alClic, forte) {
    const r = el(alClic ? 'button' : 'div', 'aut-riga' + (forte ? ' forte' : '') + (alClic ? ' cliccabile' : ''));
    if (alClic) { r.type = 'button'; r.addEventListener('click', alClic); }
    r.appendChild(el('span', '', nome));
    r.appendChild(el('span', '', valore));
    righe.appendChild(r);
  }

  // il calcolo dei mesi di autonomia (lo usano il riquadro e il suo dettaglio)
  function calcoloAutonomia() {
    const saldi = {};
    for (const c of CONTI_ID) saldi[c] = saldoAttuale(c);
    const sa = liquidi();
    const ft = fondoTasse();
    const tasse = ft ? Math.max(0, ft.fondo) : 0;
    const spendibili = sa === null ? null : sa - tasse;
    const sm = speseMedie();
    const fissi = stato.ricorrenti.filter(r => r.attivo && spesaVera(r)).reduce((a, r) => a + r.importo, 0);
    let mesi = null, spiegazione;
    if (sa === null) {
      spiegazione = 'Servono i saldi di contanti o digitale.';
    } else if (sm && sm.media > 0) {
      mesi = spendibili / sm.media;
      spiegazione = 'Senza entrate, spendendo ' + euro(sm.media) + ' al mese.';
    } else if (fissi > 0) {
      mesi = spendibili / fissi;
      spiegazione = 'Senza entrate, con le sole spese fisse (' + euro(fissi) + ' al mese).';
    } else {
      spiegazione = 'Servono un mese di spese o i movimenti fissi.';
    }
    return { saldi, sa, ft, tasse, spendibili, sm, fissi, mesi, spiegazione };
  }

  function disegnaAutonomia() {
    const corpo = $('autonomiaCorpo');
    corpo.textContent = '';
    if (vista.conto) { disegnaSaldoConto(corpo, vista.conto); return; }
    $('titoloAutonomia').textContent = 'Mesi di autonomia';
    const saldi = {};
    for (const c of CONTI_ID) saldi[c] = saldoAttuale(c);
    const qualcuno = CONTI_ID.some(c => saldi[c] !== null);
    $('modSaldo').hidden = !qualcuno;
    $('modSaldo').textContent = 'Correggi saldi';
    if (!qualcuno) {
      corpo.appendChild(el('p', 'aut-testo', 'Inserisci i saldi per sapere quanti mesi reggi senza entrate.'));
      const r = el('div', 'riga-tasti');
      r.appendChild(tasto('tasto-secondario', 'Inserisci i saldi', () => apriSaldo()));
      corpo.appendChild(r);
      return;
    }
    const { sa, ft, tasse, spendibili, mesi, spiegazione } = calcoloAutonomia();
    corpo.appendChild(el('p', 'aut-mesi', mesi !== null ? formatoMesi(mesi) : '—'));
    corpo.appendChild(el('p', 'aut-testo', spiegazione));
    const righe = el('div', 'aut-righe');
    for (const c of CONTI_LIQUIDI) rigaSaldo(righe, nomeConto(c) + ' oggi', saldi[c] !== null ? saldoEuro(saldi[c]) : 'da inserire', () => apriSaldo(c));
    if (sa !== null) {
      if (ft) rigaSaldo(righe, 'Da tenere per le tasse', tasse ? '−' + euro(tasse) : euro(0));
      rigaSaldo(righe, 'Spendibili', saldoEuro(spendibili), null, true);
    }
    rigaSaldo(righe, nomeConto('cripto') + ' · non conta', saldi.cripto !== null ? saldoEuro(saldi.cripto) : 'da inserire', () => apriSaldo('cripto'));
    corpo.appendChild(righe);
    if (stato.saldi.daDividere) corpo.appendChild(el('p', 'avviso', 'Il saldo vecchio (conti e contanti insieme) è in Digitale: separa i contanti.'));
  }

  // Guardando un conto solo: il suo saldo di oggi
  function disegnaSaldoConto(corpo, c) {
    $('titoloAutonomia').textContent = 'Saldo ' + inConto(c);
    const v = saldoAttuale(c);
    $('modSaldo').hidden = v === null;
    $('modSaldo').textContent = 'Correggi saldo';
    const cosa = c === 'cripto' ? 'Non conta nei mesi di autonomia.' : '';
    if (v === null) {
      corpo.appendChild(el('p', 'aut-testo', 'Inserisci il saldo ' + inConto(c) + '.'));
      const r = el('div', 'riga-tasti');
      r.appendChild(tasto('tasto-secondario', 'Inserisci il saldo', () => apriSaldo(c)));
      corpo.appendChild(r);
      return;
    }
    corpo.appendChild(el('p', 'aut-mesi', saldoEuro(v)));
    if (cosa) corpo.appendChild(el('p', 'aut-testo', cosa));
    const s = stato.saldi[c];
    corpo.appendChild(el('p', 'nota', 'Inserito ' + etichettaGiorno(s.data).toLowerCase() + ': ' + saldoEuro(s.importo)));
  }

  // I saldi: tutti e tre insieme, o uno solo («solo»). Un campo non toccato tiene il saldo di prima, con la sua data.
  function apriSaldo(solo) {
    const quali = solo ? [infoConto(solo)] : A.CONTI;
    apriFoglio(solo ? 'Saldo ' + inConto(solo) : 'Saldi dei conti', corpo => {
      if (!solo) corpo.appendChild(el('p', '', 'Quanto hai adesso. Lascia vuoto quello che non usi.'));
      if (stato.saldi.daDividere && solo !== 'cripto') corpo.appendChild(el('p', 'avviso', 'Il saldo vecchio (conti e contanti insieme) è in Digitale: separa i contanti.'));
      const campi = [];
      for (const c of quali) {
        const sa = saldoAttuale(c.id);
        const inp = inputTesto(sa !== null ? (sa < 0 ? '-' : '') + formatoPerCampo(sa) : '', 'decimal');
        inp.placeholder = '0,00';
        inp.id = 'saldo' + maiuscola(c.id);
        corpo.appendChild(campo(c.icona + ' ' + c.nome + ' oggi, in euro', inp));
        if (c.id === 'cripto') corpo.appendChild(el('p', 'nota-campo', 'In euro, al valore di oggi. Non conta nei mesi di autonomia.'));
        campi.push([c.id, inp, sa]);
      }
      const riga = el('div', 'riga-tasti');
      if (solo && stato.saldi[solo]) riga.appendChild(tasto('tasto-secondario', 'Togli', () => {
        stato.saldi[solo] = null; scrivi(); chiudiFoglio(); disegna(); suonaMovimento('elimina');
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        const nuovi = [];
        for (const [id, inp, prima] of campi) {
          const testo = inp.value.trim();
          if (!testo) { nuovi.push([id, null]); continue; }
          const v = leggiEuro(testo, true);
          if (v === null) { mostraToast('Importo non valido'); inp.focus(); return; }
          nuovi.push([id, v === prima ? undefined : v]);
        }
        const adesso = new Date().toISOString();
        // di quanto non torna rispetto ai movimenti segnati: le cripto no, cambiano valore da sole (24/11/2026)
        const scarti = [];
        for (const [id, v] of nuovi) {
          if (v === undefined) continue;
          const prima = campi.find(x => x[0] === id)[2];
          if (v !== null && prima !== null && id !== 'cripto' && !stato.saldi.daDividere) scarti.push([id, v - prima]);
          stato.saldi[id] = v === null ? null : { importo: v, data: isoOggi(), aggiornato: adesso };
        }
        if (solo !== 'cripto') delete stato.saldi.daDividere;
        scrivi(); chiudiFoglio(); disegna();
        suonaSaldo(solo || null);
        if (!scarti.length) { mostraToast(solo ? 'Saldo salvato' : 'Saldi salvati'); return; }
        // «Segna»: la differenza diventa un movimento di oggi, già compreso nel saldo appena scritto (creato un attimo prima)
        mostraToast(scarti.map(([id, d]) => infoConto(id).nome + ' ' + conSegno(d)).join(', ') + ' rispetto ai movimenti', 'Segna', () => {
          const creato = new Date(Date.parse(adesso) - 1).toISOString();
          for (const [id, d] of scarti) {
            const tipo = d > 0 ? 'entrata' : 'uscita';
            stato.movimenti.push({ id: nuovoId(), data: isoOggi(), tipo, importo: Math.abs(d), categoria: ripiegoDi(tipo), descrizione: 'Differenza di saldo', testo: '', creato, conto: id });
          }
          scrivi(); disegna();
          suonaMovimento(scarti.some(([, d]) => d > 0) ? 'entrata' : 'uscita');
          mostraToast(scarti.length === 1 ? 'Segnata la differenza' : 'Segnate le differenze');
        }, 10000);
      }));
      corpo.appendChild(riga);
    });
  }

  function apriTasse() {
    const t = stato.tasse;
    apriFoglio('Tasse da accantonare', corpo => {
      corpo.appendChild(el('p', '', 'Una parte delle entrate scelte resta da parte. Le uscite in «' + nomeDaBase('uscita', 'Tasse e commercialista') + '» la consumano.'));
      const on = interruttore('Accantona per le tasse', t.attiva);
      corpo.appendChild(on.etichetta);
      const inP = inputTesto(t.percentuale ? String(t.percentuale).replace('.', ',') : '', 'decimal');
      inP.placeholder = '%';
      corpo.appendChild(campo('Percentuale da mettere da parte', inP));
      corpo.appendChild(el('div', 'titoletto', 'Su quali entrate'));
      const scelteCat = t.categorie.length ? t.categorie : [nomeDaBase('entrata', 'Provvigioni')];
      const caselle = [];
      for (const c of categorie('entrata')) {
        const i = interruttore(c.icona + ' ' + c.nome, scelteCat.includes(c.nome));
        caselle.push([c.nome, i.casella]);
        corpo.appendChild(i.etichetta);
      }
      const inDal = el('input');
      inDal.type = 'date';
      inDal.value = t.dal || isoOggi();
      corpo.appendChild(campo('Contano le entrate da questo giorno', inDal));
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        const p = parseFloat(String(inP.value).replace(',', '.'));
        if (on.casella.checked && !(p > 0 && p < 100)) { mostraToast('Scrivi una percentuale fra 0 e 100'); inP.focus(); return; }
        stato.tasse = {
          attiva: on.casella.checked, percentuale: p > 0 ? p : 0,
          categorie: caselle.filter(([, c]) => c.checked).map(([n]) => n),
          dal: /^\d{4}-\d{2}-\d{2}$/.test(inDal.value) ? inDal.value : isoOggi()
        };
        scrivi(); chiudiFoglio(); disegna();
        mostraToast(stato.tasse.attiva ? 'Accantono il ' + String(stato.tasse.percentuale).replace('.', ',') + '%' : 'Accantonamento spento');
      }));
      corpo.appendChild(riga);
    });
  }

  // ================================================================ categorie personali
  const EMOJI = ['🛒', '🍕', '🍽️', '☕', '🍺', '🍷', '🚆', '🚗', '🛵', '🔧', '⛽', '🏠', '📱', '💊', '🏋️', '⚔️',
    '⛵', '📚', '🎲', '🎮', '🎵', '🎬', '✈️', '👕', '🧖', '💇', '💻', '🎁', '🧾', '🏦', '🚬', '🍀',
    '🍫', '🐶', '👶', '💼', '💶', '↩️', '🏷️', '🌱', '🤝', '📈', '💰', '🪙', '🛡️', '❤️', '⭐', '•'];
  let tipoCategorie = 'uscita';

  // l'elenco personale diventa esplicito (serve per rinominare, nascondere, eliminare); le eliminate restano come segnaposto
  function materializza() {
    const nuove = {};
    for (const tipo of TIPI_DATI) {
      const vecchie = stato.categorie && Array.isArray(stato.categorie[tipo]) ? stato.categorie[tipo] : [];
      nuove[tipo] = A.elenco(tipo, stato.categorie).map(c => ({ nome: c.nome, icona: c.icona, base: c.base, nascosta: !!c.nascosta }))
        .concat(vecchie.filter(x => x.eliminata));
    }
    stato.categorie = nuove;
  }
  const vivaDi = (tipo, nome) => stato.categorie[tipo].find(x => x.nome === nome && !x.eliminata);
  function pulisciNome(s) { return String(s).replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28); }
  function nomeLibero(tipo, nome, tranne) {
    const n = A.normalizza(nome);
    return !categorie(tipo, true).some(c => A.normalizza(c.nome) === n && c.nome !== tranne);
  }
  function usiDi(tipo, nome) { return stato.movimenti.filter(m => m.tipo === tipo && m.categoria === nome).length; }
  function primoSimbolo(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (window.Intl && Intl.Segmenter) {
      const p = new Intl.Segmenter('it', { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next();
      return p.value ? p.value.segment : '';
    }
    return Array.from(s)[0];
  }

  function rinomina(tipo, vecchio, nuovo, icona) {
    materializza();
    const e = vivaDi(tipo, vecchio);
    if (!e) return;
    e.nome = nuovo;
    if (icona) e.icona = icona;
    if (nuovo !== vecchio) {
      for (const m of stato.movimenti) if (m.tipo === tipo && m.categoria === vecchio) m.categoria = nuovo;
      for (const r of stato.ricorrenti) if (r.tipo === tipo && r.categoria === vecchio) r.categoria = nuovo;
      for (const k of Object.keys(stato.imparate)) {
        const v = stato.imparate[k];
        if (v.tipo === tipo && v.categoria === vecchio) v.categoria = nuovo;
      }
      if (tipo === 'entrata') stato.tasse.categorie = stato.tasse.categorie.map(c => (c === vecchio ? nuovo : c));
      if (eFiltro(tipo, vecchio)) vista.filtro = { tipo, nome: nuovo };
      for (const s of scelte) if (s.categoria === vecchio) s.categoria = nuovo;
    }
    scrivi();
  }
  function aggiungiCategoria(tipo, nome, icona) {
    materializza();
    const lista = stato.categorie[tipo];
    const dove = lista.findIndex(x => x.base === A.RIPIEGO[tipo]);   // prima di «Altro»
    lista.splice(dove >= 0 ? dove : lista.length, 0, { nome, icona: icona || '•', base: null, nascosta: false });
    scrivi();
  }
  // Toglie la categoria: i suoi movimenti e fissi passano nel ripiego («Altro»), le parole imparate si dimenticano.
  // Una categoria di partenza resta come segnaposto «eliminata», se no tornerebbe alla prossima versione.
  function eliminaCategoria(tipo, nome) {
    materializza();
    const lista = stato.categorie[tipo];
    const e = vivaDi(tipo, nome);
    if (!e || e.base === A.RIPIEGO[tipo]) return;
    const rip = ripiegoDi(tipo);
    if (e.base) Object.assign(e, { eliminata: true, nascosta: true, nome: '(eliminata) ' + e.base });
    else lista.splice(lista.indexOf(e), 1);
    for (const m of stato.movimenti) if (m.tipo === tipo && m.categoria === nome) m.categoria = rip;
    for (const r of stato.ricorrenti) if (r.tipo === tipo && r.categoria === nome) r.categoria = rip;
    for (const k of Object.keys(stato.imparate)) {
      const v = stato.imparate[k];
      if (v.tipo === tipo && v.categoria === nome) delete stato.imparate[k];
    }
    if (tipo === 'entrata') stato.tasse.categorie = stato.tasse.categorie.filter(c => c !== nome);
    if (eFiltro(tipo, nome)) vista.filtro = null;
    for (const s of scelte) if (s.categoria === nome) delete s.categoria;
    scrivi();
  }

  // Modulo di una categoria: nome, simbolo, nascondere, eliminare.
  // opz.alSalvare(nome): dopo il salvataggio (chiude il foglio); opz.alTornare(vecchio, nuovo): riapre il foglio di prima.
  function formCategoria(tipo, esistente, opz) {
    opz = opz || {};
    let icona = esistente ? esistente.icona : '•';
    const fine = (vecchio, nuovo) => {
      if (opz.alTornare) opz.alTornare(vecchio, nuovo);
      else { chiudiFoglio(); if (opz.alSalvare && nuovo) opz.alSalvare(nuovo); }
    };
    apriFoglio(esistente ? 'Modifica categoria' : 'Nuova categoria', corpo => {
      if (opz.alTornare) corpo.appendChild(tasto('tasto-piccolo angolo', '‹ Indietro', () => opz.alTornare(null, null)));
      const inp = inputTesto(esistente ? esistente.nome : '');
      inp.id = 'nomeCategoria';
      inp.maxLength = 28;
      inp.placeholder = 'Nome';
      corpo.appendChild(campo('Nome', inp));
      corpo.appendChild(el('div', 'titoletto', 'Simbolo'));
      const g = el('div', 'griglia-emoji');
      const libero = inputTesto('');
      const segna = () => g.querySelectorAll('.emoji').forEach(x => x.setAttribute('aria-pressed', String(x.textContent === icona)));
      const elencoEmoji = EMOJI.includes(icona) ? EMOJI : [icona].concat(EMOJI.slice(0, -1));
      for (const e of elencoEmoji) g.appendChild(tasto('emoji', e, () => { icona = e; libero.value = ''; segna(); }));
      corpo.appendChild(g);
      segna();
      libero.maxLength = 8;
      libero.placeholder = 'Un\'altra emoji';
      libero.addEventListener('input', () => { const s = primoSimbolo(libero.value); if (s) { icona = s; segna(); } });
      corpo.appendChild(campo('Un\'altra emoji', libero));
      const ripiego = esistente && esistente.ripiego;
      let casNascosta = null;
      if (esistente && !ripiego) {
        casNascosta = interruttore('Nascosta', esistente.nascosta);
        corpo.appendChild(casNascosta.etichetta);
      }
      const riga = el('div', 'riga-tasti');
      if (esistente && !ripiego) riga.appendChild(tasto('tasto-pericolo', 'Elimina', () => {
        const n = usiDi(tipo, esistente.nome), f = stato.ricorrenti.filter(r => r.tipo === tipo && r.categoria === esistente.nome).length;
        const rip = ripiegoDi(tipo);
        const cosa = [n ? n + (n === 1 ? ' movimento passa' : ' movimenti passano') : '', f ? f + (f === 1 ? ' fisso passa' : ' fissi passano') : ''].filter(Boolean).join(' e ');
        const via = () => {
          foglioSotto = sotto;
          const prima = JSON.stringify(stato);
          eliminaCategoria(tipo, esistente.nome);
          disegna(); rileggi();
          suonaMovimento('elimina');
          fine(esistente.nome, rip);
          mostraToast('Eliminata «' + esistente.nome + '»', 'Annulla', () => { stato = JSON.parse(prima); scrivi(); disegna(); rileggi(); });
        };
        const sotto = foglioSotto;
        if (!cosa) { via(); return; }
        conferma('Eliminare «' + esistente.nome + '»?', cosa + ' in «' + rip + '».', 'Elimina', via, () => { foglioSotto = sotto; formCategoria(tipo, esistente, opz); });
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        const nome = pulisciNome(inp.value);
        if (!nome) { mostraToast('Scrivi un nome'); inp.focus(); return; }
        if (!nomeLibero(tipo, nome, esistente && esistente.nome)) { mostraToast('Questo nome c\'è già'); inp.focus(); return; }
        if (esistente) {
          rinomina(tipo, esistente.nome, nome, icona);
          if (casNascosta) { const e = vivaDi(tipo, nome); if (e) { e.nascosta = casNascosta.casella.checked; scrivi(); } }
        } else aggiungiCategoria(tipo, nome, icona);
        disegna();
        rileggi();
        fine(esistente ? esistente.nome : null, nome);
      }));
      corpo.appendChild(riga);
      if (!esistente) setTimeout(() => inp.focus(), 50);
    });
  }
  function nuovaCategoria(tipo, alFinire) { formCategoria(tipo, null, { alSalvare: alFinire }); }

  function apriCategorie() {
    apriFoglio('Categorie', corpo => {
      const seg = el('div', 'segmentato largo');
      [['uscita', 'Uscite'], ['entrata', 'Entrate']].forEach(([t, nome]) => {
        const b = tasto('', nome, () => { tipoCategorie = t; apriCategorie(); });
        b.setAttribute('aria-pressed', String(tipoCategorie === t));
        seg.appendChild(b);
      });
      corpo.appendChild(seg);
      corpo.appendChild(el('p', 'nota-su', 'Tocca per modificare.'));
      const lista = el('div', 'elenco-righe');
      for (const c of categorie(tipoCategorie, true)) {
        const r = el('button', 'cat-riga' + (c.nascosta ? ' nascosta' : ''));
        r.type = 'button';
        r.appendChild(el('span', 'cat-icona', c.icona));
        r.appendChild(el('span', 'cat-nome', c.nome + (c.nascosta ? ' · nascosta' : '')));
        const n = usiDi(tipoCategorie, c.nome);
        r.appendChild(el('span', 'cat-usi', n ? String(n) : ''));
        r.appendChild(el('span', 'cat-freccia', '›'));
        r.addEventListener('click', () => formCategoria(tipoCategorie, c, { alTornare: () => apriCategorie() }));
        lista.appendChild(r);
      }
      corpo.appendChild(lista);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', '＋ Aggiungi categoria', () => formCategoria(tipoCategorie, null, { alTornare: () => apriCategorie() })));
      corpo.appendChild(riga);
    });
  }

  // ================================================================ periodo e riepilogo
  // conto: null = tutti insieme, se no il conto che sta guardando (la «seconda modalità» del 15/11/2026)
  // filtro: { tipo, nome } della barra toccata (una categoria può chiamarsi uguale nelle spese e nelle entrate)
  // tutte: per tipo, se le barre oltre le prime sei sono aperte
  const vista = { modo: 'mese', anno: oggi().getFullYear(), mese: oggi().getMonth(), filtro: null, conto: null, tutte: {} };
  const eFiltro = (tipo, nome) => !!vista.filtro && vista.filtro.tipo === tipo && vista.filtro.nome === nome;

  function nelPeriodo(m) {
    return m.data.startsWith(vista.modo === 'anno' ? vista.anno + '-' : vista.anno + '-' + String(vista.mese + 1).padStart(2, '0') + '-');
  }
  // Entrate e uscite della lista. Con un conto: solo quelle di quel conto, e il saldo conta anche gli spostamenti
  // (arrivati qui: più; partiti da qui: meno). Tutti insieme gli spostamenti non contano: restano soldi suoi.
  function totali(lista, conto) {
    const t = { entrate: 0, uscite: 0, tasse: 0, spostati: 0, arrivati: 0, partiti: 0 };
    for (const m of lista) {
      if (eSpostamento(m)) {
        t.spostati += m.importo;
        if (conto && m.verso === conto) t.arrivati += m.importo;
        if (conto && m.da === conto) t.partiti += m.importo;
        continue;
      }
      if (conto && contoDi(m) !== conto) continue;
      if (m.tipo === 'entrata') { t.entrate += m.importo; t.tasse += accantonamento(m); }
      else t.uscite += m.importo;
    }
    t.saldo = t.entrate - t.uscite + (conto ? t.arrivati - t.partiti : 0);
    t.restano = t.saldo - t.tasse;
    return t;
  }
  // si può andare avanti fino al mese corrente, o più in là se ci sono movimenti con date future
  function ultimoMese() {
    let k = chiaveMese(oggi());
    for (const m of stato.movimenti) if (m.data.slice(0, 7) > k) k = m.data.slice(0, 7);
    return k;
  }

  // ---------------------------------------------------------------- confronto col periodo prima (17/11/2026)
  // Sotto entrate e uscite: quanto in più o in meno del mese prima (o dell'anno prima). Il mese in corso si confronta
  // allo stesso giorno («dal 1° al 17 novembre» contro «dal 1° al 17 ottobre»), se no a metà mese sembrerebbe sempre
  // di spendere meno; i fissi del mese contano da tutte e due le parti, anche quelli dopo il 17, come nel numero sopra
  // (che li conta dal 1°): senza, il numero e la percentuale si smentivano. Solo se l'app c'era già all'inizio del
  // periodo di prima (come per la spesa media: primo movimento entro il 7) e, in questa edizione, mai coi mesi di prova.
  function confronto(conto) {
    const ora = oggi(), oggiIso = isoOggi(), due = n => String(n).padStart(2, '0');
    let da1, da0, nome, stessoGiorno;
    // da… fine: il periodo intero; taglio: fin dove contano i movimenti normali (oggi, o lo stesso giorno di prima)
    let fine1, fine0, taglio1, taglio0;
    if (vista.modo === 'anno') {
      stessoGiorno = vista.anno === ora.getFullYear();
      da1 = vista.anno + '-01-01'; fine1 = vista.anno + '-12-31';
      da0 = (vista.anno - 1) + '-01-01'; fine0 = (vista.anno - 1) + '-12-31';
      taglio1 = stessoGiorno ? oggiIso : fine1; taglio0 = stessoGiorno ? (vista.anno - 1) + oggiIso.slice(4) : fine0;
      nome = 'il ' + (vista.anno - 1);
    } else {
      const k = vista.anno + '-' + due(vista.mese + 1);
      const p = vista.mese === 0 ? (vista.anno - 1) + '-12' : vista.anno + '-' + due(vista.mese);
      stessoGiorno = k === chiaveMese(ora);
      da1 = k + '-01'; fine1 = k + '-31';
      da0 = p + '-01'; fine0 = p + '-31';
      taglio1 = stessoGiorno ? oggiIso : fine1; taglio0 = stessoGiorno ? dataNelMese(p, ora.getDate()) : fine0;
      nome = MESI[vista.mese === 0 ? 11 : vista.mese - 1];
    }
    if (da1 > oggiIso || (INIZIO_SUL_SERIO && da0 < INIZIO_SUL_SERIO)) return null;
    // un passaggio solo sui movimenti (con 1500 movimenti e il processore rallentato si sentiva, 17/11/2026)
    const ora_ = [], prima_ = [];
    let primo = '9999';
    for (const m of stato.movimenti) {
      if (!m.ricorrente && m.data < primo) primo = m.data;
      if (m.data >= da1 && m.data <= fine1) { if ((m.data <= taglio1 || m.ricorrente) && tocca(m, conto)) ora_.push(m); }
      else if (m.data >= da0 && m.data <= fine0 && (m.data <= taglio0 || m.ricorrente) && tocca(m, conto)) prima_.push(m);
    }
    if (primo > da0.slice(0, 8) + '07') return null;
    return { ora: totali(ora_, conto), prima: totali(prima_, conto), nome, stessoGiorno };
  }
  function disegnaConfronto(conto) {
    const c = confronto(conto);
    for (const [id, chiave, piuEBene] of [['confEntrate', 'entrate', true], ['confUscite', 'uscite', false]]) {
      const box = $(id);
      const prima = c ? c.prima[chiave] : 0;
      box.hidden = !c || !(prima > 0);
      if (box.hidden) continue;
      const diff = c.ora[chiave] - prima;
      box.textContent = '';
      box.className = 't-confronto';
      if (!diff) { box.textContent = 'come ' + c.nome; continue; }
      const bene = (diff > 0) === piuEBene;
      box.classList.add(bene ? 'bene' : 'male');
      box.appendChild(el('span', 'freccia', diff > 0 ? '▲' : '▼'));
      box.appendChild(document.createTextNode(' ' + percento(Math.abs(diff), prima) + (diff > 0 ? ' in più di ' : ' in meno di ') + c.nome));
      box.title = (c.stessoGiorno ? 'Allo stesso giorno: ' : '') + euro(c.ora[chiave]) + ' contro ' + euro(prima);
      box.setAttribute('aria-label', box.textContent + '. ' + box.title);
    }
  }

  function disegna() {
    const ora = oggi();
    $('oggi').textContent = maiuscola(GIORNI[ora.getDay()]) + ' ' + ora.getDate() + ' ' + MESI[ora.getMonth()];
    disegnaGiornata();
    $('titoloPeriodo').textContent = vista.modo === 'anno' ? String(vista.anno) : maiuscola(MESI[vista.mese]) + ' ' + vista.anno;
    const ultimo = ultimoMese();
    const attuale = vista.anno + '-' + String(vista.mese + 1).padStart(2, '0');
    $('succ').disabled = vista.modo === 'anno' ? vista.anno >= Number(ultimo.slice(0, 4)) : attuale >= ultimo;
    document.querySelectorAll('.periodo .segmentato button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === vista.modo)));

    const conto = vista.conto;
    disegnaSceltaConto();
    const lista = stato.movimenti.filter(m => nelPeriodo(m) && tocca(m, conto));
    const t = totali(lista, conto);
    $('heroEtichetta').textContent = (vista.modo === 'anno' ? 'Saldo del ' + vista.anno : 'Saldo di ' + MESI[vista.mese]) + (conto ? ' ' + inConto(conto) : '');
    $('heroValore').textContent = saldoConSegno(t.saldo);
    let sotto = '';
    if (t.tasse > 0) sotto += ' Tasse da parte ' + euro(t.tasse) + ', restano ' + saldoEuro(t.restano) + '.';
    // i fissi del mese che devono ancora arrivare contano già (dal 10/11/2026): lo si dice
    const oggiIso = isoOggi(), futuri = lista.filter(m => m.data > oggiIso && !eSpostamento(m) && tocca(m, conto));
    if (futuri.length) {
      const u = futuri.filter(m => m.tipo === 'uscita').reduce((a, m) => a + m.importo, 0);
      const e = futuri.filter(m => m.tipo === 'entrata').reduce((a, m) => a + m.importo, 0);
      sotto += ' Di cui in arrivo: ' + [u ? 'uscite ' + euro(u) : '', e ? 'entrate ' + euro(e) : ''].filter(Boolean).join(', ') + '.';
    }
    $('heroSotto').textContent = sotto.trim();
    $('heroSotto').hidden = !sotto.trim();
    $('totEntrate').textContent = euro(t.entrate);
    $('totUscite').textContent = euro(t.uscite);
    disegnaConfronto(conto);
    // gli spostamenti: guardando un conto, da dove sono arrivati e dove sono andati; tutti insieme, che non contano
    const rs = $('riepSpostamenti');
    if (conto && (t.arrivati || t.partiti)) {
      const parti = new Map();
      for (const m of lista) {
        if (!eSpostamento(m)) continue;
        const k = m.verso === conto ? 'da ' + m.da : 'verso ' + m.verso;
        parti.set(k, (parti.get(k) || 0) + m.importo);
      }
      rs.textContent = '↔ ' + [...parti.entries()].map(([k, v]) => {
        const [dir, c] = k.split(' ');
        return (dir === 'da' ? '+' : '−') + euro(v) + ' ' + dir + ' ' + nomeConto(c);
      }).join(' · ');
      rs.hidden = false;
    } else if (!conto && t.spostati) {
      rs.textContent = '↔ Spostati fra i conti: ' + euro(t.spostati);
      rs.hidden = false;
    } else rs.hidden = true;

    const periodoOra = [vista.modo, vista.anno, vista.modo === 'mese' ? vista.mese : '', conto || ''].join('|');
    document.body.classList.toggle('crescono', periodoOra !== periodoBarre);
    periodoBarre = periodoOra;
    disegnaBarre('uscita', lista, t.uscite);
    disegnaBarre('entrata', lista, t.entrate);
    disegnaCalendario(lista);
    $('sezMesi').hidden = vista.modo !== 'anno';
    if (vista.modo === 'anno') disegnaMesi();
    disegnaLista(lista);
    disegnaAutonomia();
    disegnaOcchi();
    disegnaBanner();
    disegnaBannerProva();
  }

  // i due occhi (accanto al saldo del mese e nel riquadro dei saldi) dicono e cambiano la stessa cosa
  function disegnaOcchi() {
    for (const id of ['occhio', 'occhioSaldi']) {
      const b = $(id);
      b.setAttribute('aria-pressed', String(saldoVisibile));
      b.setAttribute('aria-label', saldoVisibile ? 'Nascondi il saldo' : 'Mostra il saldo');
      b.classList.toggle('aperto', saldoVisibile);
    }
    $('occhioSaldi').hidden = $('modSaldo').hidden;   // senza saldi inseriti non c'è niente da nascondere
  }
  // il suono ogni volta che lo scopre (17/11/2026 sera, precisato il 25/11)
  // conto: quello che si guarda (di solito quello della pagina): ogni conto ha il suo suono (18/11/2026)
  function cambiaOcchio(v, conto) {
    const prima = saldoVisibile;
    saldoVisibile = v === undefined ? !saldoVisibile : !!v;
    if (saldoVisibile && !prima) suonaSaldo(conto);
    disegna();
    if (saldoVisibile && !prima) svela($('heroValore'));
  }
  // un'animazione di stile che riparte ogni volta (togliere e rimettere la classe da sole non basta)
  function svela(e, classe) {
    classe = classe || 'svela';
    e.classList.remove(classe);
    void e.offsetWidth;
    e.classList.add(classe);
  }

  // In cima al riepilogo: tutti insieme o un conto solo. Toccando un conto si vede solo quello (entrate, uscite,
  // spostamenti, saldo, categorie, movimenti, anno) e le frasi nuove vanno lì, se non ne nominano un altro.
  function disegnaSceltaConto() {
    document.querySelectorAll('#sceltaConto button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.conto || null) === vista.conto)));
    $('etichettaFrase').textContent = vista.conto ? 'Cosa hai speso o incassato ' + inConto(vista.conto) + '?' : 'Cosa hai speso o incassato?';
  }
  function scegliVistaConto(c) {
    vista.conto = CONTI_ID.includes(c) ? c : null;
    vista.filtro = null;
    rileggi();   // la frase già scritta va nel conto nuovo
    disegna();
  }

  // Le spese per categoria e, dal 24/11/2026, le entrate: «nello stesso identico modo», quindi un disegno solo per tutte e due.
  const BARRE = {
    uscita: { barre: 'barre', titolo: 'titoloCategorie', altre: 'barreAltre', nome: 'Spese', quota: 'delle uscite', vuoto: 'Nessuna spesa in questo periodo.' },
    entrata: { barre: 'barreEntrate', titolo: 'titoloEntrate', altre: 'barreEntrateAltre', nome: 'Entrate', quota: 'delle entrate', vuoto: 'Nessuna entrata in questo periodo.' }
  };
  // su «Tutto», accanto alla categoria, da quali conti: «(digitale, contanti)», dal più pesante (25/11/2026, sua richiesta).
  // Di quanto, si guarda sul conto: per questo niente cifre
  function contiPerCategoria(lista, tipo) {
    const per = new Map();
    for (const m of lista) {
      if (m.tipo !== tipo) continue;
      if (!per.has(m.categoria)) per.set(m.categoria, new Map());
      const c = per.get(m.categoria), id = contoDi(m);
      c.set(id, (c.get(id) || 0) + m.importo);
    }
    return nome => [...(per.get(nome) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([id]) => infoConto(id).nome.toLowerCase());
  }
  // il nome e i suoi conti: se non ci stanno sulla riga, i conti vanno a capo interi
  function nomeEConti(classe, nome, conti) {
    const v = el('span', 'voce-conti');
    v.appendChild(el('span', classe, nome));
    if (conti.length) { v.appendChild(document.createTextNode(' ')); v.appendChild(el('span', 'conti-piccoli', '(' + conti.join(', ') + ')')); }
    return v;
  }
  let periodoBarre = null;   // cambiando mese, anno o conto le barre crescono; salvando o toccandole no
  function disegnaBarre(tipo, lista, totale) {
    const B = BARRE[tipo];
    const ol = $(B.barre), altre = $(B.altre);
    ol.textContent = '';
    $(B.titolo).textContent = B.nome + ' ' + (vista.conto ? inConto(vista.conto) : 'per categoria');
    const somme = new Map();
    for (const m of lista) if (m.tipo === tipo) somme.set(m.categoria, (somme.get(m.categoria) || 0) + m.importo);
    const righe = [...somme.entries()].sort((a, b) => b[1] - a[1]);
    altre.hidden = true;
    if (!righe.length) {
      ol.classList.remove('corte');
      ol.appendChild(el('li', 'vuoto', B.vuoto));
      return;
    }
    const max = righe[0][1];
    const contiDi = vista.conto ? () => [] : contiPerCategoria(lista, tipo);
    const corte = righe.length > 8 && !vista.tutte[tipo] && !righe.slice(6).some(([n]) => eFiltro(tipo, n));
    ol.classList.toggle('corte', corte);
    for (const [nome, cent] of righe) {
      const li = el('li');
      const b = el('button', 'barra-riga');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(eFiltro(tipo, nome)));
      const quota = percento(cent, totale), conti = contiDi(nome);
      b.setAttribute('aria-label', nome + (conti.length ? ', ' + conti.join(' e ') : '') + ': ' + euro(cent) + ', ' + quota + ' ' + B.quota + '. Tocca per vedere i movimenti.');
      // come i movimenti: il simbolo nel suo riquadro; sotto al nome la barra, e accanto alla barra la percentuale
      b.appendChild(riquadro(iconaDi(tipo, nome)));
      const corpo = el('span', 'barra-corpo');
      const testi = el('span', 'barra-testi');
      testi.appendChild(nomeEConti('barra-nome', nome, conti));
      testi.appendChild(el('span', 'barra-valore', euro(cent)));
      corpo.appendChild(testi);
      const sotto = el('span', 'barra-sotto');
      const pista = el('span', 'barra-pista');
      const segno = el('span', 'barra-segno');
      segno.style.width = Math.max(1, cent / max * 100) + '%';
      pista.appendChild(segno);
      sotto.appendChild(pista);
      sotto.appendChild(el('span', 'barra-quota', quota));
      corpo.appendChild(sotto);
      b.appendChild(corpo);
      b.addEventListener('click', () => { vista.filtro = eFiltro(tipo, nome) ? null : { tipo, nome }; disegna(); });
      li.appendChild(b);
      ol.appendChild(li);
    }
    altre.hidden = righe.length <= 8 || (!corte && !vista.tutte[tipo]);
    altre.textContent = corte ? 'Altre ' + (righe.length - 6) + ' categorie ›' : 'Solo le prime';
  }

  // ================================================================ il calendario del mese (26/11/2026, sua scelta)
  // Solo nel mese: un riquadro per giorno, da lunedì, con le uscite del giorno e, in verde, le entrate. Più ha speso, più il
  // riquadro è pieno (un colore solo, come il grafico dell'anno). Oggi cerchiato; i giorni che devono ancora venire (i fissi
  // in arrivo) in corsivo. Segue il conto che guarda e la categoria toccata. Toccando un giorno, i suoi movimenti.
  // al massimo quattro segni, perché ci stia anche sull'iPhone più stretto: 4,50 · 85 · 1,2k · 35k · 940k · 1,2M
  function cifraCorta(cent) {
    const e = cent / 100;
    if (e >= 999500) return (Math.round(e / 100000) / 10).toLocaleString('it-IT') + 'M';
    if (e >= 9950) return Math.round(e / 1000) + 'k';
    if (e >= 1000) return (Math.round(e / 100) / 10).toLocaleString('it-IT') + 'k';
    if (e >= 10) return String(Math.round(e));
    return e.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function disegnaCalendario(lista) {
    const sez = $('sezCalendario');
    sez.hidden = vista.modo !== 'mese';
    if (sez.hidden) return;
    const conto = vista.conto, f = vista.filtro;
    const k = vista.anno + '-' + String(vista.mese + 1).padStart(2, '0');
    const quanti = new Date(vista.anno, vista.mese + 1, 0).getDate();
    const per = new Map();
    for (const m of lista) {
      if (eSpostamento(m) || (conto && contoDi(m) !== conto)) continue;
      if (f && (m.tipo !== f.tipo || m.categoria !== f.nome)) continue;
      const g = Number(m.data.slice(8, 10));
      const x = per.get(g) || { u: 0, e: 0 };
      if (m.tipo === 'entrata') x.e += m.importo; else x.u += m.importo;
      per.set(g, x);
    }
    // un mese senza niente (il 1° dicembre, appena ripartito da vuoto): niente griglia di riquadri vuoti (27/11/2026)
    sez.hidden = !per.size;
    if (sez.hidden) return;
    $('titoloCalendario').textContent = 'Giorno per giorno' + (f ? ' · ' + f.nome : '');
    const box = $('calendario');
    box.textContent = '';
    const primo = (new Date(vista.anno, vista.mese, 1).getDay() + 6) % 7;   // lunedì = 0
    for (let i = 0; i < primo; i++) box.appendChild(el('span', 'cal-vuoto'));
    let max = 0;
    for (const x of per.values()) if (x.u > max) max = x.u;
    const oggiIso = isoOggi();
    // i giorni senza spese si contano da quando segna (il primo movimento), non da prima
    let inizio = '9999';
    for (const m of stato.movimenti) if (m.data < inizio) inizio = m.data;
    let caro = null, senza = 0;
    for (let g = 1; g <= quanti; g++) {
      const iso = k + '-' + String(g).padStart(2, '0'), x = per.get(g);
      const b = el('button', 'cal-giorno');
      b.type = 'button';
      b.dataset.giorno = iso;
      if (iso === oggiIso) b.classList.add('oggi');
      if (iso > oggiIso) b.classList.add('futuro');
      b.appendChild(el('span', 'cal-numero', String(g)));
      const nome = GIORNI[daIso(iso).getDay()] + ' ' + g + ' ' + MESI[vista.mese];
      if (x) {
        if (x.u) { b.appendChild(el('span', 'cal-uscite', cifraCorta(x.u))); b.style.setProperty('--calore', (x.u / max).toFixed(3)); b.classList.add('speso'); }
        if (x.e) b.appendChild(el('span', 'cal-entrate', '+' + cifraCorta(x.e)));
        b.setAttribute('aria-label', nome + ': ' + [x.u ? 'uscite ' + euro(x.u) : '', x.e ? 'entrate ' + euro(x.e) : ''].filter(Boolean).join(', '));
        b.addEventListener('click', () => apriMovimenti({ periodo: 'scelto', da: iso, a: iso, conto, categoria: f ? { tipo: f.tipo, nome: f.nome } : null }));
        if (x.u && (!caro || x.u > caro.u)) caro = { g, u: x.u, iso };
      } else {
        b.disabled = true;
        b.setAttribute('aria-label', nome + ': niente');
      }
      if (iso <= oggiIso && iso >= inizio && !(x && x.u)) senza++;
      box.appendChild(b);
    }
    // sotto: il giorno più caro e quanti giorni senza spese (fino a oggi)
    const parti = [];
    if (caro) parti.push('Più caro: ' + GIORNI_BREVI[daIso(caro.iso).getDay()] + ' ' + caro.g + ', ' + euro(caro.u));
    if (senza && !f) parti.push('senza spese: ' + (senza === 1 ? '1 giorno' : senza + ' giorni'));
    $('calNota').textContent = parti.join(' · ');
    $('calNota').hidden = !parti.length;
  }

  function disegnaMesi() {
    const tb = $('righeMesi');
    tb.textContent = '';
    const ultimo = ultimoMese();
    const finoA = vista.anno < Number(ultimo.slice(0, 4)) ? 11 : Number(ultimo.slice(5, 7)) - 1;
    let righe = 0;
    const perMese = new Map(), anno = vista.anno + '-';
    for (const m of stato.movimenti) {
      if (!m.data.startsWith(anno) || !tocca(m, vista.conto)) continue;
      const x = Number(m.data.slice(5, 7)) - 1;
      if (!perMese.has(x)) perMese.set(x, []);
      perMese.get(x).push(m);
    }
    disegnaGrafico(perMese, finoA);
    for (let mm = finoA; mm >= 0; mm--) {
      const lista = perMese.get(mm) || [];
      if (!lista.length) continue;   // i mesi senza movimenti non si mostrano
      righe++;
      const t = totali(lista, vista.conto);
      const tr = el('tr', 'cliccabile');
      tr.tabIndex = 0;
      tr.appendChild(el('td', '', maiuscola(MESI[mm])));
      tr.appendChild(el('td', '', euro(t.entrate)));
      tr.appendChild(el('td', '', euro(t.uscite)));
      tr.appendChild(el('td', '', saldoConSegno(t.saldo)));
      const apri = () => { vista.modo = 'mese'; vista.mese = mm; vista.filtro = null; disegna(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
      tr.addEventListener('click', apri);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') apri(); });
      tb.appendChild(tr);
    }
    if (!righe) {
      const tr = el('tr');
      const td = el('td', 'vuoto', 'Nessun movimento' + (vista.conto ? ' ' + inConto(vista.conto) : '') + ' nel ' + vista.anno + '.');
      td.colSpan = 4;
      td.style.textAlign = 'left';
      tr.appendChild(td);
      tb.appendChild(tr);
    }
  }

  // Il grafico dell'anno (17/11/2026): le uscite mese per mese, una colonna per mese, un colore solo, il mese in corso
  // più scuro. Niente numeri sulle colonne (non ci stanno al centesimo): sotto, il mese più caro e la media; tutti gli
  // altri nella tabella. Toccando un mese si apre.
  const INIZIALI = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];
  function disegnaGrafico(perMese, finoA) {
    const box = $('graficoColonne');
    box.textContent = '';
    $('graficoTitolo').textContent = 'Uscite' + (vista.conto ? ' ' + inConto(vista.conto) : '');
    const valori = INIZIALI.map((_, mm) => (perMese.get(mm) || []).reduce((a, m) => a + (m.tipo === 'uscita' && (!vista.conto || contoDi(m) === vista.conto) ? m.importo : 0), 0));
    const max = Math.max(...valori);
    $('grafico').hidden = !(max > 0);
    if (!(max > 0)) return;
    const qui = vista.anno === oggi().getFullYear() ? oggi().getMonth() : -1;
    valori.forEach((v, mm) => {
      const b = el('button', 'colonna' + (mm === qui ? ' corrente' : ''));
      b.type = 'button';
      b.disabled = mm > finoA || !(perMese.get(mm) || []).length;
      b.setAttribute('aria-label', maiuscola(MESI[mm]) + ': uscite ' + euro(v) + (b.disabled ? '' : '. Tocca per aprire il mese.'));
      const pista = el('span', 'colonna-pista');
      const barra = el('span', 'colonna-barra');
      barra.style.height = v ? Math.max(2, v / max * 100) + '%' : '0';
      pista.appendChild(barra);
      b.appendChild(pista);
      b.appendChild(el('span', 'colonna-mese', INIZIALI[mm]));
      b.addEventListener('click', () => { vista.modo = 'mese'; vista.mese = mm; vista.filtro = null; disegna(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      box.appendChild(b);
    });
    // i mesi con dei movimenti, quello in corso escluso (è a metà): la media è di quelli interi
    const interi = valori.map((v, mm) => [v, mm]).filter(([, mm]) => mm !== qui && mm <= finoA && (perMese.get(mm) || []).length);
    const piuCaro = valori.indexOf(max);
    let nota = 'Il mese più caro: ' + MESI[piuCaro] + ', ' + euro(max) + '.';
    if (interi.length >= 2) nota += ' Media dei mesi finiti: ' + euro(Math.round(interi.reduce((a, [v]) => a + v, 0) / interi.length)) + '.';
    $('graficoNota').textContent = nota;
  }

  // Gli ultimi movimenti (17/11/2026 sera, Francesco: «con il tempo diventerà sempre più grande… basta una piccola tabella
  // con gli ultimi 10 movimenti, come sulle app bancarie, e poi tutti i movimenti dal… al…»). Qui i 10 più recenti del
  // periodo che guarda (sopra, quelli in arrivo del mese), e sotto il tasto per la vista completa (apriMovimenti).
  const ULTIMI = 10;
  function disegnaLista(lista) {
    const cont = $('lista');
    cont.textContent = '';
    const filtro = $('filtro');
    $('titoloMovimenti').textContent = 'Ultimi movimenti' + (vista.conto ? ' ' + inConto(vista.conto) : '');
    filtro.hidden = !vista.filtro;
    if (vista.filtro) filtro.textContent = 'Solo ' + vista.filtro.nome;
    let righe = vista.filtro ? lista.filter(m => eFiltro(m.tipo, m.categoria)) : lista;
    righe = righe.slice().sort(piuRecenti);
    const oggiIso = isoOggi();
    const inArrivo = righe.filter(m => m.data > oggiIso), fatti = righe.filter(m => m.data <= oggiIso);
    const mostrati = inArrivo.concat(fatti.slice(0, ULTIMI));
    const bt = $('tuttiMovimenti');
    bt.hidden = !stato.movimenti.length;
    bt.querySelector('small').textContent = fatti.length > ULTIMI
      ? ULTIMI + ' di ' + fatti.length
      : '';
    if (!mostrati.length) {
      cont.appendChild(el('p', 'vuoto', stato.movimenti.length ? 'Nessun movimento' + (vista.conto ? ' ' + inConto(vista.conto) : '') + ' in questo periodo.'
        : 'Ancora nessun movimento.'));
      if (iconaNuova()) {   // i dati della vecchia arrivano dagli appunti
        const b = tasto('tasto-secondario', '📥 Incolla dalla vecchia icona', incollaDallaVecchia);
        b.id = 'incollaTraslocoLista';
        b.style.marginTop = '10px';
        cont.appendChild(b);
      }
      return;
    }
    let giorno = null;
    for (const m of mostrati) {
      if (m.data !== giorno) {
        giorno = m.data;
        const futuro = m.data > oggiIso;
        cont.appendChild(titoloGiorno(m.data, futuro, spesoNelGiorno(righe, m.data, vista.conto)));
      }
      cont.appendChild(rigaMovimento(m));
    }
  }
  // la data e, a destra, quanto si è speso quel giorno (24/11/2026)
  function titoloGiorno(data, futuro, speso) {
    const t = el('div', 'giorno-titolo' + (futuro ? ' in-arrivo' : ''));
    t.appendChild(el('span', '', (futuro ? 'In arrivo · ' : '') + etichettaGiorno(data)));
    if (speso) t.appendChild(el('span', 'giorno-totale', '−' + euro(speso)));
    return t;
  }
  const spesoNelGiorno = (lista, data, conto) => lista.reduce((a, m) => a + (m.data === data && m.tipo === 'uscita' && (!conto || contoDi(m) === conto) ? m.importo : 0), 0);
  const piuRecenti = (a, b) => b.data.localeCompare(a.data) || (b.creato || '').localeCompare(a.creato || '');

  // ritorno (facoltativo): nella vista «Tutti i movimenti», dopo averlo modificato si torna lì. conto: quello che
  // si guarda (lì può essere diverso da quello della pagina); senza conto, il simbolo del conto su ogni riga
  // il simbolo nel suo riquadro; il puntino delle categorie senza simbolo, più grande
  const riquadro = icona => el('span', 'mov-icona' + (icona === '•' ? ' punto' : ''), icona);
  function rigaMovimento(m, ritorno, conto) {
    const b = el('button', 'mov');
    b.type = 'button';
    b.dataset.id = m.id;
    const spost = eSpostamento(m);
    b.appendChild(riquadro(spost ? '↔' : iconaDi(m.tipo, m.categoria)));
    const testi = el('span', 'mov-testi');
    testi.appendChild(el('span', 'mov-desc', m.descrizione));
    // il conto: per gli spostamenti da… a…; tutti insieme, il simbolo del conto
    if (conto === undefined) conto = vista.conto;
    let sotto = spost ? etichettaConto(m) : m.categoria + (conto ? '' : ' · ' + infoConto(contoDi(m)).icona);
    const acc = accantonamento(m);
    if (acc) sotto += ' · tasse ' + euro(acc);
    if (m.ricorrente) sotto += ' · fisso';
    if (m.data > isoOggi()) { b.classList.add('in-arrivo'); sotto += ' · in arrivo'; }
    testi.appendChild(el('span', 'mov-cat', sotto));
    b.appendChild(testi);
    // uno spostamento, guardando un conto: più se arriva qui, meno se parte da qui; tutti insieme, senza segno
    let segno = segnoDi(m.tipo), classe = m.tipo;
    if (spost) {
      segno = conto ? (m.verso === conto ? '+' : '−') : '';
      classe = 'spostamento' + (conto && m.verso === conto ? ' entrata' : '');
    }
    b.appendChild(el('span', 'mov-importo ' + classe, segno + euro(Math.abs(m.importo))));
    b.setAttribute('aria-label', m.descrizione + ', ' + sotto + ', ' + etichettaTipo(m.tipo) + ' ' + euro(Math.abs(m.importo)) + '. Tocca per modificare.');
    b.addEventListener('click', () => { if (ritorno) ritorno.prima(); modifica(m.id, ritorno ? ritorno.dopo : null); });
    return b;
  }

  // ================================================================ modifica di un movimento
  // dopo: dopo aver salvato (dalla ricerca: si torna ai risultati). Dopo Elimina no, se no sparirebbe «Annulla».
  function modifica(id, dopo) {
    const orig = stato.movimenti.find(m => m.id === id);
    if (!orig) return;
    const bozza = copiaConto({ tipo: orig.tipo, categoria: orig.categoria, data: orig.data, descrizione: orig.descrizione,
      importo: Math.abs(orig.importo), ripeti: false, giorno: daIso(orig.data).getDate() }, orig);
    const fissoDi = () => orig.ricorrente && stato.ricorrenti.find(r => r.id === orig.ricorrente);
    const ridisegna = () => { foglioSotto = null; disegnaModifica(); };
    const disegnaModifica = () => apriFoglio('Modifica movimento', corpo => {
      // quello che ha scritto resta anche passando da un altro foglio (se è scritto male, lo dice Salva)
      const inImp = inputTesto(bozza.scritto !== undefined ? bozza.scritto : formatoPerCampo(bozza.importo), 'decimal');
      inImp.id = 'modImporto';
      const inDesc = inputTesto(bozza.descrizione);
      inDesc.id = 'modDescrizione';
      const leggiCampi = () => {
        const v = leggiEuro(inImp.value);
        bozza.scritto = inImp.value;
        bozza.importo = v === null ? 0 : v;   // prima un importo scritto male si ignorava e restava quello vecchio (24/11/2026)
        bozza.descrizione = inDesc.value.trim();
      };
      const g = el('div', 'chips');
      g.appendChild(tasto('chip scambia', etichettaTipo(bozza.tipo), () => {
        leggiCampi();
        scegliTipo(bozza, tipo => {
          if (eSpostamento(bozza)) { bozza.conto = bozza.da; delete bozza.da; delete bozza.verso; }   // resta dov'era partito
          bozza.tipo = tipo;
          if (!valida(tipo, bozza.categoria)) bozza.categoria = ripiegoDi(tipo);
          ridisegna();
        });
      }));
      const chipK = tasto('chip chip-conto', etichettaConto(bozza), () => {
        leggiCampi();
        foglioSotto = ridisegna;
        scegliConto(bozza, n => {
          if (n.tipo === 'spostamento') { bozza.tipo = 'spostamento'; bozza.categoria = A.SPOSTAMENTO; }
          else if (eSpostamento(bozza)) { bozza.tipo = n.tipo; bozza.categoria = ripiegoDi(n.tipo); }
          copiaConto(bozza, n);
          ridisegna();
        });
      });
      chipK.id = 'modConto';
      g.appendChild(chipK);
      if (!eSpostamento(bozza)) g.appendChild(tasto('chip', iconaDi(bozza.tipo, bozza.categoria) + ' ' + bozza.categoria, () => {
        leggiCampi();
        foglioSotto = ridisegna;
        scegliCategoria(bozza.tipo, bozza.categoria, nome => { bozza.categoria = nome; ridisegna(); });
      }));
      g.appendChild(tasto('chip', etichettaQuando(bozza), () => {
        leggiCampi();
        foglioSotto = ridisegna;
        // la spesa ricorrente si sceglie qui solo se non è già un fisso (per quelli c'è il tasto sotto)
        scegliData(bozza.data, iso => { bozza.data = iso; ridisegna(); },
          fissoDi() ? null : { acceso: bozza.ripeti, giorno: bozza.giorno, senzaInizio: true,
            alCambiare: v => { bozza.ripeti = v.acceso; bozza.giorno = v.giorno; } });
      }));
      corpo.appendChild(g);
      if (!orig.ricorrente && !bozza.ripeti && bozza.data > isoOggi()) corpo.appendChild(el('p', 'avviso', 'La data è nel futuro: controllala.'));
      corpo.appendChild(campo('Importo in euro', inImp));
      corpo.appendChild(campo('Descrizione', inDesc));
      if (orig.testo) corpo.appendChild(el('p', 'nota', 'Frase originale: «' + orig.testo + '»'));

      // applica al movimento quello che è scritto nel foglio; false se l'importo non va
      const applica = () => {
        leggiCampi();
        if (!(bozza.importo > 0)) { mostraToast('Importo non valido'); inImp.focus(); return false; }
        const spost = eSpostamento(bozza) || eSpostamento(orig);
        if (!spost && (bozza.tipo !== orig.tipo || bozza.categoria !== orig.categoria)) impara(bozza.descrizione, bozza.tipo, bozza.categoria);
        if (!spost && contoDi(bozza) !== contoDi(orig)) imparaConto(bozza.descrizione, contoDi(bozza));
        Object.assign(orig, {
          tipo: bozza.tipo, categoria: bozza.categoria, data: bozza.data, descrizione: bozza.descrizione || bozza.categoria,
          importo: bozza.importo, modificato: new Date().toISOString()
        });
        copiaConto(orig, bozza);
        return true;
      };
      const fisso = fissoDi();
      const rip = tasto('tasto-secondario', fisso ? '🔁 Fisso: ogni ' + fisso.giorno + ' del mese · Modifica' : '🔁 Ripeti ogni mese', () => {
        if (fisso) { apriFisso(fisso); return; }
        if (!applica()) return;
        chiudiFoglio();
        ripetiOgniMese(orig, bozza.giorno);   // salva lui
      });
      rip.style.marginTop = '14px';
      corpo.appendChild(rip);

      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-pericolo', 'Elimina', () => {
        leggiCampi();
        conferma('Eliminare «' + orig.descrizione + '»?', segnoDi(orig.tipo) + euro(Math.abs(orig.importo)) + ' · ' + etichettaGiorno(orig.data), 'Elimina', () => {
          const i = stato.movimenti.findIndex(m => m.id === id);
          if (i < 0) return;
          const tolto = stato.movimenti.splice(i, 1)[0];
          scrivi();
          disegna();
          suonaMovimento('elimina');
          mostraToast('Eliminato', 'Annulla', () => { stato.movimenti.push(tolto); scrivi(); disegna(); });
        }, ridisegna);
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        if (!applica()) return;
        if (bozza.ripeti && !fissoDi()) { chiudiFoglio(); ripetiOgniMese(orig, bozza.giorno); return; }   // salva lui
        scrivi();
        chiudiFoglio();
        disegna();
        suonaMovimento(orig.tipo);   // Salva suona sempre, non solo la prima volta (24/11/2026)
        if (dopo) { dopo(); return; }
        mostraToast('Modifica salvata');
      }));
      corpo.appendChild(riga);
    });
    ridisegna();
  }

  // ================================================================ esporta e importa
  // Due testi, dal 10/11/2026:
  //  - «per l'AI»: righe data;tipo;importo;categoria;descrizione;id;conto + righe «#» con le impostazioni.
  //    Dal 15/11/2026 c'è la colonna del conto (contanti, digitale, cripto; per gli spostamenti «da>verso»).
  //    È anche la copia di sicurezza: «Importa da testo» la rimette su un telefono nuovo.
  //  - «da condividere»: un riassunto semplice da leggere (totali, categorie, movimenti giorno per giorno).
  // Tutti e due per il periodo scelto (da… a…). Senza periodo: tutti i movimenti.
  const ordinaMov = l => l.slice().sort((a, b) => a.data.localeCompare(b.data) || (a.creato || '').localeCompare(b.creato || ''));
  const nelTratto = (da, a) => m => (!da || m.data >= da) && (!a || m.data <= a);

  function testoEsportazione(da, a) {
    const righe = ordinaMov(stato.movimenti.filter(nelTratto(da, a)));
    const pulisci = s => String(s || '').replace(/[;\r\n]+/g, ' ').trim();
    const out = [];
    out.push('# Conti — esportazione del ' + new Date().toLocaleString('it-IT') + ' — ' + righe.length + ' movimenti' +
      (da || a ? ' — periodo ' + (da || 'inizio') + ' → ' + (a || 'oggi') : '') + ' — app ' + VERSIONE);
    out.push('data;tipo;importo;categoria;descrizione;id;conto');
    for (const m of righe) out.push([m.data, m.tipo, (m.importo / 100).toFixed(2), pulisci(m.categoria), pulisci(m.descrizione), m.id,
      eSpostamento(m) ? m.da + '>' + m.verso : contoDi(m)].join(';'));
    out.push('#schema ' + SCHEMA);
    out.push('#imparate ' + JSON.stringify(stato.imparate));
    out.push('#fissi ' + JSON.stringify(stato.ricorrenti));
    out.push('#categorie ' + JSON.stringify(stato.categorie));
    out.push('#saldi ' + JSON.stringify(stato.saldi));
    out.push('#conti ' + JSON.stringify(stato.imparatiConti));
    // quando sono stati segnati i movimenti dal giorno del saldo più vecchio in poi: dello stesso giorno del saldo
    // contano solo quelli segnati dopo, e importandoli senza l'ora contavano tutti (trovato il 15/11/2026)
    const dalSaldo = CONTI_ID.map(c => stato.saldi[c] && stato.saldi[c].data).filter(Boolean).sort()[0];
    if (dalSaldo) out.push('#creati ' + JSON.stringify(Object.fromEntries(righe.filter(m => m.data >= dalSaldo && m.creato).map(m => [m.id, m.creato]))));
    out.push('#tasse ' + JSON.stringify(stato.tasse));
    out.push('#legami ' + JSON.stringify(Object.fromEntries(righe.filter(m => m.ricorrente).map(m => [m.id, m.ricorrente]))));
    return out.join('\n');
  }

  // «dal 1° al 10 novembre 2026», «dall'8 al 30 novembre», «dal 28 ottobre al 3 novembre 2026»
  function testoPeriodo(da, a) {
    const d1 = daIso(da), d2 = daIso(a);
    const n = d => (d.getDate() === 1 ? '1°' : String(d.getDate()));
    const dal = d => (d.getDate() === 8 || d.getDate() === 11 ? 'dall\'' : 'dal ') + n(d);
    const al = d => (d.getDate() === 8 || d.getDate() === 11 ? 'all\'' : 'al ') + n(d);
    const mese = d => MESI[d.getMonth()];
    if (da === a) return 'Il ' + n(d1) + ' ' + mese(d1) + ' ' + d1.getFullYear();
    if (d1.getFullYear() !== d2.getFullYear()) return maiuscola(dal(d1)) + ' ' + mese(d1) + ' ' + d1.getFullYear() + ' ' + al(d2) + ' ' + mese(d2) + ' ' + d2.getFullYear();
    if (d1.getMonth() === d2.getMonth()) return maiuscola(dal(d1)) + ' ' + al(d2) + ' ' + mese(d2) + ' ' + d2.getFullYear();
    return maiuscola(dal(d1)) + ' ' + mese(d1) + ' ' + al(d2) + ' ' + mese(d2) + ' ' + d2.getFullYear();
  }

  function testoLeggibile(da, a) {
    const righe = ordinaMov(stato.movimenti.filter(nelTratto(da, a)));
    const primo = da || (righe[0] ? righe[0].data : isoOggi());
    const ultimo = a || (righe.length ? righe[righe.length - 1].data : isoOggi());
    const t = totali(righe);
    const out = [ED.titolo, testoPeriodo(primo, ultimo), ''];
    if (!righe.length) { out.push('Nessun movimento in questo periodo.'); return out.join('\n'); }
    out.push('Entrate: +' + euro(t.entrate));
    out.push('Uscite: −' + euro(t.uscite));
    out.push('Saldo: ' + conSegno(t.saldo));
    if (t.spostati) out.push('Spostati fra i conti: ' + euro(t.spostati) + ' (non contano)');
    // per conto (15/11/2026): solo quelli che hanno qualcosa
    const perConto = A.CONTI.map(c => [c, totali(righe.filter(m => tocca(m, c.id)), c.id)])
      .filter(([, x]) => x.entrate || x.uscite || x.arrivati || x.partiti);
    if (perConto.length > 1 || (perConto.length === 1 && perConto[0][0].id !== A.CONTO_BASE)) {
      out.push('', 'Per conto');
      for (const [c, x] of perConto) {
        out.push(c.icona + ' ' + c.nome + ': ' + [x.entrate ? 'entrate +' + euro(x.entrate) : '', x.uscite ? 'uscite −' + euro(x.uscite) : '',
          x.arrivati ? 'spostati qui +' + euro(x.arrivati) : '', x.partiti ? 'spostati via −' + euro(x.partiti) : ''].filter(Boolean).join(', '));
      }
    }
    for (const [tipo, titolo, tot] of [['uscita', 'Uscite per categoria', t.uscite], ['entrata', 'Entrate per categoria', t.entrate]]) {
      const somme = new Map();
      for (const m of righe) if (m.tipo === tipo) somme.set(m.categoria, (somme.get(m.categoria) || 0) + m.importo);
      if (!somme.size) continue;
      out.push('', titolo);
      for (const [nome, cent] of [...somme.entries()].sort((x, y) => y[1] - x[1])) {
        out.push(iconaDi(tipo, nome) + ' ' + nome + ': ' + euro(cent) + ' (' + percento(cent, tot) + ')');
      }
    }
    out.push('', 'Movimenti (' + righe.length + ')');
    const anni = new Set(righe.map(m => m.data.slice(0, 4))).size > 1;
    let giorno = null;
    for (const m of righe) {
      if (m.data !== giorno) {
        giorno = m.data;
        const d = daIso(m.data);
        out.push('', maiuscola(GIORNI[d.getDay()]) + ' ' + d.getDate() + ' ' + MESI[d.getMonth()] + (anni ? ' ' + d.getFullYear() : ''));
      }
      out.push(eSpostamento(m)
        ? '↔ ' + euro(m.importo) + ' · ' + m.descrizione + ' (' + etichettaConto(m) + ')' + (m.ricorrente ? ' 🔁' : '')
        : segnoDi(m.tipo) + euro(m.importo) + ' · ' + m.descrizione + ' (' + m.categoria + ' · ' + nomeConto(contoDi(m)) + ')' + (m.ricorrente ? ' 🔁' : ''));
    }
    return out.join('\n');
  }

  function segnaBackup() { stato.ultimoBackup = new Date().toISOString(); scrivi(); disegnaBanner(); }

  async function copiaTesto(testo) {
    try {
      await navigator.clipboard.writeText(testo);
      return true;
    } catch (e) {
      const ta = el('textarea');
      ta.value = testo;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, testo.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function importaTesto(testo) {
    const esito = { aggiunti: 0, presenti: 0, scartati: 0 };
    const vuota = !stato.movimenti.length;
    const ids = new Set(stato.movimenti.map(m => m.id));
    const tipi = new Set(TIPI_DATI.concat('spostamento'));
    const meta = {};
    const righe = [];
    for (const riga of String(testo).split(/\r?\n/)) {
      const r = riga.trim();
      if (!r) continue;
      const m = r.match(/^#(schema|imparate|fissi|categorie|saldo|saldi|conti|creati|tasse|legami|preferenze) (.*)$/);
      if (m) { try { meta[m[1]] = JSON.parse(m[2]); } catch (e) { /* riga rovinata: si ignora */ } continue; }
      // anche l'intestazione con davanti il titolo della condivisione («Conti # Conti — esportazione…»)
      if (r.startsWith('#') || r.startsWith('data;') || /#\s*Conti — esportazione/.test(r)) continue;
      righe.push(r);
    }
    // prima le impostazioni, tradotte come i dati vecchi se vengono da una versione di prima (vedi migra)
    const imp = migra({
      movimenti: [], schema: meta.schema || 1,
      ricorrenti: Array.isArray(meta.fissi) ? meta.fissi.filter(r => r && r.id) : [],
      imparate: meta.imparate && typeof meta.imparate === 'object' ? meta.imparate : {},
      categorie: meta.categorie && typeof meta.categorie === 'object' ? meta.categorie : null,
      tasse: Object.assign(vuoto().tasse, meta.tasse && typeof meta.tasse === 'object' ? meta.tasse : {})
    });
    if (!Array.isArray(imp.tasse.categorie)) imp.tasse.categorie = [];
    Object.assign(stato.imparate, imp.imparate);
    if (imp.categorie && !stato.categorie) stato.categorie = imp.categorie;
    // i saldi: per conto dal 15/11/2026; prima uno solo («#saldo»), che va in Digitale
    if (meta.saldi && typeof meta.saldi === 'object') {
      for (const c of CONTI_ID) if (!stato.saldi[c] && meta.saldi[c] && typeof meta.saldi[c].importo === 'number') stato.saldi[c] = meta.saldi[c];
      if (meta.saldi.daDividere && stato.saldi.digitale === meta.saldi.digitale) stato.saldi.daDividere = true;
    } else if (meta.saldo && !CONTI_ID.some(c => stato.saldi[c])) sistemaSaldi(stato, meta.saldo);
    if (meta.conti && typeof meta.conti === 'object') for (const [k, v] of Object.entries(meta.conti)) if (CONTI_ID.includes(v)) stato.imparatiConti[k] = v;
    if (meta.tasse && !stato.tasse.attiva) stato.tasse = imp.tasse;
    const presenti = new Set(stato.ricorrenti.map(r => r.id));
    for (const r of imp.ricorrenti) if (!presenti.has(r.id) && tipi.has(r.tipo) && r.importo) stato.ricorrenti.push(copiaConto(r, r));
    // dal trasloco su un'icona nuova: lo sfondo scelto nella vecchia, se questa è ancora vuota
    if (vuota && meta.preferenze && typeof meta.preferenze.sfondo === 'string' && meta.preferenze.sfondo !== pref.sfondo) {
      pref.sfondo = meta.preferenze.sfondo;
      scriviPref();
      applicaSfondo();
    }
    const legami = meta.legami && typeof meta.legami === 'object' ? meta.legami : {};
    const creati = meta.creati && typeof meta.creati === 'object' ? meta.creati : {};
    for (const r of righe) {
      const c = r.split(';');
      if (c.length < 5) { esito.scartati++; continue; }
      let [data, tipo, importo, categoria, descrizione] = c.map(x => x.trim());
      let id = (c[5] || '').trim();
      let n = parseFloat(importo.replace(',', '.'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !isFinite(n) || n === 0) { esito.scartati++; continue; }
      // righe delle versioni di prima: investimenti e nomi vecchi
      if (tipo === 'investimento') {
        if (n < 0) { tipo = 'entrata'; n = -n; categoria = nomeDaBase('entrata', A.RITIRATO); }
        else { tipo = 'uscita'; categoria = nomeDaBase('uscita', A.INVESTIMENTI); }
      } else if (A.RINOMINATE[tipo] && A.RINOMINATE[tipo][categoria]) categoria = nomeDaBase(tipo, A.RINOMINATE[tipo][categoria]);
      if (!tipi.has(tipo)) { esito.scartati++; continue; }
      // il conto: settima colonna dal 15/11/2026 (prima non c'era: Digitale)
      const contoCol = (c[6] || '').trim();
      let conti = null;
      if (tipo === 'spostamento') {
        const [da, verso] = contoCol.split('>');
        if (!CONTI_ID.includes(da) || !CONTI_ID.includes(verso) || da === verso) { esito.scartati++; continue; }
        conti = { tipo, da, verso };
      } else conti = { conto: CONTI_ID.includes(contoCol) ? contoCol : A.CONTO_BASE };
      if (!id) id = 'imp-' + hash(r);
      if (ids.has(id)) { esito.presenti++; continue; }
      let cat = A.SPOSTAMENTO;
      if (tipo !== 'spostamento') {
        cat = pulisciNome(categoria) || ripiegoDi(tipo);
        const uguale = categorie(tipo, true).find(x => A.normalizza(x.nome) === A.normalizza(cat));
        if (uguale) cat = uguale.nome;
        else aggiungiCategoria(tipo, cat, '•');
      }
      const creato = typeof creati[id] === 'string' ? creati[id] : new Date().toISOString();
      const mov = copiaConto({ id, data, tipo, importo: Math.round(Math.abs(n) * 100), categoria: cat, descrizione: descrizione || cat, creato, importato: true }, conti);
      if (legami[id]) mov.ricorrente = legami[id];
      stato.movimenti.push(mov);
      ids.add(id);
      esito.aggiunti++;
    }
    scrivi();
    return esito;
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  // Il foglio «Esporta e condividi»: periodo (da… a…), poi le tre azioni.
  function apriEsporta(iniziale) {
    const d = oggi();
    const tratti = {
      mese: () => [A.isoDa(new Date(d.getFullYear(), d.getMonth(), 1)), isoOggi()],
      scorso: () => [A.isoDa(new Date(d.getFullYear(), d.getMonth() - 1, 1)), A.isoDa(new Date(d.getFullYear(), d.getMonth(), 0))],
      anno: () => [d.getFullYear() + '-01-01', isoOggi()],
      tutto: () => {
        const date = stato.movimenti.map(m => m.data).sort();
        return [date[0] || isoOggi(), date.length && date[date.length - 1] > isoOggi() ? date[date.length - 1] : isoOggi()];
      }
    };
    let scelta = iniziale || 'mese';
    let [da, a] = tratti[scelta]();
    apriFoglio('Esporta e condividi', corpo => {
      corpo.appendChild(el('div', 'titoletto', 'Periodo'));
      const chips = el('div', 'chips');
      const voci = [['mese', 'Questo mese'], ['scorso', 'Mese scorso'], ['anno', 'Quest\'anno'], ['tutto', 'Tutto']];
      const bottoni = voci.map(([k, nome]) => {
        const b = tasto('chip senza-freccia', nome, () => { scelta = k; [da, a] = tratti[k](); inDa.value = da; inA.value = a; aggiorna(); });
        b.dataset.periodo = k;
        chips.appendChild(b);
        return b;
      });
      corpo.appendChild(chips);
      const date = el('div', 'riga-date');
      const inDa = el('input'); inDa.type = 'date'; inDa.value = da; inDa.id = 'esportaDa';
      const inA = el('input'); inA.type = 'date'; inA.value = a; inA.id = 'esportaA';
      const cambia = () => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(inDa.value)) da = inDa.value;
        if (/^\d{4}-\d{2}-\d{2}$/.test(inA.value)) a = inA.value;
        if (da > a) { const x = da; da = a; a = x; inDa.value = da; inA.value = a; }
        scelta = 'scelto';
        aggiorna();
      };
      inDa.addEventListener('change', cambia); inA.addEventListener('change', cambia);
      date.appendChild(campo('Da', inDa));
      date.appendChild(campo('A', inA));
      corpo.appendChild(date);
      const riassunto = el('p', 'riassunto');
      riassunto.id = 'esportaRiassunto';
      corpo.appendChild(riassunto);
      // «Tutto» comprende anche i movimenti fuori dalle date (è la copia di sicurezza)
      const filtro = () => (scelta === 'tutto' ? [null, null] : [da, a]);
      const aggiorna = () => {
        bottoni.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.periodo === scelta)));
        const [x, y] = filtro();
        const lista = stato.movimenti.filter(nelTratto(x, y));
        const t = totali(lista);
        riassunto.textContent = lista.length ? lista.length + (lista.length === 1 ? ' movimento' : ' movimenti') + ' · entrate ' + euro(t.entrate) + ' · uscite ' + euro(t.uscite)
          : 'Nessun movimento in questo periodo.';
        notaAI.textContent = scelta === 'tutto' ? ED.testoCopia : 'Per la copia completa: «Tutto».';
      };

      const azioni = el('div', 'elenco-azioni');
      azioni.style.marginTop = '12px';
      const bAI = tasto('azione', '🤖 Copia per l\'AI', async () => {
        const [x, y] = filtro();
        const ok = await copiaTesto(testoEsportazione(x, y));
        if (!ok) { mostraToast('Non sono riuscito a copiare'); return; }
        if (scelta === 'tutto') segnaBackup();
        chiudiFoglio(); mostraToast(ED.avvisoCopiato);
      });
      bAI.id = 'copiaAI';
      const notaAI = el('small', '', '');
      bAI.appendChild(notaAI);
      azioni.appendChild(bAI);
      const bLegg = tasto('azione', '📋 Copia da condividere', async () => {
        const [x, y] = filtro();
        const ok = await copiaTesto(testoLeggibile(x, y));
        if (!ok) { mostraToast('Non sono riuscito a copiare'); return; }
        chiudiFoglio(); mostraToast('Copiato: incollalo in una chat o in una nota');
      });
      bLegg.id = 'copiaLeggibile';
      bLegg.appendChild(el('small', '', 'Un riassunto da leggere.'));
      azioni.appendChild(bLegg);
      if (navigator.share) {
        const bCond = tasto('azione', '📤 Condividi…', async () => {
          const [x, y] = filtro();
          try {
            await navigator.share({ title: ED.titolo, text: testoLeggibile(x, y) });
            chiudiFoglio();
          } catch (e) {
            if (e && e.name !== 'AbortError') mostraToast('Condivisione non riuscita');
          }
        });
        bCond.id = 'condividi';
        bCond.appendChild(el('small', '', 'Il riassunto, con WhatsApp, Mail o Note.'));
        azioni.appendChild(bCond);
      }
      corpo.appendChild(azioni);
      aggiorna();
    });
  }

  function apriMenu() {
    apriFoglio('Menù', corpo => {
      const ts = el('div', 'titoletto con-tasto', '');
      ts.appendChild(el('span', '', 'Sfondo'));
      const tutti = tasto('legame-tasto', 'Vedi tutti ›', apriSfondi);
      tutti.id = 'vediSfondi';
      ts.appendChild(tutti);
      corpo.appendChild(ts);
      filaSfondi(corpo);

      corpo.appendChild(el('div', 'titoletto', 'Impostazioni'));
      const imp = el('div', 'elenco-azioni');
      const voce = (titolo, sotto, alClic) => { const b = tasto('azione', titolo, alClic); b.appendChild(el('small', '', sotto)); imp.appendChild(b); return b; };
      const tf = totaleFissi(), nf = stato.ricorrenti.length;
      voce('🔁 Movimenti fissi', nf ? nf + (nf === 1 ? ' impostato' : ' impostati') + (tf.uscite ? ' · uscite ' + euro(tf.uscite) + ' al mese' : '') : 'Si segnano da soli ogni mese.', apriFissi);
      const saldi = A.CONTI.map(c => [c, saldoAttuale(c.id)]).filter(([, v]) => v !== null);
      voce('🏦 Saldi dei conti', saldi.length ? (saldoVisibile ? saldi.map(([c, v]) => c.icona + ' ' + euro(v)).join(' · ') : 'Nascosti dall\'occhio')
        : 'Contanti, digitale, cripto.', () => apriSaldo());
      voce('🧾 Tasse da accantonare', stato.tasse.attiva ? String(stato.tasse.percentuale).replace('.', ',') + '% di ' + (stato.tasse.categorie.join(', ') || 'nessuna categoria') : 'Spento', apriTasse);
      voce('🏷️ Categorie', 'Nomi e simboli.', apriCategorie);
      voce('🎙️ Microfono', descriviVoce(), apriImpostazioniVoce);
      if (F) {
        const pr = F.prossime(oggi(), 1, pref.compleanno)[0];
        voce('🎉 Feste e santi', !festeAccese() ? 'Feste a tema spente' : pr ? 'La prossima: ' + pr.festa.nome + ', ' + etichettaGiorno(A.isoDa(pr.data)).toLowerCase() : 'Feste a tema e santo del giorno', apriFeste).id = 'voceFeste';
      }
      if (S) {
        const nomeDi = (lista, id) => lista.find(a => a.id === id).nome;
        const spenti = [!siglaAccesa() && 'sigla', !occhioAcceso() && 'occhio', !suoniMovimenti() && 'salva ed elimina'].filter(Boolean);
        voce('🔊 Suoni', spenti.length ? 'Spenti: ' + spenti.join(', ') : 'Sigla: ' + nomeDi(S.SIGLE, suonoSigla()) + ' · occhio: ' + nomeDi(S.SALDO, suonoSaldo()), apriSuoni).id = 'voceSuoni';
        // solo nell'edizione di Francesco, per sempre (sua richiesta del 18/11/2026): mai in quelle degli amici
        if (ED.nome === 'principale') voce('🎛️ Suoni del creatore', 'Tutti i suoni', apriCreatore).id = 'voceCreatore';
      }
      corpo.appendChild(imp);

      corpo.appendChild(el('div', 'titoletto', 'I tuoi movimenti'));
      const n = stato.movimenti.length;
      corpo.appendChild(el('p', '', n + (n === 1 ? ' movimento' : ' movimenti') + '. ' + testoUltimoBackup()
        + ' Memoria usata ' + percento(spazioUsato(), 1) + '.'));
      const azioni = el('div', 'elenco-azioni');
      azioni.style.marginTop = '10px';
      corpo.appendChild(azioni);

      const bEsp = tasto('azione', '📤 Esporta e condividi', () => apriEsporta('mese'));
      bEsp.appendChild(el('small', '', 'Copia o condividi un periodo.'));
      azioni.appendChild(bEsp);

      const bCop = tasto('azione', '🕰️ Copie automatiche', apriCopie);
      bCop.id = 'voceCopie';
      bCop.appendChild(el('small', '', 'Torna a un giorno prima.'));
      azioni.appendChild(bCop);

      const bImp = tasto('azione', '📥 Importa da testo', () => apriImporta());
      bImp.appendChild(el('small', '', 'Da una copia esportata.'));
      azioni.appendChild(bImp);

      // fatto da Francesco l'11/11/2026: nella sua edizione non serve più (resta per quelle degli amici, ancora vecchie)
      if (ED.nome !== 'principale') {
        const bIco = tasto('azione', '📲 Nome e icona nuovi', apriTrasloco);
        bIco.id = 'voceTrasloco';
        bIco.appendChild(el('small', '', 'Per avere «' + ED.titolo + '» con l\'icona nuova sulla schermata Home: si porta tutto su un\'icona nuova.'));
        azioni.appendChild(bIco);
      }

      const bZero = tasto('azione', '🧨 Ricomincia da zero', () => ricomincia());
      bZero.style.color = 'var(--critico)';
      bZero.disabled = !n && !stato.ricorrenti.length && !CONTI_ID.some(c => stato.saldi[c]);
      bZero.appendChild(el('small', '', 'Cancella i movimenti.'));
      azioni.appendChild(bZero);

      corpo.appendChild(el('p', 'nota', 'I dati sono solo su questo telefono: esporta ogni tanto.'));
      const crediti = tasto('tasto-secondario', 'Crediti di foto e suoni', apriCrediti);
      crediti.style.marginTop = '12px';
      corpo.appendChild(crediti);
      const ora = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      const info = el('p', 'nota', 'Versione ' + VERSIONE + (versionePronta ? ' · è pronta quella nuova, si mette appena chiudi il menù.'
        : ' · si aggiorna da sola' + (ultimoControllo ? ' (controllato alle ' + ora(ultimoControllo) + ').' : '.')));
      const aggiorna = tasto('tasto-secondario', versionePronta ? 'Aggiorna ora' : 'Cerca aggiornamenti',
        () => versionePronta ? ricarica() : cercaAggiornamenti());
      aggiorna.style.marginTop = '8px';
      info.appendChild(el('br'));
      info.appendChild(aggiorna);
      corpo.appendChild(info);
    });
  }

  // ================================================================ trasloco su un'icona nuova
  // L'iPhone prende nome e icona solo quando si aggiunge l'app alla schermata Home e non li aggiorna più (verificato il
  // 10/11/2026); ogni icona ha poi la sua memoria. Per avere quelli nuovi si aggiunge di nuovo l'app e ci si portano
  // i dati: «Copia tutto» qui, «Incolla dalla vecchia icona» nell'icona nuova, che parte vuota.
  function apriTrasloco() {
    apriFoglio('Nome e icona nuovi', corpo => {
      corpo.appendChild(el('p', '', 'L\'iPhone non cambia mai da solo nome e icona di un\'app già sulla schermata Home: va aggiunta di nuovo, una volta sola. Quattro passi, due minuti.'));
      const passi = el('ol', 'passi');
      const n = stato.movimenti.length;
      const p1 = el('li', '', '');
      p1.appendChild(el('strong', '', 'Copia tutto. '));
      p1.appendChild(document.createTextNode('Qui sotto: ' + n + (n === 1 ? ' movimento' : ' movimenti') + ', fissi, categorie, saldi, tasse e sfondo.'));
      const copia = tasto('tasto-primario', '📋 Copia tutto', async () => {
        const ok = await copiaTesto(testoEsportazione() + '\n#preferenze ' + JSON.stringify({ sfondo: pref.sfondo }));
        if (!ok) { mostraToast('Non sono riuscito a copiare'); return; }
        segnaBackup();
        copia.textContent = '✓ Copiato';
        mostraToast('Copiato tutto: ora apri Safari');
      });
      copia.id = 'copiaTrasloco';
      copia.style.marginTop = '8px';
      p1.appendChild(copia);
      passi.appendChild(p1);
      const indirizzo = location.origin + location.pathname.replace(/index\.html$/, '');
      const p2 = el('li', '', '');
      p2.appendChild(el('strong', '', 'Aggiungila di nuovo da Safari. '));
      p2.appendChild(document.createTextNode('Apri Safari e scrivi '));
      p2.appendChild(el('span', 'indirizzo', indirizzo.replace(/^https?:\/\//, '')));
      p2.appendChild(document.createTextNode(' (te lo completa da solo). Poi Condividi (il quadrato con la freccia) → «Aggiungi alla schermata Home» → Aggiungi.'));
      passi.appendChild(p2);
      const p3 = el('li', '', '');
      p3.appendChild(el('strong', '', 'Apri l\'icona nuova e tocca «📥 Incolla» '));
      p3.appendChild(document.createTextNode('in cima. Se compare il fumetto «Incolla», toccalo. Arrivano tutti i movimenti.'));
      passi.appendChild(p3);
      const p4 = el('li', '', '');
      p4.appendChild(el('strong', '', 'Solo dopo, cancella la vecchia: '));
      p4.appendChild(document.createTextNode('tienila premuta → Rimuovi app. Prima no, perché con l\'icona se ne vanno i suoi dati.'));
      passi.appendChild(p4);
      corpo.appendChild(passi);
      corpo.appendChild(el('p', 'nota', 'Nell\'icona nuova il microfono «Preciso» va riscaricato una volta (250 MB, meglio col Wi-Fi): ogni icona ha la sua memoria.'));
    });
  }

  // Nell'icona nuova, vuota: legge dagli appunti la «Copia tutto» della vecchia. Se il telefono non lascia leggere gli
  // appunti, si apre «Importa» per incollarla a mano.
  async function incollaDallaVecchia() {
    let testo = '';
    mostraToast('Se compare il fumetto «Incolla», toccalo', null, null, 6000);
    try { testo = await navigator.clipboard.readText(); } catch (e) { testo = ''; }
    if (!/^\d{4}-\d{2}-\d{2};/m.test(testo)) {
      apriImporta();
      mostraToast('Tieni premuto nel riquadro → Incolla, poi Importa');
      return;
    }
    const e = importaTesto(testo);
    generaRicorrenti(true);
    disegna();
    mostraToast(e.aggiunti ? 'Arrivati dalla vecchia icona: ' + e.aggiunti + (e.aggiunti === 1 ? ' movimento' : ' movimenti') : 'Nessun movimento nuovo da aggiungere');
  }

  const quandoCopia = c => { const d = new Date(c.quando), p = n => String(n).padStart(2, '0'); return etichettaGiorno(c.giorno) + ' alle ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  // si torna a una copia: prima se ne fa una di adesso
  function tornaA(copia) {
    let s = null;
    try { s = JSON.parse(copia.testo); } catch (e) { s = null; }
    if (!s || !Array.isArray(s.movimenti)) { mostraToast('Questa copia non si legge'); return; }
    const prima = JSON.stringify(stato);
    const fatto = salvaCopia('prima di tornare a una copia');
    const metti = testo => {
      const nuovo = daTesto(testo);
      const rev = stato.rev || 0;
      stato = nuovo;
      stato.rev = Math.max(rev, stato.rev || 0);
      if (!scrivi()) return false;
      scelte = [];
      vista.filtro = null;
      generaRicorrenti(true);
      scrivi();
      rileggi();
      disegna();
      return true;
    };
    if (!metti(copia.testo)) return;
    chiudiFoglio();
    mostraToast('Tornato a ' + quandoCopia(copia).toLowerCase() + ': ' + movimenti_(stato.movimenti.length), 'Annulla', () => { metti(prima); }, 12000);
    return fatto;
  }
  function apriCopie() {
    apriFoglio('Copie automatiche', corpo => {
      corpo.appendChild(el('p', '', 'Ogni giorno, e prima di ogni cancellazione. Dentro questo telefono.'));
      const lista = el('div', 'elenco-righe');
      lista.id = 'listaCopie';
      corpo.appendChild(lista);
      elencoCopie().then(l => {
        if (!l.length) { lista.appendChild(el('p', 'vuoto', 'Ancora nessuna.')); return; }
        for (const c of l) {
          const b = el('button', 'cat-riga');
          b.type = 'button';
          b.dataset.copia = c.id;
          b.appendChild(el('span', 'cat-icona', c.motivo ? '🛟' : '🕰️'));
          const testi = el('span', 'mov-testi');
          testi.appendChild(el('span', 'mov-desc', quandoCopia(c)));
          testi.appendChild(el('span', 'mov-cat', movimenti_(c.movimenti) + (c.motivo ? ' · ' + c.motivo : '')));
          b.appendChild(testi);
          b.appendChild(el('span', 'cat-freccia', '›'));
          b.addEventListener('click', () => {
            conferma('Tornare a ' + quandoCopia(c).toLowerCase() + '?', movimenti_(c.movimenti) + '. Prima salvo una copia di adesso.', 'Torna a questa', () => tornaA(c), apriCopie);
          });
          lista.appendChild(b);
        }
      });
    });
  }
  // i recenti ci sono ma i vecchi (in IndexedDB) no: il telefono li ha cancellati. Dall'ultima copia buona si rimettono
  // solo quelli prima di archivioDal, senza toccare i recenti
  function offriVecchi() {
    elencoCopie().then(l => {
      const buona = l.find(c => c.movimenti > stato.movimenti.length);
      if (!buona) { mostraToast('I movimenti più vecchi non ci sono più', null, null, 12000); return; }
      apriFoglio('I movimenti più vecchi non ci sono più', corpo => {
        corpo.appendChild(el('p', '', 'Ho una copia di ' + quandoCopia(buona).toLowerCase() + ', con ' + movimenti_(buona.movimenti) + '.'));
        const riga = el('div', 'riga-tasti colonna');
        const b = tasto('tasto-primario', 'Rimetti i vecchi', () => {
          let s = null;
          try { s = JSON.parse(buona.testo); } catch (e) { s = null; }
          if (!s || !Array.isArray(s.movimenti)) { mostraToast('Questa copia non si legge'); return; }
          const ci = new Set(stato.movimenti.map(m => m.id));
          const vecchi = s.movimenti.filter(m => m.data < archivioDal && !ci.has(m.id));
          stato.movimenti = vecchi.concat(stato.movimenti);
          memoriaVecchiaPersa = false;
          if (!scrivi()) return;
          chiudiFoglio();
          disegna();
          // detto solo quando IndexedDB ha finito di scriverli (sono tanti: su WebKit ci vuole un attimo)
          codaDati.then(() => mostraToast('Rimessi ' + movimenti_(vecchi.length)));
        });
        b.id = 'rimettiCopia';
        riga.appendChild(b);
        riga.appendChild(tasto('tasto-secondario', 'No', () => chiudiFoglio(true)));
        corpo.appendChild(riga);
      });
    });
  }
  // la memoria dei movimenti è vuota da sempre ma le copie ci sono: l'iPhone l'ha persa. Si offre l'ultima buona.
  function offriCopia() {
    if (!maiSalvata || stato.movimenti.length) return;
    elencoCopie().then(l => {
      const buona = l.find(c => c.movimenti > 0);
      if (!buona && memoriaPersa && !stato.movimenti.length) mostraToast('I movimenti non ci sono più', null, null, 12000);
      if (!buona || stato.movimenti.length) return;
      apriFoglio('I movimenti non ci sono più', corpo => {
        corpo.appendChild(el('p', '', 'Ho una copia di ' + quandoCopia(buona).toLowerCase() + ', con ' + movimenti_(buona.movimenti) + '.'));
        const riga = el('div', 'riga-tasti colonna');
        const b = tasto('tasto-primario', 'Rimetti la copia', () => tornaA(buona));
        b.id = 'rimettiCopia';
        riga.appendChild(b);
        riga.appendChild(tasto('tasto-secondario', 'No', () => chiudiFoglio(true)));
        corpo.appendChild(riga);
      });
    });
  }

  function apriImporta() {
    apriFoglio('Importa movimenti', corpo => {
      corpo.appendChild(el('p', '', 'Incolla una copia esportata.'));
      const ta = el('textarea');
      ta.id = 'testoImporta';
      ta.placeholder = 'Incolla qui';
      const c = el('label', 'campo');
      c.appendChild(ta);
      corpo.appendChild(c);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', 'Importa', () => {
        salvaCopia('prima di importare');
        const e = importaTesto(ta.value);
        chiudiFoglio();
        generaRicorrenti(true);
        disegna();
        mostraToast('Aggiunti ' + e.aggiunti + (e.presenti ? ', già presenti ' + e.presenti : '') + (e.scartati ? ', righe scartate ' + e.scartati : ''));
      }));
      corpo.appendChild(riga);
    });
  }

  function testoUltimoBackup() {
    if (!stato.ultimoBackup) return 'Mai esportati.';
    const giorni = Math.floor((Date.now() - new Date(stato.ultimoBackup)) / GIORNO_MS);
    return 'Esportati ' + (giorni === 0 ? 'oggi' : giorni === 1 ? 'ieri' : giorni + ' giorni fa') + '.';
  }

  // un'icona nuova è quella dove non c'è mai stato niente: ricominciando da zero (il 1° dicembre) è solo vuota (24/11/2026)
  const qualcosaDentro = () => !!(stato.movimenti.length || stato.ricorrenti.length || CONTI_ID.some(c => stato.saldi[c]));
  const iconaNuova = () => !pref.avviata && !qualcosaDentro();
  function disegnaBanner() {
    // un'icona appena aggiunta: il tasto per portarci i dati della vecchia sta in cima, dove si vede subito (11/11/2026:
    // prima stava solo in fondo all'elenco vuoto, sotto riepilogo, autonomia e categorie)
    if (!pref.avviata && qualcosaDentro()) { pref.avviata = true; scriviPref(); }
    $('bannerTrasloco').hidden = !iconaNuova();
    const n = stato.movimenti.length;
    const vecchio = !stato.ultimoBackup || (Date.now() - new Date(stato.ultimoBackup)) > 14 * GIORNO_MS;
    // la memoria quasi piena viene prima di tutto: va detto a Claude, che sposta i movimenti in una memoria più grande
    const pieno = spazioUsato() >= 0.6;
    const mostra = pieno || (n >= 10 && vecchio);
    $('bannerBackup').hidden = !mostra;
    if (pieno) $('bannerTesto').textContent = 'La memoria dei movimenti è al ' + percento(spazioUsato(), 1) + ': esporta e ' +
      (ED.nome === 'principale' ? 'dillo a Claude, che li sposta' : 'chiedi a chi ti ha dato l\'app di spostarli') + ' in una memoria più grande prima che si riempia.';
    else if (mostra) $('bannerTesto').textContent = 'Fai una copia dei movimenti. ' + testoUltimoBackup();
  }

  // ================================================================ ricominciare e fine delle prove
  // Cancellare i movimenti non cambia quanti soldi ha: i saldi di oggi restano quelli (24/11/2026: tornavano a quelli scritti
  // settimane prima, perché i movimenti venuti dopo sparivano). E i fissi del mese, se il fisso resta, si risegnano: prima
  // chi ripartiva da zero il 1° del mese perdeva quelli del mese e non tornavano più.
  function cancella(condizione, messaggio) {
    salvaCopia('prima di cancellare');
    const tolti = stato.movimenti.filter(condizione);
    const saldiPrima = JSON.stringify(stato.saldi), fattiPrima = stato.ricorrenti.map(r => [r, (r.fatti || []).slice()]);
    const oggiPrima = CONTI_ID.map(c => [c, saldoAttuale(c)]);
    stato.movimenti = stato.movimenti.filter(m => !condizione(m));
    const adesso = new Date().toISOString(), ora = chiaveMese(oggi());
    for (const [c, v] of oggiPrima) if (v !== null && saldoAttuale(c) !== v) stato.saldi[c] = { importo: v, data: isoOggi(), aggiornato: adesso };
    for (const r of stato.ricorrenti) {
      if (!r.attivo || !tolti.some(m => m.ricorrente === r.id && m.data.slice(0, 7) >= ora)) continue;
      r.fatti = (r.fatti || []).filter(k => k < ora || !tolti.some(m => m.ricorrente === r.id && m.data.slice(0, 7) === k));
    }
    generaRicorrenti(true);
    // quelli di questo mese già passati e già dentro il saldo: segnati, ma senza toglierli una seconda volta
    for (const m of stato.movimenti) {
      if (!m.ricorrente || m.creato < adesso || m.data > isoOggi()) continue;
      if (tolti.some(x => x.ricorrente === m.ricorrente && x.data === m.data)) m.creato = tolti.find(x => x.ricorrente === m.ricorrente && x.data === m.data).creato || m.creato;
    }
    scrivi();
    chiudiFoglio();
    disegna();
    if (tolti.length) suonaMovimento('elimina');
    mostraToast(messaggio, 'Annulla', () => {
      const via = new Set(tolti.map(m => m.id)), rifatti = m => m.ricorrente && m.creato >= adesso;
      stato.movimenti = stato.movimenti.filter(m => !via.has(m.id) && !rifatti(m)
        && !(m.ricorrente && tolti.some(x => x.ricorrente === m.ricorrente && x.data === m.data))).concat(tolti);
      stato.saldi = JSON.parse(saldiPrima);
      for (const [r, f] of fattiPrima) r.fatti = f;
      scrivi(); disegna();
    });
  }
  // 15. «Tutto»: come appena installata, tenendo categorie, tasse e preferenze. Prima una copia, poi Annulla, poi i saldi.
  function cancellaTutto() {
    salvaCopia('prima di ripartire da vuoto');
    const prima = JSON.stringify(stato);
    const tieni = { categorie: stato.categorie, tasse: Object.assign({}, stato.tasse, { dal: stato.tasse.attiva ? isoOggi() : stato.tasse.dal }) };
    stato = Object.assign(vuoto(), tieni);
    vista.filtro = null;
    scelte = [];
    if (INIZIO_SUL_SERIO && isoOggi() >= INIZIO_SUL_SERIO) { pref.proveChiuse = true; scriviPref(); }
    scrivi();
    chiudiFoglio();
    rileggi();
    disegna();
    suonaMovimento('elimina');
    mostraToast('Si riparte da vuoto', 'Annulla', () => { stato = JSON.parse(prima); scrivi(); rileggi(); disegna(); }, 12000);
  }

  // Due conferme (la seconda chiesta da Francesco il 10/11/2026), poi qualche secondo per «Annulla».
  // Dal 15/11/2026 (sua richiesta) si sceglie cosa: tutto, «tutto tranne Cripto e spese ricorrenti», o i conti scelti
  // a mano, tenendo o no le spese ricorrenti (i movimenti dei fissi: cancellati non tornano, il loro mese è già fatto).
  // Un movimento si cancella solo se tutti i conti che tocca sono fra quelli scelti: lo spostamento Digitale → Cripto
  // resta se si tiene Cripto, se no il saldo cripto perderebbe da dove sono arrivati i soldi.
  const TRANNE_CRIPTO = { conti: ['contanti', 'digitale'], tieniFissi: true };
  const daCancellare = scelta => m => !(scelta.tieniFissi && m.ricorrente) &&
    (eSpostamento(m) ? [m.da, m.verso] : [contoDi(m)]).every(c => scelta.conti.includes(c));
  const movimenti_ = k => k + (k === 1 ? ' movimento' : ' movimenti');
  function ricomincia() {
    const n = stato.movimenti.length;
    const scelta = { conti: CONTI_ID.slice(), tieniFissi: false };
    apriFoglio('Ricomincia da zero', corpo => {
      corpo.appendChild(el('p', '', 'Impostazioni e categorie restano.'));
      const tutto = tasto('azione', '🧨 Tutto, si riparte da vuoto', () => confermaTutto());
      tutto.id = 'cancellaTutto';
      tutto.style.marginTop = '12px';
      tutto.appendChild(el('small', '', 'Movimenti, spese ricorrenti, saldi e parole imparate.'));
      corpo.appendChild(tutto);
      const kp = stato.movimenti.filter(daCancellare(TRANNE_CRIPTO)).length;
      const pre = tasto('azione', '🧹 Tutto tranne Cripto e spese ricorrenti', () => ricominciaConferma(TRANNE_CRIPTO, kp));
      pre.id = 'cancellaTranneCripto';
      pre.disabled = !kp;
      pre.appendChild(el('small', '', kp ? movimenti_(kp) + ' in contanti e digitale.' : 'Niente da cancellare.'));
      pre.style.marginTop = '12px';
      corpo.appendChild(pre);
      corpo.appendChild(el('div', 'titoletto', 'Oppure scegli tu quali conti'));
      const caselle = [];
      for (const c of A.CONTI) {
        const i = interruttore(c.icona + ' ' + c.nome, true);
        i.casella.dataset.conto = c.id;
        caselle.push([c.id, i.casella]);
        corpo.appendChild(i.etichetta);
      }
      const fissi = interruttore('🔁 Tieni le spese ricorrenti', false);
      fissi.casella.id = 'tieniRicorrenti';
      corpo.appendChild(fissi.etichetta);
      corpo.appendChild(el('p', 'nota', 'Uno spostamento resta se tieni uno dei suoi conti.'));
      const copia = tasto('tasto-secondario', '🤖 Prima fai una copia', () => apriEsporta('tutto'));
      copia.style.marginTop = '12px';
      corpo.appendChild(copia);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-secondario', 'Annulla', () => chiudiFoglio(true)));
      const via = tasto('tasto-pericolo', '', () => {
        const k = stato.movimenti.filter(daCancellare(scelta)).length;
        if (k) ricominciaConferma(Object.assign({}, scelta), k);
      });
      via.id = 'cancellaScelti';
      riga.appendChild(via);
      corpo.appendChild(riga);
      // il tasto dice quanti ne cancella, cambiando le caselle senza ridisegnare il foglio (che tornerebbe in cima)
      const conta = () => {
        scelta.conti = caselle.filter(([, x]) => x.checked).map(([id]) => id);
        scelta.tieniFissi = fissi.casella.checked;
        const k = stato.movimenti.filter(daCancellare(scelta)).length;
        via.textContent = k === n && k ? 'Cancella tutto' : 'Cancella ' + movimenti_(k);
        via.disabled = !k;
      };
      caselle.forEach(([, x]) => x.addEventListener('change', conta));
      fissi.casella.addEventListener('change', conta);
      conta();
    });
  }
  function confermaTutto() {
    const n = stato.movimenti.length, f = stato.ricorrenti.length, s = CONTI_ID.filter(c => stato.saldi[c]).length;
    const inizio = INIZIO_SUL_SERIO && isoOggi() >= INIZIO_SUL_SERIO ? stato.movimenti.filter(m => m.data >= INIZIO_SUL_SERIO && !m.ricorrente).length : 0;
    apriFoglio('Sei proprio sicuro?', corpo => {
      corpo.appendChild(el('p', 'allarme', '🧨 Stai per cancellare ' + [n ? movimenti_(n) : '', f ? f + (f === 1 ? ' spesa ricorrente' : ' spese ricorrenti') : '',
        s ? s + (s === 1 ? ' saldo' : ' saldi') : ''].filter(Boolean).join(', ') + '.'));
      if (inizio) corpo.appendChild(el('p', 'avviso', 'Compresi ' + movimenti_(inizio) + ' da dicembre in poi.'));
      corpo.appendChild(el('p', '', 'Una copia resta in Menù → Copie automatiche.'));
      const riga = el('div', 'riga-tasti colonna');
      const si = tasto('tasto-pericolo pieno', 'Sì, si riparte da vuoto', cancellaTutto);
      si.id = 'cancellaTuttoSi';
      riga.appendChild(si);
      riga.appendChild(tasto('tasto-secondario', 'No, tieni tutto', () => chiudiFoglio(true)));
      corpo.appendChild(riga);
    });
  }
  function ricominciaConferma(scelta, n) {
    const parte = scelta.conti.length < CONTI_ID.length || scelta.tieniFissi;
    apriFoglio('Sei proprio sicuro?', corpo => {
      const dove = scelta.conti.map(inConto);
      const elenco = dove.length > 1 ? dove.slice(0, -1).join(', ') + ' e ' + dove[dove.length - 1] : dove.join('');
      corpo.appendChild(el('p', 'allarme', '🧨 Stai per cancellare ' + movimenti_(n) + (parte ? ' ' + elenco : '') + '.'));
      if (scelta.tieniFissi) corpo.appendChild(el('p', '', 'Le spese ricorrenti restano.'));
      if (!scelta.tieniFissi && stato.ricorrenti.some(r => r.attivo)) corpo.appendChild(el('p', '', 'Le spese ricorrenti di questo mese si risegnano.'));
      corpo.appendChild(el('p', '', 'I saldi di oggi restano. Una copia resta in Menù → Copie automatiche.'));
      const riga = el('div', 'riga-tasti colonna');
      riga.appendChild(tasto('tasto-pericolo pieno', 'Sì, cancella ' + movimenti_(n), () => cancella(daCancellare(scelta), 'Cancellati ' + movimenti_(n))));
      riga.appendChild(tasto('tasto-secondario', 'No, tienili', () => chiudiFoglio(true)));
      corpo.appendChild(riga);
    });
  }

  // Dal 15/11/2026 (sua richiesta) le prove di novembre si cancellano tranne quelle in Cripto e le spese ricorrenti,
  // come «Tutto tranne Cripto e spese ricorrenti». Francesco: usata a dicembre, questa cancellazione si toglie dal
  // codice (riquadro bannerProva, INIZIO_SUL_SERIO, pref.proveChiuse).
  const unaProva = m => m.data < INIZIO_SUL_SERIO && daCancellare(TRANNE_CRIPTO)(m);
  function disegnaBannerProva() {
    if (!INIZIO_SUL_SERIO) { $('bannerProva').hidden = true; return; }
    const prove = stato.movimenti.filter(unaProva);
    const tenute = stato.movimenti.filter(m => m.data < INIZIO_SUL_SERIO && !unaProva(m)).length;
    const mostra = isoOggi() >= INIZIO_SUL_SERIO && !pref.proveChiuse && prove.length > 0;
    $('bannerProva').hidden = !mostra;
    if (mostra) $('bannerProvaTesto').textContent = 'Dal 1° dicembre si fa sul serio. Riparti da vuoto, o cancello ' + (prove.length === 1 ? 'il movimento di prova segnato' : 'i ' + prove.length + ' movimenti di prova segnati') +
      ' prima?' + (tenute ? ' Così tengo ' + (tenute === 1 ? 'quello' : 'i ' + tenute) + ' in cripto e delle spese ricorrenti.' : ' Così cripto e spese ricorrenti restano.');
  }
  $('provaTieni').addEventListener('click', () => { pref.proveChiuse = true; scriviPref(); disegnaBannerProva(); });
  $('provaTutto').addEventListener('click', confermaTutto);
  $('provaCancella').addEventListener('click', () => {
    pref.proveChiuse = true;
    scriviPref();
    cancella(unaProva, 'Cancellate le prove: cripto e spese ricorrenti restano');
  });

  // ================================================================ sfondi
  let sfondi = [];   // da sfondi/sfondi.json: id, nome, autore, licenza, fonte
  function sfondoDiOggi() {
    if (!sfondi.length) return pref.ultimoSfondo || null;
    const d = oggi();
    const giorno = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / GIORNO_MS);
    return sfondi[giorno % sfondi.length].id;
  }
  // «A caso» (25/11/2026, sua richiesta): una foto nuova ogni volta che apre l'app o ci torna, a caso fra tutte, mai due volte
  // di fila la stessa. La prossima si sceglie e si scarica prima, mentre guarda quella di adesso, e si mette quando esce: al
  // ritorno è già lì. La ricarica di un aggiornamento non è un'apertura, e la foto resta.
  const CHIAVE_CASO = CHIAVE + '.sfondo';
  let sfondoCaso = null, prossimoCaso = null, primaDopo = null, mostrata = null;
  try { sfondoCaso = sessionStorage.getItem(CHIAVE_CASO); } catch (e) { /* niente */ }
  // la foto della prossima apertura, in una memoria sua: uscendo non si riscrivono le preferenze
  try { primaDopo = localStorage.getItem(CHIAVE_CASO); } catch (e) { /* niente */ }
  const aCaso = () => { const l = sfondi.filter(x => x.id !== sfondoCaso && x.id !== mostrata); return l.length ? l[Math.floor(Math.random() * l.length)].id : null; };
  function preparaProssimo() {
    if (pref.sfondo !== 'caso' || !sfondi.length) return;
    prossimoCaso = aCaso();
    if (!prossimoCaso) return;
    const i = preparaProssimo.foto = new Image();
    i.src = 'sfondi/' + prossimoCaso + '.webp';
    if (i.decode) i.decode().catch(() => {});
  }
  function cambiaCaso() {
    const id = prossimoCaso || aCaso();
    if (!id) return;
    sfondoCaso = id;
    prossimoCaso = null;
    try { sessionStorage.setItem(CHIAVE_CASO, id); } catch (e) { /* niente */ }
    applicaSfondo();
  }
  document.addEventListener('visibilitychange', () => {
    if (pref.sfondo !== 'caso') return;
    if (document.hidden) cambiaCaso(); else setTimeout(preparaProssimo, 1200);
  });
  function applicaSfondo() {
    if (pref.sfondo === 'caso' && !sfondoCaso) {
      // aperta adesso: finché l'elenco non arriva, quella scelta l'ultima volta che è uscito
      sfondoCaso = primaDopo || aCaso() || pref.ultimoSfondo || null;
      try { if (sfondoCaso) sessionStorage.setItem(CHIAVE_CASO, sfondoCaso); } catch (e) { /* niente */ }
    }
    let id = pref.sfondo === 'giorno' ? sfondoDiOggi() : pref.sfondo === 'nessuno' ? null : pref.sfondo === 'caso' ? sfondoCaso : pref.sfondo;
    if (id && sfondi.length && !sfondi.some(x => x.id === id)) id = sfondoDiOggi();
    // la prima foto della prossima apertura si sceglie già adesso: se l'app viene chiusa dal telefono, all'apertura c'è subito
    if (pref.sfondo === 'caso' && sfondi.length && (!primaDopo || primaDopo === id)) {
      const altre = sfondi.filter(x => x.id !== id);
      primaDopo = altre[Math.floor(Math.random() * altre.length)].id;
      try { localStorage.setItem(CHIAVE_CASO, primaDopo); } catch (e) { /* niente */ }
    }
    mostrata = id;
    const s = $('sfondo'), sopra = $('sfondoSopra');
    const info = sfondi.find(x => x.id === id);
    $('sfondoNome').textContent = info ? info.nome : '';
    if (id) {
      for (const x of [s, sopra]) { x.style.backgroundImage = 'url("sfondi/' + id + '.webp")'; x.classList.add('foto'); }
      if (pref.ultimoSfondo !== id && pref.sfondo !== 'caso') { pref.ultimoSfondo = id; scriviPref(); }
    } else {
      for (const x of [s, sopra]) { x.style.backgroundImage = ''; x.classList.remove('foto'); }
    }
  }
  function apriSfondi() {
    apriFoglio('Sfondi', corpo => {
      corpo.appendChild(el('p', 'nota-su', 'A caso cambia a ogni apertura.'));
      filaSfondi(corpo, true);
    });
  }
  function filaSfondi(corpo, griglia) {
    const fila = el('div', griglia ? 'griglia-sfondi' : 'fila-sfondi');
    const opzioni = [{ id: 'caso', nome: 'A caso' }, { id: 'giorno', nome: 'Ogni giorno' }]
      .concat(sfondi.map(s => ({ id: s.id, nome: s.nome })), [{ id: 'nessuno', nome: 'Tinta unita' }]);
    for (const o of opzioni) {
      const b = el('button', 'scelta-sfondo');
      b.type = 'button';
      b.dataset.sfondo = o.id;
      const mini = el('span', 'mini');
      if (o.id === 'giorno') {
        const id = sfondoDiOggi();
        if (id) mini.style.backgroundImage = 'linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.35)), url("sfondi/' + id + '-mini.webp")';
        mini.textContent = '⟳';
      } else if (o.id === 'caso') {
        const q = sfondi.filter((x, k) => k % 7 === 1).slice(0, 4).map(x => 'url("sfondi/' + x.id + '-mini.webp")');
        mini.style.backgroundImage = ['linear-gradient(rgba(0,0,0,.3), rgba(0,0,0,.3))'].concat(q).join(',');
        mini.style.backgroundSize = 'cover, 50% 50%, 50% 50%, 50% 50%, 50% 50%';
        mini.style.backgroundPosition = '0 0, 0 0, 100% 0, 0 100%, 100% 100%';
        mini.textContent = '🎲';
      } else if (o.id === 'nessuno') {
        mini.style.backgroundImage = 'linear-gradient(180deg, #184f95, #256abf 40%, var(--pagina))';
      } else {
        mini.style.backgroundImage = 'url("sfondi/' + o.id + '-mini.webp")';
      }
      b.appendChild(mini);
      b.appendChild(document.createTextNode(o.nome));
      b.setAttribute('aria-pressed', String(pref.sfondo === o.id));
      b.addEventListener('click', () => {
        pref.sfondo = o.id;
        if (o.id === 'caso') { sfondoCaso = null; primaDopo = null; }
        scriviPref();
        applicaSfondo();
        preparaProssimo();
        fila.querySelectorAll('.scelta-sfondo').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      });
      fila.appendChild(b);
    }
    corpo.appendChild(fila);
    // nella fila del menù quella scelta si vede subito
    if (!griglia) requestAnimationFrame(() => { const s = fila.querySelector('[aria-pressed=true]'); if (s && s.offsetLeft > 250) fila.scrollLeft = s.offsetLeft - 120; });
  }
  let creditiSuoni = null;
  function apriCrediti() {
    const link = (li, url) => { const a = el('a', '', 'originale'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; li.appendChild(a); };
    apriFoglio('Crediti di foto e suoni', corpo => {
      corpo.appendChild(el('p', '', 'Foto di Wikimedia Commons.'));
      const ul = el('ul', 'passi crediti');
      for (const s of sfondi) {
        const li = el('li');
        li.appendChild(el('b', '', s.nome + ': '));
        li.appendChild(document.createTextNode(s.autore + ' · ' + s.licenza + ' · '));
        link(li, s.fonte);
        ul.appendChild(li);
      }
      corpo.appendChild(ul);
      // i suoni (17/11/2026): tutti CC0, citarli non è obbligatorio ma è giusto
      corpo.appendChild(el('div', 'titoletto', 'Suoni'));
      corpo.appendChild(el('p', '', 'Registrazioni di Freesound e Kenney, licenza CC0.'));
      const us = el('ul', 'passi crediti');
      us.id = 'creditiSuoni';
      corpo.appendChild(us);
      const scrivi = lista => {
        const viste = new Set();
        for (const s of lista) for (const f of s.fonti) {
          if (viste.has(f.fonte + f.titolo)) continue;
          viste.add(f.fonte + f.titolo);
          const li = el('li');
          li.appendChild(el('b', '', f.titolo + ': '));
          li.appendChild(document.createTextNode(f.autore + ' · ' + f.licenza + ' · '));
          link(li, f.fonte);
          us.appendChild(li);
        }
      };
      corpo.appendChild(el('div', 'titoletto', 'Santi del giorno'));
      corpo.appendChild(el('p', '', 'Da Wikipedia (CC BY-SA 4.0): il calendario di oggi, quello del 1954 e le pagine dei giorni.'));
      if (creditiSuoni) scrivi(creditiSuoni);
      else fetch('suoni/suoni.json').then(r => r.json()).then(l => { creditiSuoni = l; if (document.body.contains(us)) scrivi(l); }).catch(() => {});
    });
  }
  // «A caso» al posto di «Ogni giorno» per chi aveva quella (una volta sola): è la modalità che ha chiesto
  if (ED.nome === 'principale' && !pref.casoProposto) { pref.casoProposto = true; if (pref.sfondo === 'giorno') pref.sfondo = 'caso'; scriviPref(); }
  applicaSfondo();
  fetch('sfondi/sfondi.json').then(r => r.json()).then(l => { if (Array.isArray(l)) { sfondi = l; applicaSfondo(); prontiAlMenu(); setTimeout(preparaProssimo, 1500); } }).catch(() => {});
  // Le miniature degli sfondi: alla prima apertura del menù andavano prese dalla memoria e decodificate tutte insieme,
  // un terzo di secondo col processore rallentato come un telefono (dalla seconda 22 ms, misurato l'11/11/2026).
  // Si preparano prima, quando l'app è ferma; tenerle qui le lascia pronte anche per il menù.
  const miniPronte = [];
  function prontiAlMenu() {
    const quando = window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 4000 }) : f => setTimeout(f, 2500);
    quando(() => {
      for (const s of sfondi) {
        const i = new Image();
        i.src = 'sfondi/' + s.id + '-mini.webp';
        if (i.decode) i.decode().catch(() => {});
        miniPronte.push(i);
      }
    });
  }

  // ================================================================ microfono (voce.js)
  // Rifatto il 10/11/2026. Un tocco: ascolta (si vede il tempo e l'onda della voce); secondo tocco: basta.
  // Si ferma anche da solo dopo 2 s di silenzio. Due modelli: «Preciso» (250 MB, consigliato) e «Veloce» (78 MB).
  // Il modello scelto si carica appena si apre l'app, in un worker: al tocco è già pronto.
  // Dall'11/11/2026 («continua a fare schifo, trascrive molto lentamente»): prima il riconoscimento di Apple, se
  // l'iPhone lo lascia usare all'app (le parole arrivano mentre parla); se no Whisper, anche sulla scheda grafica.
  let statoVoce = 'fermo';   // fermo | scarico | ascolto | trascrivo
  let ascoltoInCorso = null, timerVoce = null, inizioFase = 0;
  const bottoneVoce = $('microfono');
  const onda = [];

  const scaricati = () => Object.assign({ veloce: !!pref.voceScaricata }, pref.voceScaricati || {});
  function modelloVoce() {
    const s = scaricati();
    if (pref.voceModello && s[pref.voceModello]) return pref.voceModello;
    return null;
  }
  // Apple: c'è in questa pagina, lui non ha scelto Whisper, e non ha già detto «qui no» con questa versione di iOS
  // (l'indicazione del browser cambia con gli aggiornamenti: dopo un aggiornamento si riprova da solo).
  let appleSaltaUnaVolta = false;   // senza rete Apple non va: quella volta si usa Whisper
  const usaApple = () => !!(V && V.apple) && pref.voceMotore !== 'whisper' && pref.appleNo !== navigator.userAgent && !appleSaltaUnaVolta;
  const secondi = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
  function descriviVoce() {
    if (usaApple()) return pref.appleSi ? 'Apple' : 'Apple';
    const m = modelloVoce();
    if (!m) return 'Da scaricare una volta';
    const t = (pref.voceTempi || []).slice(-1)[0];
    return V.MODELLI[m].nome + (t ? ' · ultima trascrizione ' + secondi(t) : '') + (V.isolato ? ' · più motori insieme' : '');
  }

  function mostraStatoVoce(testo, livello) {
    $('statoVoce').hidden = !testo;
    $('statoVoceTesto').textContent = testo || '';
    const o = $('ondaVoce');
    o.hidden = livello === undefined;
    if (livello === undefined) return;
    onda.push(livello);
    while (onda.length > 24) onda.shift();
    if (o.children.length !== 24) { o.textContent = ''; for (let i = 0; i < 24; i++) o.appendChild(el('span')); }
    const pad = 24 - onda.length;
    Array.from(o.children).forEach((s, i) => { const v = i < pad ? 0 : onda[i - pad]; s.style.transform = 'scaleY(' + Math.max(0.08, v).toFixed(3) + ')'; });
  }
  function fase(nome, testo) {
    statoVoce = nome;
    inizioFase = performance.now();
    clearInterval(timerVoce);
    bottoneVoce.classList.toggle('ascolta', nome === 'ascolto');
    bottoneVoce.classList.toggle('lavora', nome === 'scarico' || nome === 'trascrivo');
    bottoneVoce.setAttribute('aria-label', nome === 'ascolto' ? 'Basta, ho finito' : 'Detta a voce');
    document.body.classList.toggle('in-ascolto', nome === 'ascolto');
    document.body.classList.toggle('voce-attiva', nome !== 'fermo');
    if (nome === 'trascrivo') {
      const scrivi = () => mostraStatoVoce('✍️ Trascrivo… ' + secondi(performance.now() - inizioFase));
      scrivi();
      timerVoce = setInterval(scrivi, 200);
    } else if (testo !== undefined) mostraStatoVoce(testo);
  }
  function fineVoce() {
    if (S) S.libera();   // il microfono ha finito: i suoni possono tornare (24/11/2026)
    fase('fermo');
    ascoltoInCorso = null;
    onda.length = 0;
    mostraStatoVoce('');
  }
  // parole che Francesco usa di più: aiutano Whisper a scriverle giuste («Fineco», nomi di posti…)
  function paroleFrequenti() {
    const conta = new Map();
    for (const m of stato.movimenti.slice(-80)) for (const p of A.paroleSignificative(m.descrizione)) conta.set(p, (conta.get(p) || 0) + 1);
    const mie = TIPI_DATI.flatMap(t => categorie(t).filter(c => !c.base).map(c => c.nome));
    return mie.concat([...conta.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).filter(p => !mie.includes(p))).slice(0, 14);
  }

  // il microfono non si può usare (negato o assente): solo il perché, poi si scrive (19/11/2026: niente più i passi
  // della dettatura della tastiera, che lui non vuole)
  function guidaDettatura(motivo) {
    apriFoglio('Microfono', corpo => {
      if (motivo) corpo.appendChild(el('p', '', motivo));
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', 'Ho capito', () => { chiudiFoglio(); campoFrase.focus(); }));
      corpo.appendChild(riga);
    });
  }

  // I due modelli, come bottoni: quello in uso è segnato, quelli da scaricare dicono quanto pesano.
  function sceltaModelli(corpo, alScegliere) {
    const g = el('div', 'elenco-azioni');
    const s = scaricati(), attuale = modelloVoce();
    const testi = {
      rapido: pref.voceGpu === false && s.rapido ? 'Qui lavora col processore.' : 'Il più veloce. Consigliato.',
      preciso: 'Sbaglia meno.' + (V.gpu ? '' : ' Consigliato.'),
      veloce: 'Più rapido, sbaglia di più.'
    };
    const icone = { rapido: '🚀 ', preciso: '🎯 ', veloce: '⚡ ' };
    for (const k of (V.gpu ? ['rapido', 'preciso', 'veloce'] : ['preciso', 'veloce'])) {
      const M = V.MODELLI[k];
      const peso = k === 'rapido' && !s.preciso ? M.mbDaZero : M.mb;
      const b = tasto('azione scelta-modello', icone[k] + M.nome + (s[k] ? (attuale === k ? ' · in uso' : ' · scaricato') : ' · ' + peso + ' MB da scaricare'), () => alScegliere(k));
      b.dataset.modello = k;
      b.setAttribute('aria-pressed', String(attuale === k));
      b.appendChild(el('small', '', testi[k]));
      g.appendChild(b);
    }
    corpo.appendChild(g);
  }
  function usaModello(k) {
    if (pref.voceMotore !== 'whisper' && V.apple && pref.appleNo !== navigator.userAgent) pref.voceMotore = 'whisper';   // ha scelto Whisper
    if (!scaricati()[k]) { scaricaVoce(k); return; }
    pref.voceModello = k;
    scriviPref();
    chiudiFoglio();
    preparaVoce();
    mostraToast('Microfono: ' + V.MODELLI[k].nome + '. Tocca 🎙️ e parla');
  }

  function chiediScaricamento() {
    const vecchio = scaricati().veloce && !pref.voceModello;
    apriFoglio(vecchio ? 'Microfono nuovo' : 'Microfono', corpo => {
      corpo.appendChild(el('p', '', vecchio
        ? 'C\'è il riconoscimento «Preciso», che sbaglia meno.'
        : 'Si scarica una volta, meglio col Wi-Fi. La voce resta sul telefono.'));
      // niente «Usa la tastiera» (tolto il 17/11/2026): la dettatura della tastiera lui non la vuole
      sceltaModelli(corpo, usaModello);
    });
  }

  function apriImpostazioniVoce() {
    apriFoglio('Microfono', corpo => {
      if (V.apple) {
        const g = el('div', 'elenco-azioni');
        const appleNo = pref.appleNo === navigator.userAgent;
        const bA = tasto('azione', '🍎 Apple, come la dettatura' + (appleNo ? ' · qui non va' : pref.voceMotore !== 'whisper' ? ' · in uso' : ''), () => {
          pref.voceMotore = 'apple';
          if (appleNo) pref.appleNo = null;   // riprova
          scriviPref();
          chiudiFoglio();
          mostraToast('Microfono: Apple. Tocca 🎙️ e parla');
        });
        bA.setAttribute('aria-pressed', String(!appleNo && pref.voceMotore !== 'whisper'));
        bA.appendChild(el('small', '', appleNo
          ? 'Qui non va. Tocca per riprovare.'
          : 'Le parole arrivano mentre parli.'));
        g.appendChild(bA);
        corpo.appendChild(g);
        corpo.appendChild(el('div', 'titoletto', 'Oppure Whisper, dentro il telefono'));
      }
      sceltaModelli(corpo, usaModello);
      const tempi = (pref.voceTempi || []).slice(-5);
      const righe = el('div', 'aut-righe');
      const riga = (nome, valore) => { const r = el('div', 'aut-riga'); r.appendChild(el('span', '', nome)); r.appendChild(el('span', '', valore)); righe.appendChild(r); };
      riga('Ultime trascrizioni', tempi.length ? tempi.map(secondi).join(' · ') : 'nessuna ancora');
      riga('Motori insieme', V.isolato ? 'sì: ' + (navigator.hardwareConcurrency || '?') + ' core' : 'no, uno solo');
      if (scaricati().rapido) riga('Scheda grafica', pref.voceGpu === true ? 'sì, lavora lei' : pref.voceGpu === false ? 'non partita: lavora il processore' : 'si vede alla prima trascrizione');
      corpo.appendChild(righe);
      const s = scaricati(), attuale = modelloVoce();
      // «Preciso veloce» usa i file di «Preciso»: con quello in uso non si propone di cancellare niente
      const altro = attuale === 'preciso' ? 'veloce' : attuale === 'veloce' ? 'preciso' : null;
      if (altro && s[altro]) {
        const b = tasto('tasto-secondario', 'Libera spazio: cancella «' + V.MODELLI[altro].nome + '» (' + V.MODELLI[altro].mb + ' MB)', async () => {
          await V.cancellaModello(altro).catch(() => 0);
          pref.voceScaricati = Object.assign({}, scaricati(), { [altro]: false });
          if (altro === 'veloce') pref.voceScaricata = false;
          scriviPref();
          apriImpostazioniVoce();
          mostraToast('Cancellato «' + V.MODELLI[altro].nome + '»');
        });
        b.style.marginTop = '14px';
        corpo.appendChild(b);
      }
    });
  }

  // Se l'app si chiude da sola mentre il modello «Preciso» lavora (memoria finita), la volta dopo si torna a «Veloce».
  function segnaLavoroVoce(chiave) { pref.voceInCorso = chiave ? { modello: chiave, quando: Date.now() } : null; scriviPref(); }
  (function controllaCaduta() {
    const c = pref.voceInCorso;
    if (!c) return;
    pref.voceInCorso = null;
    if (c.modello === 'rapido' && Date.now() - c.quando < 120000 && scaricati().preciso) {
      pref.voceModello = 'preciso';
      pref.voceGpu = false;
      setTimeout(() => mostraToast('La scheda grafica ha fatto chiudere l\'app: uso «Preciso» col processore'), 800);
    } else if (c.modello === 'preciso' && Date.now() - c.quando < 120000) {
      if (scaricati().veloce) {
        pref.voceModello = 'veloce';
        setTimeout(() => mostraToast('«Preciso» ha fatto chiudere l\'app: uso «Veloce». Menù → Microfono per riprovare'), 800);
      } else {
        // senza «Veloce» non si ricarica da solo all'apertura, se no l'app si richiuderebbe ogni volta
        pref.voceModello = null;
        setTimeout(() => mostraToast('«Preciso» ha fatto chiudere l\'app: scegli «Veloce» in Menù → Microfono'), 800);
      }
    }
    scriviPref();
  })();
  document.addEventListener('visibilitychange', () => { if (document.hidden && pref.voceInCorso) segnaLavoroVoce(null); });
  // una ricarica normale (aggiornamento dell'app) non è una caduta
  window.addEventListener('pagehide', () => { if (pref.voceInCorso) segnaLavoroVoce(null); });

  // carica il modello scelto in sottofondo, così al primo tocco è già pronto
  function preparaVoce() {
    const k = modelloVoce();
    if (usaApple() && pref.appleSi) return;   // con Apple, Whisper non serve: l'app si apre più leggera
    if (!k || !V || !V.disponibile || V.caricato(k)) return;
    segnaLavoroVoce(k);
    V.prepara(k).then(() => segnaLavoroVoce(null), () => segnaLavoroVoce(null));
  }

  async function scaricaVoce(k) {
    chiudiFoglio();
    const M = V.MODELLI[k];
    const mb = k === 'rapido' && !scaricati().preciso ? M.mbDaZero : M.mb;
    fase('scarico');
    mostraStatoVoce('Scarico «' + M.nome + '» (' + mb + ' MB)… 0%', 0);
    try {
      segnaLavoroVoce(k);
      await V.prepara(k, p => { if (statoVoce === 'scarico') { onda.length = 0; mostraStatoVoce('Scarico «' + M.nome + '» (' + mb + ' MB)… ' + Math.round(p * 100) + '%', p); } });
      segnaLavoroVoce(null);
      pref.voceScaricati = Object.assign({}, scaricati(), { [k]: true });
      if (k === 'veloce') pref.voceScaricata = true;
      pref.voceModello = k;
      scriviPref();
      fineVoce();
      mostraToast('Pronto: tocca 🎙️ e parla');
    } catch (e) {
      segnaLavoroVoce(null);
      fineVoce();
      mostraToast('Scaricamento non riuscito: controlla la rete e riprova');
    }
  }

  function erroreMicrofono(e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      guidaDettatura('Microfono negato: Impostazioni → Safari → Microfono → Consenti.');
    } else {
      mostraToast('Microfono non disponibile' + (e && e.message ? ': ' + e.message.slice(0, 50) : ''));
    }
  }

  // ---- il riconoscimento di Apple: le parole compaiono nel riquadro mentre parla
  const unisciFrase = (prima, nuovo) => (prima ? prima.replace(/[,.\s]+$/, '') + ', ' + nuovo : nuovo);
  async function microfonoApple() {
    const prima = campoFrase.value.trim();
    const tempo = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    let a;
    try {
      a = V.ascoltaApple({   // dentro il tocco: iOS apre il microfono solo da un gesto
        alVia: () => { if (statoVoce === 'ascolto') { inizioFase = performance.now(); mostraStatoVoce('🎙️ 0:00 · parla pure'); } },
        alTempo: (s, sentito) => { if (statoVoce === 'ascolto') mostraStatoVoce((sentito ? '🔴 ' : '🎙️ ') + tempo(s) + (sentito ? ' · tocca ■ quando hai finito' : ' · parla pure')); },
        alTesto: testo => { if (statoVoce !== 'ascolto') return; campoFrase.value = unisciFrase(prima, testo); rileggi(); }
      });
    } catch (e) { if (S) S.libera(); appleNonVa(e); return; }
    ascoltoInCorso = a;
    fase('ascolto');
    onda.length = 0;
    mostraStatoVoce('🎙️ Apro il microfono…');
    let ris;
    try { ris = await a.finito; }
    catch (e) { fineVoce(); campoFrase.value = prima; rileggi(); appleNonVa(e); return; }
    fineVoce();
    if (ris.annullato) { campoFrase.value = prima; rileggi(); return; }
    if (!pref.appleSi) { pref.appleSi = true; scriviPref(); }
    if (!ris.parlato) { campoFrase.value = prima; rileggi(); mostraToast('Non ho sentito niente: riprova, un po\' più vicino'); return; }
    campoFrase.value = unisciFrase(prima, ris.testo);
    rileggi();
  }
  // Apple non è partito: se è perché qui non c'è, lo si ricorda (fino al prossimo iOS) e si passa a Whisper.
  function appleNonVa(e) {
    const codice = (e && e.codice) || '';
    if (V.APPLE_ASSENTE.includes(codice) || !codice) {
      pref.appleNo = navigator.userAgent;
      pref.appleSi = false;
      scriviPref();
      apriFoglio('Microfono', corpo => {
        corpo.appendChild(el('p', '', 'Il riconoscimento di Apple qui non va (' + (codice || 'errore') + '): uso Whisper.'));
        corpo.appendChild(el('p', '', V.gpu ? 'Consigliato: «Preciso veloce».' : ''));
        sceltaModelli(corpo, usaModello);
      });
      return;
    }
    // senza rete (o un intoppo di un momento): questa volta Whisper, la prossima di nuovo Apple
    appleSaltaUnaVolta = true;
    setTimeout(() => { appleSaltaUnaVolta = false; }, 60000);
    mostraToast(codice === 'network' ? 'Senza rete Apple non riconosce la voce: tocca di nuovo 🎙️ per Whisper' : 'Apple non ha risposto (' + codice + '): tocca di nuovo 🎙️', null, null, 6000);
  }

  async function microfono() {
    if (statoVoce === 'ascolto') { if (ascoltoInCorso) ascoltoInCorso.ferma(); return; }
    if (statoVoce !== 'fermo') return;
    if (usaApple()) { if (S) S.ferma(); microfonoApple(); return; }   // niente suoni: il microfono tutto al riconoscimento
    if (!V || !V.disponibile) { guidaDettatura('Questo telefono non lascia usare il microfono all\'app.'); return; }
    const chiave = modelloVoce();
    if (!chiave) { chiediScaricamento(); return; }
    let a;
    if (S) S.ferma();
    try {
      // dentro il tocco: sull'iPhone l'audio si apre solo da un gesto
      a = V.ascolta({
        alVia: () => { if (statoVoce === 'ascolto') inizioFase = performance.now(); },
        alLivello: (l, parlato, t) => {
          if (statoVoce !== 'ascolto') return;
          const tempo = Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
          mostraStatoVoce((parlato ? '🔴 ' : '🎙️ ') + tempo + (parlato ? ' · tocca ■ quando hai finito' : ' · parla pure'), l);
        }
      });
    } catch (e) { if (S) S.libera(); erroreMicrofono(e); return; }
    ascoltoInCorso = a;
    fase('ascolto');
    onda.length = 0;
    mostraStatoVoce('🎙️ Apro il microfono…', 0);
    // intanto il modello si carica nel worker (se non era già pronto)
    segnaLavoroVoce(chiave);
    const modello = V.prepara(chiave).then(() => null, e => e);
    let ris;
    try { ris = await a.finito; }
    catch (e) { segnaLavoroVoce(null); fineVoce(); erroreMicrofono(e); return; }
    ascoltoInCorso = null;
    if (!ris.parlato) { segnaLavoroVoce(null); fineVoce(); if (!ris.annullato) mostraToast('Non ho sentito niente: riprova, un po\' più vicino'); return; }
    fase('trascrivo');
    try {
      const errore = await modello;
      if (errore) throw errore;
      const r = await V.trascrivi(chiave, ris.audio, paroleFrequenti());
      pref.voceTempi = (pref.voceTempi || []).concat(r.ms).slice(-10);
      if (chiave === 'rapido') pref.voceGpu = r.gpu;   // la scheda grafica ha lavorato davvero, o è tornato al processore
      if (!r.testo) mostraToast('Non ho capito: riprova, un po\' più vicino');
      else {
        const prima = campoFrase.value.trim();
        campoFrase.value = prima ? prima.replace(/[,.\s]+$/, '') + ', ' + r.testo : r.testo;
        rileggi();
      }
    } catch (e) {
      mostraToast('Trascrizione non riuscita: ' + (e && e.message ? e.message.slice(0, 60) : 'errore'));
    }
    segnaLavoroVoce(null);
    fineVoce();
  }
  bottoneVoce.addEventListener('click', microfono);
  setTimeout(preparaVoce, 1200);

  // ================================================================ suoni e piccole animazioni (17/11/2026)
  // Francesco, 17/11: «l'idea del suono quando si entra dentro mi piace… non un suono che mi crei tu, ma creato da te
  // attraverso qualcosa che trovi in giro». Registrazioni vere CC0 (fai_suoni.py), suonate da suoni.js.
  // 17/11 sera: il suono che partiva al primo tocco l'ha sentito toccando l'occhio del saldo («mi piace ancora di più che si
  // senta quando schiacci sul saldo, però dovrebbe sentirsi ogni volta»), e all'apertura vuole una sigla «in stile
  // Clash Royale, che ti fa pensare: è quell'app». Quindi:
  //  - il suono del saldo (Devastante, Cassa, Tesoro) a ogni tocco che mostra il saldo;
  //  - la sigla all'apertura: prima si prova a suonarla subito; se l'iPhone non lo lascia fare senza un tocco (Web Audio
  //    chiede un gesto), parte al primo tocco entro 12 secondi. Cosa è successo resta in pref.siglaSubito, e lo si
  //    legge in Menù → Suoni. Se il primo tocco è l'occhio suona l'occhio, non la sigla. Mai sopra il
  //    microfono (lo registrerebbe) e mai mentre ascolta. Tornando sull'app dopo almeno 3 minuti, di nuovo.
  const scelta = (lista, v, base) => (S && lista.some(a => a.id === v) ? v : base);
  // la scelta fatta il 17/11 («apertura-…») era il suono che ha sentito sul saldo: passa al saldo
  if (pref.suonoApertura && !pref.suonoSaldo) {
    pref.suonoSaldo = pref.suonoApertura.replace(/^apertura-/, 'saldo-');
    delete pref.suonoApertura;
    scriviPref();
  }
  // 25/11/2026: «nell'occhio non si sente nessun suono». Nella sua diagnosi l'app non li chiedeva proprio: fra le scelte c'era
  // «Nessuno», in fondo all'elenco, e spegneva in silenzio l'occhio di tutti i conti. Tolto: si accende e si spegne con le
  // levette, e chi era su «Nessuno» li ritrova accesi.
  if (pref.suonoSaldo === 'nessuno') { delete pref.suonoSaldo; scriviPref(); }
  if (pref.suonoSigla === 'nessuno') { delete pref.suonoSigla; scriviPref(); }
  const suonoSigla = () => scelta(S ? S.SIGLE : [], pref.suonoSigla, 'sigla-oro');
  const suonoSaldo = () => scelta(S ? S.SALDO : [], pref.suonoSaldo, 'saldo-devastante');
  const siglaAccesa = () => pref.siglaAccesa !== false;
  const occhioAcceso = () => pref.occhioAcceso !== false;
  const suoniMovimenti = () => pref.suoniMovimenti !== false;
  // col microfono aperto niente suoni (li registrerebbe); mentre scarica o trascrive sì: prima tacevano anche lì (24/11/2026)
  const micAperto = () => statoVoce === 'ascolto';
  function suonaMovimento(nome) { if (S && suoniMovimenti() && !micAperto()) S.suona(nome); }
  let togliSigla = null, nascostaDa = 0;
  function sigla() {
    if (!S) return;
    if (togliSigla) { togliSigla(); togliSigla = null; }
    if (!siglaAccesa()) return;
    const festa = festaDiOggi();
    const nome = festa && festa.suono ? festa.suono : suonoSigla();
    S.provaSubito(nome).then(subito => {
      if (pref.siglaSubito !== subito) { pref.siglaSubito = subito; scriviPref(); }
      if (subito) { brillaTitolo(); return; }
      togliSigla = S.alPrimoTocco(e => {
        togliSigla = null;
        const t = e && e.target && e.target.closest ? e.target : null;
        if (micAperto() || (t && t.closest('#microfono'))) return;
        brillaTitolo();
        if (t && t.closest('#occhio, #occhioSaldi, #heroValore')) return;   // quel tasto ha il suo suono, e vince lui
        S.suona(nome);
      }, 12000);
    });
  }
  // l'occhio: il suo suono quando SCOPRE il numero, subito, anche sopra la sigla; quando lo ricopre niente. Sua scelta del
  // 25/11/2026, dopo averlo provato a ogni tocco (24/11 sera): «voglio che parta solamente quando schiaccio per vedere il numero».
  // 18/11/2026: «un rumore diverso quando schiaccio l'occhio su digitale rispetto a contanti e cripto»: guardando un
  // conto, il suo (banconote, il bip del POS, una moneta digitale); su «Tutto» quello scelto. «Nessuno» li spegne tutti.
  function suonaSaldo(conto) {
    if (!S) return;
    if (micAperto() || !occhioAcceso()) { S.nota('occhio zitto: ' + (micAperto() ? 'microfono aperto' : 'spento in Suoni')); return; }
    const c = conto === undefined ? vista.conto : conto;
    S.suona(c && S.CONTI[c] ? S.CONTI[c] : suonoSaldo());
  }
  // «Devastanti» si accende: all'apertura, e di nuovo con la sigla
  function brillaTitolo() {
    const t = document.querySelector('.titolo-giu');
    if (!t) return;
    t.classList.remove('brilla');
    void t.offsetWidth;   // per farla ripartire
    t.classList.add('brilla');
  }
  const pocoMovimento = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // le righe appena salvate si accendono un attimo, così si vede dove sono finite
  function illumina(ids) {
    if (!ids.size) return;
    document.querySelectorAll('#lista .mov').forEach(r => { if (ids.has(r.dataset.id)) r.classList.add('appena'); });
  }
  // un'entrata: una manciata di monete che salta su dal tasto Salva
  function pioggiaDiMonete(r) {
    if (pocoMovimento() || !r || !r.width || !document.body.animate) return;
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const simbolo = (festaDiOggi() || {}).moneta || '🪙';   // a Natale 🎁, a Halloween 🍬…
    for (let i = 0; i < 9; i++) {
      const m = el('span', 'moneta', simbolo);
      m.style.left = x0 + 'px'; m.style.top = y0 + 'px';
      document.body.appendChild(m);
      const dx = (Math.random() - 0.5) * 220, su = 90 + Math.random() * 120, giro = (Math.random() - 0.5) * 540;
      m.animate([
        { transform: 'translate(-50%, -50%) scale(0.6) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% - ${su}px)) scale(1.1) rotate(${giro / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% - ${su * 0.35}px)) scale(0.9) rotate(${giro}deg)`, opacity: 0 }
      ], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.3,1)', delay: i * 25 }).onfinish = () => m.remove();
    }
  }

  // ---------------------------------------------------------------- i suoni del creatore (18/11/2026)
  // Francesco: «una modalità che si chiama suoni del creatore, dove posso schiacciare e provare tutti i suoni che ci
  // sono, e posso farlo solamente io: per mostrarlo a qualcuno, o per ascoltarmelo da solo e divertirmici». Una
  // tastiera di tutti i suoni, divisi per gruppo, più uno a caso. Solo nella sua edizione (ED.nome 'principale').
  const TAVOLA_SUONI = [
    ['Sigle', [['sigla-oro', '🏆', 'Fanfara d\'oro'], ['sigla-fanfara', '🎺', 'Fanfara'], ['sigla-corno', '📯', 'Corno di guerra'], ['sigla-tada', '✨', 'Ta-da']]],
    ['Saldo', [['saldo-devastante', '💥', 'Devastante'], ['saldo-cassa', '🧾', 'Cassa'], ['saldo-tesoro', '💎', 'Tesoro']]],
    ['Conti', [['saldo-contanti', '💶', 'Banconote'], ['saldo-digitale', '💳', 'POS'], ['saldo-cripto', '🪙', 'Moneta digitale']]],
    ['Movimenti', [['entrata', '💰', 'Entrata'], ['uscita', '🪙', 'Uscita'], ['spostamento', '↔️', 'Spostamento'], ['elimina', '🗑️', 'Cestino']]],
    ['Feste', [['festa-natale', '🎄', 'Natale'], ['festa-capodanno', '🍾', 'Capodanno'], ['festa-trombetta', '🎉', 'Trombetta'],
      ['festa-halloween', '🎃', 'Halloween'], ['festa-pasqua', '🔔', 'Pasqua']]]
  ];
  function apriCreatore() {
    apriFoglio('Suoni del creatore', corpo => {
      const tutti = TAVOLA_SUONI.flatMap(([, l]) => l);
      const suona = (b, id) => {
        S.suona(id);
        b.classList.remove('suona');
        void b.offsetWidth;   // per far ripartire l'animazione
        b.classList.add('suona');
      };
      const caso = tasto('tasto-primario creatore-caso', '🎲 Uno a caso', () => {
        const [id, icona, nome] = tutti[Math.floor(Math.random() * tutti.length)];
        caso.textContent = '🎲 ' + icona + ' ' + nome;
        suona(caso, id);
      });
      caso.id = 'creatoreCaso';
      corpo.appendChild(caso);
      for (const [titolo, lista] of TAVOLA_SUONI) {
        corpo.appendChild(el('div', 'titoletto', titolo));
        const g = el('div', 'creatore-griglia');
        for (const [id, icona, nome] of lista) {
          const b = tasto('creatore-tasto', '', () => suona(b, id));
          b.dataset.suono = id;
          b.appendChild(el('span', 'creatore-icona', icona));
          b.appendChild(el('span', 'creatore-nome', nome));
          g.appendChild(b);
        }
        corpo.appendChild(g);
      }
      corpo.appendChild(el('p', 'nota', 'Col silenzioso non si sentono.'));
    });
  }

  const impostazioniSuoni = () => 'sigla ' + (siglaAccesa() ? suonoSigla() : 'spenta') + ' · occhio ' + (occhioAcceso() ? suonoSaldo() : 'spento') + ' · salva ed elimina ' + (suoniMovimenti() ? 'sì' : 'spenti');
  function apriSuoni() {
    apriFoglio('Suoni', corpo => {
      const gruppo = (titolo, lista, attuale, salva) => {
        corpo.appendChild(el('div', 'titoletto', titolo));
        const g = el('div', 'elenco-azioni');
        for (const a of lista) {
          const b = tasto('azione scelta-suono', a.nome, () => {
            salva(a.id);
            scriviPref();
            S.suona(a.id);
            if (a.id.startsWith('sigla-')) brillaTitolo();
            apriSuoni();
          });
          b.dataset.suono = a.id;
          b.setAttribute('aria-pressed', String(a.id === attuale));
          g.appendChild(b);
        }
        corpo.appendChild(g);
      };
      // tre levette: cosa suona e cosa no si vede subito
      for (const [chiave, testo, acceso] of [['siglaAccesa', 'Sigla all\'apertura', siglaAccesa()], ['occhioAcceso', 'Occhio del saldo', occhioAcceso()], ['suoniMovimenti', 'Salva ed Elimina', suoniMovimenti()]]) {
        const l = interruttore(testo, acceso);
        l.casella.id = chiave;
        l.casella.addEventListener('change', () => { pref[chiave] = l.casella.checked; scriviPref(); S.nota(testo + ': ' + (l.casella.checked ? 'acceso' : 'spento')); });
        corpo.appendChild(l.etichetta);
      }
      gruppo('Sigla', S.SIGLE, suonoSigla(), id => { pref.suonoSigla = id; });
      corpo.appendChild(el('p', 'nota-campo', pref.siglaSubito === true
        ? 'Parte appena apri l\'app.'
        : pref.siglaSubito === false
          ? 'Parte al primo tocco.'
          : 'Parte all\'apertura o al primo tocco.'));
      gruppo('Occhio, su Tutto', S.SALDO, suonoSaldo(), id => { pref.suonoSaldo = id; });
      corpo.appendChild(el('p', 'nota-campo', 'Sui singoli conti:'));
      const pc = el('div', 'chips');
      pc.style.marginTop = '8px';
      for (const [c, cosa] of [['contanti', '💶 Banconote'], ['digitale', '💳 POS'], ['cripto', '🪙 Moneta digitale']]) {
        const b = tasto('chip senza-freccia', '▶ ' + cosa, () => S.suona(S.CONTI[c]));
        b.dataset.suonoConto = c;
        pc.appendChild(b);
      }
      corpo.appendChild(pc);
      corpo.appendChild(el('div', 'titoletto', 'Salva ed Elimina'));
      const prove = el('div', 'chips');
      prove.style.marginTop = '10px';
      for (const [nome, cosa] of [['entrata', '💰 Entrata'], ['uscita', '🪙 Uscita'], ['spostamento', '↔ Spostamento'], ['elimina', '🗑️ Elimina']]) {
        prove.appendChild(tasto('chip senza-freccia', '▶ ' + cosa, () => S.suona(nome)));
      }
      corpo.appendChild(prove);
      const sal = S.salute();
      corpo.appendChild(el('p', 'nota', 'Col silenzioso non suonano.' + (ED.nome === 'principale' && sal.chiesti
        ? ' Persi ' + sal.persi + ' su ' + sal.chiesti + (sal.ms.length ? ', in media ' + secondi(sal.ms.reduce((x, y) => x + y, 0) / sal.ms.length) : '') + '.' : '')));
      if (ED.nome === 'principale') {
        const dia = tasto('tasto-secondario', 'Copia diagnosi', async () => {
          mostraToast((await copiaTesto('Versione ' + VERSIONE + '\n' + impostazioniSuoni() + '\n' + S.diario())) === false ? 'Non copiato' : 'Copiata');
        });
        dia.id = 'copiaDiagnosi';
        dia.style.margin = '16px 10px 0 0';
        corpo.appendChild(dia);
      }
      const cred = tasto('tasto-secondario', 'Da dove vengono', apriCrediti);
      cred.style.marginTop = '16px';
      corpo.appendChild(cred);
    });
  }

  // ================================================================ feste e santo del giorno (18/11/2026)
  // Francesco: «quando c'è un giorno di festa voglio che ci sia qualcosa a tema», e «scrivimi in piccolo, in alto a
  // sinistra, sotto la data, il nome del santo di oggi: può essere un buon aggancio per fare gli auguri».
  // Le feste stanno in feste.js; nei loro giorni: il saluto sotto la data, i colori del titolo, la pioggia di simboli
  // all'apertura, il suono della festa al posto della sigla (se c'è), le monete delle entrate a tema. Il compleanno lo
  // scrive lui in Menù → Feste e santi e resta sul telefono. Il santo da santi.json (fai_santi.py, da Wikipedia).
  const F = window.Feste;
  const festeAccese = () => pref.feste !== false;
  let festaProva = null;   // l'anteprima dal menù: { festa, fino }
  function festaDiOggi() {
    if (festaProva && Date.now() < festaProva.fino) return festaProva.festa;
    return F && festeAccese() ? F.festaDi(oggi(), pref.compleanno) : null;
  }
  let santi = null;
  fetch('santi.json').then(r => (r.ok ? r.json() : null)).then(s => { if (s && typeof s === 'object') { santi = s; disegnaGiornata(); } }).catch(() => {});
  const santoDi = d => (santi ? santi[String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')] || null : null);
  function disegnaGiornata() {
    const f = festaDiOggi(), s = santoDi(oggi());
    $('festa').hidden = !f;
    $('festa').textContent = f ? f.saluto : '';
    $('santo').hidden = !s;
    // «Oggi è Sant'Ilario», ma «Oggi: Dedicazione delle basiliche…» per le celebrazioni che non sono una persona
    $('santo').textContent = s ? (/^(San|Sant|Santa|Santi|Sante|Santo|Beata|Madonna|Maria|Nostra)\b|^Sant'/i.test(s) ? 'Oggi è ' : 'Oggi: ') + s : '';
    // i colori della festa sul titolo infuocato; non sul titolo semplice delle edizioni degli amici («Conti», bianco),
    // dove il colore non è ritagliato sulle lettere e farebbe un rettangolo
    const t = document.querySelector('.titolo-giu');
    if (t && t.previousElementSibling) t.style.backgroundImage = f ? 'linear-gradient(100deg, ' + f.colori.join(', ') + ')' : '';
    document.body.dataset.festa = f ? f.id : '';
  }
  // una pioggia di simboli della festa, per qualche secondo; poi sparisce
  function pioggiaFesta(f) {
    if (!f || pocoMovimento() || !document.body.animate) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = 0; i < 24; i++) {
      const s = el('span', 'festa-particella', f.simboli[i % f.simboli.length]);
      s.style.left = Math.round(Math.random() * (w - 20)) + 'px';
      s.style.fontSize = Math.round(18 + Math.random() * 16) + 'px';
      document.body.appendChild(s);
      const dx = (Math.random() - 0.5) * 140, giro = (Math.random() - 0.5) * 360;
      s.animate([
        { transform: 'translate(0, -50px) rotate(0deg)', opacity: 0 },
        { opacity: 1, offset: 0.08 },
        { transform: `translate(${dx}px, ${h + 50}px) rotate(${giro}deg)`, opacity: 0.85 }
      ], { duration: 2800 + Math.random() * 2600, delay: Math.random() * 1600, easing: 'linear', fill: 'both' }).onfinish = () => s.remove();
    }
  }
  // «▶ Prova» dal menù: la festa per qualche secondo, con pioggia e suono, per vederla prima che arrivi
  function anteprimaFesta(id) {
    const f = F && F.perId(id);
    if (!f) return;
    festaProva = { festa: f, fino: Date.now() + 9000 };
    chiudiFoglio();
    disegnaGiornata();
    brillaTitolo();
    pioggiaFesta(f);
    if (S && siglaAccesa()) S.suona(f.suono || suonoSigla());
    setTimeout(() => { festaProva = null; disegnaGiornata(); }, 9100);
  }
  function apriFeste() {
    apriFoglio('Feste e santi', corpo => {
      const on = interruttore('Feste a tema', festeAccese());
      on.casella.id = 'festeAccese';
      on.casella.addEventListener('change', () => { pref.feste = on.casella.checked; scriviPref(); disegnaGiornata(); });
      corpo.appendChild(on.etichetta);
      // il compleanno: giorno e mese, senza anno; resta solo sul telefono
      corpo.appendChild(el('div', 'titoletto', 'Il tuo compleanno'));
      const riga = el('div', 'riga-date');
      const selG = el('select'), selM = el('select');
      selG.id = 'compleannoGiorno'; selM.id = 'compleannoMese';
      selG.appendChild(new Option('—', ''));
      for (let g = 1; g <= 31; g++) selG.appendChild(new Option(String(g), String(g).padStart(2, '0')));
      selM.appendChild(new Option('—', ''));
      MESI.forEach((m, i) => selM.appendChild(new Option(maiuscola(m), String(i + 1).padStart(2, '0'))));
      if (pref.compleanno) { selM.value = pref.compleanno.slice(0, 2); selG.value = pref.compleanno.slice(3, 5); }
      // si salva quando ci sono giorno e mese; con uno solo si aspetta l'altro (rifacendo il foglio si perdeva il primo)
      const salvaCompleanno = () => {
        const g = selG.value, m = selM.value;
        if (g && m) pref.compleanno = m + '-' + g;
        else if (pref.compleanno || (!g && !m)) pref.compleanno = null;
        else return;
        scriviPref();
        disegnaGiornata();
        apriFeste();
      };
      selG.addEventListener('change', salvaCompleanno); selM.addEventListener('change', salvaCompleanno);
      riga.appendChild(campo('Giorno', selG));
      riga.appendChild(campo('Mese', selM));
      corpo.appendChild(riga);
      corpo.appendChild(el('p', 'nota-campo', 'Resta solo su questo telefono.'));
      // le prossime feste, ognuna da provare
      corpo.appendChild(el('div', 'titoletto', 'Le prossime feste'));
      const lista = el('div', 'elenco-righe');
      lista.id = 'prossimeFeste';
      for (const { festa, data } of F.prossime(oggi(), 10, pref.compleanno)) {
        const r = el('div', 'festa-riga');
        const testi = el('span', 'festa-testi');
        testi.appendChild(el('span', 'festa-nome', festa.saluto.split(' ')[0] + ' ' + festa.nome));
        const tra = Math.round((data - oggi()) / GIORNO_MS);
        testi.appendChild(el('span', 'festa-quando', (tra === 0 ? 'Oggi' : etichettaGiorno(A.isoDa(data))) + (tra > 1 ? ' · tra ' + tra + ' giorni' : '') + (festa.suono ? ' · col suono' : '')));
        r.appendChild(testi);
        const prova = tasto('tasto-piccolo', '▶ Prova', () => anteprimaFesta(festa.id));
        prova.dataset.festa = festa.id;
        r.appendChild(prova);
        lista.appendChild(r);
      }
      corpo.appendChild(lista);
      // il santo
      corpo.appendChild(el('div', 'titoletto', 'Il santo del giorno'));
      const domani = new Date(oggi().getFullYear(), oggi().getMonth(), oggi().getDate() + 1);
      const righe = el('div', 'aut-righe');
      for (const [nome, d] of [['Oggi', oggi()], ['Domani', domani]]) {
        const x = el('div', 'aut-riga');
        x.appendChild(el('span', '', nome));
        x.appendChild(el('span', '', santoDi(d) || '—'));
        righe.appendChild(x);
      }
      corpo.appendChild(righe);
      corpo.appendChild(el('p', 'nota', 'Dai calendari di oggi e di una volta (Wikipedia).'));
    });
  }

  // ================================================================ il dettaglio dei mesi di autonomia (18/11/2026)
  // Toccando il riquadro: i soldi che contano, la spesa media mese per mese e tutte le spese fisse divise per categoria,
  // con le entrate, gli investimenti e gli spostamenti fissi a parte. Guardando un conto, il suo saldo e i suoi fissi.
  // Un fisso si tocca per modificarlo, e si torna qui.
  function apriAutonomia(conto) {
    if (conto === undefined) conto = vista.conto;
    const torna = () => apriAutonomia(conto);
    apriFoglio(conto ? 'Saldo ' + inConto(conto) : 'Mesi di autonomia', corpo => {
      const occhio = tasto('tasto-piccolo angolo', saldoVisibile ? '🙈 Nascondi' : '👁 Mostra', () => { cambiaOcchio(!saldoVisibile, conto); torna(); });
      occhio.id = 'autOcchio';
      corpo.appendChild(occhio);
      const righe = () => { const r = el('div', 'aut-righe'); corpo.appendChild(r); return r; };
      let spendibili = null;
      if (conto) {
        const v = saldoAttuale(conto), s = stato.saldi[conto];
        corpo.appendChild(el('p', 'aut-mesi', v === null ? 'Da inserire' : saldoEuro(v)));
        if (s) {
          // da quando l'ha inserito: entrate, uscite e spostamenti di questo conto
          let e = 0, u = 0, dentro = 0, fuori = 0;
          const oggiIso = isoOggi();
          for (const m of stato.movimenti) {
            if (m.data > oggiIso || !(m.data > s.data || (m.data === s.data && (m.creato || '') > (s.aggiornato || ''))) || !tocca(m, conto)) continue;
            if (eSpostamento(m)) { if (m.verso === conto) dentro += m.importo; else fuori += m.importo; }
            else if (m.tipo === 'entrata') e += m.importo; else u += m.importo;
          }
          const r = righe();
          rigaSaldo(r, 'Saldo inserito ' + etichettaGiorno(s.data).toLowerCase(), saldoEuro(s.importo), () => apriSaldo(conto));
          rigaSaldo(r, 'Entrate da allora', '+' + euro(e));
          rigaSaldo(r, 'Uscite da allora', '−' + euro(u));
          if (dentro || fuori) rigaSaldo(r, 'Spostamenti da allora', (dentro ? '+' + euro(dentro) : '') + (dentro && fuori ? ' ' : '') + (fuori ? '−' + euro(fuori) : ''));
          rigaSaldo(r, 'Oggi', saldoEuro(v), null, true);
        } else {
          const b = tasto('tasto-secondario', 'Inserisci il saldo', () => apriSaldo(conto));
          b.style.marginTop = '8px';
          corpo.appendChild(b);
        }
      } else {
        const a = calcoloAutonomia();
        spendibili = a.spendibili;
        corpo.appendChild(el('p', 'aut-mesi', a.mesi !== null ? formatoMesi(a.mesi) : '—'));
        corpo.appendChild(el('p', 'aut-testo', a.spiegazione));
        corpo.appendChild(el('div', 'titoletto', 'I soldi che contano'));
        const r = righe();
        for (const c of CONTI_LIQUIDI) rigaSaldo(r, nomeConto(c) + ' oggi', a.saldi[c] !== null ? saldoEuro(a.saldi[c]) : 'da inserire', () => apriSaldo(c));
        if (a.sa !== null) {
          if (a.ft) rigaSaldo(r, 'Da tenere per le tasse', a.tasse ? '−' + euro(a.tasse) : euro(0));
          rigaSaldo(r, 'Spendibili', saldoEuro(a.spendibili), null, true);
        }
        rigaSaldo(r, nomeConto('cripto') + ' · non conta', a.saldi.cripto !== null ? saldoEuro(a.saldi.cripto) : 'da inserire', () => apriSaldo('cripto'));
        corpo.appendChild(el('div', 'titoletto', 'La spesa media'));
        if (a.sm) {
          const r2 = righe();
          for (const [k, v] of a.sm.dettaglio) rigaSaldo(r2, maiuscola(MESI[Number(k.slice(5)) - 1]) + ' ' + k.slice(0, 4), euro(v));
          rigaSaldo(r2, 'Media al mese', euro(a.sm.media), null, true);
          corpo.appendChild(el('p', 'nota-campo', 'Mesi finiti, investimenti esclusi.'));
        } else {
          corpo.appendChild(el('p', 'aut-testo', 'Serve un mese intero di spese.'));
        }
      }
      // le spese fisse, per categoria
      const fissi = stato.ricorrenti.filter(r => tocca(r, conto));
      const attivi = l => l.filter(r => r.attivo);
      const somma = l => attivi(l).reduce((x, r) => x + r.importo, 0);
      const uscite = fissi.filter(r => r.tipo === 'uscita'), vere = uscite.filter(spesaVera), invest = uscite.filter(r => !spesaVera(r));
      const entrate = fissi.filter(r => r.tipo === 'entrata'), sposta = fissi.filter(eSpostamento);
      corpo.appendChild(el('div', 'titoletto', 'Spese fisse' + (conto ? ' ' + inConto(conto) : ', per categoria')));
      if (!fissi.length) {
        corpo.appendChild(el('p', 'aut-testo', 'Nessun movimento fisso' + (conto ? ' ' + inConto(conto) : '') + '.'));
      } else {
        const tot = somma(vere);
        corpo.appendChild(el('p', 'riassunto', 'Al mese: uscite fisse ' + euro(tot) + (somma(invest) ? ' · investimenti ' + euro(somma(invest)) : '') + (somma(entrate) ? ' · entrate ' + euro(somma(entrate)) : '')));
        if (spendibili > 0 && tot > 0) corpo.appendChild(el('p', 'aut-testo', 'Con le sole spese fisse reggeresti ' + formatoMesi(spendibili / tot) + '.'));
        const voceFisso = (box, r) => {
          const b = el('button', 'mov fisso-riga' + (r.attivo ? '' : ' in-pausa'));
          b.type = 'button';
          b.dataset.fisso = r.id;
          b.appendChild(riquadro(eSpostamento(r) ? '↔' : iconaDi(r.tipo, r.categoria)));
          const testi = el('span', 'mov-testi');
          testi.appendChild(el('span', 'mov-desc', r.descrizione));
          testi.appendChild(el('span', 'mov-cat', 'ogni ' + r.giorno + ' del mese · ' + (eSpostamento(r) ? etichettaConto(r) : infoConto(contoDi(r)).icona) + (r.attivo ? '' : ' · in pausa')));
          b.appendChild(testi);
          b.appendChild(el('span', 'mov-importo ' + r.tipo, segnoDi(r.tipo) + euro(r.importo)));
          b.addEventListener('click', () => apriFisso(r, torna));
          box.appendChild(b);
        };
        const gruppo = (titolo, lista, nota) => {
          if (!lista.length) return;
          const box = el('div', 'fissi-gruppo');
          const t = el('div', 'fissi-titolo');
          t.appendChild(el('span', '', titolo));
          t.appendChild(el('span', 'fissi-totale', euro(somma(lista)) + (nota ? ' · ' + nota : '')));
          box.appendChild(t);
          lista.slice().sort((a, b) => a.giorno - b.giorno).forEach(r => voceFisso(box, r));
          corpo.appendChild(box);
        };
        const perCat = new Map();
        for (const r of vere) { if (!perCat.has(r.categoria)) perCat.set(r.categoria, []); perCat.get(r.categoria).push(r); }
        [...perCat.entries()].sort((x, y) => somma(y[1]) - somma(x[1]))
          .forEach(([cat, l]) => gruppo(iconaDi('uscita', cat) + ' ' + cat, l, tot ? percento(somma(l), tot) : ''));
        gruppo(iconaDi('uscita', catInvestimenti()) + ' ' + catInvestimenti(), invest, 'non contano nei mesi');
        gruppo('💰 Entrate fisse', entrate, '');
        gruppo('↔ Spostamenti fissi', sposta, 'non contano');
      }
      const tasti = el('div', 'riga-tasti');
      tasti.appendChild(tasto('tasto-secondario', '＋ Aggiungi un fisso', () => apriFisso(null, torna)));
      tasti.appendChild(tasto('tasto-secondario', conto ? 'Correggi saldo' : 'Correggi saldi', () => apriSaldo(conto || undefined)));
      corpo.appendChild(tasti);
    });
  }

  // ================================================================ tutti i movimenti, dal… al…, e cerca (17/11/2026 sera)
  // Una vista sola per scorrere tutto (anche gli anni passati, dal più recente), scegliere il periodo («dal 20 aprile
  // al 15 maggio») e cercare. In cima il resoconto: quanti, entrate, uscite, la differenza (dietro l'occhio, come il
  // saldo) e le spese per categoria. Si apre da «Tutti i movimenti» sotto gli ultimi 10 o dalla lente (cursore nella
  // ricerca). Le righe si costruiscono a blocchi mentre scorre: con anni di movimenti non si blocca.
  // La ricerca, rifatta il 17/11 sera («serata lazy child» non lo trovava): il correttore dell'iPhone era acceso nel campo e
  // cambiava le parole inglesi; ora è spento. Cerca anche nella frase originale, accetta una lettera sbagliata nelle
  // parole lunghe (due dalle 7 lettere) e, se nessun movimento ha tutte le parole, mostra quelli che ne hanno di più e lo dice.
  const pezzi = s => A.normalizza(s).split(/[\s·→()«»"!?;:/]+/).filter(Boolean);
  function distanza(a, b, tetto) {   // quante lettere cambiano fra a e b; si ferma appena supera il tetto
    if (Math.abs(a.length - b.length) > tetto) return tetto + 1;
    let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const riga = [i];
      let minimo = i;
      for (let j = 1; j <= b.length; j++) {
        riga[j] = Math.min(prec[j] + 1, riga[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (riga[j] < minimo) minimo = riga[j];
      }
      if (minimo > tetto) return tetto + 1;
      prec = riga;
    }
    return prec[b.length];
  }
  function cercabile(m) {
    const imp = (m.importo / 100).toFixed(2);
    const testo = A.normalizza([m.descrizione, m.testo || '', m.categoria, eSpostamento(m) ? etichettaConto(m) : nomeConto(contoDi(m)),
      etichettaTipo(m.tipo), imp, imp.replace('.', ','), euro(m.importo), m.data.slice(8, 10) + '/' + m.data.slice(5, 7)].join(' '));
    return { testo, parole: pezzi(testo) };
  }
  // la parola w è nel movimento: dentro il testo, o una parola quasi uguale (anche solo l'inizio, se la sta scrivendo)
  function somiglia(w, c) {
    if (c.testo.includes(w)) return true;
    if (w.length < 4 || /\d/.test(w)) return false;
    const k = w.length >= 7 ? 2 : 1;
    return c.parole.some(p => distanza(w, p, k) <= k || (p.length > w.length && distanza(w, p.slice(0, w.length), k) <= k));
  }
  function cerca(q, lista) {
    const parole = pezzi(q);
    lista = lista || stato.movimenti;
    if (!parole.length) return { trovati: lista, parziali: false, parole: 0, quante: 0 };
    const tutte = [], conPunti = [];
    for (const m of lista) {
      const c = cercabile(m);
      let n = 0;
      for (const w of parole) if (somiglia(w, c)) n++;
      if (n === parole.length) tutte.push(m);
      else if (n) conPunti.push([n, m]);
    }
    if (tutte.length || !conPunti.length) return { trovati: tutte, parziali: false, parole: parole.length, quante: parole.length };
    const quante = Math.max(...conPunti.map(x => x[0]));
    return { trovati: conPunti.filter(x => x[0] === quante).map(x => x[1]), parziali: true, parole: parole.length, quante };
  }

  const PERIODI = [['mese', 'Questo mese'], ['scorso', 'Mese scorso'], ['tre', 'Ultimi 3 mesi'], ['anno', 'Quest\'anno'], ['tutto', 'Tutto']];
  function intervallo(f) {
    const d = oggi(), y = d.getFullYear(), mm = d.getMonth();
    const primo = (a, m) => A.isoDa(new Date(a, m, 1)), ultimo = (a, m) => A.isoDa(new Date(a, m + 1, 0));
    if (f.periodo === 'mese') return [primo(y, mm), ultimo(y, mm)];
    if (f.periodo === 'scorso') return [primo(y, mm - 1), ultimo(y, mm - 1)];
    if (f.periodo === 'tre') return [primo(y, mm - 2), ultimo(y, mm)];
    if (f.periodo === 'anno') return [y + '-01-01', y + '-12-31'];
    if (f.periodo === 'scelto') return [f.da, f.a];
    return [null, null];
  }
  const BLOCCO = 80;
  // opz: { periodo, da, a, conto, categoria ({ tipo, nome }), testo, cerca (cursore nella ricerca), filtri (per tornare com'era) }
  function apriMovimenti(opz) {
    opz = opz || {};
    const f = opz.filtri || { testo: opz.testo || '', periodo: opz.periodo || 'tutto', da: opz.da || null, a: opz.a || null,
      conto: opz.conto !== undefined ? opz.conto : vista.conto, categoria: opz.categoria || null, mostrati: BLOCCO, scorso: 0 };
    let osservatore = null, timer = null;
    apriFoglio('Movimenti', corpo => {
      const inp = el('input');
      inp.type = 'search';
      inp.id = 'testoCerca';
      inp.value = f.testo;
      inp.placeholder = 'Cerca';
      // il correttore dell'iPhone cambiava le parole («lazy» → altro): spento
      for (const [k, v] of [['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false'], ['enterkeyhint', 'search']]) inp.setAttribute(k, v);
      const c = el('label', 'campo cerca-campo');
      c.appendChild(inp);
      corpo.appendChild(c);
      const chips = el('div', 'chips periodi');
      chips.id = 'periodiMovimenti';
      const bottoni = PERIODI.map(([k, nome]) => {
        const b = tasto('chip senza-freccia', nome, () => { f.periodo = k; f.mostrati = BLOCCO; aggiorna(true); });
        b.dataset.periodo = k;
        chips.appendChild(b);
        return b;
      });
      corpo.appendChild(chips);
      const date = el('div', 'riga-date');
      const inDa = el('input'); inDa.type = 'date'; inDa.id = 'movDa';
      const inA = el('input'); inA.type = 'date'; inA.id = 'movA';
      const cambia = () => {
        const valido = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
        let da = valido(inDa.value) ? inDa.value : null, a = valido(inA.value) ? inA.value : null;
        if (da && a && da > a) { const x = da; da = a; a = x; }
        Object.assign(f, { periodo: 'scelto', da, a, mostrati: BLOCCO });
        aggiorna(true);
      };
      inDa.addEventListener('change', cambia); inA.addEventListener('change', cambia);
      date.appendChild(campo('Dal', inDa));
      date.appendChild(campo('Al', inA));
      corpo.appendChild(date);
      const conti = el('div', 'segmentato largo conti-mov');
      conti.id = 'contoMovimenti';
      const bConti = [[null, '💰 Tutti']].concat(A.CONTI.map(x => [x.id, x.icona + ' ' + x.nome])).map(([id, nome]) => {
        const b = tasto('', nome, () => { f.conto = id; f.mostrati = BLOCCO; aggiorna(true); });
        b.dataset.conto = id || '';
        conti.appendChild(b);
        return b;
      });
      corpo.appendChild(conti);
      const cat = tasto('chip piccolo', '', () => { f.categoria = null; f.mostrati = BLOCCO; aggiorna(true); });
      cat.id = 'categoriaMovimenti';
      corpo.appendChild(cat);
      const res = el('div', 'resoconto');
      res.id = 'movResoconto';
      corpo.appendChild(res);
      const lista = el('div', 'risultati');
      lista.id = 'risultatiCerca';
      corpo.appendChild(lista);

      let righe = [], mese = null, giorno = null, fatte = 0, sentinella = null;
      // le uscite di ogni mese, per il titolo del mese (un passaggio solo)
      let uscitePerMese = new Map(), uscitePerGiorno = new Map();
      const altre = n => {
        const fino = Math.min(righe.length, fatte + n);
        const oggiIso = isoOggi();
        const frammento = document.createDocumentFragment();
        for (; fatte < fino; fatte++) {
          const m = righe[fatte];
          const k = m.data.slice(0, 7);
          if (k !== mese) {
            mese = k;
            const t = el('div', 'mese-titolo');
            t.appendChild(el('span', '', maiuscola(MESI[Number(k.slice(5)) - 1]) + ' ' + k.slice(0, 4)));
            if (uscitePerMese.get(k)) t.appendChild(el('span', 'mese-uscite', 'uscite ' + euro(uscitePerMese.get(k))));
            frammento.appendChild(t);
          }
          if (m.data !== giorno) {
            giorno = m.data;
            const futuro = m.data > oggiIso;
            frammento.appendChild(titoloGiorno(m.data, futuro, uscitePerGiorno.get(m.data) || 0));
          }
          frammento.appendChild(rigaMovimento(m, {
            prima: () => { f.mostrati = Math.max(BLOCCO, fatte); f.scorso = $('foglio').scrollTop; },
            dopo: () => apriMovimenti({ filtri: f })
          }, f.conto));
        }
        if (sentinella) sentinella.remove();
        lista.appendChild(frammento);
        sentinella = null;
        if (fatte < righe.length) {
          sentinella = tasto('tasto-secondario altri', 'Mostra altri ' + Math.min(BLOCCO, righe.length - fatte) + ' (ne restano ' + (righe.length - fatte) + ')', () => altre(BLOCCO));
          lista.appendChild(sentinella);
          if (osservatore) { osservatore.disconnect(); osservatore.observe(sentinella); }
        }
      };
      const aggiorna = inCima => {
        f.testo = inp.value;
        const [da, a] = intervallo(f);
        bottoni.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.periodo === f.periodo)));
        bConti.forEach(b => b.setAttribute('aria-pressed', String((b.dataset.conto || null) === f.conto)));
        cat.hidden = !f.categoria;
        cat.textContent = f.categoria ? 'Solo ' + f.categoria.nome : '';
        const base = stato.movimenti.filter(m => (!da || m.data >= da) && (!a || m.data <= a) && tocca(m, f.conto) &&
          (!f.categoria || (m.tipo === f.categoria.tipo && m.categoria === f.categoria.nome)));
        let primo = '9999', ultimo = '';
        for (const m of base) { if (m.data < primo) primo = m.data; if (m.data > ultimo) ultimo = m.data; }
        inDa.value = da || (base.length ? primo : isoOggi());
        inA.value = a || (ultimo > isoOggi() ? ultimo : isoOggi());
        const r = cerca(f.testo, base);
        righe = r.trovati.slice().sort(piuRecenti);
        uscitePerMese = new Map();
        uscitePerGiorno = new Map();
        for (const m of righe) if (m.tipo === 'uscita' && (!f.conto || contoDi(m) === f.conto)) {
          uscitePerMese.set(m.data.slice(0, 7), (uscitePerMese.get(m.data.slice(0, 7)) || 0) + m.importo);
          uscitePerGiorno.set(m.data, (uscitePerGiorno.get(m.data) || 0) + m.importo);
        }
        disegnaResoconto(res, righe, f, r, inDa.value, inA.value, () => aggiorna(false));
        lista.textContent = '';
        mese = null; giorno = null; fatte = 0; sentinella = null;
        if (!righe.length) {
          lista.appendChild(el('p', 'vuoto', f.testo.trim() ? 'Nessun movimento con «' + f.testo.trim() + '» in questo periodo.' : 'Nessun movimento in questo periodo.'));
          return;
        }
        altre(Math.max(BLOCCO, f.mostrati || 0));
        if (inCima && $('foglio').scrollTop > 0) $('foglio').scrollTop = 0;
      };
      inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { f.mostrati = BLOCCO; aggiorna(false); }, 150); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      if ('IntersectionObserver' in window) {
        osservatore = new IntersectionObserver(voci => { if (voci.some(v => v.isIntersecting) && sentinella) altre(BLOCCO); }, { root: $('foglio'), rootMargin: '400px' });
      }
      aggiorna(false);
    }, () => { if (osservatore) osservatore.disconnect(); clearTimeout(timer); });
    // tornando da una modifica: al punto di prima
    if (opz.filtri && f.scorso) $('foglio').scrollTop = f.scorso;
    // dalla lente: il cursore nella ricerca, dentro il tocco (sull'iPhone così si apre la tastiera)
    if (opz.cerca) { const i = $('testoCerca'); i.focus(); i.select(); }
  }
  // il resoconto in cima: quanti, entrate, uscite, la differenza dietro l'occhio, le uscite e le entrate per categoria
  function disegnaResoconto(box, righe, f, r, da, a, ridisegna) {
    box.textContent = '';
    const t = totali(righe, f.conto);
    const quando = f.periodo === 'tutto' ? 'Da sempre: ' + testoPeriodo(da, a).replace(/^D/, 'd') : testoPeriodo(da, a);
    box.appendChild(el('p', 'res-titolo', quando + ' · ' + righe.length + (righe.length === 1 ? ' movimento' : ' movimenti') + (f.conto ? ' ' + inConto(f.conto) : '')));
    if (r.parziali) box.appendChild(el('p', 'avviso', 'Nessun movimento ha tutte le parole: questi ne hanno ' + r.quante + ' su ' + r.parole + '.'));
    if (!righe.length) return;
    const tessere = el('div', 'tessere');
    for (const [nome, v, classe] of [['Entrate', t.entrate, ' entrata'], ['Uscite', t.uscite, '']]) {
      const x = el('div', 'tessera');
      x.appendChild(el('span', 't-etichetta', nome));
      x.appendChild(el('span', 't-valore' + classe, euro(v)));
      tessere.appendChild(x);
    }
    box.appendChild(tessere);
    const diff = tasto('res-saldo', '', () => { if (!saldoVisibile) { cambiaOcchio(true, f.conto); ridisegna(); } });
    diff.id = 'movDifferenza';
    diff.appendChild(el('span', '', f.conto && (t.arrivati || t.partiti) ? 'Entrate meno uscite, più gli spostamenti' : 'Entrate meno uscite'));
    diff.appendChild(el('span', 'res-saldo-valore', saldoConSegno(t.saldo)));
    box.appendChild(diff);
    const gruppi = [];
    for (const [tipo, tot] of [['uscita', t.uscite], ['entrata', t.entrate]]) {
      const somme = new Map();
      for (const m of righe) if (m.tipo === tipo && (!f.conto || contoDi(m) === f.conto)) somme.set(m.categoria, (somme.get(m.categoria) || 0) + m.importo);
      if (somme.size > 1) gruppi.push([tipo, tot, [...somme.entries()].sort((x, y) => y[1] - x[1])]);
    }
    for (const [tipo, tot, cat] of gruppi) {
      if (gruppi.length > 1) box.appendChild(el('p', 'res-cat-titolo', BARRE[tipo].nome + ' per categoria'));
      const ol = el('ol', 'res-categorie');
      ol.dataset.tipo = tipo;
      const contiDi = f.conto ? () => [] : contiPerCategoria(righe, tipo);
      for (const [nome, cent] of cat.slice(0, 5)) {
        const li = el('li');
        li.appendChild(nomeEConti('res-cat-nome', iconaDi(tipo, nome) + ' ' + nome, contiDi(nome)));
        li.appendChild(el('span', 'res-cat-valore', euro(cent) + ' · ' + percento(cent, tot)));
        ol.appendChild(li);
      }
      if (cat.length > 5) ol.appendChild(el('li', 'res-cat-altre', 'e altre ' + (cat.length - 5) + ' categorie'));
      box.appendChild(ol);
    }
  }
  const apriCerca = () => apriMovimenti({ periodo: 'tutto', conto: null, cerca: true });

  // ================================================================ eventi generali
  $('apriMenu').addEventListener('click', apriMenu);
  $('apriCerca').addEventListener('click', () => apriCerca());
  // sotto gli ultimi 10: tutti, dal più recente, con la categoria e il conto che sta guardando
  $('tuttiMovimenti').addEventListener('click', () => apriMovimenti({ periodo: 'tutto', categoria: vista.filtro, conto: vista.conto }));
  // 18/11/2026: «quando clicchi su movimenti te li ingrandisce, quando clicchi su mesi di autonomia te li mostra al dettaglio»
  $('titoloMovimenti').addEventListener('click', () => apriMovimenti({ periodo: 'tutto', categoria: vista.filtro, conto: vista.conto }));
  $('sezAutonomia').addEventListener('click', e => { if (e.target.closest('button, a, input, select, label')) return; apriAutonomia(); });
  $('incollaTrasloco').addEventListener('click', incollaDallaVecchia);
  $('bannerEsporta').addEventListener('click', () => apriEsporta('tutto'));
  $('modSaldo').addEventListener('click', () => apriSaldo(vista.conto || undefined));
  $('velo').addEventListener('click', chiudiFoglio);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && foglioAperto()) chiudiFoglio(true); });
  $('filtro').addEventListener('click', () => { vista.filtro = null; disegna(); });
  for (const tipo of TIPI_DATI) $(BARRE[tipo].altre).addEventListener('click', () => { vista.tutte[tipo] = !vista.tutte[tipo]; disegna(); });
  document.addEventListener('touchstart', () => {}, { passive: true });   // sull'iPhone i tasti si sentono sotto il dito (:active) solo se qualcuno ascolta i tocchi
  $('occhio').addEventListener('click', () => cambiaOcchio());
  $('occhioSaldi').addEventListener('click', () => cambiaOcchio());
  // anche toccando i pallini del saldo («quando schiacci il saldo»)
  $('heroValore').addEventListener('click', () => { if (!saldoVisibile) cambiaOcchio(true); });
  // uscendo dall'app il saldo si rinasconde: tornandoci si vede coperto
  document.addEventListener('visibilitychange', () => { if (document.hidden && saldoVisibile) { saldoVisibile = false; disegna(); } });
  document.querySelectorAll('#sceltaConto button').forEach(b => b.addEventListener('click', () => scegliVistaConto(b.dataset.conto)));
  $('prec').addEventListener('click', () => {
    if (vista.modo === 'anno') vista.anno--;
    else if (vista.mese === 0) { vista.mese = 11; vista.anno--; } else vista.mese--;
    vista.filtro = null;
    disegna();
  });
  $('succ').addEventListener('click', () => {
    if (vista.modo === 'anno') vista.anno++;
    else if (vista.mese === 11) { vista.mese = 0; vista.anno++; } else vista.mese++;
    vista.filtro = null;
    disegna();
  });
  document.querySelectorAll('.periodo .segmentato button').forEach(b => b.addEventListener('click', () => {
    vista.modo = b.dataset.modo;
    vista.filtro = null;
    disegna();
  }));
  // un'altra scheda che cambia i dati
  window.addEventListener('storage', e => { if (e.key === CHIAVE && e.newValue && !e.newValue.includes('"inIdb"') && !e.newValue.includes('"archivio":{')) { stato = daTesto(e.newValue); disegna(); } });
  // Il giorno che cambia (24/11/2026): se stava guardando il mese (o l'anno) di allora, si passa a quello di adesso. Prima,
  // riaprendola il 1° dicembre dal sottofondo, restava su novembre; e a mezzanotte, con l'app davanti, «oggi» restava ieri.
  let giornoVisto = isoOggi();
  function nuovoGiorno() {
    const adesso = isoOggi();
    if (adesso === giornoVisto) return false;
    const prima = daIso(giornoVisto), ora = oggi();
    giornoVisto = adesso;
    if (vista.anno === prima.getFullYear() && (vista.modo === 'anno' || vista.mese === prima.getMonth())) {
      if (vista.anno !== ora.getFullYear() || vista.mese !== ora.getMonth()) vista.filtro = null;
      vista.anno = ora.getFullYear();
      vista.mese = ora.getMonth();
    }
    return true;
  }
  setInterval(() => {
    if (document.hidden || !nuovoGiorno()) return;
    generaRicorrenti();
    rileggi();
    disegna();
    applicaSfondo();
  }, 20000);
  // tornando in primo piano: può essere un altro giorno (fissi da segnare, «oggi» diverso, sfondo nuovo)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { nascostaDa = Date.now(); return; }
    nuovoGiorno();
    generaRicorrenti();
    rileggi();
    disegna();
    applicaSfondo();
    // tornarci dopo almeno 3 minuti è come riaprirla: di nuovo il suono d'apertura al primo tocco
    if (nascostaDa && Date.now() - nascostaDa >= 180000) { sigla(); brillaTitolo(); pioggiaFesta(festaDiOggi()); }
  });

  // Dopo la traduzione dei dati vecchi (10/11/2026): i movimenti finiti in «Altro» si rileggono con le
  // categorie nuove («Tabacchi 13,30» era in Altro perché la categoria non c'era). Solo quelli in «Altro».
  if (stato.daRileggere) {
    delete stato.daRileggere;
    for (const m of stato.movimenti) {
      if (m.categoria !== ripiegoDi(m.tipo) || !m.descrizione) continue;
      const r = A.analizza(m.descrizione + ' 1', opzioniAnalisi({ tipo: m.tipo }));
      if (r.certo.categoria && r.categoria !== m.categoria) m.categoria = r.categoria;
    }
    materializza();
    scrivi();
  }

  // il nome dell'app: l'ultima parola grande, il resto sopra («Che Conti» / «Devastanti»)
  (function titolo() {
    const parole = String(ED.titolo).trim().split(/\s+/);
    const h = $('titoloApp');
    h.textContent = '';
    if (parole.length > 1) h.appendChild(el('span', 'titolo-su', parole.slice(0, -1).join(' ')));
    h.appendChild(el('span', 'titolo-giu', parole[parole.length - 1]));
    h.setAttribute('aria-label', ED.titolo);
    document.title = ED.titolo;
  })();

  generaRicorrenti();
  rileggi();
  disegna();
  offriCopia();
  if (memoriaVecchiaPersa) setTimeout(offriVecchi, 800);
  if (soloLettura || memoriaIndietro) setTimeout(() => mostraToast(soloLettura ? 'Non riesco a leggere i movimenti: chiudi e riapri l\'app' : 'Gli ultimi movimenti non si sono salvati: guarda Menù → Copie automatiche', null, null, 12000), 800);
  copiaTraPoco();   // la prima del giorno anche se oggi non segna niente
  brillaTitolo();
  sigla();
  pioggiaFesta(festaDiOggi());
  // i suoni si scaricano e si decodificano appena aperta (dal service worker, anche senza rete): prima quelli che possono
  // servire al primo tocco, se no la sigla e il primo saldo arrivavano tardi (24/11/2026)
  if (S) {
    const f = festaDiOggi();
    S.nota('aperta ' + VERSIONE + ' · ' + impostazioniSuoni());
    S.prepara([f && f.suono, suonoSigla(), suonoSaldo()].concat(Object.values(S.CONTI), ['uscita', 'entrata', 'spostamento', 'elimina']).filter(Boolean));
  }

  // ================================================================ funzionamento senza rete
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const avevaController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (!avevaController || versionePronta) return;   // la prima installazione non cambia niente da mostrare
      const v = await versioneDelServiceWorker();
      if (v && v <= VERSIONE) return;                   // la stessa versione, registrata di nuovo
      prontaLaNuova();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    // i momenti in cui guarda se c'è una versione nuova: aperta, tornando sull'app o la rete, ogni 2 minuti davanti
    setTimeout(controllaVersione, 1500);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { ricaricaSePuoi(true); return; }   // uscendo: la ricarica non la vede nemmeno
      if (!ricaricaSePuoi(true)) controllaVersione();
    });
    window.addEventListener('pageshow', e => { if (e.persisted) controllaVersione(); });
    window.addEventListener('online', () => controllaVersione());
    setInterval(() => { if (!document.hidden) controllaVersione(); }, 120000);
  }

  // per le prove automatiche
  window.__conti = {
    versione: VERSIONE, edizione: ED, stato: () => stato, pref: () => pref, testoEsportazione, testoLeggibile, importaTesto,
    generaRicorrenti, saldoAttuale, liquidi, fondoTasse, speseMedie, totaleFissi, rinomina, aggiungiCategoria, eliminaCategoria,
    materializza, migra, apriEsporta, apriTrasloco, statoVoce: () => statoVoce, versionePronta: () => versionePronta,
    vista: () => vista, faseVoce: fase, scegliVistaConto, saldoVisibile: () => saldoVisibile,
    controllaVersione, novita: NOVITA, soliteSpese, cerca, confronto, apriCerca, apriMovimenti, apriSuoni, spazioUsato,
    apriAutonomia, apriFeste, elencoCopie, leggiDati, inIdb: () => inIdb, soloLettura: () => soloLettura, salvaCopia, nuovoGiorno, festaDiOggi, santoDi: () => santoDi(oggi()), anteprimaFesta
  };
})();
