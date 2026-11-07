/* Conti — lettura delle frasi dettate.
   Trasforma «pizza 12 ieri» in { tipo, importo, categoria, data, descrizione }.
   Solo funzioni pure: niente accesso alla pagina né ai dati salvati.
   Gli importi sono in centesimi (interi) per non perdere centesimi nelle somme. */
(function (globale) {
  'use strict';

  // ---------------------------------------------------------------- categorie
  // Parole chiave generiche: il codice è pubblico, qui non vanno nomi di persone o clienti.
  const CATEGORIE = {
    uscita: [
      { nome: 'Spesa', icona: '🛒', parole: ['spesa', 'supermercato', 'esselunga', 'coop', 'conad', 'lidl', 'eurospin', 'despar', 'interspar', 'carrefour', 'aldi', 'penny', 'famila', 'alimentari', 'panificio', 'fornaio', 'macelleria', 'pescheria', 'frutta', 'verdura', 'mercato'] },
      { nome: 'Ristoranti e bar', icona: '🍕', parole: ['pizza', 'pizzeria', 'ristorante', 'trattoria', 'osteria', 'bacaro', 'bar', 'caffe', 'cappuccino', 'brioche', 'cornetto', 'colazione', 'aperitivo', 'spritz', 'birra', 'cena', 'pranzo', 'sushi', 'kebab', 'mcdonald', 'burger', 'hamburger', 'gelato', 'pasticceria', 'paninoteca', 'panino', 'piadina', 'tramezzino', 'cicchetti', 'vino', 'cocktail', 'pub', 'glovo', 'deliveroo', 'just eat', 'justeat', 'cibo', 'asporto'] },
      { nome: 'Trasporti', icona: '🚗', parole: ['benzina', 'carburante', 'diesel', 'gasolio', 'pieno', 'autostrada', 'pedaggio', 'telepass', 'treno', 'trenitalia', 'italo', 'biglietto', 'bus', 'autobus', 'actv', 'vaporetto', 'tram', 'metro', 'taxi', 'uber', 'parcheggio', 'sosta', 'monopattino'] },
      { nome: 'Auto e moto', icona: '🔧', parole: ['meccanico', 'tagliando', 'gomme', 'pneumatici', 'revisione', 'bollo auto', 'carrozziere', 'autolavaggio', 'assicurazione auto', 'rca', 'officina'] },
      { nome: 'Casa e bollette', icona: '🏠', parole: ['bolletta', 'luce', 'gas', 'enel', 'hera', 'veritas', 'acqua', 'internet', 'fibra', 'wifi', 'affitto', 'condominio', 'tari', 'casa', 'ikea', 'brico', 'mobili', 'elettrodomestico', 'pulizie', 'detersivi', 'ferramenta'] },
      { nome: 'Telefono e abbonamenti', icona: '📱', parole: ['ricarica', 'telefono', 'tim', 'vodafone', 'wind', 'iliad', 'ho mobile', 'fastweb', 'netflix', 'spotify', 'disney', 'prime video', 'amazon prime', 'dazn', 'now tv', 'sky', 'icloud', 'apple one', 'youtube premium', 'claude', 'chatgpt', 'abbonamento'] },
      { nome: 'Salute', icona: '💊', parole: ['farmacia', 'medicine', 'medicina', 'farmaco', 'medico', 'mediche', 'dottore', 'dentista', 'visita', 'analisi', 'esami del sangue', 'ticket', 'ottico', 'occhiali', 'lenti', 'fisioterapista', 'osteopata', 'psicologo'] },
      { nome: 'Sport e palestra', icona: '🏋️', parole: ['palestra', 'scherma', 'piscina', 'calcetto', 'tennis', 'padel', 'yoga', 'integratori', 'proteine', 'creatina', 'whey', 'sport', 'allenamento', 'personal trainer', 'decathlon'] },
      { nome: 'Formazione', icona: '📚', parole: ['corso', 'patente', 'libro', 'scuola', 'esame', 'lezione', 'formazione', 'udemy', 'master', 'universita'] },
      { nome: 'Svago', icona: '🎲', parole: ['cinema', 'concerto', 'teatro', 'museo', 'mostra', 'videogioco', 'gioco', 'steam', 'playstation', 'ps5', 'xbox', 'nintendo', 'dadi', 'fumetti', 'discoteca', 'serata', 'evento', 'bowling', 'escape room'] },
      { nome: 'Viaggi', icona: '✈️', parole: ['viaggio', 'volo', 'aereo', 'ryanair', 'easyjet', 'wizz', 'hotel', 'albergo', 'airbnb', 'booking', 'ostello', 'vacanza', 'traghetto', 'noleggio'] },
      { nome: 'Vestiti e cura', icona: '👕', parole: ['vestiti', 'abbigliamento', 'scarpe', 'maglia', 'maglietta', 'felpa', 'pantaloni', 'jeans', 'giacca', 'camicia', 'zara', 'nike', 'adidas', 'barbiere', 'parrucchiere', 'profumo', 'cosmetici', 'lavanderia'] },
      { nome: 'Tecnologia', icona: '💻', parole: ['amazon', 'computer', 'pc', 'portatile', 'iphone', 'cuffie', 'airpods', 'cavo', 'caricatore', 'mediaworld', 'unieuro', 'elettronica', 'software', 'stampante'] },
      { nome: 'Regali', icona: '🎁', parole: ['regalo', 'regali', 'compleanno', 'fiori'] },
      { nome: 'Tasse e commercialista', icona: '🧾', parole: ['tasse', 'tassa', 'f24', 'inps', 'irpef', 'imposta', 'imposte', 'commercialista', 'marca da bollo', 'multa', 'agenzia delle entrate', 'bollo'] },
      { nome: 'Banca e commissioni', icona: '🏦', parole: ['commissione bancaria', 'commissioni bancarie', 'canone', 'conto corrente', 'prelievo', 'bancomat', 'bonifico'] },
      { nome: 'Altro', icona: '•', parole: [] }
    ],
    entrata: [
      { nome: 'Provvigioni', icona: '💼', parole: ['provvigione', 'commissione', 'fattura', 'cliente'] },
      { nome: 'Stipendio', icona: '💶', parole: ['stipendio', 'busta paga'] },
      { nome: 'Rimborsi', icona: '↩️', parole: ['rimborso', 'rimborsato', 'restituito', 'ridato', 'reso'] },
      { nome: 'Regali ricevuti', icona: '🎁', parole: ['regalo', 'regalato', 'regalati'] },
      { nome: 'Vendite', icona: '🏷️', parole: ['venduto', 'vendita', 'vinted', 'subito', 'ebay'] },
      { nome: 'Rendite', icona: '🌱', parole: ['dividendo', 'cedola', 'interessi', 'staking'] },
      { nome: 'Altre entrate', icona: '•', parole: [] }
    ],
    investimento: [
      { nome: 'PAC', icona: '📈', parole: ['pac', 'piano di accumulo'] },
      { nome: 'ETF e azioni', icona: '📊', parole: ['etf', 'azioni', 'azione', 'titolo', 's&p', 'nasdaq', 'msci'] },
      { nome: 'Cripto', icona: '🪙', parole: ['cripto', 'crypto', 'bitcoin', 'btc', 'eth', 'ethereum', 'solana', 'usdt', 'binance', 'ledger', 'blofin', 'bybit'] },
      { nome: 'Certificati', icona: '📜', parole: ['certificato', 'cash collect', 'autocall'] },
      { nome: 'Altri investimenti', icona: '•', parole: [] }
    ]
  };

  const RIPIEGO = { uscita: 'Altro', entrata: 'Altre entrate', investimento: 'Altri investimenti' };

  // ------------------------------------------------------- parole che decidono il tipo
  const INVESTE = ['pac', 'etf', 'investito', 'investiti', 'investimento', 'investimenti', 'investire', 'investo',
    'cripto', 'crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'usdt', 'binance', 'ledger', 'blofin', 'bybit',
    'etoro', 'certificato', 'certificati', 'azioni', 'nasdaq', 's&p', 'msci', 'cash collect', 'autocall', 'piano di accumulo'];
  const RITIRA = ['venduto', 'venduti', 'vendita', 'prelevato', 'prelevati', 'ritirato', 'ritirati', 'disinvestito',
    'disinvestiti', 'riscattato', 'rientrato', 'rientrati', 'incassato', 'incassati', 'tornati', 'scaduto', 'rimborsato'];
  const RENDITA = ['dividendo', 'dividendi', 'cedola', 'cedole', 'interessi', 'staking'];
  const ENTRA = ['entrata', 'entrate', 'incassato', 'incassati', 'incasso', 'ricevuto', 'ricevuti', 'provvigione',
    'provvigioni', 'stipendio', 'rimborso', 'rimborsi', 'guadagnato', 'guadagnati', 'guadagno', 'venduto', 'venduti',
    'vendita', 'mi ha dato', 'mi hanno dato', 'mi ha pagato', 'mi hanno pagato', 'mi ha restituito', 'mi hanno restituito',
    'mi ha ridato', 'mi hanno ridato', 'mi ha rimborsato', 'mi hanno rimborsato', 'mi ha regalato', 'mi hanno regalato',
    'bonifico da', 'bonifico ricevuto', 'commissione', 'commissioni', 'busta paga'];
  const BANCA = ['bancaria', 'bancarie', 'banca', 'prelievo', 'bonifico', 'carta', 'conto', 'bancomat', 'canone'];
  const ESCE = ['uscita', 'speso', 'spesi', 'pagato', 'pagati', 'comprato', 'comprati', 'acquistato', 'acquisto'];

  const VALUTA = new Set(['euro', 'eur', 'euri', '€']);
  const RIEMPITIVI = new Set(['ho', 'mi', 'ha', 'hanno', 'abbiamo', 'speso', 'spesi', 'pagato', 'pagati', 'preso', 'presi',
    'comprato', 'comprati', 'fatto', 'fatta', 'incassato', 'incassati', 'ricevuto', 'ricevuti', 'entrata', 'uscita',
    'per', 'di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'il', 'lo', 'la', 'i', 'gli', 'le', 'l\'', 'un', 'uno',
    'una', 'un\'', 'a', 'al', 'alla', 'allo', 'ai', 'agli', 'alle', 'e', 'in', 'su', 'sul', 'sulla']);
  const VUOTE = new Set([...RIEMPITIVI, 'da', 'con', 'che', 'oggi', 'ieri', 'mio', 'mia', 'miei', 'mie', 'suo', 'sua', 'x']);

  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const GIORNI = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];

  // ------------------------------------------------------------------ utilità
  function normalizza(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, '\'');
  }

  // Varianti di plurale per le parole singole lunghe: pizza→pizze, libro→libri, lezione→lezioni.
  function varianti(p) {
    const v = [p];
    if (p.length >= 4 && !p.includes(' ')) {
      const radice = p.slice(0, -1), fine = p.slice(-1);
      if (fine === 'a') v.push(radice + 'e');
      if (fine === 'o' || fine === 'e') v.push(radice + 'i');
    }
    return v;
  }

  // Cerca le parole chiave dentro il testo già normalizzato e spaziato (" a b c ").
  function trova(testoSpaziato, elenco) {
    let migliore = null;
    for (const parola of elenco) {
      for (const v of varianti(normalizza(parola))) {
        if (testoSpaziato.includes(' ' + v + ' ') && (!migliore || v.length > migliore.length)) migliore = v;
      }
    }
    return migliore;
  }

  function numeroDaToken(t) {
    let s = t, segno = 1;
    if (s.startsWith('+')) s = s.slice(1);
    else if (s.startsWith('-') || s.startsWith('−')) { s = s.slice(1); segno = -1; }
    let molt = 1;
    if (/k$/.test(s)) { molt = 1000; s = s.slice(0, -1); }
    const m = s.match(/^(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)$/);
    if (!m) return null;
    let n;
    if (/^\d{1,3}(?:\.\d{3})+/.test(m[1])) n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    else n = parseFloat(m[1].replace(',', '.'));
    return { valore: n * molt, decimali: /[.,]\d{1,2}$/.test(m[1]), segno };
  }

  // Numeri a parole («dodici», «trecentoquaranta», «duemila»): servono solo se la dettatura non li scrive in cifre.
  const UNITA = { uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11,
    dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19 };
  const DECINE = { venti: 20, vent: 20, trenta: 30, trent: 30, quaranta: 40, quarant: 40, cinquanta: 50, cinquant: 50,
    sessanta: 60, sessant: 60, settanta: 70, settant: 70, ottanta: 80, ottant: 80, novanta: 90, novant: 90 };
  const PEZZI = Object.keys(UNITA).concat(Object.keys(DECINE), ['cento', 'mille', 'mila']).sort((a, b) => b.length - a.length);

  function numeroDaParola(p) {
    if (!p || p === 'un' || p === 'uno' || p === 'una') return null;
    let i = 0, totale = 0, corrente = 0, trovato = false;
    while (i < p.length) {
      const pezzo = PEZZI.find(x => p.startsWith(x, i));
      if (!pezzo) return null;
      trovato = true;
      if (pezzo === 'cento') corrente = (corrente || 1) * 100;
      else if (pezzo === 'mille') { totale += 1000; corrente = 0; }
      else if (pezzo === 'mila') { totale += (corrente || 1) * 1000; corrente = 0; }
      else corrente += UNITA[pezzo] || DECINE[pezzo];
      i += pezzo.length;
    }
    return trovato ? totale + corrente : null;
  }

  function isoDa(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function aMezzanotte(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function spostaGiorni(d, n) { const x = aMezzanotte(d); x.setDate(x.getDate() + n); return x; }

  function tokenizza(testo) {
    const pulito = String(testo)
      .replace(/€/g, ' € ')
      .replace(/['’]/g, '\' ')
      .replace(/[;:!?()"«»]/g, ' ')
      .replace(/,(?=\s|$)/g, ' ')
      .replace(/\.(?=\s|$)/g, ' ');
    return pulito.split(/\s+/).filter(Boolean).map(orig => ({ orig, norm: normalizza(orig), usato: false }));
  }

  // ------------------------------------------------------------------ date
  function leggiData(tok, oggi, restanoImporti) {
    let data = null;
    const usa = (...idx) => idx.forEach(i => { tok[i].usato = true; });
    const n = tok.length;
    for (let i = 0; i < n && !data; i++) {
      const t = tok[i].norm;
      if (['oggi', 'stamattina', 'stamani', 'stasera', 'stanotte', 'stamane'].includes(t)) { data = oggi; usa(i); break; }
      if (t === 'altroieri' || t === 'ieralaltro') { data = spostaGiorni(oggi, -2); usa(i); break; }
      if (t === 'altro' && tok[i + 1] && tok[i + 1].norm === 'ieri') {
        data = spostaGiorni(oggi, -2); usa(i, i + 1);
        if (i > 0 && tok[i - 1].norm === 'l\'') usa(i - 1);
        break;
      }
      if (t === 'ieri') {
        data = spostaGiorni(oggi, -1); usa(i);
        if (tok[i + 1] && tok[i + 1].norm === 'l\'' && tok[i + 2] && tok[i + 2].norm === 'altro') { data = spostaGiorni(oggi, -2); usa(i + 1, i + 2); }
        else if (tok[i + 1] && ['sera', 'mattina', 'pomeriggio', 'notte'].includes(tok[i + 1].norm)) usa(i + 1);
        break;
      }
      const g = GIORNI.indexOf(t);
      if (g >= 0) {
        const scorso = tok[i + 1] && ['scorso', 'scorsa'].includes(tok[i + 1].norm);
        let indietro = (oggi.getDay() - g + 7) % 7;
        if (scorso && indietro === 0) indietro = 7;
        data = spostaGiorni(oggi, -indietro); usa(i);
        if (scorso) usa(i + 1);
        if (i > 0 && ['di', 'il', 'lo', 'la'].includes(tok[i - 1].norm)) usa(i - 1);
        break;
      }
      // 3/11, 03-11-2026
      const m = t.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
      if (m) {
        const giorno = +m[1], mese = +m[2] - 1;
        let anno = m[3] ? +m[3] : null;
        if (anno !== null && anno < 100) anno += 2000;
        if (mese >= 0 && mese < 12 && giorno >= 1 && giorno <= 31) { data = componi(giorno, mese, anno, oggi); usa(i); break; }
      }
      // 3 novembre, 3 nov 2026
      if (/^\d{1,2}$/.test(t) && tok[i + 1]) {
        const p = tok[i + 1].norm;
        let mese = MESI.indexOf(p);
        if (mese < 0) mese = MESI_BREVI.indexOf(p);
        const giorno = +t;
        if (mese >= 0 && giorno >= 1 && giorno <= 31 && restanoImporti(i)) {
          let anno = null;
          if (tok[i + 2] && /^(19|20)\d{2}$/.test(tok[i + 2].norm)) { anno = +tok[i + 2].norm; usa(i + 2); }
          data = componi(giorno, mese, anno, oggi); usa(i, i + 1);
          if (i > 0 && ['il', 'del', 'giorno', 'dal'].includes(tok[i - 1].norm)) usa(i - 1);
          break;
        }
      }
      // il 3 (giorno del mese corrente), solo se resta un altro numero per l'importo
      if (['il', 'giorno'].includes(t) && tok[i + 1] && /^\d{1,2}$/.test(tok[i + 1].norm)) {
        const giorno = +tok[i + 1].norm;
        if (giorno >= 1 && giorno <= 31 && restanoImporti(i + 1)) {
          // solo il giorno: se cadrebbe nel futuro è del mese scorso
          data = new Date(oggi.getFullYear(), oggi.getMonth(), giorno);
          if (data > spostaGiorni(oggi, 1)) data = new Date(oggi.getFullYear(), oggi.getMonth() - 1, giorno);
          usa(i, i + 1);
          break;
        }
      }
    }
    return data;
  }

  // Senza anno: se la data cadrebbe nel futuro (oltre domani) è dell'anno scorso.
  function componi(giorno, mese, anno, oggi) {
    let a = anno !== null ? anno : oggi.getFullYear();
    let d = new Date(a, mese, giorno);
    if (anno === null && d > spostaGiorni(oggi, 1)) d = new Date(a - 1, mese, giorno);
    return d;
  }

  // ---------------------------------------------------------------- importo
  function leggiImporto(tok) {
    const candidati = [];
    tok.forEach((t, i) => {
      if (t.usato) return;
      const num = t.num !== undefined ? { valore: t.num, decimali: false, segno: 1 } : numeroDaToken(t.norm);
      if (!num) return;
      const prima = tok[i - 1], dopo = tok[i + 1];
      const conValuta = !!((dopo && VALUTA.has(dopo.norm)) || (prima && prima.norm === '€'));
      const anno = /^(19|20)\d{2}$/.test(t.norm);
      candidati.push({ i, num, conValuta, anno });
    });
    if (!candidati.length) return null;
    const nonAnni = candidati.filter(c => !c.anno);
    const pool = nonAnni.length ? nonAnni : candidati;
    const scelto = pool.find(c => c.conValuta) || pool.find(c => c.num.decimali) ||
      pool.reduce((a, b) => (b.num.valore > a.num.valore ? b : a));
    let valore = scelto.num.valore;
    const i = scelto.i;
    tok[i].usato = true;
    const prima = tok[i - 1], dopo = tok[i + 1];
    // centesimi scritti dopo «e»: in cifre («50») o a parole («cinquanta»)
    const centDi = t => {
      if (!t || t.usato) return null;
      const v = t.num !== undefined ? t.num : (/^\d{1,2}$/.test(t.norm) ? +t.norm : null);
      return v !== null && v < 100 ? v : null;
    };
    if (prima && prima.norm === '€') prima.usato = true;
    if (dopo && VALUTA.has(dopo.norm)) {
      dopo.usato = true;
      // «12 euro e 50»
      const e = tok[i + 2], cent = centDi(tok[i + 3]);
      if (!scelto.num.decimali && e && e.norm === 'e' && cent !== null) {
        valore += cent / 100; e.usato = true; tok[i + 3].usato = true;
        if (tok[i + 4] && /^centesim/.test(tok[i + 4].norm)) tok[i + 4].usato = true;
      }
    } else if (!scelto.num.decimali && dopo && dopo.norm === 'e' && centDi(tok[i + 2]) !== null &&
               tok[i + 3] && /^centesim/.test(tok[i + 3].norm)) {
      valore += centDi(tok[i + 2]) / 100; dopo.usato = true; tok[i + 2].usato = true; tok[i + 3].usato = true;
    }
    return { centesimi: Math.round(valore * 100), segno: scelto.num.segno, esplicito: tok[i].orig.trim()[0] === '+' ? 1 : (scelto.num.segno < 0 ? -1 : 0) };
  }

  // ---------------------------------------------------------------- tipo e categoria
  function categoriaPer(tipo, spaziato) {
    let migliore = null;
    for (const c of CATEGORIE[tipo]) {
      const hit = trova(spaziato, c.parole);
      if (hit && (!migliore || hit.length > migliore.lunghezza)) migliore = { nome: c.nome, lunghezza: hit.length };
    }
    return migliore ? migliore.nome : null;
  }

  function paroleSignificative(descrizione) {
    return normalizza(descrizione).replace(/[^a-z0-9&' ]/g, ' ').split(/\s+/)
      .filter(p => p.length >= 3 && !VUOTE.has(p) && !/^\d+$/.test(p));
  }

  function esiste(tipo, nome) { return CATEGORIE[tipo] && CATEGORIE[tipo].some(c => c.nome === nome); }

  /**
   * analizza(testo, { oggi: Date, imparate: {parola: {tipo, categoria}}, tipo, segno })
   * tipo/segno forzano il tipo (quando lo sceglie Francesco dal bottone).
   */
  function analizza(testo, opz) {
    opz = opz || {};
    const oggi = aMezzanotte(opz.oggi || new Date());
    const tok = tokenizza(testo);
    const risultato = { tipo: 'uscita', segno: 1, importo: null, categoria: null, data: isoDa(oggi), descrizione: '',
      certo: { tipo: false, categoria: false, importo: false, data: false } };
    if (!tok.length) return risultato;

    // numeri a parole solo se non c'è nessuna cifra
    if (!tok.some(t => /\d/.test(t.norm))) {
      tok.forEach(t => { const n = numeroDaParola(t.norm); if (n !== null) t.num = n; });
    }
    const contaNumeriLiberi = escluso => tok.filter((t, i) => !t.usato && i !== escluso &&
      (t.num !== undefined || numeroDaToken(t.norm))).length > 0;

    const data = leggiData(tok, oggi, contaNumeriLiberi);
    if (data) { risultato.data = isoDa(data); risultato.certo.data = true; }

    const imp = leggiImporto(tok);
    if (imp) { risultato.importo = imp.centesimi; risultato.certo.importo = imp.centesimi > 0; }

    const spaziato = ' ' + tok.map(t => t.norm.replace(/[^a-z0-9&']/g, '')).join(' ') + ' ';

    // tipo
    let tipo = 'uscita', segno = 1, certo = false;
    const primo = tok[0].orig.trim();
    if (opz.tipo) { tipo = opz.tipo; segno = opz.segno || 1; certo = true; }
    else if (primo.startsWith('+') || (imp && imp.esplicito === 1)) { tipo = 'entrata'; certo = true; }
    else if (primo.startsWith('-') || primo.startsWith('−') || (imp && imp.esplicito === -1)) { tipo = 'uscita'; certo = true; }
    else if (trova(spaziato, INVESTE)) {
      certo = true;
      if (trova(spaziato, RENDITA)) tipo = 'entrata';
      else { tipo = 'investimento'; if (trova(spaziato, RITIRA)) segno = -1; }
    } else if (trova(spaziato, ENTRA)) {
      const soloCommissione = !trova(spaziato, ENTRA.filter(p => !p.startsWith('commission')));
      if (soloCommissione && trova(spaziato, BANCA)) { tipo = 'uscita'; }
      else tipo = 'entrata';
      certo = true;
    } else if (trova(spaziato, ESCE)) { certo = true; }

    // descrizione: quello che resta, senza riempitivi all'inizio e alla fine
    let resto = tok.filter(t => !t.usato && !VALUTA.has(t.norm));
    while (resto.length && RIEMPITIVI.has(resto[0].norm)) resto.shift();
    while (resto.length && (RIEMPITIVI.has(resto[resto.length - 1].norm) || resto[resto.length - 1].norm === 'da')) resto.pop();
    let descrizione = resto.map(t => t.orig).join(' ').replace(/\s+'/g, '\'').replace(/'\s+/g, '\'').trim();
    descrizione = descrizione.replace(/\s+([,.])/g, '$1');
    if (descrizione) descrizione = descrizione[0].toUpperCase() + descrizione.slice(1);

    // categoria: prima le parole imparate dalle correzioni, poi il dizionario
    let categoria = null, catCerta = false;
    const imparate = opz.imparate || {};
    for (const p of paroleSignificative(descrizione)) {
      const regola = imparate[p];
      if (!regola) continue;
      if (!certo && esiste(regola.tipo, regola.categoria)) { tipo = regola.tipo; segno = regola.segno || 1; }
      if (regola.tipo === tipo && esiste(tipo, regola.categoria)) { categoria = regola.categoria; catCerta = true; break; }
    }
    if (!categoria) {
      const c = categoriaPer(tipo, spaziato);
      if (c) { categoria = c; catCerta = true; }
    }
    if (!categoria) categoria = RIPIEGO[tipo];

    risultato.tipo = tipo;
    risultato.segno = tipo === 'investimento' ? segno : 1;
    risultato.categoria = categoria;
    risultato.descrizione = descrizione || categoria;
    risultato.certo.tipo = certo;
    risultato.certo.categoria = catCerta;
    return risultato;
  }

  function icona(tipo, nome) {
    const c = (CATEGORIE[tipo] || []).find(x => x.nome === nome);
    return c ? c.icona : '•';
  }

  globale.Analizza = { analizza, CATEGORIE, RIPIEGO, paroleSignificative, icona, isoDa, normalizza, numeroDaParola };
})(typeof window !== 'undefined' ? window : globalThis);
