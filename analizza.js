/* Conti — lettura delle frasi dettate.
   Trasforma «pizza 12 ieri» in { tipo, importo, categoria, data, descrizione }.
   Solo funzioni pure: niente accesso alla pagina né ai dati salvati.
   Gli importi sono in centesimi (interi) per non perdere centesimi nelle somme. */
(function (globale) {
  'use strict';

  // ---------------------------------------------------------------- categorie
  // Parole chiave generiche: il codice è pubblico, qui non vanno nomi di persone o clienti.
  // Dal 10/11/2026 i tipi sono solo due: gli investimenti sono un'uscita («Investimenti»)
  // e quello che torna dagli investimenti è un'entrata («Ritirato dagli investimenti»).
  const PAROLE_INVESTIMENTI = ['pac', 'piano di accumulo', 'etf', 'azioni', 's&p', 'nasdaq', 'msci', 'cripto', 'crypto',
    'bitcoin', 'btc', 'eth', 'ethereum', 'solana', 'usdt', 'binance', 'ledger', 'blofin', 'bybit', 'etoro', 'certificato',
    'certificati', 'cash collect', 'autocall', 'investito', 'investiti', 'investimento', 'investimenti', 'obbligazioni', 'btp'];
  const CATEGORIE = {
    uscita: [
      { nome: 'Spesa', icona: '🛒', parole: ['spesa', 'supermercato', 'esselunga', 'coop', 'conad', 'lidl', 'eurospin', 'despar', 'interspar', 'carrefour', 'aldi', 'penny', 'famila', 'alimentari', 'panificio', 'fornaio', 'macelleria', 'pescheria', 'frutta', 'verdura', 'mercato'] },
      // «bar» da solo va in Svago; in giornata (prima delle 18, oggi, senza «sera») va in Cibo: vedi barDiGiorno()
      { nome: 'Cibo', icona: '🍕', parole: ['cibo', 'pizza', 'pizzeria', 'ristorante', 'trattoria', 'osteria', 'caffe', 'cappuccino', 'brioche', 'cornetto', 'colazione', 'merenda', 'spuntino', 'cena', 'pranzo', 'sushi', 'kebab', 'poke', 'ramen', 'mcdonald', 'mcdonalds', 'mc', 'burger', 'hamburger', 'gelato', 'pasticceria', 'paninoteca', 'panino', 'piadina', 'tramezzino', 'toast', 'focaccia', 'rosticceria', 'tavola calda', 'cicchetti', 'glovo', 'deliveroo', 'just eat', 'justeat', 'asporto'] },
      { nome: 'Trasporti', icona: '🚆', parole: ['benzina', 'carburante', 'diesel', 'gasolio', 'pieno', 'autostrada', 'pedaggio', 'telepass', 'treno', 'trenitalia', 'italo', 'biglietto', 'bus', 'autobus', 'actv', 'vaporetto', 'tram', 'metro', 'taxi', 'uber', 'parcheggio', 'sosta', 'monopattino'] },
      { nome: 'Motori', icona: '🔧', parole: ['motori', 'moto', 'meccanico', 'tagliando', 'gomme', 'pneumatici', 'revisione', 'bollo auto', 'bollo moto', 'carrozziere', 'autolavaggio', 'assicurazione auto', 'assicurazione moto', 'rca', 'officina', 'casco'] },
      { nome: 'Casa', icona: '🏠', parole: ['casa', 'bolletta', 'luce', 'gas', 'enel', 'hera', 'veritas', 'acqua', 'internet', 'fibra', 'wifi', 'affitto', 'condominio', 'tari', 'manutenzione', 'idraulico', 'elettricista', 'ikea', 'brico', 'mobili', 'elettrodomestico', 'pulizie', 'detersivi', 'ferramenta'] },
      { nome: 'Abbonamenti', icona: '📱', parole: ['abbonamento', 'abbonamenti', 'ricarica', 'telefono', 'tim', 'vodafone', 'wind', 'iliad', 'ho mobile', 'fastweb', 'netflix', 'spotify', 'disney', 'prime video', 'amazon prime', 'dazn', 'now tv', 'sky', 'icloud', 'apple one', 'youtube premium', 'claude', 'chatgpt'] },
      { nome: 'Salute', icona: '💊', parole: ['farmacia', 'medicine', 'medicina', 'farmaco', 'medico', 'mediche', 'dottore', 'dentista', 'visita', 'analisi', 'esami del sangue', 'ticket', 'ottico', 'occhiali', 'lenti', 'fisioterapista', 'osteopata', 'psicologo'] },
      { nome: 'Attività fisica', icona: '🏋️', parole: ['palestra', 'scherma', 'piscina', 'nuoto', 'calcetto', 'tennis', 'padel', 'yoga', 'integratori', 'proteine', 'creatina', 'whey', 'sport', 'allenamento', 'personal trainer', 'decathlon', 'attivita fisica'] },
      { nome: 'Formazione', icona: '📚', parole: ['corso', 'patente', 'libro', 'scuola', 'esame', 'lezione', 'formazione', 'udemy', 'master', 'universita'] },
      { nome: 'Svago', icona: '🎲', parole: ['svago', 'bar', 'aperitivo', 'spritz', 'birra', 'cocktail', 'drink', 'pub', 'vino', 'bacaro', 'amaro', 'shot', 'locale', 'speakeasy', 'speak easy', 'club', 'discoteca', 'serata', 'cinema', 'concerto', 'teatro', 'museo', 'mostra', 'videogioco', 'gioco', 'steam', 'playstation', 'ps5', 'xbox', 'nintendo', 'dadi', 'fumetti', 'evento', 'bowling', 'escape room'] },
      { nome: 'Viaggi', icona: '✈️', parole: ['viaggio', 'volo', 'aereo', 'ryanair', 'easyjet', 'wizz', 'hotel', 'albergo', 'airbnb', 'booking', 'ostello', 'vacanza', 'traghetto', 'noleggio'] },
      { nome: 'Vestiti', icona: '👕', parole: ['vestiti', 'vestito', 'abbigliamento', 'scarpe', 'maglia', 'maglietta', 'felpa', 'pantaloni', 'jeans', 'giacca', 'camicia', 'calze', 'intimo', 'zara', 'h&m', 'nike', 'adidas', 'lavanderia'] },
      { nome: 'Benessere', icona: '🧖', parole: ['benessere', 'sauna', 'spa', 'terme', 'massaggio', 'massaggi', 'bagno turco', 'centro benessere', 'estetista', 'manicure', 'pedicure', 'barbiere', 'parrucchiere', 'profumo', 'cosmetici', 'crema'] },
      { nome: 'Tecnologia', icona: '💻', parole: ['amazon', 'computer', 'pc', 'portatile', 'iphone', 'cuffie', 'airpods', 'cavo', 'caricatore', 'mediaworld', 'unieuro', 'elettronica', 'software', 'stampante'] },
      { nome: 'Regali', icona: '🎁', parole: ['regalo', 'regali', 'compleanno', 'fiori'] },
      { nome: 'Tasse e commercialista', icona: '🧾', parole: ['tasse', 'tassa', 'f24', 'inps', 'irpef', 'imposta', 'imposte', 'commercialista', 'marca da bollo', 'multa', 'agenzia delle entrate', 'bollo'] },
      { nome: 'Banca e commissioni', icona: '🏦', parole: ['commissione bancaria', 'commissioni bancarie', 'canone', 'conto corrente', 'prelievo', 'bancomat', 'bonifico'] },
      { nome: 'Tabacchi', icona: '🚬', parole: ['tabacchi', 'tabaccheria', 'tabacco', 'sigarette', 'sigaretta', 'cartine', 'filtri', 'accendino', 'iqos', 'heets', 'terea', 'svapo'] },
      { nome: 'Inserti vegetali', icona: '🍀', parole: ['inserti vegetali', 'inserti', 'inserto'] },
      { nome: 'Cioccolato', icona: '🍫', parole: ['cioccolato', 'cioccolata', 'cioccolatino', 'cioccolatini', 'nutella', 'kinder', 'lindt', 'milka', 'ferrero', 'venchi', 'ritter'] },
      { nome: 'Investimenti', icona: '📈', parole: PAROLE_INVESTIMENTI },
      { nome: 'Altro', icona: '•', parole: [] }
    ],
    entrata: [
      { nome: 'Provvigioni', icona: '💼', parole: ['provvigione', 'commissione', 'fattura', 'cliente'] },
      { nome: 'Stipendio', icona: '💶', parole: ['stipendio', 'busta paga'] },
      { nome: 'Rimborsi', icona: '↩️', parole: ['rimborso', 'rimborsato', 'restituito', 'ridato', 'reso'] },
      { nome: 'Donazioni', icona: '🎁', parole: ['donazione', 'donazioni', 'donato', 'donati', 'regalo', 'regalato', 'regalati'] },
      { nome: 'Vendite', icona: '🏷️', parole: ['venduto', 'vendita', 'vinted', 'subito', 'ebay'] },
      { nome: 'Favori', icona: '🌱', parole: ['favore', 'favori'] },
      { nome: 'Ritirato dagli investimenti', icona: '💰', parole: ['dividendo', 'dividendi', 'cedola', 'cedole', 'interessi', 'staking', 'disinvestito', 'disinvestiti', 'riscattato'] },
      { nome: 'Altre entrate', icona: '•', parole: [] }
    ]
  };

  const RIPIEGO = { uscita: 'Altro', entrata: 'Altre entrate' };
  const INVESTIMENTI = 'Investimenti', RITIRATO = 'Ritirato dagli investimenti';

  // Nomi cambiati il 10/11/2026: i dati vecchi (salvati o importati) si traducono con queste tabelle.
  const RINOMINATE = {
    uscita: { 'Ristoranti e bar': 'Cibo', 'Auto e moto': 'Motori', 'Casa e bollette': 'Casa', 'Telefono e abbonamenti': 'Abbonamenti',
      'Sport e palestra': 'Attività fisica', 'Vestiti e cura': 'Vestiti' },
    entrata: { 'Regali ricevuti': 'Donazioni', 'Rendite': 'Favori' }
  };
  const ICONE_CAMBIATE = { uscita: { Trasporti: ['🚗', '🚆'] } };

  // ------------------------------------------------------- parole che decidono il tipo
  const INVESTE = PAROLE_INVESTIMENTI.concat(['investire', 'investo']);
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

  // Distanza di modifica (Levenshtein) con tetto: dice solo se due parole differiscono di 1-2 lettere.
  function distanza(a, b, tetto) {
    if (Math.abs(a.length - b.length) > tetto) return tetto + 1;
    let prima = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const riga = [i];
      let minimo = i;
      for (let j = 1; j <= b.length; j++) {
        riga[j] = Math.min(prima[j] + 1, riga[j - 1] + 1, prima[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (riga[j] < minimo) minimo = riga[j];
      }
      if (minimo > tetto) return tetto + 1;
      prima = riga;
    }
    return prima[b.length];
  }

  // Cerca le parole chiave dentro il testo già normalizzato e spaziato (" a b c ").
  // Con «storte» accetta anche parole lunghe sbagliate di una lettera (due se lunghissime)
  // e due pezzi attaccati («provi gione»): gli errori tipici della trascrizione a voce.
  function trova(testoSpaziato, elenco, storte) {
    let migliore = null;
    for (const parola of elenco) {
      for (const v of varianti(normalizza(parola))) {
        if (testoSpaziato.includes(' ' + v + ' ') && (!migliore || v.length > migliore.length)) migliore = v;
      }
    }
    if (migliore || !storte) return migliore;
    const parole = testoSpaziato.split(' ').filter(Boolean);
    const vera = w => w.length >= 3 && /^[a-z']+$/.test(w) && !VALUTA.has(w);
    const pezzi = parole.concat(parole.slice(1).map((p, i) => (vera(parole[i]) && vera(p) ? parole[i] + p : null)).filter(Boolean));
    for (const parola of elenco) {
      const k = normalizza(parola);
      if (k.length < 7 || k.includes(' ')) continue;
      const tetto = k.length >= 10 ? 2 : 1;
      if (pezzi.some(p => distanza(p, k, tetto) <= tetto) && (!migliore || k.length > migliore.length)) migliore = k;
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
      let num = t.num !== undefined ? { valore: t.num, decimali: false, segno: 1 } : numeroDaToken(t.norm);
      // «un euro e 20»: «un» vale 1 solo se subito dopo c'è la valuta
      if (!num && (t.norm === 'un' || t.norm === 'uno') && tok[i + 1] && VALUTA.has(tok[i + 1].norm)) num = { valore: 1, decimali: false, segno: 1 };
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

  // ---------------------------------------------------------------- categorie personali
  // personali = { uscita: [{ nome, icona, base, nascosta, eliminata }], ... } nell'ordine scelto da Francesco.
  // «base» è la categoria di partenza da cui prende le parole chiave (null per quelle nuove).
  // «eliminata» tiene il posto di una categoria di partenza tolta, così non ricompare.
  // Le categorie di partenza che mancano dall'elenco personale (aggiunte in versioni nuove) si infilano
  // subito dopo quella che le precede nell'elenco di partenza: «Benessere» dopo «Vestiti», ecc.
  function elenco(tipo, personali) {
    const base = CATEGORIE[tipo] || [];
    const segna = c => Object.assign({}, c, { base: c.nome, nascosta: false, ripiego: c.nome === RIPIEGO[tipo] });
    const mie = personali && Array.isArray(personali[tipo]) ? personali[tipo] : null;
    if (!mie) return base.map(segna);
    const lista = mie.map(p => {
      const b = base.find(c => c.nome === p.base);
      const eRipiego = !!b && b.nome === RIPIEGO[tipo];
      return { nome: p.nome, icona: p.icona || (b ? b.icona : '•'), parole: b ? b.parole : [], base: b ? b.nome : null,
        nascosta: !!p.nascosta && !eRipiego, eliminata: !!p.eliminata && !eRipiego, ripiego: eRipiego };
    });
    base.forEach((c, i) => {
      if (lista.some(p => p.base === c.nome)) return;
      let dove = -1;
      for (let k = i - 1; k >= 0 && dove < 0; k--) dove = lista.findIndex(p => p.base === base[k].nome);
      lista.splice(dove + 1, 0, segna(c));
    });
    return lista.filter(c => !c.eliminata);
  }
  function ripiego(tipo, personali) {
    const c = elenco(tipo, personali).find(x => x.ripiego);
    return c ? c.nome : RIPIEGO[tipo];
  }
  // il nome (anche rinominato da Francesco) della categoria di partenza «base», se c'è ed è visibile
  function perBase(tipo, base, personali) {
    const c = elenco(tipo, personali).find(x => x.base === base && !x.nascosta);
    return c ? c.nome : null;
  }

  // ---------------------------------------------------------------- tipo e categoria
  // Restituisce { nome, parola }: la categoria e la parola chiave che l'ha decisa.
  function categoriaPer(tipo, spaziato, personali) {
    const lista = elenco(tipo, personali).filter(c => !c.nascosta);
    for (const storte of [false, true]) {
      let migliore = null;
      for (const c of lista) {
        const hit = trova(spaziato, c.parole, storte);
        let peso = hit ? hit.length : 0;
        // «scherma 60» va in «Scherma», se l'hai creata tu: il nome vale più delle parole di partenza
        if (!storte && !c.ripiego && (!c.base || c.nome !== c.base)) {
          const nome = normalizza(c.nome);
          if (spaziato.includes(' ' + nome + ' ')) peso = Math.max(peso, 100 + nome.length);
        }
        if (peso && (!migliore || peso > migliore.peso)) migliore = { nome: c.nome, base: c.base, peso, parola: hit };
      }
      if (migliore) return migliore;
    }
    return null;
  }

  // «bar» da solo: di sera è svago, in giornata (oggi, prima delle 18) è una cosa semplice e va in Cibo.
  const SERA = ['sera', 'stasera', 'serata', 'notte', 'stanotte', 'aperitivo', 'dopocena'];
  function barDiGiorno(spaziato, dataIso, adesso) {
    if (trova(spaziato, SERA)) return false;
    const ora = adesso.getHours();
    return dataIso === isoDa(adesso) && ora >= 5 && ora < 18;
  }

  // «ogni mese», «al mese», «mensile», «tutti i mesi»: il movimento si ripete ogni mese
  function leggiRipeti(tok) {
    for (let i = 0; i < tok.length; i++) {
      const a = tok[i].norm, b = tok[i + 1] && tok[i + 1].norm, c = tok[i + 2] && tok[i + 2].norm;
      if (tok[i].usato) continue;
      if ((a === 'ogni' || a === 'al') && b === 'mese') { tok[i].usato = tok[i + 1].usato = true; return true; }
      if (a === 'tutti' && b === 'i' && c === 'mesi') { tok[i].usato = tok[i + 1].usato = tok[i + 2].usato = true; return true; }
      if (a === 'mensile' || a === 'mensili' || a === 'mensilmente') { tok[i].usato = true; return true; }
    }
    return false;
  }

  function paroleSignificative(descrizione) {
    return normalizza(descrizione).replace(/[^a-z0-9&' ]/g, ' ').split(/\s+/)
      .filter(p => p.length >= 3 && !VUOTE.has(p) && !/^\d+$/.test(p));
  }

  function esiste(tipo, nome, personali) { return elenco(tipo, personali).some(c => c.nome === nome && !c.nascosta); }

  /**
   * analizza(testo, { oggi: Date, adesso: Date, imparate: {parola: {tipo, categoria}}, categorie, tipo })
   * tipo forza il tipo (quando lo sceglie Francesco dal bottone). adesso (con l'ora) serve al «bar».
   */
  function analizza(testo, opz) {
    opz = opz || {};
    const adesso = opz.adesso || opz.oggi || new Date();
    const oggi = aMezzanotte(opz.oggi || adesso);
    const tok = tokenizza(testo);
    const risultato = { tipo: 'uscita', importo: null, categoria: null, data: isoDa(oggi), descrizione: '', ripeti: false,
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
    risultato.ripeti = leggiRipeti(tok);

    let imp = leggiImporto(tok);
    // «Pizzadodici euro»: la trascrizione a volte incolla il numero alla parola prima. Solo come ultima
    // risorsa (nessun importo trovato) e solo per numeri lunghi almeno 4 lettere dopo almeno 3 lettere.
    if (!imp) {
      for (let i = 0; i < tok.length && !imp; i++) {
        const t = tok[i];
        if (t.usato || t.num !== undefined || /\d/.test(t.norm)) continue;
        for (let k = 3; k <= t.norm.length - 4; k++) {
          const n = numeroDaParola(t.norm.slice(k));
          if (n === null || n === 0) continue;
          const resto = t.orig.slice(0, k);
          tok.splice(i, 1, { orig: resto, norm: normalizza(resto), usato: false },
            { orig: t.orig.slice(k), norm: t.norm.slice(k), usato: false, num: n });
          imp = leggiImporto(tok);
          break;
        }
      }
    }
    if (imp) { risultato.importo = imp.centesimi; risultato.certo.importo = imp.centesimi > 0; }

    const spaziato = ' ' + tok.map(t => t.norm.replace(/[^a-z0-9&']/g, '')).join(' ') + ' ';

    // tipo. Gli investimenti sono uscite in «Investimenti»; venduti, ritirati, dividendi sono entrate in «Ritirato dagli investimenti».
    let tipo = 'uscita', certo = false, forzata = null;
    const primo = tok[0].orig.trim();
    const investe = trova(spaziato, INVESTE);
    if (investe) forzata = trova(spaziato, RENDITA) || trova(spaziato, RITIRA) ? RITIRATO : INVESTIMENTI;
    if (opz.tipo) { tipo = opz.tipo; certo = true; }
    else if (primo.startsWith('+') || (imp && imp.esplicito === 1)) { tipo = 'entrata'; certo = true; }
    else if (primo.startsWith('-') || primo.startsWith('−') || (imp && imp.esplicito === -1)) { tipo = 'uscita'; certo = true; }
    else if (investe) { certo = true; tipo = forzata === RITIRATO ? 'entrata' : 'uscita'; }
    else if (trova(spaziato, ENTRA) || trova(spaziato, ['provvigione', 'provvigioni', 'stipendio'], true)) {
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

    // categoria: prima le parole imparate dalle correzioni, poi gli investimenti, poi il dizionario
    let categoria = null, catCerta = false;
    const imparate = opz.imparate || {};
    for (const p of paroleSignificative(descrizione)) {
      const regola = imparate[p];
      if (!regola) continue;
      if (!certo && esiste(regola.tipo, regola.categoria, opz.categorie)) tipo = regola.tipo;
      if (regola.tipo === tipo && esiste(tipo, regola.categoria, opz.categorie)) { categoria = regola.categoria; catCerta = true; break; }
    }
    if (!categoria && investe) {
      const c = perBase(tipo, tipo === 'entrata' ? RITIRATO : INVESTIMENTI, opz.categorie);
      if (c) { categoria = c; catCerta = true; }
    }
    if (!categoria) {
      const c = categoriaPer(tipo, spaziato, opz.categorie);
      if (c) {
        categoria = c.nome; catCerta = true;
        if (c.base === 'Svago' && c.parola === 'bar' && barDiGiorno(spaziato, risultato.data, adesso)) {
          const cibo = perBase('uscita', 'Cibo', opz.categorie);
          if (cibo) categoria = cibo;
        }
      }
    }
    if (!categoria) categoria = ripiego(tipo, opz.categorie);

    risultato.tipo = tipo;
    risultato.categoria = categoria;
    risultato.descrizione = descrizione || categoria;
    risultato.certo.tipo = certo;
    risultato.certo.categoria = catCerta;
    return risultato;
  }

  function icona(tipo, nome, personali) {
    const c = elenco(tipo, personali).find(x => x.nome === nome);
    return c ? c.icona : '•';
  }

  // ---------------------------------------------------------------- più movimenti in una frase
  // «pizza 12, benzina 50, caffè 1,20» → tre movimenti. Si divide su a capo, «;», «, » e «. »
  // (mai dentro «1,20» o «1.800»), su «poi», e su « e » solo se a sinistra e a destra c'è un importo
  // e a destra non comincia un numero («12 euro e 50» resta uno). I pezzi senza importo si
  // riattaccano al successivo: «Spesa, frutta e verdura 20» resta uno.
  function haImporto(pezzo, opz) { return analizza(pezzo, opz).importo > 0; }
  function iniziaConNumero(pezzo) {
    const primo = normalizza(pezzo.trim()).split(/\s+/)[0] || '';
    return /^[+\-−€]?\d/.test(primo) || numeroDaParola(primo) !== null || primo === 'un' || primo === 'uno' || primo === 'euro';
  }
  function dividi(testo, opz) {
    const grezzi = String(testo).split(/\s+e\s+poi\s+|\s+poi\s+|\n|;|,\s+|\.\s+/i).map(x => x.trim()).filter(Boolean);
    const uniti = [];
    let attesa = '';
    for (const g of grezzi) {
      const pezzo = attesa ? attesa + ', ' + g : g;
      if (haImporto(pezzo, opz)) { uniti.push(pezzo); attesa = ''; } else attesa = pezzo;
    }
    if (attesa) { if (uniti.length) uniti[uniti.length - 1] += ', ' + attesa; else uniti.push(attesa); }
    const finali = [];
    for (const u of uniti) {
      let resto = u;
      for (;;) {
        const re = /\s+e\s+/gi;
        let m, diviso = false;
        while ((m = re.exec(resto))) {
          const sx = resto.slice(0, m.index), dx = resto.slice(m.index + m[0].length);
          if (haImporto(sx, opz) && haImporto(dx, opz) && !iniziaConNumero(dx)) { finali.push(sx.trim()); resto = dx; diviso = true; break; }
        }
        if (!diviso) break;
      }
      finali.push(resto.trim());
    }
    return finali.slice(0, 12);
  }

  // Come analizza, ma restituisce un elenco: uno per movimento. Chi non ha una data sua prende
  // la prima data detta nella frase («ieri pizza 12, benzina 50»: tutte e due ieri).
  function analizzaFrasi(testo, opz) {
    opz = opz || {};
    if (!String(testo).trim()) return [];
    const risultati = dividi(testo, opz).map(p => Object.assign(analizza(p, opz), { testo: p }));
    const conData = risultati.find(r => r.certo.data);
    if (conData) for (const r of risultati) if (!r.certo.data) r.data = conData.data;
    return risultati;
  }

  globale.Analizza = { analizza, analizzaFrasi, dividi, CATEGORIE, RIPIEGO, RINOMINATE, ICONE_CAMBIATE, INVESTIMENTI, RITIRATO,
    elenco, ripiego, perBase, paroleSignificative, icona, isoDa, normalizza, numeroDaParola };
})(typeof window !== 'undefined' ? window : globalThis);
