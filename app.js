/* Conti — l'app. I dati stanno solo nel telefono (localStorage di questa app). */
(function () {
  'use strict';

  const VERSIONE = '2026.11.10-1235';
  const ED = Object.assign({ nome: 'principale', titolo: 'Conti', chiave: 'conti.v1', chiavePref: 'conti.preferenze',
    inizioSulSerio: null, testoCopia: 'È la tua copia di sicurezza.', avvisoCopiato: 'Copiato' }, window.EDIZIONE || {});
  const CHIAVE = ED.chiave;
  const CHIAVE_PREF = ED.chiavePref;
  const INIZIO_SUL_SERIO = ED.inizioSulSerio;   // null nelle edizioni senza periodo di prova
  const A = window.Analizza;
  const V = window.Voce;
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
      saldo: null,             // { importo, data, aggiornato }: soldi liquidi dichiarati da Francesco
      tasse: { attiva: false, percentuale: 0, categorie: [], dal: null }
    };
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
  const etichettaTipo = tipo => (tipo === 'entrata' ? 'Entrata' : 'Uscita');
  const segnoDi = tipo => (tipo === 'entrata' ? '+' : '−');
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
  function opzioniAnalisi(extra) { return Object.assign({ oggi: oggi(), adesso: new Date(), imparate: stato.imparate, categorie: stato.categorie }, extra || {}); }

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
  // Si chiude toccando il velo, col tasto Esc o trascinandolo in giù (dal 10/11/2026), come i fogli dell'iPhone.
  let alChiudereFoglio = null, timerFoglio = null;
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
    clearTimeout(timerFoglio);
    const f = $('foglio'), v = $('velo');
    const giaAperto = !f.hidden && !f.classList.contains('via');
    f.classList.remove('via');
    f.style.transform = ''; v.style.opacity = '';
    v.hidden = false;
    f.hidden = false;
    f.scrollTop = 0;
    if (!giaAperto) { f.classList.add('entra'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('entra'))); }
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
  }
  const foglioAperto = () => !$('foglio').hidden && !$('foglio').classList.contains('via');

  // trascinare in giù: parte solo se il foglio è già scorso in cima (o dalla maniglia), così lo scorrimento resta normale
  (function trascinaFoglio() {
    const f = $('foglio');
    let y0 = null, dy = 0, t0 = 0, attivo = false, bloccaClic = 0;
    f.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || f.classList.contains('via')) { y0 = null; return; }
      const daManiglia = !!e.target.closest('.maniglia');
      if (f.scrollTop > 0 && !daManiglia) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0; t0 = performance.now(); attivo = false;
    }, { passive: true });
    f.addEventListener('touchmove', e => {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      if (!attivo) {
        if (dy > 6 && f.scrollTop <= 0) attivo = true;
        else { if (dy < -6) y0 = null; return; }
      }
      e.preventDefault();
      f.classList.add('trascina');
      f.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
      $('velo').style.opacity = String(Math.max(0.15, 1 - dy / 450));
    }, { passive: false });
    const fine = () => {
      if (y0 === null) return;
      y0 = null;
      f.classList.remove('trascina');
      if (!attivo) return;
      attivo = false;
      bloccaClic = performance.now() + 350;   // il dito che si alza non deve «toccare» un bottone
      const veloce = dy / Math.max(1, performance.now() - t0) > 0.5;
      if (dy > 120 || (dy > 50 && veloce)) chiudiFoglio(true);
      else { f.style.transform = ''; $('velo').style.opacity = ''; }
    };
    f.addEventListener('touchend', fine);
    f.addEventListener('touchcancel', fine);
    f.addEventListener('click', e => { if (performance.now() < bloccaClic) { e.stopPropagation(); e.preventDefault(); } }, true);
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
  function scegliTipo(corrente, alScegliere) { alScegliere(altroTipo(corrente.tipo)); }
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
    b.addEventListener('touchend', ferma);
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
        const b = el('button', 'opzione' + (c.nascosta ? ' spenta' : ''), c.icona + '  ' + c.nome + (inModifica ? '' : ''));
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
  // «ripeti» (facoltativo): { acceso, alCambiare(bool) } per la spesa ricorrente, che si ripete ogni mese
  function scegliData(corrente, alScegliere, ripeti) {
    apriFoglio('Quando?', corpo => {
      if (ripeti) {
        const seg = el('div', 'segmentato largo');
        seg.id = 'quandoRipeti';
        const giorno = daIso(corrente).getDate();
        [[false, 'Una volta'], [true, '🔁 Ogni mese']].forEach(([v, nome]) => {
          const s = tasto('', nome, () => { ripeti.alCambiare(v); scegliData(corrente, alScegliere, Object.assign({}, ripeti, { acceso: v })); });
          s.setAttribute('aria-pressed', String(!!ripeti.acceso === v));
          seg.appendChild(s);
        });
        corpo.appendChild(seg);
        corpo.appendChild(el('p', 'nota-su', ripeti.acceso
          ? 'Spesa ricorrente: si segna da sola il ' + giorno + ' di ogni mese (il giorno che scegli qui sotto). La trovi in Menù → Movimenti fissi.'
          : 'Per le uscite stabili (affitto, abbonamenti, palestra) scegli «Ogni mese»: si segnano da sole.'));
      }
      const g = el('div', 'griglia');
      g.style.marginTop = ripeti ? '12px' : '0';
      const base = oggi();
      [['Oggi', 0], ['Ieri', -1], ['L’altro ieri', -2]].forEach(([nome, n]) => {
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
  let scelte = [];     // per ogni pezzo: { tipo, categoria, data, ripeti } scelti toccando i bottoni

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
        r = Object.assign(A.analizza(p.testo, Object.assign({}, opz, { tipo: s.tipo })), { testo: p.testo });
        if (!r.certo.data) r.data = p.data;   // la data ereditata dal resto della frase
      }
      r = Object.assign({}, r, { certo: Object.assign({}, r.certo) });
      if (s.categoria && valida(r.tipo, s.categoria)) { r.categoria = s.categoria; r.certo.categoria = true; }
      if (s.data) r.data = s.data;
      if (s.ripeti !== undefined) r.ripeti = s.ripeti;
      return r;
    });
    disegnaAnteprima();
  }

  function cambiaTipo(i) {
    const c = correnti[i];
    if (!c) return;
    scegliTipo(c, tipo => {
      scelte[i].tipo = tipo;
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
    scegliData(c.data, iso => { scelte[i].data = iso; rileggi(); },
      { acceso: c.ripeti, alCambiare: v => { scelte[i].ripeti = v; rileggi(); } });
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
      ct.textContent = etichettaTipo(c.tipo);
      ct.classList.toggle('dubbio', !c.certo.tipo && !scelte[0].tipo && c.tipo !== 'uscita');
      const cc = $('chipCategoria');
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
        const k = tasto('chip', iconaDi(c.tipo, c.categoria) + ' ' + c.categoria, () => cambiaCategoria(i));
        k.classList.toggle('dubbio', !c.certo.categoria && !scelte[i].categoria);
        chips.appendChild(t);
        chips.appendChild(k);
        chips.appendChild(tasto('chip', etichettaQuando(c), () => cambiaData(i)));
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

  const etichettaQuando = c => etichettaGiorno(c.data) + (c.ripeti ? ' · 🔁 ogni mese' : '');

  function impara(descrizione, tipo, categoria) {
    for (const p of A.paroleSignificative(descrizione)) stato.imparate[p] = { tipo, categoria };
    const chiavi = Object.keys(stato.imparate);   // tetto: le ultime 600 parole
    if (chiavi.length > 600) for (const k of chiavi.slice(0, chiavi.length - 600)) delete stato.imparate[k];
  }

  function salvaFrase() {
    if (!correnti.length || correnti.some(c => !(c.importo > 0))) { campoFrase.focus(); return; }
    const adesso = new Date().toISOString();
    const testo = campoFrase.value.trim();
    const nuovi = correnti.map((c, i) => {
      const p = proposte[i];
      if (p && (p.tipo !== c.tipo || p.categoria !== c.categoria)) impara(c.descrizione, c.tipo, c.categoria);
      return {
        id: nuovoId(), data: c.data, tipo: c.tipo, importo: c.importo,
        categoria: c.categoria, descrizione: c.descrizione, testo: correnti.length > 1 ? c.testo : testo, creato: adesso
      };
    });
    stato.movimenti.push(...nuovi);
    // spese ricorrenti: diventano anche movimenti fissi, che si segnano da soli i mesi dopo
    const fissi = nuovi.filter((m, i) => correnti[i].ripeti).map(creaFisso);
    if (!scrivi()) {
      stato.movimenti.splice(stato.movimenti.length - nuovi.length, nuovi.length);
      stato.ricorrenti = stato.ricorrenti.filter(r => !fissi.includes(r));
      return;
    }
    campoFrase.value = '';
    scelte = [];
    rileggi();
    const d = daIso(nuovi[nuovi.length - 1].data);
    vista.anno = d.getFullYear();
    if (vista.modo === 'mese') vista.mese = d.getMonth();
    disegna();
    const ids = new Set(nuovi.map(m => m.id));
    const m0 = nuovi[0];
    const testoToast = (nuovi.length > 1 ? 'Salvati ' + nuovi.length + ' movimenti'
      : 'Salvato: ' + (m0.descrizione.length > 22 ? m0.descrizione.slice(0, 21) + '…' : m0.descrizione) + ' ' + euro(Math.abs(m0.importo)))
      + (fissi.length ? ' · 🔁 ogni mese' : '');
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
    const t = { uscite: 0, entrate: 0 };
    for (const r of stato.ricorrenti) {
      if (!r.attivo) continue;
      if (r.tipo === 'entrata') t.entrate += r.importo; else t.uscite += r.importo;
    }
    return t;
  }

  function apriFissi() {
    apriFoglio('Movimenti fissi', corpo => {
      corpo.appendChild(el('p', '', 'Abbonamenti, PAC, palestra, telefono: li imposti una volta e si segnano da soli il giorno giusto di ogni mese. Se un mese non c\'è, cancella quel movimento: non torna.'));
      const t = totaleFissi();
      const somma = [t.uscite ? 'uscite ' + euro(t.uscite) : '', t.entrate ? 'entrate ' + euro(t.entrate) : ''].filter(Boolean);
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
        b.appendChild(el('span', 'mov-importo ' + r.tipo, segnoDi(r.tipo) + euro(Math.abs(r.importo))));
        b.addEventListener('click', () => apriFisso(r));
        lista.appendChild(b);
      }
      if (!ordinati.length) lista.appendChild(el('p', 'vuoto', 'Nessuno ancora. Puoi anche scegliere «🔁 Ogni mese» toccando il giorno quando segni una spesa, o aprire un movimento già segnato e toccare «Ripeti ogni mese».'));
      corpo.appendChild(lista);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', '＋ Aggiungi', () => apriFisso(null)));
      corpo.appendChild(riga);
    });
  }

  function apriFisso(esistente) {
    const nuovo = !esistente;
    const ora = chiaveMese(oggi());
    const b = esistente ? Object.assign({}, esistente, { importo: Math.abs(esistente.importo) })
      : { descrizione: '', importo: 0, tipo: 'uscita', categoria: ripiegoDi('uscita'), giorno: oggi().getDate(), attivo: true };
    let sceltaMano = !nuovo;
    let quando = b.giorno >= oggi().getDate() ? 'questo' : 'prossimo';
    const disegnaForm = () => apriFoglio(nuovo ? 'Nuovo movimento fisso' : 'Movimento fisso', corpo => {
      const inDesc = inputTesto(b.descrizione);
      inDesc.placeholder = 'es. Netflix, PAC S&P 500, palestra';
      inDesc.addEventListener('input', () => {
        if (sceltaMano) return;
        const r = A.analizza(inDesc.value, opzioniAnalisi());
        b.tipo = r.tipo; b.categoria = r.categoria;
        chipT.textContent = etichettaTipo(b.tipo);
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
      const chipT = tasto('chip scambia', etichettaTipo(b.tipo), () => {
        leggi();
        scegliTipo(b, tipo => {
          sceltaMano = true; b.tipo = tipo;
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
        const importo = b.importo;
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

  // Il movimento m diventa anche un fisso: il suo mese è già «fatto», i successivi si segnano da soli. Non salva.
  function creaFisso(m) {
    const d = daIso(m.data), ora = chiaveMese(oggi()), suo = chiaveMese(d);
    const r = { id: nuovoId(), descrizione: m.descrizione, importo: m.importo, tipo: m.tipo, categoria: m.categoria,
      giorno: d.getDate(), attivo: true, dal: suo > ora ? suo : ora, fatti: [suo], creato: new Date().toISOString() };
    // se questo mese c'è già un movimento con la stessa descrizione, non lo rifà
    const stesso = x => x.tipo === m.tipo && x.data.slice(0, 7) === ora && A.normalizza(x.descrizione) === A.normalizza(m.descrizione);
    if (!r.fatti.includes(ora) && stato.movimenti.some(stesso)) r.fatti.push(ora);
    m.ricorrente = r.id;
    stato.ricorrenti.push(r);
    return r;
  }
  function ripetiOgniMese(m) {
    const r = creaFisso(m);
    scrivi();
    generaRicorrenti();
    disegna();
    mostraToast('Si ripeterà ogni mese, il giorno ' + r.giorno);
  }

  // ================================================================ saldo, tasse e mesi di autonomia
  // Saldo attuale = saldo dichiarato + i movimenti venuti dopo (fino a oggi). Quelli dello stesso giorno contano
  // solo se segnati dopo aver dichiarato il saldo. Gli investimenti sono uscite: escono dai soldi liquidi, i ritiri rientrano.
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
    const fissi = stato.ricorrenti.filter(r => r.attivo && spesaVera(r)).reduce((a, r) => a + r.importo, 0);
    let mesi = null, spiegazione;
    if (sm && sm.media > 0) {
      mesi = spendibili / sm.media;
      spiegazione = 'senza entrate, con le spese medie ' + (sm.mesi === 1 ? 'dell\'ultimo mese' : 'degli ultimi ' + sm.mesi + ' mesi') + ' (' + euro(sm.media) + ' al mese, investimenti esclusi).';
    } else if (fissi > 0) {
      mesi = spendibili / fissi;
      spiegazione = 'senza entrate, contando solo le spese fisse (' + euro(fissi) + ' al mese, investimenti esclusi): il conto vero arriva dopo il primo mese intero.';
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
    riga('Sui conti oggi', euro(sa));
    if (ft) {
      riga('Da tenere per le tasse', tasse ? '−' + euro(tasse) : euro(0));
      riga('Spendibili', euro(spendibili), true);
    }
    corpo.appendChild(righe);
    corpo.appendChild(el('p', 'nota', 'Saldo inserito ' + etichettaGiorno(stato.saldo.data).toLowerCase() + ': ' + euro(stato.saldo.importo) + '. Ricontrollalo ogni tanto col conto.'));
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
  const vista = { modo: 'mese', anno: oggi().getFullYear(), mese: oggi().getMonth(), filtro: null };

  function nelPeriodo(m) {
    const [y, mm] = m.data.split('-').map(Number);
    return vista.modo === 'anno' ? y === vista.anno : (y === vista.anno && mm - 1 === vista.mese);
  }
  function totali(lista) {
    const t = { entrate: 0, uscite: 0, tasse: 0 };
    for (const m of lista) {
      if (m.tipo === 'entrata') { t.entrate += m.importo; t.tasse += accantonamento(m); }
      else t.uscite += m.importo;
    }
    t.saldo = t.entrate - t.uscite;
    t.restano = t.saldo - t.tasse;
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
    $('heroValore').textContent = conSegno(t.saldo);
    let sotto = 'Entrate meno uscite.';
    if (t.tasse > 0) sotto += ' Tolti ' + euro(t.tasse) + ' per le tasse, restano ' + euro(t.restano) + '.';
    $('heroSotto').textContent = sotto;
    $('totEntrate').textContent = euro(t.entrate);
    $('totUscite').textContent = euro(t.uscite);

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
    for (let mm = finoA; mm >= 0; mm--) {
      const lista = stato.movimenti.filter(m => { const [y, x] = m.data.split('-').map(Number); return y === vista.anno && x - 1 === mm; });
      if (!lista.length) continue;   // i mesi senza movimenti non si mostrano
      righe++;
      const t = totali(lista);
      const tr = el('tr', 'cliccabile');
      tr.tabIndex = 0;
      tr.appendChild(el('td', '', maiuscola(MESI[mm])));
      tr.appendChild(el('td', '', euro(t.entrate)));
      tr.appendChild(el('td', '', euro(t.uscite)));
      tr.appendChild(el('td', '', conSegno(t.saldo)));
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
    let sotto = m.categoria;
    const acc = accantonamento(m);
    if (acc) sotto += ' · ' + euro(acc) + ' per le tasse';
    if (m.ricorrente) sotto += ' · fisso';
    testi.appendChild(el('span', 'mov-cat', sotto));
    b.appendChild(testi);
    b.appendChild(el('span', 'mov-importo ' + m.tipo, segnoDi(m.tipo) + euro(Math.abs(m.importo))));
    b.setAttribute('aria-label', m.descrizione + ', ' + sotto + ', ' + etichettaTipo(m.tipo) + ' ' + euro(Math.abs(m.importo)) + '. Tocca per modificare.');
    b.addEventListener('click', () => modifica(m.id));
    return b;
  }

  // ================================================================ modifica di un movimento
  function modifica(id) {
    const orig = stato.movimenti.find(m => m.id === id);
    if (!orig) return;
    const bozza = { tipo: orig.tipo, categoria: orig.categoria, data: orig.data, descrizione: orig.descrizione,
      importo: Math.abs(orig.importo), ripeti: false };
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
          bozza.tipo = tipo;
          if (!valida(tipo, bozza.categoria)) bozza.categoria = ripiegoDi(tipo);
          ridisegna();
        });
      }));
      g.appendChild(tasto('chip', iconaDi(bozza.tipo, bozza.categoria) + ' ' + bozza.categoria, () => {
        leggiCampi();
        scegliCategoria(bozza.tipo, bozza.categoria, nome => { bozza.categoria = nome; ridisegna(); });
      }));
      g.appendChild(tasto('chip', etichettaQuando(bozza), () => {
        leggiCampi();
        // la spesa ricorrente si sceglie qui solo se non è già un fisso (per quelli c'è il tasto sotto)
        scegliData(bozza.data, iso => { bozza.data = iso; ridisegna(); },
          fissoDi() ? null : { acceso: bozza.ripeti, alCambiare: v => { bozza.ripeti = v; } });
      }));
      corpo.appendChild(g);
      corpo.appendChild(campo('Importo in euro', inImp));
      corpo.appendChild(campo('Descrizione', inDesc));
      if (orig.testo) corpo.appendChild(el('p', 'nota', 'Frase originale: «' + orig.testo + '»'));

      // applica al movimento quello che è scritto nel foglio; false se l'importo non va
      const applica = () => {
        leggiCampi();
        if (!(bozza.importo > 0)) { mostraToast('Importo non valido'); inImp.focus(); return false; }
        if (bozza.tipo !== orig.tipo || bozza.categoria !== orig.categoria) impara(bozza.descrizione, bozza.tipo, bozza.categoria);
        Object.assign(orig, {
          tipo: bozza.tipo, categoria: bozza.categoria, data: bozza.data, descrizione: bozza.descrizione || bozza.categoria,
          importo: bozza.importo, modificato: new Date().toISOString()
        });
        return true;
      };
      const fisso = fissoDi();
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
        if (bozza.ripeti && !fissoDi()) { chiudiFoglio(); ripetiOgniMese(orig); return; }   // salva lui
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
  // Due testi, dal 10/11/2026:
  //  - «per l'AI»: righe data;tipo;importo;categoria;descrizione;id + righe «#» con le impostazioni.
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
    out.push('data;tipo;importo;categoria;descrizione;id');
    for (const m of righe) out.push([m.data, m.tipo, (m.importo / 100).toFixed(2), pulisci(m.categoria), pulisci(m.descrizione), m.id].join(';'));
    out.push('#schema ' + SCHEMA);
    out.push('#imparate ' + JSON.stringify(stato.imparate));
    out.push('#fissi ' + JSON.stringify(stato.ricorrenti));
    out.push('#categorie ' + JSON.stringify(stato.categorie));
    out.push('#saldo ' + JSON.stringify(stato.saldo));
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
      out.push(segnoDi(m.tipo) + euro(m.importo) + ' · ' + m.descrizione + ' (' + m.categoria + ')' + (m.ricorrente ? ' 🔁' : ''));
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
    const ids = new Set(stato.movimenti.map(m => m.id));
    const tipi = new Set(TIPI_DATI);
    const meta = {};
    const righe = [];
    for (const riga of String(testo).split(/\r?\n/)) {
      const r = riga.trim();
      if (!r) continue;
      const m = r.match(/^#(schema|imparate|fissi|categorie|saldo|tasse|legami) (.*)$/);
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
    if (meta.saldo && !stato.saldo && typeof meta.saldo.importo === 'number') stato.saldo = meta.saldo;
    if (meta.tasse && !stato.tasse.attiva) stato.tasse = imp.tasse;
    const presenti = new Set(stato.ricorrenti.map(r => r.id));
    for (const r of imp.ricorrenti) if (!presenti.has(r.id) && tipi.has(r.tipo) && r.importo) stato.ricorrenti.push(r);
    const legami = meta.legami && typeof meta.legami === 'object' ? meta.legami : {};
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
      if (!id) id = 'imp-' + hash(r);
      if (ids.has(id)) { esito.presenti++; continue; }
      let cat = pulisciNome(categoria) || ripiegoDi(tipo);
      const uguale = categorie(tipo, true).find(x => A.normalizza(x.nome) === A.normalizza(cat));
      if (uguale) cat = uguale.nome;
      else aggiungiCategoria(tipo, cat, '•');
      const mov = { id, data, tipo, importo: Math.round(Math.abs(n) * 100), categoria: cat, descrizione: descrizione || cat, creato: new Date().toISOString(), importato: true };
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
      const sa = saldoAttuale();
      voce('🏦 Saldo sui conti', sa !== null ? 'Oggi ' + euro(sa) + ' · tocca per correggerlo' : 'Per sapere quanti mesi reggi senza entrate.', apriSaldo);
      voce('🧾 Tasse da accantonare', stato.tasse.attiva ? String(stato.tasse.percentuale).replace('.', ',') + '% di ' + (stato.tasse.categorie.join(', ') || 'nessuna categoria') : 'Spento', apriTasse);
      voce('🏷️ Categorie', 'Aggiungi, rinomina, cambia simbolo, nascondi o elimina.', apriCategorie);
      voce('🎙️ Microfono', descriviVoce(), apriImpostazioniVoce);
      corpo.appendChild(imp);

      corpo.appendChild(el('div', 'titoletto', 'I tuoi movimenti'));
      const n = stato.movimenti.length;
      corpo.appendChild(el('p', '', n + (n === 1 ? ' movimento' : ' movimenti') + ' salvati su questo telefono. ' + testoUltimoBackup()));
      const azioni = el('div', 'elenco-azioni');
      azioni.style.marginTop = '10px';
      corpo.appendChild(azioni);

      const bEsp = tasto('azione', '📤 Esporta e condividi', () => apriEsporta('mese'));
      bEsp.appendChild(el('small', '', 'Scegli il periodo, poi «Copia per l\'AI», «Copia da condividere» o «Condividi».'));
      azioni.appendChild(bEsp);

      const bImp = tasto('azione', '📥 Importa da testo', () => apriImporta());
      bImp.appendChild(el('small', '', 'Incolla una «Copia per l\'AI»: i movimenti già presenti non si doppiano.'));
      azioni.appendChild(bImp);

      const bZero = tasto('azione', '🧨 Ricomincia da zero', ricomincia);
      bZero.style.color = 'var(--critico)';
      bZero.disabled = !n;
      bZero.appendChild(el('small', '', 'Cancella tutti i movimenti, per esempio quelli di prova. Impostazioni e parole imparate restano.'));
      azioni.appendChild(bZero);

      corpo.appendChild(el('p', 'nota', 'I movimenti esistono solo dentro questa app sul telefono. Se cancelli l\'icona dalla schermata Home o i dati del sito, spariscono: esporta ogni tanto.'));
      const crediti = tasto('tasto-secondario', 'Crediti delle foto', apriCrediti);
      crediti.style.marginTop = '12px';
      corpo.appendChild(crediti);
      const info = el('p', 'nota', 'Versione ' + VERSIONE + '. ');
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

  // Due conferme (la seconda chiesta da Francesco il 10/11/2026), poi qualche secondo per «Annulla».
  function ricomincia() {
    const n = stato.movimenti.length;
    apriFoglio('Ricomincia da zero', corpo => {
      corpo.appendChild(el('p', '', 'Cancello tutti i ' + n + ' movimenti. Restano le impostazioni (movimenti fissi, saldo, categorie, tasse), le parole che l\'app ha imparato e lo sfondo.'));
      corpo.appendChild(el('p', '', 'Se vuoi tenerne una copia, prima fai «Copia per l\'AI» con «Tutto».'));
      const copia = tasto('tasto-secondario', '🤖 Prima fai una copia', () => apriEsporta('tutto'));
      copia.style.marginTop = '12px';
      corpo.appendChild(copia);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-secondario', 'Annulla', () => chiudiFoglio(true)));
      riga.appendChild(tasto('tasto-pericolo', 'Cancella tutto', () => ricominciaConferma(n)));
      corpo.appendChild(riga);
    });
  }
  function ricominciaConferma(n) {
    apriFoglio('Sei proprio sicuro?', corpo => {
      corpo.appendChild(el('p', 'allarme', '🧨 Stai per cancellare ' + n + (n === 1 ? ' movimento' : ' movimenti') + '.'));
      corpo.appendChild(el('p', '', 'Dopo qualche secondo non si torna più indietro: rimarrebbero solo le copie che hai esportato.'));
      const riga = el('div', 'riga-tasti colonna');
      riga.appendChild(tasto('tasto-pericolo pieno', 'Sì, cancella ' + n + (n === 1 ? ' movimento' : ' movimenti'), () => cancella(() => true, 'Cancellati ' + n + ' movimenti')));
      riga.appendChild(tasto('tasto-secondario', 'No, tienili', () => chiudiFoglio(true)));
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
  // Rifatto il 10/11/2026. Un tocco: ascolta (si vede il tempo e l'onda della voce); secondo tocco: basta.
  // Si ferma anche da solo dopo 2 s di silenzio. Due modelli: «Preciso» (250 MB, consigliato) e «Veloce» (78 MB).
  // Il modello scelto si carica appena si apre l'app, in un worker: al tocco è già pronto.
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
  const secondi = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
  function descriviVoce() {
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
      preciso: 'Sbaglia molto meno numeri e parole («43,20», «eToro»). Ci mette qualche secondo in più. Consigliato.',
      veloce: 'Risponde prima, ma sbaglia più spesso («milleottocento» → 1880).'
    };
    for (const k of ['preciso', 'veloce']) {
      const M = V.MODELLI[k];
      const b = tasto('azione scelta-modello', (k === 'preciso' ? '🎯 ' : '⚡ ') + M.nome + (s[k] ? (attuale === k ? ' · in uso' : ' · scaricato') : ' · ' + M.mb + ' MB da scaricare'), () => alScegliere(k));
      b.dataset.modello = k;
      b.setAttribute('aria-pressed', String(attuale === k));
      b.appendChild(el('small', '', testi[k]));
      g.appendChild(b);
    }
    corpo.appendChild(g);
  }
  function usaModello(k) {
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
      sceltaModelli(corpo, usaModello);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-secondario', 'Usa la tastiera', () => guidaDettatura('')));
      corpo.appendChild(riga);
    });
  }

  function apriImpostazioniVoce() {
    apriFoglio('Microfono', corpo => {
      corpo.appendChild(el('p', '', 'Tocca 🎙️, parla, poi tocca ■ (o fai una pausa di 2 secondi). Il riconoscimento gira dentro il telefono: la voce non esce mai.'));
      sceltaModelli(corpo, usaModello);
      const tempi = (pref.voceTempi || []).slice(-5);
      const righe = el('div', 'aut-righe');
      const riga = (nome, valore) => { const r = el('div', 'aut-riga'); r.appendChild(el('span', '', nome)); r.appendChild(el('span', '', valore)); righe.appendChild(r); };
      riga('Ultime trascrizioni', tempi.length ? tempi.map(secondi).join(' · ') : 'nessuna ancora');
      riga('Motori insieme', V.isolato ? 'sì: ' + (navigator.hardwareConcurrency || '?') + ' core' : 'no, uno solo');
      corpo.appendChild(righe);
      const s = scaricati(), attuale = modelloVoce();
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
      const r2 = el('div', 'riga-tasti');
      r2.appendChild(tasto('tasto-secondario', 'Dettare con la tastiera', () => guidaDettatura('')));
      corpo.appendChild(r2);
    });
  }

  // Se l'app si chiude da sola mentre il modello «Preciso» lavora (memoria finita), la volta dopo si torna a «Veloce».
  function segnaLavoroVoce(chiave) { pref.voceInCorso = chiave ? { modello: chiave, quando: Date.now() } : null; scriviPref(); }
  (function controllaCaduta() {
    const c = pref.voceInCorso;
    if (!c) return;
    pref.voceInCorso = null;
    if (c.modello === 'preciso' && Date.now() - c.quando < 120000 && scaricati().veloce) {
      pref.voceModello = 'veloce';
      setTimeout(() => mostraToast('«Preciso» ha fatto chiudere l\'app: uso «Veloce». Menù → Microfono per riprovare'), 800);
    }
    scriviPref();
  })();
  document.addEventListener('visibilitychange', () => { if (document.hidden && pref.voceInCorso) segnaLavoroVoce(null); });
  // una ricarica normale (aggiornamento dell'app) non è una caduta
  window.addEventListener('pagehide', () => { if (pref.voceInCorso) segnaLavoroVoce(null); });

  // carica il modello scelto in sottofondo, così al primo tocco è già pronto
  function preparaVoce() {
    const k = modelloVoce();
    if (!k || !V || !V.disponibile || V.caricato(k)) return;
    segnaLavoroVoce(k);
    V.prepara(k).then(() => segnaLavoroVoce(null), () => segnaLavoroVoce(null));
  }

  async function scaricaVoce(k) {
    chiudiFoglio();
    const M = V.MODELLI[k];
    fase('scarico');
    mostraStatoVoce('Scarico «' + M.nome + '» (' + M.mb + ' MB)… 0%', 0);
    try {
      segnaLavoroVoce(k);
      await V.prepara(k, p => { if (statoVoce === 'scarico') { onda.length = 0; mostraStatoVoce('Scarico «' + M.nome + '» (' + M.mb + ' MB)… ' + Math.round(p * 100) + '%', p); } });
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

  async function microfono() {
    if (statoVoce === 'ascolto') { if (ascoltoInCorso) ascoltoInCorso.ferma(); return; }
    if (statoVoce !== 'fermo') return;
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

  // ================================================================ eventi generali
  $('apriMenu').addEventListener('click', apriMenu);
  $('bannerEsporta').addEventListener('click', () => apriEsporta('tutto'));
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
    versione: VERSIONE, edizione: ED, stato: () => stato, pref: () => pref, testoEsportazione, testoLeggibile, importaTesto,
    generaRicorrenti, saldoAttuale, fondoTasse, speseMedie, totaleFissi, rinomina, aggiungiCategoria, eliminaCategoria,
    materializza, migra, apriEsporta, statoVoce: () => statoVoce
  };
})();
