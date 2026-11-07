/* Conti — l'app. I dati stanno solo nel telefono (localStorage di questa app). */
(function () {
  'use strict';

  const VERSIONE = '2026.11.07-2046';
  const ED = Object.assign({ nome: 'principale', titolo: 'Conti', chiave: 'conti.v1', chiavePref: 'conti.preferenze',
    inizioSulSerio: null, testoCopia: 'È la tua copia di sicurezza.', avvisoCopiato: 'Copiato' }, window.EDIZIONE || {});
  const CHIAVE = ED.chiave;
  const CHIAVE_PREF = ED.chiavePref;
  const INIZIO_SUL_SERIO = ED.inizioSulSerio;   // null nelle edizioni senza periodo di prova
  const A = window.Analizza;
  const V = window.Voce;
  const $ = id => document.getElementById(id);
  const GIORNO_MS = 86400000;
  const TIPI_DATI = ['uscita', 'entrata', 'investimento'];

  // ================================================================ dati
  function vuoto() {
    return {
      movimenti: [], imparate: {}, ultimoBackup: null,
      ricorrenti: [],          // movimenti fissi: si segnano da soli ogni mese
      categorie: null,         // null = quelle di partenza; altrimenti l'elenco personale per tipo
      saldo: null,             // { importo, data, aggiornato }: soldi liquidi dichiarati da Francesco
      tasse: { attiva: false, percentuale: 0, categorie: [], dal: null }
    };
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
        return s;
      }
    } catch (e) { /* sotto */ }
    // dati illeggibili: prima di ripartire da zero se ne tiene una copia, per non perderli col primo salvataggio
    try { localStorage.setItem(CHIAVE + '.illeggibile.' + Date.now(), grezzo); } catch (e) { /* spazio pieno */ }
    return vuoto();
  }
  let stato = carica();
  let persistenzaChiesta = false;

  function scrivi() {
    try {
      localStorage.setItem(CHIAVE, JSON.stringify(stato));
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
  // 1.234,56 € — fatto a mano: Intl in italiano non mette il punto sotto i 10.000 (2400 €)
  // tondo = euro interi, per i riepiloghi; le righe dei movimenti tengono i centesimi
  function euro(cent, tondo) {
    const v = Math.abs(cent) / 100;
    const [intero, dec] = (tondo ? String(Math.round(v)) : v.toFixed(2)).split('.');
    const negativo = tondo ? Math.round(v) > 0 && cent < 0 : cent < 0;
    return (negativo ? '−' : '') + intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '') + ' €';
  }
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

  function etichettaGiorno(iso) {
    const d = daIso(iso), diff = Math.round((oggi() - d) / GIORNO_MS);
    if (diff === 0) return 'Oggi';
    if (diff === 1) return 'Ieri';
    if (diff === 2) return 'L\'altro ieri';
    if (diff === -1) return 'Domani';
    const anno = d.getFullYear() !== oggi().getFullYear() ? ' ' + d.getFullYear() : '';
    return maiuscola(GIORNI_BREVI[d.getDay()] + ' ' + d.getDate() + ' ' + MESI[d.getMonth()].slice(0, 3)) + anno;
  }
  function etichettaTipo(tipo, segno) {
    if (tipo === 'entrata') return 'Entrata';
    if (tipo === 'investimento') return segno < 0 ? 'Ritirato dagli investimenti' : 'Investito';
    return 'Uscita';
  }
  function segnoDi(tipo, segno) {
    if (tipo === 'entrata') return '+';
    if (tipo === 'uscita') return '−';
    return segno < 0 ? '↙ ' : '↗ ';
  }
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
  function opzioniAnalisi(extra) { return Object.assign({ oggi: oggi(), imparate: stato.imparate, categorie: stato.categorie }, extra || {}); }

  // ================================================================ toast
  let timerToast = null;
  function mostraToast(testo, azione, alClic) {
    $('toastTesto').textContent = testo;
    const b = $('toastAzione');
    b.hidden = !azione;
    b.textContent = azione || '';
    b.onclick = () => { nascondiToast(); if (alClic) alClic(); };
    $('toast').hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(nascondiToast, azione ? 6000 : 3500);
  }
  function nascondiToast() { $('toast').hidden = true; }

  // ================================================================ foglio dal basso
  let alChiudereFoglio = null;
  function apriFoglio(titolo, costruisci, alChiudere) {
    const corpo = $('foglioCorpo');
    corpo.textContent = '';
    const h = document.createElement('h2');
    h.id = 'foglioTitolo';
    h.textContent = titolo;
    corpo.appendChild(h);
    costruisci(corpo);
    alChiudereFoglio = alChiudere || null;
    nascondiToast();
    $('velo').hidden = false;
    $('foglio').hidden = false;
    $('foglio').scrollTop = 0;
  }
  function chiudiFoglio() {
    $('velo').hidden = true;
    $('foglio').hidden = true;
    const f = alChiudereFoglio;
    alChiudereFoglio = null;
    if (f) f();
  }
  const foglioAperto = () => !$('foglio').hidden;

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
  const TIPI = [
    { tipo: 'uscita', segno: 1, nome: 'Uscita', icona: '−' },
    { tipo: 'entrata', segno: 1, nome: 'Entrata', icona: '+' },
    { tipo: 'investimento', segno: 1, nome: 'Investito', icona: '↗' },
    { tipo: 'investimento', segno: -1, nome: 'Ritirato dagli investimenti', icona: '↙' }
  ];
  function scegliTipo(corrente, alScegliere) {
    apriFoglio('Che movimento è?', corpo => {
      const g = el('div', 'griglia');
      for (const t of TIPI) {
        const b = tasto('opzione' + (t.segno < 0 ? ' larga' : ''), t.icona + '  ' + t.nome, () => { chiudiFoglio(); alScegliere(t.tipo, t.segno); });
        b.setAttribute('aria-pressed', String(t.tipo === corrente.tipo && t.segno === (corrente.segno || 1)));
        g.appendChild(b);
      }
      corpo.appendChild(g);
      corpo.appendChild(el('p', 'nota', 'Gli investimenti stanno a parte: non contano come spese, ma li vedi nel totale «Investiti».'));
    });
  }
  function scegliCategoria(tipo, corrente, alScegliere) {
    apriFoglio('Categoria', corpo => {
      const g = el('div', 'griglia');
      for (const c of categorie(tipo)) {
        const b = tasto('opzione', c.icona + '  ' + c.nome, () => { chiudiFoglio(); alScegliere(c.nome); });
        b.setAttribute('aria-pressed', String(c.nome === corrente));
        g.appendChild(b);
      }
      g.appendChild(tasto('opzione larga tratteggiata', '＋  Nuova categoria', () => nuovaCategoria(tipo, nome => alScegliere(nome))));
      corpo.appendChild(g);
      corpo.appendChild(el('p', 'nota', 'Quando correggi una categoria, la prossima volta che usi le stesse parole la propongo io.'));
    });
  }
  function scegliData(corrente, alScegliere) {
    apriFoglio('Quando?', corpo => {
      const g = el('div', 'griglia');
      const base = oggi();
      [['Oggi', 0], ['Ieri', -1], ['L\'altro ieri', -2]].forEach(([nome, n]) => {
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
  let scelte = [];     // per ogni pezzo: { tipo, segno, categoria, data } scelti toccando i bottoni

  function rileggi() {
    const testo = campoFrase.value;
    adattaAltezza();
    if (!testo.trim()) {
      proposte = []; correnti = []; scelte = [];
      $('anteprima').hidden = true;
      $('suggerimento').hidden = false;
      return;
    }
    const opz = opzioniAnalisi();
    proposte = A.analizzaFrasi(testo, opz);
    if (scelte.length !== proposte.length) scelte = proposte.map(() => ({}));
    correnti = proposte.map((p, i) => {
      const s = scelte[i];
      let r = p;
      if (s.tipo) {
        r = Object.assign(A.analizza(p.testo, Object.assign({}, opz, { tipo: s.tipo, segno: s.segno })), { testo: p.testo });
        if (!r.certo.data) r.data = p.data;   // la data ereditata dal resto della frase
      }
      r = Object.assign({}, r, { certo: Object.assign({}, r.certo) });
      if (s.categoria && valida(r.tipo, s.categoria)) { r.categoria = s.categoria; r.certo.categoria = true; }
      if (s.data) r.data = s.data;
      return r;
    });
    disegnaAnteprima();
  }

  function cambiaTipo(i) {
    const c = correnti[i];
    if (!c) return;
    scegliTipo(c, (tipo, segno) => {
      scelte[i].tipo = tipo; scelte[i].segno = segno;
      if (scelte[i].categoria && !valida(tipo, scelte[i].categoria)) delete scelte[i].categoria;
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
    scegliData(c.data, iso => { scelte[i].data = iso; rileggi(); });
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
    const futuri = correnti.filter(c => daIso(c.data) > oggi());
    if (!multi) {
      const c = correnti[0];
      const ct = $('chipTipo');
      ct.textContent = etichettaTipo(c.tipo, c.segno);
      ct.classList.toggle('dubbio', !c.certo.tipo && !scelte[0].tipo && c.tipo !== 'uscita');
      const cc = $('chipCategoria');
      cc.textContent = iconaDi(c.tipo, c.categoria) + ' ' + c.categoria;
      cc.classList.toggle('dubbio', !c.certo.categoria && !scelte[0].categoria);
      $('chipData').textContent = etichettaGiorno(c.data);
      if (c.importo > 0) { imp.textContent = segnoDi(c.tipo, c.segno) + euro(c.importo); imp.classList.remove('manca'); }
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
        su.appendChild(el('span', 'ant-voce-importo' + (c.importo > 0 ? '' : ' manca'), c.importo > 0 ? segnoDi(c.tipo, c.segno) + euro(c.importo) : 'Quanto?'));
        r.appendChild(su);
        const chips = el('div', 'chips piccole');
        const t = tasto('chip', etichettaTipo(c.tipo, c.segno), () => cambiaTipo(i));
        t.classList.toggle('dubbio', !c.certo.tipo && !scelte[i].tipo && c.tipo !== 'uscita');
        const k = tasto('chip', iconaDi(c.tipo, c.categoria) + ' ' + c.categoria, () => cambiaCategoria(i));
        k.classList.toggle('dubbio', !c.certo.categoria && !scelte[i].categoria);
        chips.appendChild(t);
        chips.appendChild(k);
        chips.appendChild(tasto('chip', etichettaGiorno(c.data), () => cambiaData(i)));
        r.appendChild(chips);
        lista.appendChild(r);
      });
      const uscite = correnti.filter(c => c.tipo === 'uscita').reduce((a, c) => a + (c.importo || 0), 0);
      const entrate = correnti.filter(c => c.tipo === 'entrata').reduce((a, c) => a + (c.importo || 0), 0);
      imp.textContent = correnti.length + ' movimenti';
      imp.classList.remove('manca');
      $('antDescrizione').textContent = [uscite ? 'uscite ' + euro(uscite) : '', entrate ? 'entrate ' + euro(entrate) : ''].filter(Boolean).join(' · ');
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

  function impara(descrizione, tipo, segno, categoria) {
    for (const p of A.paroleSignificative(descrizione)) stato.imparate[p] = { tipo, segno, categoria };
    const chiavi = Object.keys(stato.imparate);   // tetto: le ultime 600 parole
    if (chiavi.length > 600) for (const k of chiavi.slice(0, chiavi.length - 600)) delete stato.imparate[k];
  }

  function salvaFrase() {
    if (!correnti.length || correnti.some(c => !(c.importo > 0))) { campoFrase.focus(); return; }
    const adesso = new Date().toISOString();
    const testo = campoFrase.value.trim();
    const nuovi = correnti.map((c, i) => {
      const p = proposte[i];
      if (p && (p.tipo !== c.tipo || p.segno !== c.segno || p.categoria !== c.categoria)) impara(c.descrizione, c.tipo, c.segno, c.categoria);
      return {
        id: nuovoId(), data: c.data, tipo: c.tipo,
        importo: c.tipo === 'investimento' ? c.importo * (c.segno < 0 ? -1 : 1) : c.importo,
        categoria: c.categoria, descrizione: c.descrizione, testo: correnti.length > 1 ? c.testo : testo, creato: adesso
      };
    });
    stato.movimenti.push(...nuovi);
    if (!scrivi()) { stato.movimenti.splice(stato.movimenti.length - nuovi.length, nuovi.length); return; }
    campoFrase.value = '';
    scelte = [];
    rileggi();
    const d = daIso(nuovi[nuovi.length - 1].data);
    vista.anno = d.getFullYear();
    if (vista.modo === 'mese') vista.mese = d.getMonth();
    disegna();
    const ids = new Set(nuovi.map(m => m.id));
    const m0 = nuovi[0];
    const testoToast = nuovi.length > 1 ? 'Salvati ' + nuovi.length + ' movimenti'
      : 'Salvato: ' + (m0.descrizione.length > 22 ? m0.descrizione.slice(0, 21) + '…' : m0.descrizione) + ' ' + euro(Math.abs(m0.importo));
    mostraToast(testoToast, 'Annulla', () => {
      stato.movimenti = stato.movimenti.filter(x => !ids.has(x.id));
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
  $('chipCategoria').addEventListener('click', () => cambiaCategoria(0));
  $('chipData').addEventListener('click', () => cambiaData(0));

  // ================================================================ movimenti fissi (ricorrenti)
  // Ogni fisso: { id, descrizione, importo (come nei movimenti: negativo = ritiro dagli investimenti),
  //   tipo, categoria, giorno (1-31), attivo, dal ('AAAA-MM': primo mese ancora da fare), fatti: ['AAAA-MM'] }.
  // Un mese «fatto» non si rifà più, anche se il movimento poi lo cancelli: così cancellare vuol dire «questo mese no».
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
        if (data <= d && !r.fatti.includes(k)) {
          nuovi.push({ id: nuovoId(), data: A.isoDa(data), tipo: r.tipo, importo: r.importo, categoria: r.categoria,
            descrizione: r.descrizione, testo: '', creato: adesso, ricorrente: r.id });
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
      if (!silenzioso) mostraToast(nuovi.length === 1 ? 'Segnato da solo: ' + nuovi[0].descrizione + ' ' + euro(Math.abs(nuovi[0].importo))
        : 'Segnati da soli ' + nuovi.length + ' movimenti fissi');
    } else if (cambiato) scrivi();
    return nuovi.length;
  }

  function totaleFissi() {
    const t = { uscite: 0, entrate: 0, investimenti: 0 };
    for (const r of stato.ricorrenti) {
      if (!r.attivo) continue;
      if (r.tipo === 'uscita') t.uscite += r.importo;
      else if (r.tipo === 'entrata') t.entrate += r.importo;
      else t.investimenti += r.importo;
    }
    return t;
  }

  function apriFissi() {
    apriFoglio('Movimenti fissi', corpo => {
      corpo.appendChild(el('p', '', 'Abbonamenti, PAC, palestra, telefono: li imposti una volta e si segnano da soli il giorno giusto di ogni mese. Se un mese non c\'è, cancella quel movimento: non torna.'));
      const t = totaleFissi();
      const somma = [t.uscite ? 'uscite ' + euro(t.uscite, true) : '', t.investimenti ? 'investimenti ' + euro(t.investimenti, true) : '', t.entrate ? 'entrate ' + euro(t.entrate, true) : ''].filter(Boolean);
      if (somma.length) corpo.appendChild(el('p', 'riassunto', 'Al mese: ' + somma.join(' · ')));
      const lista = el('div', 'elenco-righe');
      const ordinati = stato.ricorrenti.slice().sort((a, b) => a.giorno - b.giorno);
      for (const r of ordinati) {
        const b = el('button', 'mov');
        b.type = 'button';
        b.appendChild(el('span', 'mov-icona', iconaDi(r.tipo, r.categoria)));
        const testi = el('span', 'mov-testi');
        testi.appendChild(el('span', 'mov-desc', r.descrizione));
        testi.appendChild(el('span', 'mov-cat', 'il ' + r.giorno + ' di ogni mese · ' + r.categoria + (r.attivo ? '' : ' · in pausa')));
        b.appendChild(testi);
        b.appendChild(el('span', 'mov-importo ' + r.tipo, segnoDi(r.tipo, r.importo < 0 ? -1 : 1) + euro(Math.abs(r.importo))));
        b.addEventListener('click', () => apriFisso(r));
        lista.appendChild(b);
      }
      if (!ordinati.length) lista.appendChild(el('p', 'vuoto', 'Nessuno ancora. Puoi anche aprire un movimento già segnato e toccare «Ripeti ogni mese».'));
      corpo.appendChild(lista);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', '＋ Aggiungi', () => apriFisso(null)));
      corpo.appendChild(riga);
    });
  }

  function apriFisso(esistente) {
    const nuovo = !esistente;
    const ora = chiaveMese(oggi());
    const b = esistente ? Object.assign({ segno: esistente.importo < 0 ? -1 : 1 }, esistente, { importo: Math.abs(esistente.importo) })
      : { descrizione: '', importo: 0, tipo: 'uscita', segno: 1, categoria: ripiegoDi('uscita'), giorno: oggi().getDate(), attivo: true };
    let sceltaMano = !nuovo;
    let quando = b.giorno >= oggi().getDate() ? 'questo' : 'prossimo';
    const disegnaForm = () => apriFoglio(nuovo ? 'Nuovo movimento fisso' : 'Movimento fisso', corpo => {
      const inDesc = inputTesto(b.descrizione);
      inDesc.placeholder = 'es. Netflix, PAC S&P 500, palestra';
      inDesc.addEventListener('input', () => {
        if (sceltaMano) return;
        const r = A.analizza(inDesc.value, opzioniAnalisi());
        b.tipo = r.tipo; b.segno = r.segno; b.categoria = r.categoria;
        chipT.textContent = etichettaTipo(b.tipo, b.segno);
        chipC.textContent = iconaDi(b.tipo, b.categoria) + ' ' + b.categoria;
      });
      corpo.appendChild(campo('Che cos\'è', inDesc));
      const inImp = inputTesto(b.importo ? formatoPerCampo(b.importo) : '', 'decimal');
      inImp.placeholder = '0,00';
      corpo.appendChild(campo('Importo in euro', inImp));
      const inGiorno = inputTesto(b.giorno, 'numeric');
      corpo.appendChild(campo('Giorno del mese (1-31)', inGiorno));
      const chips = el('div', 'chips');
      chips.style.marginTop = '12px';
      const leggi = () => {
        b.descrizione = inDesc.value.trim();
        const v = leggiEuro(inImp.value);
        if (v !== null) b.importo = v;
        const g = parseInt(inGiorno.value, 10);
        if (g >= 1 && g <= 31) b.giorno = g;
      };
      const chipT = tasto('chip', etichettaTipo(b.tipo, b.segno), () => {
        leggi();
        scegliTipo(b, (tipo, segno) => {
          sceltaMano = true; b.tipo = tipo; b.segno = segno;
          if (!valida(tipo, b.categoria)) b.categoria = ripiegoDi(tipo);
          disegnaForm();
        });
      });
      const chipC = tasto('chip', iconaDi(b.tipo, b.categoria) + ' ' + b.categoria, () => {
        leggi();
        scegliCategoria(b.tipo, b.categoria, nome => { sceltaMano = true; b.categoria = nome; disegnaForm(); });
      });
      chips.appendChild(chipT);
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
        corpo.appendChild(el('p', 'nota', quando === 'questo'
          ? 'Se il giorno è già passato, lo segno subito per questo mese.'
          : 'Questo mese no: se l\'hai già pagato, segnalo a mano come al solito.'));
      } else {
        attivo = interruttore('Attivo: si segna ogni mese', b.attivo);
        corpo.appendChild(attivo.etichetta);
      }
      const riga = el('div', 'riga-tasti');
      if (!nuovo) riga.appendChild(tasto('tasto-pericolo', 'Elimina', () => {
        if (!confirm('Eliminare il movimento fisso «' + esistente.descrizione + '»? Quelli già segnati restano.')) return;
        stato.ricorrenti = stato.ricorrenti.filter(r => r.id !== esistente.id);
        scrivi(); chiudiFoglio(); disegna();
        mostraToast('Movimento fisso eliminato');
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        leggi();
        if (!b.descrizione) { mostraToast('Scrivi che cos\'è'); inDesc.focus(); return; }
        if (!(b.importo > 0)) { mostraToast('Importo non valido'); inImp.focus(); return; }
        const importo = b.tipo === 'investimento' ? b.importo * (b.segno < 0 ? -1 : 1) : b.importo;
        if (nuovo) {
          stato.ricorrenti.push({ id: nuovoId(), descrizione: b.descrizione, importo, tipo: b.tipo, categoria: b.categoria,
            giorno: b.giorno, attivo: true, dal: quando === 'questo' ? ora : meseDopo(ora), fatti: [], creato: new Date().toISOString() });
        } else {
          const r = stato.ricorrenti.find(x => x.id === esistente.id);
          if (!r) { chiudiFoglio(); return; }
          const riattivato = attivo && attivo.casella.checked && !r.attivo;
          Object.assign(r, { descrizione: b.descrizione, importo, tipo: b.tipo, categoria: b.categoria, giorno: b.giorno, attivo: attivo ? attivo.casella.checked : r.attivo });
          if (riattivato) r.dal = ora;   // i mesi di pausa non si recuperano
        }
        scrivi();
        chiudiFoglio();
        generaRicorrenti();
        disegna();
        if (nuovo) mostraToast('Movimento fisso salvato: il ' + b.giorno + ' di ogni mese');
      }));
      corpo.appendChild(riga);
    });
    disegnaForm();
  }

  function ripetiOgniMese(m) {
    const d = daIso(m.data), ora = chiaveMese(oggi()), suo = chiaveMese(d);
    const r = { id: nuovoId(), descrizione: m.descrizione, importo: m.importo, tipo: m.tipo, categoria: m.categoria,
      giorno: d.getDate(), attivo: true, dal: suo > ora ? suo : ora, fatti: [suo], creato: new Date().toISOString() };
    // se questo mese c'è già un movimento con la stessa descrizione, non lo rifà
    const stesso = x => x.tipo === m.tipo && x.data.slice(0, 7) === ora && A.normalizza(x.descrizione) === A.normalizza(m.descrizione);
    if (stato.movimenti.some(stesso)) r.fatti.push(ora);
    m.ricorrente = r.id;
    stato.ricorrenti.push(r);
    scrivi();
    generaRicorrenti();
    disegna();
    mostraToast('Si ripeterà ogni mese, il giorno ' + r.giorno);
  }

  // ================================================================ saldo, tasse e mesi di autonomia
  // Saldo attuale = saldo dichiarato + i movimenti venuti dopo (fino a oggi). Quelli dello stesso giorno contano
  // solo se segnati dopo aver dichiarato il saldo. Gli investimenti escono dai soldi liquidi, i ritiri rientrano.
  function saldoAttuale() {
    const s = stato.saldo;
    if (!s) return null;
    const oggiIso = isoOggi();
    let v = s.importo;
    for (const m of stato.movimenti) {
      if (m.data > oggiIso) continue;
      if (!(m.data > s.data || (m.data === s.data && (m.creato || '') > (s.aggiornato || '')))) continue;
      v += m.tipo === 'entrata' ? m.importo : -m.importo;
    }
    return v;
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
      totali.push(stato.movimenti.filter(m => m.tipo === 'uscita' && m.data.slice(0, 7) === chiave).reduce((a, m) => a + m.importo, 0));
    }
    if (!totali.length) return null;
    return { media: Math.round(totali.reduce((a, b) => a + b, 0) / totali.length), mesi: totali.length };
  }

  function formatoMesi(x) {
    if (x <= 0) return '0 mesi';
    if (x >= 120) return 'oltre 10 anni';
    const t = Math.round(x * 10) / 10;
    return String(t).replace('.', ',') + (t === 1 ? ' mese' : ' mesi');
  }

  function disegnaAutonomia() {
    const corpo = $('autonomiaCorpo');
    corpo.textContent = '';
    const sa = saldoAttuale();
    $('modSaldo').hidden = sa === null;
    if (sa === null) {
      corpo.appendChild(el('p', 'aut-testo', 'Quanto hai sui conti? Inseriscilo una volta: l\'app lo tiene aggiornato con i movimenti e ti dice quanti mesi reggi senza entrate.'));
      const r = el('div', 'riga-tasti');
      r.appendChild(tasto('tasto-secondario', 'Inserisci il saldo', apriSaldo));
      corpo.appendChild(r);
      return;
    }
    const ft = fondoTasse();
    const tasse = ft ? Math.max(0, ft.fondo) : 0;
    const spendibili = sa - tasse;
    const sm = speseMedie();
    const fissi = totaleFissi().uscite;
    let mesi = null, spiegazione;
    if (sm && sm.media > 0) {
      mesi = spendibili / sm.media;
      spiegazione = 'senza entrate, con le spese medie ' + (sm.mesi === 1 ? 'dell\'ultimo mese' : 'degli ultimi ' + sm.mesi + ' mesi') + ' (' + euro(sm.media, true) + ' al mese).';
    } else if (fissi > 0) {
      mesi = spendibili / fissi;
      spiegazione = 'senza entrate, contando solo le spese fisse (' + euro(fissi, true) + ' al mese): il conto vero arriva dopo il primo mese intero.';
    } else {
      spiegazione = 'Per calcolarli servono le spese di un mese intero, oppure i movimenti fissi.';
    }
    corpo.appendChild(el('p', 'aut-mesi', mesi !== null ? formatoMesi(mesi) : '—'));
    corpo.appendChild(el('p', 'aut-testo', spiegazione));
    const righe = el('div', 'aut-righe');
    const riga = (nome, valore, forte) => {
      const r = el('div', 'aut-riga' + (forte ? ' forte' : ''));
      r.appendChild(el('span', '', nome));
      r.appendChild(el('span', '', valore));
      righe.appendChild(r);
    };
    riga('Sui conti oggi', euro(sa, true));
    if (ft) {
      riga('Da tenere per le tasse', tasse ? '−' + euro(tasse, true) : euro(0, true));
      riga('Spendibili', euro(spendibili, true), true);
    }
    corpo.appendChild(righe);
    corpo.appendChild(el('p', 'nota', 'Saldo inserito ' + etichettaGiorno(stato.saldo.data).toLowerCase() + ': ' + euro(stato.saldo.importo, true) + '. Ricontrollalo ogni tanto col conto.'));
  }

  function apriSaldo() {
    apriFoglio('Saldo sui conti', corpo => {
      corpo.appendChild(el('p', '', 'Quanto hai adesso fra conti correnti e contanti, senza gli investimenti. Da qui in poi l\'app lo aggiorna coi movimenti che segni.'));
      const sa = saldoAttuale();
      const inp = inputTesto(sa !== null ? (sa < 0 ? '-' : '') + formatoPerCampo(sa) : '', 'decimal');
      inp.placeholder = '0,00';
      corpo.appendChild(campo('Soldi liquidi oggi, in euro', inp));
      corpo.appendChild(el('p', 'nota', 'Le spese che non segni lo fanno scostare dal conto vero: ogni tanto ricontrollalo e correggilo qui.'));
      const riga = el('div', 'riga-tasti');
      if (stato.saldo) riga.appendChild(tasto('tasto-secondario', 'Togli', () => {
        stato.saldo = null; scrivi(); chiudiFoglio(); disegna();
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        const v = leggiEuro(inp.value, true);
        if (v === null) { mostraToast('Importo non valido'); inp.focus(); return; }
        stato.saldo = { importo: v, data: isoOggi(), aggiornato: new Date().toISOString() };
        scrivi(); chiudiFoglio(); disegna();
        mostraToast('Saldo salvato');
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
  const EMOJI = ['🛒', '🍕', '☕', '🍺', '🚗', '🔧', '🏠', '📱', '💊', '🏋️', '⚔️', '⛵', '📚', '🎲', '🎮', '🎵',
    '✈️', '👕', '💻', '🎁', '🧾', '🏦', '🐶', '👶', '💼', '💶', '↩️', '🏷️', '🌱', '📈', '🪙', '•'];
  let tipoCategorie = 'uscita';

  function materializza() {
    const nuove = {};
    for (const tipo of TIPI_DATI) nuove[tipo] = A.elenco(tipo, stato.categorie).map(c => ({ nome: c.nome, icona: c.icona, base: c.base, nascosta: !!c.nascosta }));
    stato.categorie = nuove;
  }
  function pulisciNome(s) { return String(s).replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28); }
  function nomeLibero(tipo, nome, tranne) {
    const n = A.normalizza(nome);
    return !categorie(tipo, true).some(c => A.normalizza(c.nome) === n && c.nome !== tranne);
  }
  function usiDi(tipo, nome) { return stato.movimenti.filter(m => m.tipo === tipo && m.categoria === nome).length; }

  function rinomina(tipo, vecchio, nuovo, icona) {
    materializza();
    const e = stato.categorie[tipo].find(x => x.nome === vecchio);
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
      if (vista.filtro === vecchio && tipo === 'uscita') vista.filtro = nuovo;
      for (const s of scelte) if (s.categoria === vecchio) s.categoria = nuovo;
    }
    scrivi();
  }
  function aggiungiCategoria(tipo, nome, icona) {
    materializza();
    stato.categorie[tipo].splice(Math.max(0, stato.categorie[tipo].length - 1), 0, { nome, icona: icona || '•', base: null, nascosta: false });
    scrivi();
  }

  function formCategoria(tipo, esistente, alFinire) {
    let icona = esistente ? esistente.icona : '•';
    const disegnaForm = () => apriFoglio(esistente ? 'Rinomina categoria' : 'Nuova categoria', corpo => {
      const inp = inputTesto(esistente ? esistente.nome : '');
      inp.maxLength = 28;
      inp.placeholder = 'es. Scherma, Patente nautica';
      corpo.appendChild(campo('Nome', inp));
      corpo.appendChild(el('div', 'titoletto', 'Simbolo'));
      const g = el('div', 'griglia-emoji');
      for (const e of EMOJI) {
        const b = tasto('emoji', e, () => { icona = e; g.querySelectorAll('.emoji').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
        b.setAttribute('aria-pressed', String(e === icona));
        g.appendChild(b);
      }
      corpo.appendChild(g);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        const nome = pulisciNome(inp.value);
        if (!nome) { mostraToast('Scrivi un nome'); inp.focus(); return; }
        if (!nomeLibero(tipo, nome, esistente && esistente.nome)) { mostraToast('Questo nome c\'è già'); inp.focus(); return; }
        if (esistente) rinomina(tipo, esistente.nome, nome, icona);
        else aggiungiCategoria(tipo, nome, icona);
        chiudiFoglio();
        disegna();
        rileggi();
        if (alFinire) alFinire(nome);
      }));
      corpo.appendChild(riga);
      setTimeout(() => inp.focus(), 50);
    });
    disegnaForm();
  }
  function nuovaCategoria(tipo, alFinire) { formCategoria(tipo, null, alFinire); }

  function apriCategorie() {
    apriFoglio('Categorie', corpo => {
      const seg = el('div', 'segmentato largo');
      [['uscita', 'Uscite'], ['entrata', 'Entrate'], ['investimento', 'Investimenti']].forEach(([t, nome]) => {
        const b = tasto('', nome, () => { tipoCategorie = t; apriCategorie(); });
        b.setAttribute('aria-pressed', String(tipoCategorie === t));
        seg.appendChild(b);
      });
      corpo.appendChild(seg);
      const lista = el('div', 'elenco-righe');
      for (const c of categorie(tipoCategorie, true)) {
        const r = el('div', 'cat-riga' + (c.nascosta ? ' nascosta' : ''));
        r.appendChild(el('span', 'cat-icona', c.icona));
        r.appendChild(el('span', 'cat-nome', c.nome + (c.nascosta ? ' · nascosta' : '')));
        r.appendChild(tasto('tasto-piccolo', 'Rinomina', () => formCategoria(tipoCategorie, c, () => apriCategorie())));
        if (!c.ripiego) r.appendChild(tasto('tasto-piccolo', c.nascosta ? 'Mostra' : 'Nascondi', () => {
          materializza();
          const e = stato.categorie[tipoCategorie].find(x => x.nome === c.nome);
          if (e) e.nascosta = !c.nascosta;
          scrivi(); rileggi(); apriCategorie();
        }));
        if (!c.base && !usiDi(tipoCategorie, c.nome)) r.appendChild(tasto('tasto-piccolo pericolo', 'Elimina', () => {
          materializza();
          stato.categorie[tipoCategorie] = stato.categorie[tipoCategorie].filter(x => x.nome !== c.nome);
          scrivi(); rileggi(); apriCategorie();
        }));
        lista.appendChild(r);
      }
      corpo.appendChild(lista);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', '＋ Aggiungi categoria', () => nuovaCategoria(tipoCategorie, () => apriCategorie())));
      corpo.appendChild(riga);
      corpo.appendChild(el('p', 'nota', 'Le categorie nascoste non si propongono più, ma i movimenti vecchi restano dove sono. Rinominando, cambiano anche i movimenti già segnati.'));
    });
  }

  // ================================================================ periodo e riepilogo
  const vista = { modo: 'mese', anno: oggi().getFullYear(), mese: oggi().getMonth(), filtro: null };

  function nelPeriodo(m) {
    const [y, mm] = m.data.split('-').map(Number);
    return vista.modo === 'anno' ? y === vista.anno : (y === vista.anno && mm - 1 === vista.mese);
  }
  function totali(lista) {
    const t = { entrate: 0, uscite: 0, investiti: 0, tasse: 0 };
    for (const m of lista) {
      if (m.tipo === 'entrata') { t.entrate += m.importo; t.tasse += accantonamento(m); }
      else if (m.tipo === 'uscita') t.uscite += m.importo;
      else if (m.tipo === 'investimento') t.investiti += m.importo;
    }
    t.saldo = t.entrate - t.uscite;
    t.restano = t.saldo - t.investiti - t.tasse;
    return t;
  }
  // si può andare avanti fino al mese corrente, o più in là se ci sono movimenti con date future
  function ultimoMese() {
    let k = chiaveMese(oggi());
    for (const m of stato.movimenti) if (m.data.slice(0, 7) > k) k = m.data.slice(0, 7);
    return k;
  }

  function disegna() {
    const ora = oggi();
    $('oggi').textContent = maiuscola(GIORNI[ora.getDay()]) + ' ' + ora.getDate() + ' ' + MESI[ora.getMonth()];
    $('titoloPeriodo').textContent = vista.modo === 'anno' ? String(vista.anno) : maiuscola(MESI[vista.mese]) + ' ' + vista.anno;
    const ultimo = ultimoMese();
    const attuale = vista.anno + '-' + String(vista.mese + 1).padStart(2, '0');
    $('succ').disabled = vista.modo === 'anno' ? vista.anno >= Number(ultimo.slice(0, 4)) : attuale >= ultimo;
    document.querySelectorAll('.periodo .segmentato button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === vista.modo)));

    const lista = stato.movimenti.filter(nelPeriodo);
    const t = totali(lista);
    $('heroEtichetta').textContent = vista.modo === 'anno' ? 'Saldo del ' + vista.anno : 'Saldo di ' + MESI[vista.mese];
    $('heroValore').textContent = (Math.round(t.saldo / 100) > 0 ? '+' : '') + euro(t.saldo, true);
    const tolti = [];
    if (t.investiti > 0) tolti.push(euro(t.investiti, true) + ' investiti');
    if (t.tasse > 0) tolti.push(euro(t.tasse, true) + ' per le tasse');
    let sotto = 'Entrate meno uscite.';
    if (tolti.length) sotto += ' Tolti ' + tolti.join(' e ') + (t.investiti < 0 ? ', più ' + euro(-t.investiti, true) + ' ritirati dagli investimenti' : '') + ', restano ' + euro(t.restano, true) + '.';
    else if (t.investiti < 0) sotto += ' Più ' + euro(-t.investiti, true) + ' ritirati dagli investimenti: restano ' + euro(t.restano, true) + '.';
    $('heroSotto').textContent = sotto;
    $('totEntrate').textContent = euro(t.entrate, true);
    $('totUscite').textContent = euro(t.uscite, true);
    $('totInvestiti').textContent = euro(t.investiti, true);

    disegnaBarre(lista, t.uscite);
    $('sezMesi').hidden = vista.modo !== 'anno';
    if (vista.modo === 'anno') disegnaMesi();
    disegnaLista(lista);
    disegnaAutonomia();
    disegnaBanner();
    disegnaBannerProva();
  }

  function disegnaBarre(lista, totUscite) {
    const ol = $('barre');
    ol.textContent = '';
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
      const quota = totUscite ? Math.round(cent / totUscite * 100) : 0;
      b.setAttribute('aria-label', nome + ': ' + euro(cent) + ', ' + quota + '% delle uscite. Tocca per vedere i movimenti.');
      const testi = el('div', 'barra-testi');
      testi.appendChild(el('span', 'barra-nome', iconaDi('uscita', nome) + ' ' + nome));
      const val = el('span', 'barra-valore', euro(cent, true));
      val.appendChild(el('span', 'barra-quota', quota + '%'));
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
    for (let mm = finoA; mm >= 0; mm--) {
      const lista = stato.movimenti.filter(m => { const [y, x] = m.data.split('-').map(Number); return y === vista.anno && x - 1 === mm; });
      if (!lista.length) continue;   // i mesi senza movimenti non si mostrano
      righe++;
      const t = totali(lista);
      const tr = el('tr', 'cliccabile');
      tr.tabIndex = 0;
      tr.appendChild(el('td', '', maiuscola(MESI[mm])));
      tr.appendChild(el('td', '', euro(t.entrate, true)));
      tr.appendChild(el('td', '', euro(t.uscite, true)));
      tr.appendChild(el('td', '', (Math.round(t.saldo / 100) > 0 ? '+' : '') + euro(t.saldo, true)));
      const apri = () => { vista.modo = 'mese'; vista.mese = mm; vista.filtro = null; disegna(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
      tr.addEventListener('click', apri);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') apri(); });
      tb.appendChild(tr);
    }
    if (!righe) {
      const tr = el('tr');
      const td = el('td', 'vuoto', 'Nessun movimento nel ' + vista.anno + '.');
      td.colSpan = 4;
      td.style.textAlign = 'left';
      tr.appendChild(td);
      tb.appendChild(tr);
    }
  }

  function disegnaLista(lista) {
    const cont = $('lista');
    cont.textContent = '';
    const filtro = $('filtro');
    filtro.hidden = !vista.filtro;
    if (vista.filtro) filtro.textContent = 'Solo ' + vista.filtro;
    // nell'anno la lista completa è lunga: si vede solo filtrando una categoria
    $('sezMovimenti').hidden = vista.modo === 'anno' && !vista.filtro;
    let righe = vista.filtro ? lista.filter(m => m.tipo === 'uscita' && m.categoria === vista.filtro) : lista;
    righe = righe.slice().sort((a, b) => (b.data.localeCompare(a.data)) || (b.creato || '').localeCompare(a.creato || ''));
    if (!righe.length) {
      cont.appendChild(el('p', 'vuoto', stato.movimenti.length ? 'Nessun movimento in questo periodo.'
        : 'Ancora nessun movimento. Scrivi o detta la prima spesa qui sopra, per esempio «caffè 1,20».'));
      return;
    }
    let giorno = null;
    for (const m of righe) {
      if (m.data !== giorno) {
        giorno = m.data;
        cont.appendChild(el('div', 'giorno-titolo', etichettaGiorno(m.data)));
      }
      cont.appendChild(rigaMovimento(m));
    }
  }

  function rigaMovimento(m) {
    const b = el('button', 'mov');
    b.type = 'button';
    b.appendChild(el('span', 'mov-icona', iconaDi(m.tipo, m.categoria)));
    const testi = el('span', 'mov-testi');
    testi.appendChild(el('span', 'mov-desc', m.descrizione));
    let sotto = m.tipo === 'investimento' ? etichettaTipo(m.tipo, m.importo < 0 ? -1 : 1) + ' · ' + m.categoria : m.categoria;
    const acc = accantonamento(m);
    if (acc) sotto += ' · ' + euro(acc) + ' per le tasse';
    if (m.ricorrente) sotto += ' · fisso';
    testi.appendChild(el('span', 'mov-cat', sotto));
    b.appendChild(testi);
    b.appendChild(el('span', 'mov-importo ' + m.tipo, segnoDi(m.tipo, m.importo < 0 ? -1 : 1) + euro(Math.abs(m.importo))));
    b.setAttribute('aria-label', m.descrizione + ', ' + sotto + ', ' + etichettaTipo(m.tipo, m.importo < 0 ? -1 : 1) + ' ' + euro(Math.abs(m.importo)) + '. Tocca per modificare.');
    b.addEventListener('click', () => modifica(m.id));
    return b;
  }

  // ================================================================ modifica di un movimento
  function modifica(id) {
    const orig = stato.movimenti.find(m => m.id === id);
    if (!orig) return;
    const bozza = { tipo: orig.tipo, segno: orig.importo < 0 ? -1 : 1, categoria: orig.categoria, data: orig.data,
      descrizione: orig.descrizione, importo: Math.abs(orig.importo) };
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
      g.appendChild(tasto('chip', etichettaTipo(bozza.tipo, bozza.segno), () => {
        leggiCampi();
        scegliTipo(bozza, (tipo, segno) => {
          bozza.tipo = tipo; bozza.segno = segno;
          if (!valida(tipo, bozza.categoria)) bozza.categoria = ripiegoDi(tipo);
          ridisegna();
        });
      }));
      g.appendChild(tasto('chip', iconaDi(bozza.tipo, bozza.categoria) + ' ' + bozza.categoria, () => {
        leggiCampi();
        scegliCategoria(bozza.tipo, bozza.categoria, nome => { bozza.categoria = nome; ridisegna(); });
      }));
      g.appendChild(tasto('chip', etichettaGiorno(bozza.data), () => {
        leggiCampi();
        scegliData(bozza.data, iso => { bozza.data = iso; ridisegna(); });
      }));
      corpo.appendChild(g);
      corpo.appendChild(campo('Importo in euro', inImp));
      corpo.appendChild(campo('Descrizione', inDesc));
      if (orig.testo) corpo.appendChild(el('p', 'nota', 'Frase originale: «' + orig.testo + '»'));

      // applica al movimento quello che è scritto nel foglio; false se l'importo non va
      const applica = () => {
        leggiCampi();
        if (!(bozza.importo > 0)) { mostraToast('Importo non valido'); inImp.focus(); return false; }
        if (bozza.tipo !== orig.tipo || bozza.categoria !== orig.categoria) impara(bozza.descrizione, bozza.tipo, bozza.segno, bozza.categoria);
        Object.assign(orig, {
          tipo: bozza.tipo, categoria: bozza.categoria, data: bozza.data, descrizione: bozza.descrizione || bozza.categoria,
          importo: bozza.tipo === 'investimento' ? bozza.importo * bozza.segno : bozza.importo,
          modificato: new Date().toISOString()
        });
        return true;
      };
      const fisso = orig.ricorrente && stato.ricorrenti.find(r => r.id === orig.ricorrente);
      const rip = tasto('tasto-secondario', fisso ? '🔁 Fisso: il ' + fisso.giorno + ' di ogni mese · Modifica' : '🔁 Ripeti ogni mese', () => {
        if (fisso) { apriFisso(fisso); return; }
        if (!applica()) return;
        chiudiFoglio();
        ripetiOgniMese(orig);   // salva lui
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
        mostraToast('Eliminato', 'Annulla', () => { stato.movimenti.push(tolto); scrivi(); disegna(); });
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        if (!applica()) return;
        scrivi();
        chiudiFoglio();
        disegna();
        mostraToast('Modifica salvata');
      }));
      corpo.appendChild(riga);
    });
    ridisegna();
  }

  // ================================================================ esporta e importa
  // Righe leggibili (anche da Claude) + righe «#» con le impostazioni, per ripristinare tutto su un altro telefono.
  function testoEsportazione() {
    const righe = stato.movimenti.slice().sort((a, b) => a.data.localeCompare(b.data) || (a.creato || '').localeCompare(b.creato || ''));
    const pulisci = s => String(s || '').replace(/[;\r\n]+/g, ' ').trim();
    const out = [];
    out.push('# Conti — esportazione del ' + new Date().toLocaleString('it-IT') + ' — ' + righe.length + ' movimenti — app ' + VERSIONE);
    out.push('data;tipo;importo;categoria;descrizione;id');
    for (const m of righe) out.push([m.data, m.tipo, (m.importo / 100).toFixed(2), pulisci(m.categoria), pulisci(m.descrizione), m.id].join(';'));
    out.push('#imparate ' + JSON.stringify(stato.imparate));
    out.push('#fissi ' + JSON.stringify(stato.ricorrenti));
    out.push('#categorie ' + JSON.stringify(stato.categorie));
    out.push('#saldo ' + JSON.stringify(stato.saldo));
    out.push('#tasse ' + JSON.stringify(stato.tasse));
    out.push('#legami ' + JSON.stringify(Object.fromEntries(stato.movimenti.filter(m => m.ricorrente).map(m => [m.id, m.ricorrente]))));
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
    const ids = new Set(stato.movimenti.map(m => m.id));
    const tipi = new Set(TIPI_DATI);
    const meta = {};
    const righe = [];
    for (const riga of String(testo).split(/\r?\n/)) {
      const r = riga.trim();
      if (!r) continue;
      const m = r.match(/^#(imparate|fissi|categorie|saldo|tasse|legami) (.*)$/);
      if (m) { try { meta[m[1]] = JSON.parse(m[2]); } catch (e) { /* riga rovinata: si ignora */ } continue; }
      if (r.startsWith('#') || r.startsWith('data;')) continue;
      righe.push(r);
    }
    // prima le impostazioni: le categorie personali servono per riconoscere quelle dei movimenti
    if (meta.imparate && typeof meta.imparate === 'object') Object.assign(stato.imparate, meta.imparate);
    if (meta.categorie && typeof meta.categorie === 'object' && !stato.categorie) stato.categorie = meta.categorie;
    if (meta.saldo && !stato.saldo && typeof meta.saldo.importo === 'number') stato.saldo = meta.saldo;
    if (meta.tasse && !stato.tasse.attiva && typeof meta.tasse === 'object') stato.tasse = Object.assign(vuoto().tasse, meta.tasse);
    if (Array.isArray(meta.fissi)) {
      const presenti = new Set(stato.ricorrenti.map(r => r.id));
      for (const r of meta.fissi) if (r && r.id && !presenti.has(r.id) && tipi.has(r.tipo) && r.importo) stato.ricorrenti.push(r);
    }
    const legami = meta.legami && typeof meta.legami === 'object' ? meta.legami : {};
    for (const r of righe) {
      const c = r.split(';');
      if (c.length < 5) { esito.scartati++; continue; }
      const [data, tipo, importo, categoria, descrizione] = c.map(x => x.trim());
      let id = (c[5] || '').trim();
      const n = parseFloat(importo.replace(',', '.'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !tipi.has(tipo) || !isFinite(n) || n === 0) { esito.scartati++; continue; }
      if (!id) id = 'imp-' + hash(r);
      if (ids.has(id)) { esito.presenti++; continue; }
      let cat = pulisciNome(categoria) || ripiegoDi(tipo);
      const uguale = categorie(tipo, true).find(x => A.normalizza(x.nome) === A.normalizza(cat));
      if (uguale) cat = uguale.nome;
      else aggiungiCategoria(tipo, cat, '•');
      const mov = { id, data, tipo, importo: Math.round(n * 100), categoria: cat, descrizione: descrizione || cat, creato: new Date().toISOString(), importato: true };
      if (legami[id]) mov.ricorrente = legami[id];
      stato.movimenti.push(mov);
      ids.add(id);
      esito.aggiunti++;
    }
    scrivi();
    return esito;
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  function apriMenu() {
    apriFoglio('Menù', corpo => {
      corpo.appendChild(el('div', 'titoletto', 'Sfondo'));
      filaSfondi(corpo);

      corpo.appendChild(el('div', 'titoletto', 'Impostazioni'));
      const imp = el('div', 'elenco-azioni');
      const voce = (titolo, sotto, alClic) => { const b = tasto('azione', titolo, alClic); b.appendChild(el('small', '', sotto)); imp.appendChild(b); };
      const tf = totaleFissi(), nf = stato.ricorrenti.length;
      voce('🔁 Movimenti fissi', nf ? nf + (nf === 1 ? ' impostato' : ' impostati') + (tf.uscite ? ' · uscite ' + euro(tf.uscite, true) + ' al mese' : '') : 'Abbonamenti, PAC, palestra: si segnano da soli ogni mese.', apriFissi);
      const sa = saldoAttuale();
      voce('🏦 Saldo sui conti', sa !== null ? 'Oggi ' + euro(sa, true) + ' · tocca per correggerlo' : 'Per sapere quanti mesi reggi senza entrate.', apriSaldo);
      voce('🧾 Tasse da accantonare', stato.tasse.attiva ? String(stato.tasse.percentuale).replace('.', ',') + '% di ' + (stato.tasse.categorie.join(', ') || 'nessuna categoria') : 'Spento', apriTasse);
      voce('🏷️ Categorie', 'Aggiungi, rinomina o nascondi.', apriCategorie);
      corpo.appendChild(imp);

      corpo.appendChild(el('div', 'titoletto', 'I tuoi movimenti'));
      const n = stato.movimenti.length;
      corpo.appendChild(el('p', '', n + (n === 1 ? ' movimento' : ' movimenti') + ' salvati su questo telefono. ' + testoUltimoBackup()));
      const azioni = el('div', 'elenco-azioni');
      azioni.style.marginTop = '10px';
      corpo.appendChild(azioni);

      const bCopia = tasto('azione', 'Copia tutto come testo', async () => {
        const ok = await copiaTesto(testoEsportazione());
        if (ok) { segnaBackup(); chiudiFoglio(); mostraToast(ED.avvisoCopiato); }
        else mostraToast('Non sono riuscito a copiare');
      });
      bCopia.appendChild(el('small', '', ED.testoCopia));
      azioni.appendChild(bCopia);

      if (navigator.share) {
        const bCond = tasto('azione', 'Condividi il file', async () => {
          const testo = testoEsportazione();
          const nome = 'conti-' + isoOggi() + '.txt';
          try {
            const file = new File([testo], nome, { type: 'text/plain' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Conti' });
            else await navigator.share({ title: 'Conti', text: testo });
            segnaBackup();
            chiudiFoglio();
          } catch (e) {
            if (e && e.name !== 'AbortError') mostraToast('Condivisione non riuscita');
          }
        });
        bCond.appendChild(el('small', '', 'Salvalo in File, mandalo a te stesso su WhatsApp o per mail.'));
        azioni.appendChild(bCond);
      }

      const bImp = tasto('azione', 'Importa da testo', () => apriImporta());
      bImp.appendChild(el('small', '', 'Incolla un\'esportazione: i movimenti già presenti non si doppiano.'));
      azioni.appendChild(bImp);

      const bZero = tasto('azione', 'Ricomincia da zero', ricomincia);
      bZero.style.color = 'var(--critico)';
      bZero.disabled = !n;
      bZero.appendChild(el('small', '', 'Cancella tutti i movimenti, per esempio quelli di prova. Impostazioni e parole imparate restano.'));
      azioni.appendChild(bZero);

      corpo.appendChild(el('p', 'nota', 'I movimenti esistono solo dentro questa app sul telefono. Se cancelli l\'icona dalla schermata Home o i dati del sito, spariscono: esporta ogni tanto.'));
      const crediti = tasto('tasto-secondario', 'Crediti delle foto', apriCrediti);
      crediti.style.marginTop = '12px';
      corpo.appendChild(crediti);
      const info = el('p', 'nota', 'Versione ' + VERSIONE + (pref.voceScaricata ? ' · riconoscimento vocale scaricato' : '') + '. ');
      const aggiorna = tasto('tasto-secondario', 'Cerca aggiornamenti', async () => {
        if (!navigator.serviceWorker) return;
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) { await reg.update().catch(() => {}); mostraToast(reg.installing || reg.waiting ? 'Aggiornamento in arrivo…' : 'È già l\'ultima versione'); }
      });
      aggiorna.style.marginTop = '8px';
      info.appendChild(el('br'));
      info.appendChild(aggiorna);
      corpo.appendChild(info);
    });
  }

  function apriImporta() {
    apriFoglio('Importa movimenti', corpo => {
      corpo.appendChild(el('p', '', 'Incolla qui il testo di un\'esportazione di Conti.'));
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
    const n = stato.movimenti.length;
    const vecchio = !stato.ultimoBackup || (Date.now() - new Date(stato.ultimoBackup)) > 14 * GIORNO_MS;
    const mostra = n >= 10 && vecchio;
    $('bannerBackup').hidden = !mostra;
    if (mostra) $('bannerTesto').textContent = 'I movimenti stanno solo su questo telefono. ' + testoUltimoBackup();
  }

  // ================================================================ ricominciare e fine delle prove
  function cancella(condizione, messaggio) {
    const tolti = stato.movimenti.filter(condizione);
    stato.movimenti = stato.movimenti.filter(m => !condizione(m));
    scrivi();
    chiudiFoglio();
    disegna();
    mostraToast(messaggio, 'Annulla', () => { stato.movimenti = stato.movimenti.concat(tolti); scrivi(); disegna(); });
  }

  function ricomincia() {
    const n = stato.movimenti.length;
    apriFoglio('Ricomincia da zero', corpo => {
      corpo.appendChild(el('p', '', 'Cancello tutti i ' + n + ' movimenti. Restano le impostazioni (movimenti fissi, saldo, categorie, tasse), le parole che l\'app ha imparato e lo sfondo.'));
      corpo.appendChild(el('p', '', 'Se vuoi tenerne una copia, prima usa «Copia tutto come testo».'));
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-secondario', 'Annulla', chiudiFoglio));
      riga.appendChild(tasto('tasto-pericolo', 'Cancella tutto', () => cancella(() => true, 'Cancellati ' + n + ' movimenti')));
      corpo.appendChild(riga);
    });
  }

  function disegnaBannerProva() {
    if (!INIZIO_SUL_SERIO) { $('bannerProva').hidden = true; return; }
    const prove = stato.movimenti.filter(m => m.data < INIZIO_SUL_SERIO);
    const mostra = isoOggi() >= INIZIO_SUL_SERIO && !pref.proveChiuse && prove.length > 0;
    $('bannerProva').hidden = !mostra;
    if (mostra) $('bannerProvaTesto').textContent = 'Dal 1° dicembre si fa sul serio. Cancello i ' + prove.length +
      (prove.length === 1 ? ' movimento di prova segnato' : ' movimenti di prova segnati') + ' prima?';
  }
  $('provaTieni').addEventListener('click', () => { pref.proveChiuse = true; scriviPref(); disegnaBannerProva(); });
  $('provaCancella').addEventListener('click', () => {
    pref.proveChiuse = true;
    scriviPref();
    cancella(m => m.data < INIZIO_SUL_SERIO, 'Cancellate le prove');
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
  function apriCrediti() {
    apriFoglio('Crediti delle foto', corpo => {
      corpo.appendChild(el('p', '', 'Foto «in vetrina» di Wikimedia Commons, ritagliate per il telefono. Le licenze libere chiedono di citare chi le ha scattate.'));
      const ul = el('ul', 'passi crediti');
      for (const s of sfondi) {
        const li = el('li');
        li.appendChild(el('b', '', s.nome + ': '));
        li.appendChild(document.createTextNode(s.autore + ' · ' + s.licenza + ' · '));
        const a = el('a', '', 'originale');
        a.href = s.fonte; a.target = '_blank'; a.rel = 'noopener';
        li.appendChild(a);
        ul.appendChild(li);
      }
      corpo.appendChild(ul);
    });
  }
  applicaSfondo();
  fetch('sfondi/sfondi.json').then(r => r.json()).then(l => { if (Array.isArray(l)) { sfondi = l; applicaSfondo(); } }).catch(() => {});

  // ================================================================ microfono (Whisper dentro il telefono, voce.js)
  let statoVoce = 'fermo';   // fermo | scarico | ascolto | trascrivo
  let ascoltoInCorso = null;
  const bottoneVoce = $('microfono');

  function mostraStatoVoce(testo, livello) {
    $('statoVoce').hidden = !testo;
    $('statoVoceTesto').textContent = testo || '';
    const barra = $('livelloVoce');
    barra.parentElement.hidden = livello === undefined;
    barra.style.transform = 'scaleX(' + Math.max(0, Math.min(1, livello || 0)) + ')';
  }
  function fineVoce() {
    statoVoce = 'fermo';
    ascoltoInCorso = null;
    bottoneVoce.classList.remove('ascolta', 'lavora');
    bottoneVoce.setAttribute('aria-label', 'Detta a voce');
    mostraStatoVoce('');
  }
  // parole che Francesco usa di più: aiutano Whisper a scriverle giuste («Gino», «Fineco»…)
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

  function chiediScaricamento() {
    apriFoglio('Microfono', corpo => {
      corpo.appendChild(el('p', '', 'Per capire la voce, l\'app scarica una volta sola il riconoscimento vocale: circa ' + V.PESO_MB + ' MB, meglio col Wi-Fi.'));
      corpo.appendChild(el('p', '', 'Poi funziona anche senza rete, e la tua voce non esce mai dal telefono: la trascrizione la fa il telefono stesso.'));
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-secondario', 'Usa la tastiera', () => guidaDettatura('')));
      riga.appendChild(tasto('tasto-primario', 'Scarica', scaricaVoce));
      corpo.appendChild(riga);
    });
  }
  async function scaricaVoce() {
    chiudiFoglio();
    statoVoce = 'scarico';
    bottoneVoce.classList.add('lavora');
    mostraStatoVoce('Scarico il riconoscimento vocale… 0%', 0);
    try {
      await V.caricaModello(p => { if (statoVoce === 'scarico') mostraStatoVoce('Scarico il riconoscimento vocale… ' + Math.round(p * 100) + '%', p); });
      pref.voceScaricata = true;
      scriviPref();
      fineVoce();
      mostraToast('Pronto: tocca il microfono e parla');
    } catch (e) {
      fineVoce();
      mostraToast('Scaricamento non riuscito: controlla la rete e riprova');
    }
  }

  function erroreMicrofono(e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      guidaDettatura('Il permesso del microfono è negato. Sull\'iPhone: Impostazioni → Safari → Microfono → «Chiedi» o «Consenti», poi riapri Conti. Intanto puoi dettare con la tastiera:');
    } else {
      mostraToast('Microfono non disponibile' + (e && e.message ? ': ' + e.message.slice(0, 50) : ''));
    }
  }

  async function microfono() {
    if (statoVoce === 'ascolto') { if (ascoltoInCorso) ascoltoInCorso.ferma(); return; }
    if (statoVoce !== 'fermo') return;
    if (!V || !V.disponibile) { guidaDettatura('Questo telefono non lascia usare il microfono all\'app.'); return; }
    if (!pref.voceScaricata) { chiediScaricamento(); return; }
    let a;
    try {
      // dentro il tocco: sull'iPhone l'audio si apre solo da un gesto
      a = V.ascolta({
        alVia: () => { if (statoVoce === 'ascolto') mostraStatoVoce('Ti ascolto… parla, poi fai una pausa', 0); },
        alLivello: l => { if (statoVoce === 'ascolto') $('livelloVoce').style.transform = 'scaleX(' + l + ')'; }
      });
    } catch (e) { erroreMicrofono(e); return; }
    statoVoce = 'ascolto';
    ascoltoInCorso = a;
    bottoneVoce.classList.add('ascolta');
    bottoneVoce.setAttribute('aria-label', 'Smetti di ascoltare');
    mostraStatoVoce('Apro il microfono…', 0);
    // intanto si carica il modello (dalla memoria del telefono: qualche secondo)
    const modello = V.caricaModello(p => { if (statoVoce === 'trascrivo') mostraStatoVoce('Riscarico il riconoscimento vocale… ' + Math.round(p * 100) + '%'); })
      .then(() => null, e => e);
    let ris;
    try { ris = await a.finito; }
    catch (e) { fineVoce(); erroreMicrofono(e); return; }
    ascoltoInCorso = null;
    bottoneVoce.classList.remove('ascolta');
    if (!ris.parlato) { fineVoce(); mostraToast('Non ho sentito niente: riprova'); return; }
    statoVoce = 'trascrivo';
    bottoneVoce.classList.add('lavora');
    mostraStatoVoce('Trascrivo…');
    try {
      const errore = await modello;
      if (errore) throw errore;
      const testo = await V.trascrivi(ris.audio, paroleFrequenti());
      if (!testo) mostraToast('Non ho capito: riprova, un po\' più vicino');
      else {
        const prima = campoFrase.value.trim();
        campoFrase.value = prima ? prima.replace(/[,.\s]+$/, '') + ', ' + testo : testo;
        rileggi();
      }
    } catch (e) {
      mostraToast('Trascrizione non riuscita: ' + (e && e.message ? e.message.slice(0, 60) : 'errore'));
    }
    fineVoce();
  }
  bottoneVoce.addEventListener('click', microfono);

  // ================================================================ eventi generali
  $('apriMenu').addEventListener('click', apriMenu);
  $('bannerEsporta').addEventListener('click', apriMenu);
  $('modSaldo').addEventListener('click', apriSaldo);
  $('velo').addEventListener('click', chiudiFoglio);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && foglioAperto()) chiudiFoglio(); });
  $('filtro').addEventListener('click', () => { vista.filtro = null; disegna(); });
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
    if (document.hidden) return;
    generaRicorrenti();
    rileggi();
    disegna();
    applicaSfondo();
  });

  generaRicorrenti();
  rileggi();
  disegna();

  // ================================================================ funzionamento senza rete
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const avevaController = !!navigator.serviceWorker.controller;
    let ricaricato = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!avevaController || ricaricato) return;
      ricaricato = true;
      if (!campoFrase.value.trim() && !foglioAperto() && statoVoce === 'fermo') location.reload();
      else mostraToast('Nuova versione pronta', 'Aggiorna', () => location.reload());
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  // per le prove automatiche
  window.__conti = {
    versione: VERSIONE, edizione: ED, stato: () => stato, pref: () => pref, testoEsportazione, importaTesto,
    generaRicorrenti, saldoAttuale, fondoTasse, speseMedie, totaleFissi, rinomina, aggiungiCategoria, materializza,
    statoVoce: () => statoVoce
  };
})();
