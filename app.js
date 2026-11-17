/* Conti — l'app. I dati stanno solo nel telefono (localStorage di questa app). */
(function () {
  'use strict';

  const VERSIONE = '2026.11.17-1700';
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

  function carica() {
    const grezzo = localStorage.getItem(CHIAVE);
    if (!grezzo) return vuoto();
    try {
      const d = JSON.parse(grezzo);
      if (d && Array.isArray(d.movimenti)) {
        const s = Object.assign(vuoto(), d);
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
  let stato = carica();
  let persistenzaChiesta = false;

  // Lo spazio (17/11/2026). Safari dà a ogni sito circa 5 MB di localStorage, contati in caratteri da 2 byte: circa
  // 2,5 milioni di caratteri. Un movimento ne pesa circa 220: a 8 movimenti al giorno bastano circa 4 anni. Prima di
  // arrivarci l'app lo dice (al 60%), e allora i movimenti vanno spostati in IndexedDB, che ha spazio per molto di più.
  const SPAZIO_CARATTERI = 2500000;
  let pesoStato = 0, pesoAltro = null;
  function spazioUsato() {
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
      const testo = JSON.stringify(stato);
      localStorage.setItem(CHIAVE, testo);
      pesoStato = testo.length;
    } catch (e) {
      mostraToast('Non riesco a salvare: spazio del telefono pieno?');
      return false;
    }
    if (!persistenzaChiesta && navigator.storage && navigator.storage.persist) {
      persistenzaChiesta = true;
      navigator.storage.persist().catch(() => {});
    }
    return true;
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
  const NOVITA = 'suoni veri all’apertura (Menù → Suoni), «Le solite» a un tocco, 🔍 Cerca, confronto col mese prima e grafico dell’anno';
  const CHIAVE_AGG = CHIAVE + '.aggiornamento';
  let versionePronta = false, timerPronta = null, controlloInCorso = null, ancoraUnaVolta = false, ultimoTocco = 0, ultimoControllo = null;
  ['pointerdown', 'keydown', 'input'].forEach(n => document.addEventListener(n, () => { ultimoTocco = Date.now(); }, true));
  const puoRicaricare = () => !campoFrase.value.trim() && statoVoce === 'fermo' &&
    ($('toast').hidden || $('toastAzione').hidden || $('toastAzione').textContent !== 'Annulla');
  function ricarica() {
    // mai in giro tondo: se due ricariche di fila non portano la versione nuova, ci si ferma fino alla prossima apertura
    let g = {};
    try { g = JSON.parse(sessionStorage.getItem(CHIAVE_AGG) || '{}'); } catch (e) { g = {}; }
    if (g.da === VERSIONE && g.volte >= 2 && Date.now() - g.quando < 300000) return false;
    try { sessionStorage.setItem(CHIAVE_AGG, JSON.stringify({ da: VERSIONE, volte: g.da === VERSIONE ? (g.volte || 0) + 1 : 1, quando: Date.now() })); } catch (e) {}
    location.reload();
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
  function tasto(classe, testo, alClic) {
    const b = el('button', classe, testo);
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
        b.appendChild(el('small', '', 'Prelievo al bancomat, versamento in banca, cripto comprate o vendute: non conta né come entrata né come uscita.'));
        corpo.appendChild(b);
        return;
      }
      const qui = Object.assign({}, corrente, { tipo: 'spostamento', da, verso, prima });
      // toccando come «da» il conto che era «a» (o il contrario) si scambiano
      corpo.appendChild(el('div', 'titoletto', 'Da'));
      corpo.appendChild(fila(da, id => scegliConto(Object.assign({}, qui, id === verso ? { da: id, verso: da } : { da: id }), alScegliere, true), 'spostaDa'));
      corpo.appendChild(el('div', 'titoletto', 'A'));
      corpo.appendChild(fila(verso, id => scegliConto(Object.assign({}, qui, id === da ? { da: verso, verso: id } : { verso: id }), alScegliere, true), 'spostaVerso'));
      corpo.appendChild(el('p', 'nota', 'Toglie da ' + nomeConto(da) + ' e aggiunge a ' + nomeConto(verso) + '. Non conta né come entrata né come uscita: i soldi restano tuoi, cambiano posto.'));
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
      if (inModifica) corpo.appendChild(el('p', 'nota-su', 'Tocca una categoria per cambiarle nome o simbolo, nasconderla o eliminarla.'));
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
      if (!inModifica) corpo.appendChild(el('p', 'nota', 'Quando correggi una categoria, la prossima volta che usi le stesse parole la propongo io. Per cambiarle nome tocca «✎ Modifica» o tienila premuta.'));
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
    if (inizio === 'prossimo') return 'Questo mese no: il primo sarà il ' + giorno + ' ' + MESI[(ora.getMonth() + 1) % 12] + ', poi ogni mese da solo.';
    const passato = giorno < ora.getDate();
    return 'Si segna da solo ogni ' + giorno + ' del mese e conta in quel mese, dal 1° all\'ultimo giorno. ' + (passato
      ? 'Il ' + giorno + ' di questo mese è già passato: lo conto come già pagato (se l\'avevi già segnato a mano, scegli «Dal prossimo»).'
      : 'Finché non arriva il ' + giorno + ' lo vedi «in arrivo».') + ' Lo trovi in Menù → Movimenti fissi.';
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
            corpo.appendChild(el('p', 'nota', 'Questo movimento resta com\'è; dal mese prossimo si segna da solo ogni ' + r.giorno + ' del mese. Lo trovi in Menù → Movimenti fissi.'));
          }
          const riga = el('div', 'riga-tasti');
          const fatto = tasto('tasto-primario', 'Fatto', () => { chiudiFoglio(); if (ripeti.alFatto) ripeti.alFatto(); else alScegliere(corrente); });
          fatto.id = 'quandoFatto';
          riga.appendChild(fatto);
          corpo.appendChild(riga);
          return;
        }
        corpo.appendChild(el('p', 'nota-su', 'Per le uscite stabili (affitto, abbonamenti, palestra) scegli «Ogni mese»: tocchi il giorno del mese e si segnano da sole.'));
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
      $('suggerimento').hidden = solite > 0 || stato.movimenti.length >= 30;
      return;
    }
    $('scorciatoie').hidden = true;
    const opz = opzioniAnalisi();
    proposte = A.analizzaFrasi(testo, opz);
    if (scelte.length !== proposte.length) scelte = proposte.map(() => ({}));
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
      avviso.textContent = multi ? 'Manca l\'importo in «' + senzaImporto[0].descrizione + '».' : 'Manca l\'importo: aggiungilo alla frase, es. «pizza 12».';
    } else if (futuri.length) {
      avviso.hidden = false;
      avviso.textContent = 'La data è nel futuro: controllala.';
    } else avviso.hidden = true;
    $('salva').disabled = senzaImporto.length > 0;
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
    for (const p of A.paroleSignificative(descrizione)) stato.imparate[p] = { tipo, categoria };
    const chiavi = Object.keys(stato.imparate);   // tetto: le ultime 600 parole
    if (chiavi.length > 600) for (const k of chiavi.slice(0, chiavi.length - 600)) delete stato.imparate[k];
  }

  // il conto corretto a mano: la volta dopo le stesse parole vanno lì da sole (se non si sta guardando un conto)
  function imparaConto(descrizione, conto) {
    if (!CONTI_ID.includes(conto)) return;
    for (const p of A.paroleSignificative(descrizione)) stato.imparatiConti[p] = conto;
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
      corpo.appendChild(el('p', '', 'Abbonamenti, affitto, palestra, telefono, PAC: li imposti una volta col giorno del mese e si segnano da soli. Contano nel loro mese dal 1° all\'ultimo giorno: finché il giorno non arriva li vedi «in arrivo». Se un mese non c\'è, cancella quel movimento: non torna.'));
      const t = totaleFissi();
      const somma = [t.uscite ? 'uscite ' + euro(t.uscite) : '', t.entrate ? 'entrate ' + euro(t.entrate) : ''].filter(Boolean);
      if (somma.length) corpo.appendChild(el('p', 'riassunto', 'Al mese: ' + somma.join(' · ')));
      const lista = el('div', 'elenco-righe');
      const ordinati = stato.ricorrenti.slice().sort((a, b) => a.giorno - b.giorno);
      for (const r of ordinati) {
        const b = el('button', 'mov');
        b.type = 'button';
        b.appendChild(el('span', 'mov-icona', eSpostamento(r) ? '↔' : iconaDi(r.tipo, r.categoria)));
        const testi = el('span', 'mov-testi');
        testi.appendChild(el('span', 'mov-desc', r.descrizione));
        testi.appendChild(el('span', 'mov-cat', 'ogni ' + r.giorno + ' del mese · ' + (eSpostamento(r) ? etichettaConto(r)
          : r.categoria + ' · ' + infoConto(contoDi(r)).icona) + (r.attivo ? '' : ' · in pausa')));
        b.appendChild(testi);
        b.appendChild(el('span', 'mov-importo ' + r.tipo, segnoDi(r.tipo) + euro(Math.abs(r.importo))));
        b.addEventListener('click', () => apriFisso(r));
        lista.appendChild(b);
      }
      if (!ordinati.length) lista.appendChild(el('p', 'vuoto', 'Nessuno ancora. Puoi anche dirlo nella frase («spotify 10,99 ogni 18 del mese»), scegliere «🔁 Ogni mese» toccando il giorno quando segni una spesa, o aprire un movimento già segnato e toccare «Ripeti ogni mese».'));
      corpo.appendChild(lista);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', '＋ Aggiungi', () => apriFisso(null)));
      corpo.appendChild(riga);
    });
  }

  function apriFisso(esistente) {
    const nuovo = !esistente;
    const ora = chiaveMese(oggi());
    const b = esistente ? copiaConto(Object.assign({}, esistente, { importo: Math.abs(esistente.importo) }), esistente)
      : { descrizione: '', importo: 0, tipo: 'uscita', categoria: ripiegoDi('uscita'), giorno: oggi().getDate(), attivo: true,
        conto: vista.conto || A.CONTO_BASE };
    let sceltaMano = !nuovo, contoMano = !nuovo;
    let quando = 'questo';
    const disegnaForm = () => apriFoglio(nuovo ? 'Nuovo movimento fisso' : 'Movimento fisso', corpo => {
      const inDesc = inputTesto(b.descrizione);
      inDesc.placeholder = 'es. Netflix, PAC S&P 500, palestra';
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
      const inImp = inputTesto(b.importo ? formatoPerCampo(b.importo) : '', 'decimal');
      inImp.placeholder = '0,00';
      corpo.appendChild(campo('Importo in euro', inImp));
      corpo.appendChild(el('div', 'titoletto', 'Che giorno del mese?'));
      corpo.appendChild(grigliaGiorni(b.giorno, g => { leggi(); b.giorno = g; disegnaForm(); }));
      if (b.giorno > 28) corpo.appendChild(el('p', 'nota-su', 'Nei mesi che non hanno il ' + b.giorno + ' si segna l\'ultimo giorno del mese.'));
      const chips = el('div', 'chips');
      chips.style.marginTop = '12px';
      const leggi = () => {
        b.descrizione = inDesc.value.trim();
        const v = leggiEuro(inImp.value);
        if (v !== null) b.importo = v;
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
        const inArrivo = stato.movimenti.some(m => m.ricorrente === esistente.id && m.data > isoOggi());
        if (!confirm('Eliminare il movimento fisso «' + esistente.descrizione + '»? Quelli già passati restano'
          + (inArrivo ? ', quello in arrivo questo mese sparisce.' : '.'))) return;
        aggiornaInArrivo(esistente, true);
        stato.ricorrenti = stato.ricorrenti.filter(r => r.id !== esistente.id);
        scrivi(); chiudiFoglio(); disegna();
        mostraToast('Movimento fisso eliminato');
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
    const d = oggi(), totali = [];
    for (let k = 1; k <= 3; k++) {
      const inizio = new Date(d.getFullYear(), d.getMonth() - k, 1);
      if (primo > A.isoDa(new Date(inizio.getFullYear(), inizio.getMonth(), 7))) break;
      const chiave = chiaveMese(inizio);
      totali.push(stato.movimenti.filter(m => spesaVera(m) && m.data.slice(0, 7) === chiave).reduce((a, m) => a + m.importo, 0));
    }
    if (!totali.length) return null;
    return { media: Math.round(totali.reduce((a, b) => a + b, 0) / totali.length), mesi: totali.length };
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
      corpo.appendChild(el('p', 'aut-testo', 'Quanto hai in contanti, sui conti e in cripto? Inseriscilo una volta: l\'app lo tiene aggiornato con i movimenti e ti dice quanti mesi reggi senza entrate.'));
      const r = el('div', 'riga-tasti');
      r.appendChild(tasto('tasto-secondario', 'Inserisci i saldi', () => apriSaldo()));
      corpo.appendChild(r);
      return;
    }
    const sa = liquidi();
    const ft = fondoTasse();
    const tasse = ft ? Math.max(0, ft.fondo) : 0;
    const spendibili = sa === null ? null : sa - tasse;
    const sm = speseMedie();
    const fissi = stato.ricorrenti.filter(r => r.attivo && spesaVera(r)).reduce((a, r) => a + r.importo, 0);
    let mesi = null, spiegazione;
    if (sa === null) {
      spiegazione = 'Per calcolarli servono i saldi dei contanti o del digitale: le cripto non contano.';
    } else if (sm && sm.media > 0) {
      mesi = spendibili / sm.media;
      spiegazione = 'senza entrate, con contanti e digitale e le spese medie ' + (sm.mesi === 1 ? 'dell\'ultimo mese' : 'degli ultimi ' + sm.mesi + ' mesi') + ' (' + euro(sm.media) + ' al mese, investimenti esclusi). Le cripto non contano.';
    } else if (fissi > 0) {
      mesi = spendibili / fissi;
      spiegazione = 'senza entrate, con contanti e digitale e solo le spese fisse (' + euro(fissi) + ' al mese, investimenti esclusi): il conto vero arriva dopo il primo mese intero.';
    } else {
      spiegazione = 'Per calcolarli servono le spese di un mese intero, oppure i movimenti fissi.';
    }
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
    corpo.appendChild(el('p', stato.saldi.daDividere ? 'avviso' : 'nota', stato.saldi.daDividere
      ? 'Il saldo che avevi inserito era conti e contanti insieme: ora sta in 💳 Digitale. Correggilo e inserisci a parte i contanti.'
      : 'I saldi si aggiornano coi movimenti e gli spostamenti che segni: ricontrollali ogni tanto coi conti veri.'));
  }

  // Guardando un conto solo: il suo saldo di oggi
  function disegnaSaldoConto(corpo, c) {
    $('titoloAutonomia').textContent = 'Saldo ' + inConto(c);
    const v = saldoAttuale(c);
    $('modSaldo').hidden = v === null;
    $('modSaldo').textContent = 'Correggi saldo';
    const cosa = { contanti: 'Quelli che hai in tasca e a casa.', digitale: 'Conti correnti e carte.',
      cripto: 'In euro: quello che ci hai messo meno quello che hai tolto, non il valore di oggi. Non conta nei mesi di autonomia.' }[c];
    if (v === null) {
      corpo.appendChild(el('p', 'aut-testo', 'Quanto hai ' + inConto(c) + ' adesso? Inseriscilo una volta: l\'app lo aggiorna coi movimenti ' + inConto(c) + ' e con gli spostamenti. ' + cosa));
      const r = el('div', 'riga-tasti');
      r.appendChild(tasto('tasto-secondario', 'Inserisci il saldo', () => apriSaldo(c)));
      corpo.appendChild(r);
      return;
    }
    corpo.appendChild(el('p', 'aut-mesi', saldoEuro(v)));
    corpo.appendChild(el('p', 'aut-testo', cosa + ' Aggiornato coi movimenti e gli spostamenti che segni.'));
    const s = stato.saldi[c];
    corpo.appendChild(el('p', 'nota', 'Saldo inserito ' + etichettaGiorno(s.data).toLowerCase() + ': ' + saldoEuro(s.importo) + '. Ricontrollalo ogni tanto.'));
  }

  // I saldi: tutti e tre insieme, o uno solo («solo»). Un campo non toccato tiene il saldo di prima, con la sua data.
  function apriSaldo(solo) {
    const quali = solo ? [infoConto(solo)] : A.CONTI;
    apriFoglio(solo ? 'Saldo ' + inConto(solo) : 'Saldi dei conti', corpo => {
      corpo.appendChild(el('p', '', solo ? 'Quanto hai adesso ' + inConto(solo) + '. Da qui in poi l\'app lo aggiorna coi movimenti e gli spostamenti che segni.'
        : 'Quanto hai adesso in ciascun conto. Da qui in poi l\'app li aggiorna coi movimenti e gli spostamenti che segni. Quello che non usi lascialo vuoto.'));
      if (stato.saldi.daDividere && solo !== 'cripto') corpo.appendChild(el('p', 'avviso', 'Prima c\'era un saldo solo, conti e contanti insieme: adesso è in Digitale. Togli da lì i contanti e scrivili nel loro conto.'));
      const campi = [];
      for (const c of quali) {
        const sa = saldoAttuale(c.id);
        const inp = inputTesto(sa !== null ? (sa < 0 ? '-' : '') + formatoPerCampo(sa) : '', 'decimal');
        inp.placeholder = '0,00';
        inp.id = 'saldo' + maiuscola(c.id);
        corpo.appendChild(campo(c.icona + ' ' + c.nome + ' oggi, in euro', inp));
        if (c.id === 'cripto') corpo.appendChild(el('p', 'nota-campo', 'Quanto valgono oggi in euro. Poi l\'app aggiunge e toglie quello che sposti e spendi, non segue il prezzo. Non conta nei mesi di autonomia.'));
        campi.push([c.id, inp, sa]);
      }
      corpo.appendChild(el('p', 'nota', 'Le spese che non segni li fanno scostare dai conti veri: ogni tanto ricontrollali e correggili qui.'));
      const riga = el('div', 'riga-tasti');
      if (solo && stato.saldi[solo]) riga.appendChild(tasto('tasto-secondario', 'Togli', () => {
        stato.saldi[solo] = null; scrivi(); chiudiFoglio(); disegna();
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
        for (const [id, v] of nuovi) {
          if (v === undefined) continue;
          stato.saldi[id] = v === null ? null : { importo: v, data: isoOggi(), aggiornato: adesso };
        }
        if (solo !== 'cripto') delete stato.saldi.daDividere;
        scrivi(); chiudiFoglio(); disegna();
        mostraToast(solo ? 'Saldo salvato' : 'Saldi salvati');
      }));
      corpo.appendChild(riga);
    });
  }

  function apriTasse() {
    const t = stato.tasse;
    apriFoglio('Tasse da accantonare', corpo => {
      corpo.appendChild(el('p', '', 'Per ogni entrata delle categorie scelte l\'app mette da parte una percentuale e te la toglie dai soldi spendibili. Le uscite in «' + nomeDaBase('uscita', 'Tasse e commercialista') + '» la consumano.'));
      const on = interruttore('Accantona per le tasse', t.attiva);
      corpo.appendChild(on.etichetta);
      const inP = inputTesto(t.percentuale ? String(t.percentuale).replace('.', ',') : '', 'decimal');
      inP.placeholder = 'es. 25';
      corpo.appendChild(campo('Percentuale da mettere da parte', inP));
      corpo.appendChild(el('p', 'nota', 'La percentuale giusta decidila con il commercialista: dipende dal regime e dai contributi.'));
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
      if (vista.filtro === vecchio) vista.filtro = nuovo;
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
    if (vista.filtro === nome) vista.filtro = null;
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
      inp.placeholder = 'es. Scherma, Patente nautica';
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
      libero.placeholder = 'o scrivine una tua, per esempio 🥷';
      libero.addEventListener('input', () => { const s = primoSimbolo(libero.value); if (s) { icona = s; segna(); } });
      corpo.appendChild(campo('Un\'altra emoji', libero));
      const ripiego = esistente && esistente.ripiego;
      let casNascosta = null;
      if (esistente && !ripiego) {
        casNascosta = interruttore('Nascosta: non la propongo più (i movimenti restano)', esistente.nascosta);
        corpo.appendChild(casNascosta.etichetta);
      }
      const riga = el('div', 'riga-tasti');
      if (esistente && !ripiego) riga.appendChild(tasto('tasto-pericolo', 'Elimina', () => {
        const n = usiDi(tipo, esistente.nome), f = stato.ricorrenti.filter(r => r.tipo === tipo && r.categoria === esistente.nome).length;
        const rip = ripiegoDi(tipo);
        const cosa = [n ? n + (n === 1 ? ' movimento passa' : ' movimenti passano') : '', f ? f + (f === 1 ? ' fisso passa' : ' fissi passano') : ''].filter(Boolean).join(' e ');
        if (cosa && !confirm('Eliminare «' + esistente.nome + '»? ' + cosa + ' in «' + rip + '».')) return;
        const prima = JSON.stringify(stato);
        eliminaCategoria(tipo, esistente.nome);
        disegna(); rileggi();
        fine(esistente.nome, rip);
        mostraToast('Eliminata «' + esistente.nome + '»', 'Annulla', () => { stato = JSON.parse(prima); scrivi(); disegna(); rileggi(); });
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
      corpo.appendChild(el('p', 'nota-su', 'Tocca una categoria per cambiarle nome o simbolo, nasconderla o eliminarla.'));
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
      corpo.appendChild(el('p', 'nota', 'Le categorie nascoste non si propongono più, ma i movimenti vecchi restano dove sono. Rinominando, cambiano anche i movimenti già segnati. Eliminando, i movimenti passano in «Altro».'));
    });
  }

  // ================================================================ periodo e riepilogo
  // conto: null = tutti insieme, se no il conto che sta guardando (la «seconda modalità» del 15/11/2026)
  const vista = { modo: 'mese', anno: oggi().getFullYear(), mese: oggi().getMonth(), filtro: null, conto: null };

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
    let sotto = conto && (t.arrivati || t.partiti) ? 'Entrate meno uscite, più gli spostamenti.' : 'Entrate meno uscite.';
    if (t.tasse > 0) sotto += ' Tolti ' + euro(t.tasse) + ' per le tasse, restano ' + saldoEuro(t.restano) + '.';
    // i fissi del mese che devono ancora arrivare contano già (dal 10/11/2026): lo si dice
    const oggiIso = isoOggi(), futuri = lista.filter(m => m.data > oggiIso && !eSpostamento(m) && tocca(m, conto));
    if (futuri.length) {
      const u = futuri.filter(m => m.tipo === 'uscita').reduce((a, m) => a + m.importo, 0);
      const e = futuri.filter(m => m.tipo === 'entrata').reduce((a, m) => a + m.importo, 0);
      sotto += ' Compresi in arrivo: ' + [u ? 'uscite ' + euro(u) : '', e ? 'entrate ' + euro(e) : ''].filter(Boolean).join(', ') + '.';
    }
    $('heroSotto').textContent = sotto;
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
      rs.textContent = '↔ Spostati fra i conti: ' + euro(t.spostati) + '. Non contano: restano soldi tuoi.';
      rs.hidden = false;
    } else rs.hidden = true;

    disegnaBarre(lista, t.uscite);
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
  function cambiaOcchio(v) {
    saldoVisibile = v === undefined ? !saldoVisibile : !!v;
    disegna();
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

  function disegnaBarre(lista, totUscite) {
    const ol = $('barre');
    ol.textContent = '';
    $('titoloCategorie').textContent = vista.conto ? 'Spese ' + inConto(vista.conto) : 'Spese per categoria';
    const somme = new Map();
    for (const m of lista) if (m.tipo === 'uscita') somme.set(m.categoria, (somme.get(m.categoria) || 0) + m.importo);
    const righe = [...somme.entries()].sort((a, b) => b[1] - a[1]);
    if (!righe.length) {
      ol.appendChild(el('li', 'vuoto', 'Nessuna spesa in questo periodo.'));
      return;
    }
    const max = righe[0][1];
    for (const [nome, cent] of righe) {
      const li = el('li');
      const b = el('button', 'barra-riga');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(vista.filtro === nome));
      const quota = percento(cent, totUscite);
      b.setAttribute('aria-label', nome + ': ' + euro(cent) + ', ' + quota + ' delle uscite. Tocca per vedere i movimenti.');
      const testi = el('div', 'barra-testi');
      testi.appendChild(el('span', 'barra-nome', iconaDi('uscita', nome) + ' ' + nome));
      const val = el('span', 'barra-valore', euro(cent));
      val.appendChild(el('span', 'barra-quota', quota));
      testi.appendChild(val);
      b.appendChild(testi);
      const pista = el('div', 'barra-pista');
      const segno = el('div', 'barra-segno');
      segno.style.width = Math.max(1, cent / max * 100) + '%';
      pista.appendChild(segno);
      b.appendChild(pista);
      b.addEventListener('click', () => { vista.filtro = vista.filtro === nome ? null : nome; disegna(); });
      li.appendChild(b);
      ol.appendChild(li);
    }
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

  function disegnaLista(lista) {
    const cont = $('lista');
    cont.textContent = '';
    const filtro = $('filtro');
    $('titoloMovimenti').textContent = vista.conto ? 'Movimenti ' + inConto(vista.conto) : 'Movimenti';
    filtro.hidden = !vista.filtro;
    if (vista.filtro) filtro.textContent = 'Solo ' + vista.filtro;
    // nell'anno la lista completa è lunga: si vede solo filtrando una categoria
    $('sezMovimenti').hidden = vista.modo === 'anno' && !vista.filtro;
    if ($('sezMovimenti').hidden) return;   // 1500 righe costruite per niente: mezzo secondo sul telefono (11/11/2026)
    let righe = vista.filtro ? lista.filter(m => m.tipo === 'uscita' && m.categoria === vista.filtro) : lista;
    righe = righe.slice().sort((a, b) => (b.data.localeCompare(a.data)) || (b.creato || '').localeCompare(a.creato || ''));
    if (!righe.length) {
      cont.appendChild(el('p', 'vuoto', stato.movimenti.length ? 'Nessun movimento' + (vista.conto ? ' ' + inConto(vista.conto) : '') + ' in questo periodo.'
        : 'Ancora nessun movimento. Scrivi o detta la prima spesa qui sopra, per esempio «caffè 1,20».'));
      if (!stato.movimenti.length) {   // un'icona nuova: i dati della vecchia arrivano dagli appunti
        const b = tasto('tasto-secondario', '📥 Incolla dalla vecchia icona', incollaDallaVecchia);
        b.id = 'incollaTraslocoLista';
        b.style.marginTop = '10px';
        cont.appendChild(b);
      }
      return;
    }
    let giorno = null;
    for (const m of righe) {
      if (m.data !== giorno) {
        giorno = m.data;
        const futuro = m.data > isoOggi();
        cont.appendChild(el('div', 'giorno-titolo' + (futuro ? ' in-arrivo' : ''), (futuro ? 'In arrivo · ' : '') + etichettaGiorno(m.data)));
      }
      cont.appendChild(rigaMovimento(m));
    }
  }

  // inCerca: fra i risultati della ricerca, col giorno davanti (lì le righe sono divise per mese) e, dopo averlo
  // modificato, si torna ai risultati
  function rigaMovimento(m, inCerca) {
    const b = el('button', 'mov');
    b.type = 'button';
    b.dataset.id = m.id;
    const spost = eSpostamento(m);
    b.appendChild(el('span', 'mov-icona', spost ? '↔' : iconaDi(m.tipo, m.categoria)));
    const testi = el('span', 'mov-testi');
    testi.appendChild(el('span', 'mov-desc', m.descrizione));
    // il conto: per gli spostamenti da… a…; tutti insieme, il simbolo del conto
    let sotto = (inCerca ? etichettaGiorno(m.data) + ' · ' : '') +
      (spost ? etichettaConto(m) : m.categoria + (vista.conto && !inCerca ? '' : ' · ' + infoConto(contoDi(m)).icona));
    const acc = accantonamento(m);
    if (acc) sotto += ' · ' + euro(acc) + ' per le tasse';
    if (m.ricorrente) sotto += ' · fisso';
    if (m.data > isoOggi()) { b.classList.add('in-arrivo'); sotto += ' · in arrivo'; }
    testi.appendChild(el('span', 'mov-cat', sotto));
    b.appendChild(testi);
    // uno spostamento, guardando un conto: più se arriva qui, meno se parte da qui; tutti insieme, senza segno
    let segno = segnoDi(m.tipo), classe = m.tipo;
    if (spost) {
      segno = vista.conto ? (m.verso === vista.conto ? '+' : '−') : '';
      classe = 'spostamento' + (vista.conto && m.verso === vista.conto ? ' entrata' : '');
    }
    b.appendChild(el('span', 'mov-importo ' + classe, segno + euro(Math.abs(m.importo))));
    b.setAttribute('aria-label', m.descrizione + ', ' + sotto + ', ' + etichettaTipo(m.tipo) + ' ' + euro(Math.abs(m.importo)) + '. Tocca per modificare.');
    b.addEventListener('click', () => modifica(m.id, inCerca ? () => apriCerca(true) : null));
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
    const ridisegna = () => apriFoglio('Modifica movimento', corpo => {
      const inImp = inputTesto(formatoPerCampo(bozza.importo), 'decimal');
      inImp.id = 'modImporto';
      const inDesc = inputTesto(bozza.descrizione);
      inDesc.id = 'modDescrizione';
      const leggiCampi = () => {
        const v = leggiEuro(inImp.value);
        if (v !== null) bozza.importo = v;
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
        scegliCategoria(bozza.tipo, bozza.categoria, nome => { bozza.categoria = nome; ridisegna(); });
      }));
      g.appendChild(tasto('chip', etichettaQuando(bozza), () => {
        leggiCampi();
        // la spesa ricorrente si sceglie qui solo se non è già un fisso (per quelli c'è il tasto sotto)
        scegliData(bozza.data, iso => { bozza.data = iso; ridisegna(); },
          fissoDi() ? null : { acceso: bozza.ripeti, giorno: bozza.giorno, senzaInizio: true,
            alCambiare: v => { bozza.ripeti = v.acceso; bozza.giorno = v.giorno; } });
      }));
      corpo.appendChild(g);
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
        if (!confirm('Eliminare «' + orig.descrizione + '»?')) return;
        const i = stato.movimenti.findIndex(m => m.id === id);
        if (i < 0) { chiudiFoglio(); return; }
        const tolto = stato.movimenti.splice(i, 1)[0];
        scrivi();
        chiudiFoglio();
        disegna();
        suonaMovimento('elimina');
        mostraToast('Eliminato', 'Annulla', () => { stato.movimenti.push(tolto); scrivi(); disegna(); });
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        if (!applica()) return;
        if (bozza.ripeti && !fissoDi()) { chiudiFoglio(); ripetiOgniMese(orig, bozza.giorno); return; }   // salva lui
        scrivi();
        chiudiFoglio();
        disegna();
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
        notaAI.textContent = scelta === 'tutto' ? ED.testoCopia : 'Per la copia di sicurezza completa scegli «Tutto».';
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
      bLegg.appendChild(el('small', '', 'Un riassunto semplice da leggere: totali, categorie e movimenti giorno per giorno.'));
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
        bCond.appendChild(el('small', '', 'Lo stesso riassunto, da mandare a te stesso o a qualcuno con WhatsApp o Mail, o da salvare in Note.'));
        azioni.appendChild(bCond);
      }
      corpo.appendChild(azioni);
      aggiorna();
    });
  }

  function apriMenu() {
    apriFoglio('Menù', corpo => {
      corpo.appendChild(el('div', 'titoletto', 'Sfondo'));
      filaSfondi(corpo);

      corpo.appendChild(el('div', 'titoletto', 'Impostazioni'));
      const imp = el('div', 'elenco-azioni');
      const voce = (titolo, sotto, alClic) => { const b = tasto('azione', titolo, alClic); b.appendChild(el('small', '', sotto)); imp.appendChild(b); return b; };
      const tf = totaleFissi(), nf = stato.ricorrenti.length;
      voce('🔁 Movimenti fissi', nf ? nf + (nf === 1 ? ' impostato' : ' impostati') + (tf.uscite ? ' · uscite ' + euro(tf.uscite) + ' al mese' : '') : 'Affitto, abbonamenti, PAC, palestra: si segnano da soli ogni mese.', apriFissi);
      const saldi = A.CONTI.map(c => [c, saldoAttuale(c.id)]).filter(([, v]) => v !== null);
      voce('🏦 Saldi dei conti', saldi.length ? (saldoVisibile ? saldi.map(([c, v]) => c.icona + ' ' + euro(v)).join(' · ') : 'Nascosti dall\'occhio') + ' · tocca per correggerli'
        : 'Contanti, digitale e cripto: per sapere quanti mesi reggi senza entrate.', () => apriSaldo());
      voce('🧾 Tasse da accantonare', stato.tasse.attiva ? String(stato.tasse.percentuale).replace('.', ',') + '% di ' + (stato.tasse.categorie.join(', ') || 'nessuna categoria') : 'Spento', apriTasse);
      voce('🏷️ Categorie', 'Aggiungi, rinomina, cambia simbolo, nascondi o elimina.', apriCategorie);
      voce('🎙️ Microfono', descriviVoce(), apriImpostazioniVoce);
      if (S) voce('🔊 Suoni', (suonoApertura() === 'nessuno' ? 'Apertura in silenzio' : 'Apertura: ' + S.APERTURE.find(a => a.id === suonoApertura()).nome)
        + (suoniMovimenti() ? ' · cassa e monete quando salvi' : ' · movimenti in silenzio'), apriSuoni).id = 'voceSuoni';
      corpo.appendChild(imp);

      corpo.appendChild(el('div', 'titoletto', 'I tuoi movimenti'));
      const n = stato.movimenti.length;
      corpo.appendChild(el('p', '', n + (n === 1 ? ' movimento' : ' movimenti') + ' salvati su questo telefono. ' + testoUltimoBackup()
        + ' Memoria usata: ' + percento(spazioUsato(), 1) + '.'));
      const azioni = el('div', 'elenco-azioni');
      azioni.style.marginTop = '10px';
      corpo.appendChild(azioni);

      const bEsp = tasto('azione', '📤 Esporta e condividi', () => apriEsporta('mese'));
      bEsp.appendChild(el('small', '', 'Scegli il periodo, poi «Copia per l\'AI», «Copia da condividere» o «Condividi».'));
      azioni.appendChild(bEsp);

      const bImp = tasto('azione', '📥 Importa da testo', () => apriImporta());
      bImp.appendChild(el('small', '', 'Incolla una «Copia per l\'AI»: i movimenti già presenti non si doppiano.'));
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
      bZero.disabled = !n;
      bZero.appendChild(el('small', '', 'Cancella i movimenti, per esempio quelli di prova: tutti, tutti tranne Cripto e spese ricorrenti, o i conti che scegli. Impostazioni e parole imparate restano.'));
      azioni.appendChild(bZero);

      corpo.appendChild(el('p', 'nota', 'I movimenti esistono solo dentro questa app sul telefono. Se cancelli l\'icona dalla schermata Home o i dati del sito, spariscono: esporta ogni tanto.'));
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

  function apriImporta() {
    apriFoglio('Importa movimenti', corpo => {
      corpo.appendChild(el('p', '', 'Incolla qui il testo di una «Copia per l\'AI» (anche di una versione vecchia dell\'app).'));
      const ta = el('textarea');
      ta.id = 'testoImporta';
      ta.placeholder = 'data;tipo;importo;categoria;descrizione;id';
      const c = el('label', 'campo');
      c.appendChild(ta);
      corpo.appendChild(c);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', 'Importa', () => {
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
    if (!stato.ultimoBackup) return 'Non li hai mai esportati.';
    const giorni = Math.floor((Date.now() - new Date(stato.ultimoBackup)) / GIORNO_MS);
    return 'Ultima esportazione: ' + (giorni === 0 ? 'oggi' : giorni === 1 ? 'ieri' : giorni + ' giorni fa') + '.';
  }

  function disegnaBanner() {
    // un'icona appena aggiunta: il tasto per portarci i dati della vecchia sta in cima, dove si vede subito (11/11/2026:
    // prima stava solo in fondo all'elenco vuoto, sotto riepilogo, autonomia e categorie)
    $('bannerTrasloco').hidden = !!(stato.movimenti.length || stato.ricorrenti.length || CONTI_ID.some(c => stato.saldi[c]));
    const n = stato.movimenti.length;
    const vecchio = !stato.ultimoBackup || (Date.now() - new Date(stato.ultimoBackup)) > 14 * GIORNO_MS;
    // la memoria quasi piena viene prima di tutto: va detto a Claude, che sposta i movimenti in una memoria più grande
    const pieno = spazioUsato() >= 0.6;
    const mostra = pieno || (n >= 10 && vecchio);
    $('bannerBackup').hidden = !mostra;
    if (pieno) $('bannerTesto').textContent = 'La memoria dei movimenti è al ' + percento(spazioUsato(), 1) + ': esporta e dillo a Claude, che li sposta in una memoria più grande prima che si riempia.';
    else if (mostra) $('bannerTesto').textContent = 'I movimenti stanno solo su questo telefono. ' + testoUltimoBackup();
  }

  // ================================================================ ricominciare e fine delle prove
  function cancella(condizione, messaggio) {
    const tolti = stato.movimenti.filter(condizione);
    stato.movimenti = stato.movimenti.filter(m => !condizione(m));
    scrivi();
    chiudiFoglio();
    disegna();
    if (tolti.length) suonaMovimento('elimina');
    mostraToast(messaggio, 'Annulla', () => { stato.movimenti = stato.movimenti.concat(tolti); scrivi(); disegna(); });
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
      corpo.appendChild(el('p', '', 'Cosa cancello? Restano sempre le impostazioni (movimenti fissi, saldi, categorie, tasse), le parole che l\'app ha imparato e lo sfondo.'));
      const kp = stato.movimenti.filter(daCancellare(TRANNE_CRIPTO)).length;
      const pre = tasto('azione', '🧹 Tutto tranne Cripto e spese ricorrenti', () => ricominciaConferma(TRANNE_CRIPTO, kp));
      pre.id = 'cancellaTranneCripto';
      pre.disabled = !kp;
      pre.appendChild(el('small', '', kp ? 'Cancello ' + movimenti_(kp) + ' in contanti e digitale. Restano quelli in cripto, gli spostamenti da e verso Cripto e le spese ricorrenti.'
        : 'Non c\'è niente da cancellare: sono tutti in cripto o spese ricorrenti.'));
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
      corpo.appendChild(el('p', 'nota', 'Uno spostamento si cancella solo se cancelli tutti e due i suoi conti: «comprato bitcoin» resta se tieni Cripto. Se vuoi tenerne una copia, prima fai «Copia per l\'AI» con «Tutto».'));
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
  function ricominciaConferma(scelta, n) {
    const parte = scelta.conti.length < CONTI_ID.length || scelta.tieniFissi;
    apriFoglio('Sei proprio sicuro?', corpo => {
      const dove = scelta.conti.map(inConto);
      const elenco = dove.length > 1 ? dove.slice(0, -1).join(', ') + ' e ' + dove[dove.length - 1] : dove.join('');
      corpo.appendChild(el('p', 'allarme', '🧨 Stai per cancellare ' + movimenti_(n) + (parte ? ' ' + elenco : '') + '.'));
      if (scelta.tieniFissi) corpo.appendChild(el('p', '', 'Le spese ricorrenti restano.'));
      corpo.appendChild(el('p', '', 'Dopo qualche secondo non si torna più indietro: rimarrebbero solo le copie che hai esportato.'));
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
    if (mostra) $('bannerProvaTesto').textContent = 'Dal 1° dicembre si fa sul serio. Cancello i ' + prove.length +
      (prove.length === 1 ? ' movimento di prova segnato' : ' movimenti di prova segnati') + ' prima?' +
      (tenute ? ' Tengo ' + (tenute === 1 ? 'quello' : 'i ' + tenute) + ' in cripto e delle spese ricorrenti.' : ' Cripto e spese ricorrenti restano.');
  }
  $('provaTieni').addEventListener('click', () => { pref.proveChiuse = true; scriviPref(); disegnaBannerProva(); });
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
  function applicaSfondo() {
    let id = pref.sfondo === 'giorno' ? sfondoDiOggi() : (pref.sfondo === 'nessuno' ? null : pref.sfondo);
    if (id && sfondi.length && !sfondi.some(x => x.id === id)) id = sfondoDiOggi();
    const s = $('sfondo');
    const info = sfondi.find(x => x.id === id);
    $('sfondoNome').textContent = info ? info.nome : '';
    if (id) {
      s.style.backgroundImage = 'url("sfondi/' + id + '.webp")';
      s.classList.add('foto');
      if (pref.ultimoSfondo !== id) { pref.ultimoSfondo = id; scriviPref(); }
    } else {
      s.style.backgroundImage = '';
      s.classList.remove('foto');
    }
  }
  function filaSfondi(corpo) {
    const fila = el('div', 'fila-sfondi');
    const opzioni = [{ id: 'giorno', nome: 'Ogni giorno' }]
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
        scriviPref();
        applicaSfondo();
        fila.querySelectorAll('.scelta-sfondo').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      });
      fila.appendChild(b);
    }
    corpo.appendChild(fila);
  }
  let creditiSuoni = null;
  function apriCrediti() {
    const link = (li, url) => { const a = el('a', '', 'originale'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; li.appendChild(a); };
    apriFoglio('Crediti di foto e suoni', corpo => {
      corpo.appendChild(el('p', '', 'Foto «in vetrina» di Wikimedia Commons, ritagliate per il telefono. Le licenze libere chiedono di citare chi le ha scattate.'));
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
      corpo.appendChild(el('p', '', 'Registrazioni di Freesound e Kenney con licenza CC0 (di tutti), tagliate e pareggiate di volume.'));
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
      if (creditiSuoni) scrivi(creditiSuoni);
      else fetch('suoni/suoni.json').then(r => r.json()).then(l => { creditiSuoni = l; if (document.body.contains(us)) scrivi(l); }).catch(() => {});
    });
  }
  applicaSfondo();
  fetch('sfondi/sfondi.json').then(r => r.json()).then(l => { if (Array.isArray(l)) { sfondi = l; applicaSfondo(); prontiAlMenu(); } }).catch(() => {});
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
    if (usaApple()) return pref.appleSi ? 'Apple, come la dettatura: le parole arrivano mentre parli' : 'Apple, come la dettatura (si prova al primo tocco)';
    const m = modelloVoce();
    if (!m) return 'Da scaricare una volta sola: poi funziona anche senza rete.';
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

  function guidaDettatura(motivo) {
    apriFoglio('Dettare con la tastiera', corpo => {
      if (motivo) corpo.appendChild(el('p', '', motivo));
      const ol = el('ol', 'passi');
      ol.style.marginTop = '10px';
      const passo = (forte, resto) => { const li = el('li'); li.appendChild(el('b', '', forte)); li.appendChild(document.createTextNode(resto)); ol.appendChild(li); };
      passo('Tocca «Ho capito»', ': si apre la tastiera.');
      passo('Tocca il microfono della tastiera', ', in basso a destra sotto i tasti.');
      passo('Parla come in un vocale', ', per esempio «pizza dodici euro ieri», poi tocca Salva.');
      passo('Se il microfono non c\'è', ': Impostazioni → Generali → Tastiera → attiva «Abilita dettatura».');
      corpo.appendChild(ol);
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
      rapido: 'Come «Preciso», ma la parte pesante la fa la scheda grafica: sul PC tre volte più veloce. ' +
        (pref.voceGpu === false && s.rapido ? 'Su questo telefono la scheda grafica non è partita: lavora col processore.' : 'Consigliato.'),
      preciso: 'Sbaglia molto meno numeri e parole («43,20», «eToro»). Ci mette qualche secondo in più.' + (V.gpu ? '' : ' Consigliato.'),
      veloce: 'Risponde prima, ma sbaglia più spesso («milleottocento» → 1880).'
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
        ? 'Il microfono è rifatto: adesso c\'è anche il riconoscimento «Preciso», che sbaglia molto meno. Si scarica una volta sola, meglio col Wi-Fi.'
        : 'Per capire la voce, l\'app scarica una volta sola il riconoscimento vocale, meglio col Wi-Fi.'));
      corpo.appendChild(el('p', '', 'Poi funziona anche senza rete, e la tua voce non esce mai dal telefono: la trascrizione la fa il telefono stesso.'));
      // niente «Usa la tastiera» (tolto il 17/11/2026): la dettatura della tastiera lui non la vuole
      sceltaModelli(corpo, usaModello);
    });
  }

  function apriImpostazioniVoce() {
    apriFoglio('Microfono', corpo => {
      corpo.appendChild(el('p', '', 'Tocca 🎙️, parla, poi tocca ■ (o fai una pausa di 2 secondi).'));
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
          ? 'L\'iPhone non lo lascia usare a questa app. Tocca per riprovare.'
          : 'Le parole arrivano mentre parli e capisce bene l\'italiano. La voce la riconosce iOS, come con la dettatura.'));
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
      guidaDettatura('Il permesso del microfono è negato. Sull\'iPhone: Impostazioni → Safari → Microfono → «Chiedi» o «Consenti», poi riapri l\'app. Intanto puoi dettare con la tastiera:');
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
    } catch (e) { appleNonVa(e); return; }
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
        corpo.appendChild(el('p', '', 'Il riconoscimento vocale di Apple, quello della dettatura, l\'iPhone non lo lascia usare a questa app (' + (codice || 'errore') + '). Uso Whisper, che lavora dentro il telefono. Ci riprovo da solo quando aggiorni iOS.'));
        corpo.appendChild(el('p', '', V.gpu ? 'Il più veloce è «Preciso veloce»: usa la scheda grafica del telefono.' : 'Scegli quale usare:'));
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
    if (S) S.ferma();   // l'audio dei suoni in pausa: il microfono tutto al riconoscimento (17/11/2026)
    if (usaApple()) { microfonoApple(); return; }
    if (!V || !V.disponibile) { guidaDettatura('Questo telefono non lascia usare il microfono all\'app.'); return; }
    const chiave = modelloVoce();
    if (!chiave) { chiediScaricamento(); return; }
    let a;
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
    } catch (e) { erroreMicrofono(e); return; }
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

  // ================================================================ suoni e piccole feste (17/11/2026)
  // Francesco: «l'idea del suono quando si entra dentro mi piace… non un suono che mi crei tu, ma creato da te
  // attraverso qualcosa che trovi in giro». Registrazioni vere CC0 (fai_suoni.py), suonate da suoni.js.
  // L'iPhone non lascia suonare un'app prima che la si tocchi (cercato il 17/11/2026: vale anche per le app della
  // schermata Home): il suono d'apertura parte al primo tocco entro 12 secondi da quando la apre o ci torna dopo
  // almeno 3 minuti. Mai sopra il microfono (lo registrerebbe) e mai mentre ascolta.
  const suonoApertura = () => (S && S.APERTURE.some(a => a.id === pref.suonoApertura) ? pref.suonoApertura : 'apertura-devastante');
  const suoniMovimenti = () => pref.suoniMovimenti !== false;
  function suonaMovimento(nome) { if (S && suoniMovimenti() && statoVoce === 'fermo') S.suona(nome); }
  let togliApertura = null, nascostaDa = 0;
  function armaApertura() {
    if (!S) return;
    if (togliApertura) togliApertura();
    togliApertura = S.alPrimoTocco(e => {
      togliApertura = null;
      const t = e && e.target && e.target.closest ? e.target : null;
      if (statoVoce !== 'fermo' || (t && t.closest('#microfono'))) return;
      S.sblocca();
      if (suonoApertura() === 'nessuno') return;
      S.suona(suonoApertura());
      brillaTitolo();
    }, 12000);
  }
  // «Devastanti» si accende: all'apertura, e di nuovo col suono
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
    for (let i = 0; i < 9; i++) {
      const m = el('span', 'moneta', '🪙');
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

  function apriSuoni() {
    apriFoglio('Suoni', corpo => {
      corpo.appendChild(el('p', '', 'Registrazioni vere, non suoni finti: una cassa, monete, un colpo. Con l\'iPhone in silenzioso non suonano, e non fermano la musica.'));
      corpo.appendChild(el('div', 'titoletto', 'Quando apri l\'app'));
      const g = el('div', 'elenco-azioni');
      for (const a of S.APERTURE) {
        const b = tasto('azione scelta-suono', (a.id === suonoApertura() ? '✓ ' : '') + a.nome, () => {
          pref.suonoApertura = a.id;
          scriviPref();
          S.sblocca();
          if (a.id !== 'nessuno') { S.suona(a.id); brillaTitolo(); }
          apriSuoni();
        });
        b.dataset.suono = a.id;
        b.setAttribute('aria-pressed', String(a.id === suonoApertura()));
        b.appendChild(el('small', '', a.sotto + (a.id !== 'nessuno' ? ' · tocca per sentirlo' : '')));
        g.appendChild(b);
      }
      corpo.appendChild(g);
      corpo.appendChild(el('p', 'nota-campo', 'L\'iPhone non lascia suonare un\'app prima che la tocchi: il suono parte al primo tocco, appena aperta. Se il primo tocco è il microfono, niente suono.'));
      corpo.appendChild(el('div', 'titoletto', 'Quando salvi o cancelli'));
      const on = interruttore('Suoni dei movimenti', suoniMovimenti());
      on.casella.id = 'suoniMovimenti';
      on.casella.addEventListener('change', () => { pref.suoniMovimenti = on.casella.checked; scriviPref(); });
      corpo.appendChild(on.etichetta);
      const prove = el('div', 'chips');
      prove.style.marginTop = '10px';
      for (const [nome, cosa] of [['entrata', '💰 Entrata'], ['uscita', '🪙 Uscita'], ['spostamento', '↔ Spostamento'], ['elimina', '🗑️ Elimina']]) {
        prove.appendChild(tasto('chip senza-freccia', '▶ ' + cosa, () => { S.sblocca(); S.suona(nome); }));
      }
      corpo.appendChild(prove);
      const cred = tasto('tasto-secondario', 'Da dove vengono', apriCrediti);
      cred.style.marginTop = '16px';
      corpo.appendChild(cred);
    });
  }

  // ================================================================ cerca (17/11/2026)
  // In tutti i mesi e in tutti i conti: parole della descrizione, categoria, conto o importo («12,50», «12»).
  // Ogni parola scritta deve esserci. Si tocca un risultato per modificarlo.
  function testoCercabile(m) {
    const imp = (m.importo / 100).toFixed(2);
    return A.normalizza([m.descrizione, m.categoria, eSpostamento(m) ? etichettaConto(m) : nomeConto(contoDi(m)),
      etichettaTipo(m.tipo), imp, imp.replace('.', ','), euro(m.importo), m.data.slice(8, 10) + '/' + m.data.slice(5, 7)].join(' '));
  }
  function cerca(q) {
    const parole = A.normalizza(q).split(/\s+/).filter(Boolean);
    if (!parole.length) return [];
    return stato.movimenti.filter(m => { const t = testoCercabile(m); return parole.every(p => t.includes(p)); })
      .sort((a, b) => b.data.localeCompare(a.data) || (b.creato || '').localeCompare(a.creato || ''));
  }
  let ultimaRicerca = '';
  function apriCerca(tornando) {
    if (tornando !== true) tornando = false;
    apriFoglio('Cerca', corpo => {
      const inp = el('input');
      inp.type = 'search';
      inp.id = 'testoCerca';
      inp.autocomplete = 'off';
      inp.setAttribute('enterkeyhint', 'search');
      inp.placeholder = 'pizza, Esselunga, Svago, 12,50…';
      inp.value = ultimaRicerca;
      const c = el('label', 'campo cerca-campo');
      c.appendChild(inp);
      corpo.appendChild(c);
      const riassunto = el('p', 'riassunto');
      riassunto.id = 'cercaRiassunto';
      corpo.appendChild(riassunto);
      const ris = el('div', 'risultati');
      ris.id = 'risultatiCerca';
      corpo.appendChild(ris);
      const aggiorna = () => {
        ultimaRicerca = inp.value;
        ris.textContent = '';
        const trovati = cerca(inp.value);
        if (!inp.value.trim()) { riassunto.textContent = ''; ris.appendChild(el('p', 'vuoto', 'Scrivi una parola, una categoria, un conto o un importo: cerco in tutti i mesi.')); return; }
        if (!trovati.length) { riassunto.textContent = ''; ris.appendChild(el('p', 'vuoto', 'Nessun movimento con «' + inp.value.trim() + '».')); return; }
        const t = totali(trovati);
        riassunto.textContent = trovati.length + (trovati.length === 1 ? ' movimento' : ' movimenti') +
          (t.uscite ? ' · uscite ' + euro(t.uscite) : '') + (t.entrate ? ' · entrate ' + euro(t.entrate) : '') + (t.spostati ? ' · spostati ' + euro(t.spostati) : '');
        let mese = null;
        for (const m of trovati.slice(0, 300)) {
          const k = m.data.slice(0, 7);
          if (k !== mese) {
            mese = k;
            ris.appendChild(el('div', 'giorno-titolo', maiuscola(MESI[Number(k.slice(5)) - 1]) + ' ' + k.slice(0, 4)));
          }
          ris.appendChild(rigaMovimento(m, true));
        }
        if (trovati.length > 300) ris.appendChild(el('p', 'nota', 'Ne mostro 300: aggiungi una parola per restringere.'));
      };
      inp.addEventListener('input', aggiorna);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      aggiorna();
    });
    // dentro il tocco sulla lente, a foglio già visibile: sull'iPhone così si apre la tastiera. Tornando da una
    // modifica no: i risultati si vedono meglio senza
    if (!tornando) { const i = $('testoCerca'); i.focus(); i.select(); }
  }

  // ================================================================ eventi generali
  $('apriMenu').addEventListener('click', apriMenu);
  $('apriCerca').addEventListener('click', () => apriCerca());
  $('incollaTrasloco').addEventListener('click', incollaDallaVecchia);
  $('bannerEsporta').addEventListener('click', () => apriEsporta('tutto'));
  $('modSaldo').addEventListener('click', () => apriSaldo(vista.conto || undefined));
  $('velo').addEventListener('click', chiudiFoglio);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && foglioAperto()) chiudiFoglio(); });
  $('filtro').addEventListener('click', () => { vista.filtro = null; disegna(); });
  $('occhio').addEventListener('click', () => cambiaOcchio());
  $('occhioSaldi').addEventListener('click', () => cambiaOcchio());
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
  window.addEventListener('storage', e => { if (e.key === CHIAVE) { stato = carica(); disegna(); } });
  // tornando in primo piano: può essere un altro giorno (fissi da segnare, «oggi» diverso, sfondo nuovo)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { nascostaDa = Date.now(); return; }
    generaRicorrenti();
    rileggi();
    disegna();
    applicaSfondo();
    // tornarci dopo almeno 3 minuti è come riaprirla: di nuovo il suono d'apertura al primo tocco
    if (nascostaDa && Date.now() - nascostaDa >= 180000) { armaApertura(); brillaTitolo(); }
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
  armaApertura();
  brillaTitolo();
  // i suoni si scaricano e si decodificano quando l'app è ferma (dal service worker, anche senza rete)
  if (S) (window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 3000 }) : f => setTimeout(f, 800))(() => S.prepara());

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
    vista: () => vista, scegliVistaConto, saldoVisibile: () => saldoVisibile,
    controllaVersione, novita: NOVITA, soliteSpese, cerca, confronto, apriCerca, apriSuoni, spazioUsato
  };
})();
