/* Conti — l'app. I dati stanno solo nel telefono (localStorage di questa app). */
(function () {
  'use strict';

  const VERSIONE = '2026.11.07-1732';
  const CHIAVE = 'conti.v1';
  const A = window.Analizza;
  const $ = id => document.getElementById(id);
  const GIORNO_MS = 86400000;

  // ================================================================ dati
  function carica() {
    try {
      const d = JSON.parse(localStorage.getItem(CHIAVE));
      if (d && Array.isArray(d.movimenti)) return Object.assign({ imparate: {}, ultimoBackup: null }, d);
    } catch (e) { /* dati illeggibili: si riparte vuoti, ma senza sovrascrivere finché non si salva */ }
    return { movimenti: [], imparate: {}, ultimoBackup: null };
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

  // ================================================================ formati
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
  const maiuscola = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const oggi = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const daIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  function etichettaGiorno(iso) {
    const d = daIso(iso), diff = Math.round((oggi() - d) / GIORNO_MS);
    const base = GIORNI_BREVI[d.getDay()] + ' ' + d.getDate() + ' ' + MESI[d.getMonth()].slice(0, 3);
    const anno = d.getFullYear() !== oggi().getFullYear() ? ' ' + d.getFullYear() : '';
    if (diff === 0) return 'Oggi';
    if (diff === 1) return 'Ieri';
    if (diff === 2) return 'L\'altro ieri';
    return maiuscola(base) + anno;
  }

  function etichettaTipo(tipo, segno) {
    if (tipo === 'entrata') return 'Entrata';
    if (tipo === 'investimento') return segno < 0 ? 'Ritirato dagli investimenti' : 'Investito';
    return 'Uscita';
  }

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

  // Scelte riutilizzate dall'anteprima e dalla modifica
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
        b.setAttribute('aria-pressed', String(t.tipo === corrente.tipo && t.segno === corrente.segno));
        g.appendChild(b);
      }
      corpo.appendChild(g);
      const p = el('p', 'nota', 'Gli investimenti stanno a parte: non contano come spese, ma li vedi nel totale «Investiti».');
      corpo.appendChild(p);
    });
  }
  function scegliCategoria(tipo, corrente, alScegliere) {
    apriFoglio('Categoria', corpo => {
      const g = el('div', 'griglia');
      for (const c of A.CATEGORIE[tipo]) {
        const b = tasto('opzione', c.icona + '  ' + c.nome, () => { chiudiFoglio(); alScegliere(c.nome); });
        b.setAttribute('aria-pressed', String(c.nome === corrente));
        g.appendChild(b);
      }
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
      const campo = el('label', 'campo');
      campo.appendChild(el('span', '', 'Un altro giorno'));
      const inp = el('input');
      inp.type = 'date';
      inp.value = corrente;
      inp.max = A.isoDa(new Date(base.getFullYear() + 1, 11, 31));
      campo.appendChild(inp);
      corpo.appendChild(campo);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', 'Usa questa data', () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) { inp.focus(); return; }
        chiudiFoglio(); alScegliere(inp.value);
      }));
      corpo.appendChild(riga);
    });
  }

  // ================================================================ inserimento a frase
  const campoFrase = $('frase');
  let scelte = {};          // tipo/segno/categoria/data scelti a mano per la frase in corso
  let proposta = null;      // come l'app ha letto la frase (prima delle scelte a mano)
  let corrente = null;      // proposta + scelte

  function rileggi() {
    const testo = campoFrase.value;
    adattaAltezza();
    if (!testo.trim()) {
      proposta = corrente = null; scelte = {};
      $('anteprima').hidden = true;
      $('suggerimento').hidden = false;
      return;
    }
    const opz = { oggi: oggi(), imparate: stato.imparate };
    proposta = A.analizza(testo, opz);
    let r = proposta;
    if (scelte.tipo) r = A.analizza(testo, Object.assign({}, opz, { tipo: scelte.tipo, segno: scelte.segno }));
    corrente = Object.assign({}, r);
    if (scelte.categoria && A.CATEGORIE[corrente.tipo].some(c => c.nome === scelte.categoria)) {
      corrente.categoria = scelte.categoria; corrente.certo = Object.assign({}, corrente.certo, { categoria: true });
    }
    if (scelte.data) corrente.data = scelte.data;
    disegnaAnteprima();
  }

  function disegnaAnteprima() {
    const c = corrente;
    $('anteprima').hidden = false;
    $('suggerimento').hidden = true;
    const ct = $('chipTipo');
    ct.textContent = etichettaTipo(c.tipo, c.segno);
    ct.classList.toggle('dubbio', !c.certo.tipo && !scelte.tipo && c.tipo !== 'uscita');
    const cc = $('chipCategoria');
    cc.textContent = A.icona(c.tipo, c.categoria) + ' ' + c.categoria;
    cc.classList.toggle('dubbio', !c.certo.categoria && !scelte.categoria);
    $('chipData').textContent = etichettaGiorno(c.data);
    const imp = $('antImporto');
    if (c.importo && c.importo > 0) {
      const segno = c.tipo === 'entrata' ? '+' : (c.tipo === 'uscita' ? '−' : (c.segno < 0 ? '↙ ' : '↗ '));
      imp.textContent = segno + euro(c.importo);
      imp.classList.remove('manca');
    } else {
      imp.textContent = 'Quanto?';
      imp.classList.add('manca');
    }
    $('antDescrizione').textContent = c.descrizione;
    const avviso = $('antAvviso');
    const futuro = daIso(c.data) > oggi();
    if (!c.importo) { avviso.hidden = false; avviso.textContent = 'Manca l\'importo: aggiungilo alla frase, es. «pizza 12».'; }
    else if (futuro) { avviso.hidden = false; avviso.textContent = 'La data è nel futuro: controllala.'; }
    else avviso.hidden = true;
    $('salva').disabled = !(c.importo > 0);
  }

  function adattaAltezza() {
    campoFrase.style.height = 'auto';
    campoFrase.style.height = Math.min(campoFrase.scrollHeight + 2, 160) + 'px';
  }

  function impara(descrizione, tipo, segno, categoria) {
    const parole = A.paroleSignificative(descrizione);
    for (const p of parole) stato.imparate[p] = { tipo, segno, categoria };
    // tetto: tiene le ultime 600 parole
    const chiavi = Object.keys(stato.imparate);
    if (chiavi.length > 600) for (const k of chiavi.slice(0, chiavi.length - 600)) delete stato.imparate[k];
  }

  function salvaFrase() {
    if (!corrente || !(corrente.importo > 0)) { campoFrase.focus(); return; }
    const c = corrente;
    const m = {
      id: nuovoId(),
      data: c.data,
      tipo: c.tipo,
      importo: c.tipo === 'investimento' ? c.importo * (c.segno < 0 ? -1 : 1) : c.importo,
      categoria: c.categoria,
      descrizione: c.descrizione,
      testo: campoFrase.value.trim(),
      creato: new Date().toISOString()
    };
    const corretto = proposta && (proposta.tipo !== c.tipo || proposta.segno !== c.segno || proposta.categoria !== c.categoria);
    if (corretto) impara(c.descrizione, c.tipo, c.segno, c.categoria);
    stato.movimenti.push(m);
    if (!scrivi()) { stato.movimenti.pop(); return; }
    campoFrase.value = '';
    scelte = {};
    rileggi();
    // mostra il periodo del movimento appena segnato
    const d = daIso(m.data);
    if (vista.modo === 'mese') { vista.anno = d.getFullYear(); vista.mese = d.getMonth(); }
    else vista.anno = d.getFullYear();
    disegna();
    const etichetta = m.descrizione.length > 22 ? m.descrizione.slice(0, 21) + '…' : m.descrizione;
    mostraToast('Salvato: ' + etichetta + ' ' + euro(Math.abs(m.importo)), 'Annulla', () => {
      stato.movimenti = stato.movimenti.filter(x => x.id !== m.id);
      scrivi();
      disegna();
    });
  }

  campoFrase.addEventListener('input', rileggi);
  campoFrase.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (corrente && corrente.importo > 0) salvaFrase();
      else campoFrase.blur();
    }
  });
  $('salva').addEventListener('click', salvaFrase);
  $('chipTipo').addEventListener('click', () => {
    if (!corrente) return;
    scegliTipo(corrente, (tipo, segno) => {
      scelte.tipo = tipo; scelte.segno = segno;
      if (scelte.categoria && !A.CATEGORIE[tipo].some(c => c.nome === scelte.categoria)) delete scelte.categoria;
      rileggi();
    });
  });
  $('chipCategoria').addEventListener('click', () => {
    if (!corrente) return;
    scegliCategoria(corrente.tipo, corrente.categoria, nome => { scelte.categoria = nome; rileggi(); });
  });
  $('chipData').addEventListener('click', () => {
    if (!corrente) return;
    scegliData(corrente.data, iso => { scelte.data = iso; rileggi(); });
  });

  // ================================================================ periodo e riepilogo
  const vista = { modo: 'mese', anno: oggi().getFullYear(), mese: oggi().getMonth(), filtro: null };

  function nelPeriodo(m) {
    const [y, mm] = m.data.split('-').map(Number);
    return vista.modo === 'anno' ? y === vista.anno : (y === vista.anno && mm - 1 === vista.mese);
  }

  function totali(lista) {
    const t = { entrate: 0, uscite: 0, investiti: 0 };
    for (const m of lista) {
      if (m.tipo === 'entrata') t.entrate += m.importo;
      else if (m.tipo === 'uscita') t.uscite += m.importo;
      else if (m.tipo === 'investimento') t.investiti += m.importo;
    }
    t.saldo = t.entrate - t.uscite;
    t.liquidi = t.saldo - t.investiti;
    return t;
  }

  function disegna() {
    const ora = oggi();
    const titolo = vista.modo === 'anno' ? String(vista.anno) : maiuscola(MESI[vista.mese]) + ' ' + vista.anno;
    $('titoloPeriodo').textContent = titolo;
    const allaFine = vista.modo === 'anno' ? vista.anno >= ora.getFullYear()
      : (vista.anno > ora.getFullYear() || (vista.anno === ora.getFullYear() && vista.mese >= ora.getMonth()));
    $('succ').disabled = allaFine;
    document.querySelectorAll('.segmentato button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === vista.modo)));

    const lista = stato.movimenti.filter(nelPeriodo);
    const t = totali(lista);
    $('heroEtichetta').textContent = vista.modo === 'anno' ? 'Saldo del ' + vista.anno : 'Saldo di ' + MESI[vista.mese];
    $('heroValore').textContent = (Math.round(t.saldo / 100) > 0 ? '+' : '') + euro(t.saldo, true);
    $('heroSotto').textContent = t.investiti !== 0
      ? 'Entrate meno uscite. Tolti ' + euro(t.investiti, true) + ' investiti, restano ' + euro(t.liquidi, true) + '.'
      : 'Entrate meno uscite.';
    $('totEntrate').textContent = euro(t.entrate, true);
    $('totUscite').textContent = euro(t.uscite, true);
    $('totInvestiti').textContent = euro(t.investiti, true);

    disegnaBarre(lista, t.uscite);
    $('sezMesi').hidden = vista.modo !== 'anno';
    if (vista.modo === 'anno') disegnaMesi();
    disegnaLista(lista);
    disegnaBanner();
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
      testi.appendChild(el('span', 'barra-nome', A.icona('uscita', nome) + ' ' + nome));
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
    const ora = oggi();
    const ultimo = vista.anno === ora.getFullYear() ? ora.getMonth() : 11;
    let righe = 0;
    for (let mm = ultimo; mm >= 0; mm--) {
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
      const testo = stato.movimenti.length
        ? 'Nessun movimento in questo periodo.'
        : 'Ancora nessun movimento. Scrivi o detta la prima spesa qui sopra, per esempio «caffè 1,20».';
      cont.appendChild(el('p', 'vuoto', testo));
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
    b.appendChild(el('span', 'mov-icona', A.icona(m.tipo, m.categoria)));
    const testi = el('span', 'mov-testi');
    testi.appendChild(el('span', 'mov-desc', m.descrizione));
    const sotto = m.tipo === 'investimento' ? etichettaTipo(m.tipo, m.importo < 0 ? -1 : 1) + ' · ' + m.categoria : m.categoria;
    testi.appendChild(el('span', 'mov-cat', sotto));
    b.appendChild(testi);
    let segno = '−';
    if (m.tipo === 'entrata') segno = '+';
    if (m.tipo === 'investimento') segno = m.importo < 0 ? '↙ ' : '↗ ';
    b.appendChild(el('span', 'mov-importo ' + m.tipo, segno + euro(Math.abs(m.importo))));
    b.setAttribute('aria-label', m.descrizione + ', ' + m.categoria + ', ' + etichettaTipo(m.tipo, m.importo < 0 ? -1 : 1) + ' ' + euro(Math.abs(m.importo)) + '. Tocca per modificare.');
    b.addEventListener('click', () => modifica(m.id));
    return b;
  }

  // ================================================================ modifica di un movimento
  function modifica(id) {
    const orig = stato.movimenti.find(m => m.id === id);
    if (!orig) return;
    const bozza = {
      tipo: orig.tipo, segno: orig.importo < 0 ? -1 : 1, categoria: orig.categoria, data: orig.data,
      descrizione: orig.descrizione, importo: Math.abs(orig.importo)
    };
    const ridisegna = () => apriFoglio('Modifica movimento', corpo => {
      const g = el('div', 'chips');
      g.appendChild(tasto('chip', etichettaTipo(bozza.tipo, bozza.segno), () => {
        leggiCampi();
        scegliTipo(bozza, (tipo, segno) => {
          bozza.tipo = tipo; bozza.segno = segno;
          if (!A.CATEGORIE[tipo].some(c => c.nome === bozza.categoria)) bozza.categoria = A.RIPIEGO[tipo];
          ridisegna();
        });
      }));
      g.appendChild(tasto('chip', A.icona(bozza.tipo, bozza.categoria) + ' ' + bozza.categoria, () => {
        leggiCampi();
        scegliCategoria(bozza.tipo, bozza.categoria, nome => { bozza.categoria = nome; ridisegna(); });
      }));
      g.appendChild(tasto('chip', etichettaGiorno(bozza.data), () => {
        leggiCampi();
        scegliData(bozza.data, iso => { bozza.data = iso; ridisegna(); });
      }));
      corpo.appendChild(g);

      const cImp = el('label', 'campo');
      cImp.appendChild(el('span', '', 'Importo in euro'));
      const inImp = el('input');
      inImp.id = 'modImporto';
      inImp.inputMode = 'decimal';
      inImp.autocomplete = 'off';
      inImp.value = (bozza.importo / 100).toFixed(2).replace('.', ',');
      cImp.appendChild(inImp);
      corpo.appendChild(cImp);

      const cDesc = el('label', 'campo');
      cDesc.appendChild(el('span', '', 'Descrizione'));
      const inDesc = el('input');
      inDesc.id = 'modDescrizione';
      inDesc.autocomplete = 'off';
      inDesc.value = bozza.descrizione;
      cDesc.appendChild(inDesc);
      corpo.appendChild(cDesc);

      if (orig.testo) corpo.appendChild(el('p', 'nota', 'Frase originale: «' + orig.testo + '»'));

      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-pericolo', 'Elimina', () => {
        if (!confirm('Eliminare «' + orig.descrizione + '»?')) return;
        const i = stato.movimenti.findIndex(m => m.id === id);
        const tolto = stato.movimenti.splice(i, 1)[0];
        scrivi();
        chiudiFoglio();
        disegna();
        mostraToast('Eliminato', 'Annulla', () => { stato.movimenti.push(tolto); scrivi(); disegna(); });
      }));
      riga.appendChild(tasto('tasto-primario', 'Salva', () => {
        leggiCampi();
        if (!(bozza.importo > 0)) { mostraToast('Importo non valido'); inImp.focus(); return; }
        if (bozza.tipo !== orig.tipo || bozza.categoria !== orig.categoria) impara(bozza.descrizione, bozza.tipo, bozza.segno, bozza.categoria);
        Object.assign(orig, {
          tipo: bozza.tipo, categoria: bozza.categoria, data: bozza.data, descrizione: bozza.descrizione || bozza.categoria,
          importo: bozza.tipo === 'investimento' ? bozza.importo * bozza.segno : bozza.importo,
          modificato: new Date().toISOString()
        });
        scrivi();
        chiudiFoglio();
        disegna();
        mostraToast('Modifica salvata');
      }));
      corpo.appendChild(riga);

      function leggiCampi() {
        const v = leggiEuro(inImp.value);
        if (v !== null) bozza.importo = v;
        bozza.descrizione = inDesc.value.trim();
      }
    });
    ridisegna();
  }

  function leggiEuro(s) {
    const t = String(s).replace(/[€\s]/g, '');
    if (!t) return null;
    let n;
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    else if (/^\d+([.,]\d{1,2})?$/.test(t)) n = parseFloat(t.replace(',', '.'));
    else return null;
    return Math.round(n * 100);
  }

  // ================================================================ esporta e importa
  function testoEsportazione() {
    const righe = stato.movimenti.slice().sort((a, b) => a.data.localeCompare(b.data) || (a.creato || '').localeCompare(b.creato || ''));
    const pulisci = s => String(s || '').replace(/[;\r\n]+/g, ' ').trim();
    const out = [];
    out.push('# Conti — esportazione del ' + new Date().toLocaleString('it-IT') + ' — ' + righe.length + ' movimenti — app ' + VERSIONE);
    out.push('data;tipo;importo;categoria;descrizione;id');
    for (const m of righe) out.push([m.data, m.tipo, (m.importo / 100).toFixed(2), pulisci(m.categoria), pulisci(m.descrizione), m.id].join(';'));
    out.push('#imparate ' + JSON.stringify(stato.imparate));
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
    const tipi = new Set(['uscita', 'entrata', 'investimento']);
    for (const riga of String(testo).split(/\r?\n/)) {
      const r = riga.trim();
      if (!r) continue;
      if (r.startsWith('#imparate ')) {
        try { Object.assign(stato.imparate, JSON.parse(r.slice(10))); } catch (e) { /* ignora */ }
        continue;
      }
      if (r.startsWith('#') || r.startsWith('data;')) continue;
      const c = r.split(';');
      if (c.length < 5) { esito.scartati++; continue; }
      const [data, tipo, importo, categoria, descrizione] = c.map(x => x.trim());
      let id = (c[5] || '').trim();
      const n = parseFloat(importo.replace(',', '.'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !tipi.has(tipo) || !isFinite(n)) { esito.scartati++; continue; }
      if (!id) id = 'imp-' + hash(r);
      if (ids.has(id)) { esito.presenti++; continue; }
      const cat = A.CATEGORIE[tipo].some(x => x.nome === categoria) ? categoria : (categoria || A.RIPIEGO[tipo]);
      stato.movimenti.push({ id, data, tipo, importo: Math.round(n * 100), categoria: cat, descrizione: descrizione || cat, creato: new Date().toISOString(), importato: true });
      ids.add(id);
      esito.aggiunti++;
    }
    scrivi();
    return esito;
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  function apriMenu() {
    apriFoglio('Esporta e importa', corpo => {
      const n = stato.movimenti.length;
      corpo.appendChild(el('p', '', n + (n === 1 ? ' movimento' : ' movimenti') + ' salvati su questo telefono. ' + testoUltimoBackup()));
      const azioni = el('div', 'elenco-azioni');
      corpo.appendChild(azioni);

      const bCopia = tasto('azione', 'Copia tutto come testo', async () => {
        const ok = await copiaTesto(testoEsportazione());
        if (ok) { segnaBackup(); chiudiFoglio(); mostraToast('Copiato: incollalo a Claude o in una nota'); }
        else mostraToast('Non sono riuscito a copiare');
      });
      bCopia.appendChild(el('small', '', 'Da incollare a Claude, che lo salva nel second brain: è anche la tua copia di sicurezza.'));
      azioni.appendChild(bCopia);

      if (navigator.share) {
        const bCond = tasto('azione', 'Condividi il file', async () => {
          const testo = testoEsportazione();
          const nome = 'conti-' + A.isoDa(new Date()) + '.txt';
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

      corpo.appendChild(el('p', 'nota', 'I movimenti esistono solo dentro questa app sul telefono. Se cancelli l\'icona dalla schermata Home o i dati del sito, spariscono: esporta ogni tanto.'));
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
      corpo.appendChild(el('p', '', 'Incolla qui il testo di un\'esportazione di Conti.'));
      const campo = el('label', 'campo');
      const ta = el('textarea');
      ta.id = 'testoImporta';
      ta.placeholder = 'data;tipo;importo;categoria;descrizione;id';
      campo.appendChild(ta);
      corpo.appendChild(campo);
      const riga = el('div', 'riga-tasti');
      riga.appendChild(tasto('tasto-primario', 'Importa', () => {
        const e = importaTesto(ta.value);
        chiudiFoglio();
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

  // ================================================================ eventi generali
  $('apriMenu').addEventListener('click', apriMenu);
  $('bannerEsporta').addEventListener('click', apriMenu);
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
  document.querySelectorAll('.segmentato button').forEach(b => b.addEventListener('click', () => {
    vista.modo = b.dataset.modo;
    vista.filtro = null;
    disegna();
  }));
  // altri schermi (un'altra scheda) che cambiano i dati
  window.addEventListener('storage', e => { if (e.key === CHIAVE) { stato = carica(); disegna(); } });
  // a mezzanotte «oggi» cambia: si ridisegna quando l'app torna in primo piano
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { rileggi(); disegna(); } });

  rileggi();
  disegna();

  // ================================================================ funzionamento senza rete
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const avevaController = !!navigator.serviceWorker.controller;
    let ricaricato = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!avevaController || ricaricato) return;
      ricaricato = true;
      if (!campoFrase.value.trim() && !foglioAperto()) location.reload();
      else mostraToast('Nuova versione pronta', 'Aggiorna', () => location.reload());
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  // per le prove automatiche
  window.__conti = { versione: VERSIONE, stato: () => stato, testoEsportazione, importaTesto };
})();
