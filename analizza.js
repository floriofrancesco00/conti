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
  // Dal 15/11/2026 le cripto non sono più un investimento ma uno dei tre conti (vedi sotto, «i tre conti»):
  // comprarle o venderle è uno spostamento fra Digitale e Cripto.
  const INVESTIRE_GENERICO = ['investito', 'investiti', 'investimento', 'investimenti'];
  const PRODOTTI_INVESTIMENTO = ['pac', 'piano di accumulo', 'etf', 'azioni', 's&p', 'nasdaq', 'msci', 'etoro', 'certificato',
    'certificati', 'cash collect', 'autocall', 'obbligazioni', 'btp'];
  const PAROLE_INVESTIMENTI = PRODOTTI_INVESTIMENTO.concat(INVESTIRE_GENERICO);
  const PAROLE_CRIPTO = ['cripto', 'crypto', 'criptovaluta', 'criptovalute', 'bitcoin', 'btc', 'eth', 'ethereum', 'solana',
    'usdt', 'usdc', 'tether', 'stablecoin', 'binance', 'ledger', 'blofin', 'bybit', 'coinbase', 'kraken', 'metamask', 'staking'];
  const CATEGORIE = {
    uscita: [
      { nome: 'Spesa', icona: '🛒', parole: ['spesa', 'supermercato', 'esselunga', 'coop', 'conad', 'lidl', 'eurospin', 'despar', 'interspar', 'carrefour', 'aldi', 'penny', 'famila', 'alimentari', 'panificio', 'fornaio', 'macelleria', 'pescheria', 'frutta', 'verdura', 'mercato'] },
      // «bar» da solo va in Svago; in giornata (prima delle 18, oggi, senza «sera») va in Cibo: vedi barDiGiorno()
      { nome: 'Cibo', icona: '🍕', parole: ['cibo', 'pizza', 'pizzeria', 'ristorante', 'trattoria', 'osteria', 'caffe', 'cappuccino', 'brioche', 'cornetto', 'colazione', 'merenda', 'spuntino', 'cena', 'pranzo', 'sushi', 'kebab', 'poke', 'ramen', 'mcdonald', 'mcdonalds', 'mc', 'burger', 'hamburger', 'gelato', 'gelateria', 'pasticceria', 'dolce', 'dolcetto', 'pasticcino', 'torta', 'krapfen', 'bombolone', 'muffin', 'biscotti', 'caramelle', 'patatine', 'snack', 'crepe', 'frittella', 'paninoteca', 'panino', 'piadina', 'tramezzino', 'toast', 'focaccia', 'rosticceria', 'tavola calda', 'cicchetti', 'glovo', 'deliveroo', 'just eat', 'justeat', 'asporto'] },
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
  // entrate vere (non vendite né ritiri): «ricevuto 100 usdt» è un'entrata in Cripto, non uno spostamento
  const ENTRA_VERI = ENTRA.filter(p => !RITIRA.includes(p) && p !== 'vendita');
  const COSTO = ['commissione', 'commissioni', 'costo', 'costi', 'canone', 'spese bancarie', 'spese di prelievo'];

  // ---------------------------------------------------------------- i tre conti (15/11/2026)
  // Francesco: «sono tre fonti di dove si ha il denaro»: contanti, digitale (conti e carte) e cripto. Ogni entrata e
  // ogni uscita sta in uno dei tre. Lo spostamento fra due conti (prelievo al bancomat, versamento in banca, cripto
  // comprate o vendute) non è né un'entrata né un'uscita: i soldi restano suoi, cambiano posto. Le cripto si segnano
  // in euro, al valore del momento (sua scelta).
  const CONTI = [
    { id: 'contanti', nome: 'Contanti', icona: '💶' },
    { id: 'digitale', nome: 'Digitale', icona: '💳' },
    { id: 'cripto', nome: 'Cripto', icona: '🪙' }
  ];
  const CONTO_BASE = 'digitale';
  const SPOSTAMENTO = 'Spostamento';
  // [parola, conto, opzioni]. g = generica, cioè il modo di pagare: non resta nella descrizione («pizza 12 in contanti»
  // → «Pizza») e non decide la categoria («spesa 30 col bancomat» è Spesa). l = un posto, non un conto («al bancomat»
  // non dice da dove a dove). p = vale solo dopo una preposizione («con la carta», «sul conto»; non «carta igienica»,
  // «il conto della cena»).
  const PAROLE_CONTO = [
    ['contanti', 'contanti', 'g'], ['contante', 'contanti', 'g'], ['cash', 'contanti', 'g'], ['banconote', 'contanti', 'g'],
    ['banconota', 'contanti', 'g'], ['spiccioli', 'contanti', 'g'], ['monetine', 'contanti', 'g'],
    ['digitale', 'digitale', 'g'], ['carta di credito', 'digitale', 'g'], ['carta di debito', 'digitale', 'g'],
    ['carta', 'digitale', 'gp'], ['bancomat', 'digitale', 'gl'], ['atm', 'digitale', 'gl'], ['pos', 'digitale', 'glp'],
    ['conto corrente', 'digitale', 'g'], ['conto', 'digitale', 'gp'], ['banca', 'digitale', 'g'],
    ['bonifico', 'digitale', ''], ['paypal', 'digitale', ''], ['satispay', 'digitale', ''], ['apple pay', 'digitale', ''],
    ['google pay', 'digitale', ''], ['revolut', 'digitale', ''], ['hype', 'digitale', ''], ['n26', 'digitale', ''],
    ['fineco', 'digitale', ''], ['iban', 'digitale', '']
  ].concat(PAROLE_CRIPTO.map(p => [p, 'cripto', ['cripto', 'crypto', 'criptovaluta', 'criptovalute'].includes(p) ? 'g' : '']));
  // gli spostamenti: prelievo (Digitale → Contanti), versamento (Contanti → Digitale), spostamento detto a parole
  const PRELIEVO = ['prelievo', 'prelievi', 'prelevato', 'prelevati', 'prelevare', 'prelevo', 'preso al bancomat',
    'presi al bancomat', 'ritirato al bancomat', 'ritirati al bancomat'];
  // niente «deposito»: «deposito cauzionale 500» è una spesa per la casa
  const VERSA = ['versato', 'versati', 'versamento', 'versare', 'depositato', 'depositati', 'depositare'];
  const SPOSTA = ['sposto', 'spostato', 'spostati', 'spostata', 'spostare', 'sposta', 'spostamento', 'trasferito',
    'trasferiti', 'trasferisco', 'trasferimento', 'giroconto', 'girato', 'girati'];
  const VENDE = ['venduto', 'venduti', 'vendo', 'vendita', 'prelevato', 'prelevati', 'ritirato', 'ritirati', 'incassato',
    'incassati', 'convertito', 'convertiti', 'cambiato', 'cambiati', 'tolto', 'tolti'];
  const COMPRA = ['comprato', 'comprati', 'compro', 'acquistato', 'acquistati', 'acquisto', 'messo', 'messi', 'caricato',
    'caricati', 'investire', 'investo'];
  // le parole che dicono solo la direzione: per sapere se c'è anche una spesa vera («prelievo 50» no, «pizza 20 in cripto» sì)
  const DIREZIONE = new Set([...PRELIEVO, ...VERSA, ...SPOSTA, ...VENDE, ...COMPRA, ...INVESTIRE_GENERICO].filter(p => !p.includes(' ')));
  const NOME_SPOSTAMENTO = { prelievo: 'Prelievo', versamento: 'Versamento', compra: 'Cripto comprate', vende: 'Cripto vendute', sposta: 'Spostamento' };

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
  // le varianti di una parola si fanno una volta sola: leggere una frase costa un terzo (24/11/2026)
  const memoVarianti = new Map();
  function variantiDi(parola) {
    let v = memoVarianti.get(parola);
    if (!v) {
      if (memoVarianti.size > 6000) memoVarianti.clear();
      v = [...varianti(normalizza(parola))];
      memoVarianti.set(parola, v);
    }
    return v;
  }
  function trova(testoSpaziato, elenco, storte) {
    let migliore = null;
    for (const parola of elenco) {
      for (const v of variantiDi(parola)) {
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
    const m = s.match(/^(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+|\d+(?:[.,]\d{1,2})?)$/);
    if (!m) return null;
    let n;
    if (/^\d{1,3}(?:\.\d{3})+/.test(m[1])) n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    else if (/^\d{1,3}(?:,\d{3})+$/.test(m[1])) n = parseFloat(m[1].replace(/,/g, ''));   // «1,200» scritto all'inglese
    else n = parseFloat(m[1].replace(',', '.'));
    return { valore: n * molt, decimali: /[.,]\d{1,2}$/.test(m[1]) && !/^\d{1,3}(?:,\d{3})+$/.test(m[1]), segno };
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
      if (t === 'domani') { data = spostaGiorni(oggi, 1); usa(i); break; }
      if (t === 'dopodomani') { data = spostaGiorni(oggi, 2); usa(i); break; }
      // «3 giorni fa», «tre giorni fa», «una settimana fa», «due settimane fa»: il numero non è l'importo
      if (t === 'fa' && i >= 2 && /^(giorn[oi]|settiman[ae])$/.test(tok[i - 1].norm)) {
        const q = tok[i - 2], quanti = q.num !== undefined && Number.isInteger(q.num) ? q.num : /^(un|uno|una)$/.test(q.norm) ? 1 : /^\d{1,2}$/.test(q.norm) ? +q.norm : null;
        if (quanti !== null && quanti > 0 && quanti <= 60 && !q.usato) {
          data = spostaGiorni(oggi, -quanti * (tok[i - 1].norm.startsWith('settiman') ? 7 : 1));
          usa(i - 2, i - 1, i);
          delete q.num;
          break;
        }
      }
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
      const meseDopo2 = tok[i + 2] && (MESI.includes(tok[i + 2].norm) || MESI_BREVI.includes(tok[i + 2].norm));
      if (['il', 'giorno'].includes(t) && tok[i + 1] && /^\d{1,2}$/.test(tok[i + 1].norm) && !meseDopo2) {
        const giorno = +tok[i + 1].norm;
        if (giorno >= 1 && giorno <= 31 && restanoImporti(i + 1)) {
          // solo il giorno: se cadrebbe nel futuro è del mese scorso
          data = new Date(oggi.getFullYear(), oggi.getMonth(), giorno);
          // l'ultimo mese che quel giorno ce l'ha: «il 31» detto il 10 dicembre è il 31 ottobre, non il «31 novembre»
          for (let indietro = 1; indietro <= 3 && (data > spostaGiorni(oggi, 1) || data.getDate() !== giorno); indietro++) {
            data = new Date(oggi.getFullYear(), oggi.getMonth() - indietro, giorno);
          }
          usa(i, i + 1);
          break;
        }
      }
    }
    return data;
  }

  // Senza anno: se la data cadrebbe nel futuro è dell'anno scorso; ma se manca al massimo un mese è di quest'anno (24/11/2026:
  // «affitto 500 il 20 dicembre» detto il 10 finiva un anno prima, dove non la si vede più; così l'anteprima dice che è
  // nel futuro). A dicembre vale anche per i primi di gennaio. Il 31 di un mese che non ce l'ha diventa l'ultimo giorno.
  function componi(giorno, mese, anno, oggi) {
    const fai = a => new Date(a, mese, Math.min(giorno, new Date(a, mese + 1, 0).getDate()));
    if (anno !== null) return fai(anno);
    const a = oggi.getFullYear(), limite = spostaGiorni(oggi, 31);
    if (fai(a) <= limite) return fai(a + 1) <= limite ? fai(a + 1) : fai(a);
    return fai(a - 1);
  }

  // ---------------------------------------------------------------- importo
  // Importi detti in due pezzi, che la trascrizione scrive come capita (10/11/2026: «due euro e 90» era diventato 90 €):
  // «due euro e 90», «12 euro e cinquanta centesimi», «12 euro 50», «2 e 90», «dodici e cinquanta euro»,
  // «2 virgola 90», «dodici virgola cinque», «90 centesimi», «mille e duecento». Diventano un numero solo,
  // nel primo pezzo (t.num, con t.decimali se ha i centesimi); gli altri pezzi si segnano come usati.
  const CENTESIMI = /^(centesim|cent$)/;
  const NON_CENTESIMI = new Set(['giorni', 'giorno', 'settimane', 'settimana', 'mesi', 'mese', 'anni', 'anno', 'volte',
    'litri', 'litro', 'km', 'chilometri', 'persone', 'pezzi', 'minuti', 'ore', ...MESI, ...MESI_BREVI]);
  function intero(t) {
    if (!t || t.usato) return null;
    if (t.num !== undefined) return t.decimali || !Number.isInteger(t.num) ? null : t.num;
    return /^\d+$/.test(t.norm) ? +t.norm : null;
  }
  function unisciImporti(tok) {
    const unisci = (t, valore, ...usati) => { t.num = valore; t.decimali = true; usati.forEach(u => { if (u) u.usato = true; }); };
    const cent = k => tok[k] && !tok[k].usato && CENTESIMI.test(tok[k].norm) ? tok[k] : null;
    const inCifre = tok.some(t => !t.usato && t.num === undefined && !!numeroDaToken(t.norm));
    for (let i = 0; i < tok.length; i++) {
      const t = tok[i];
      let n = intero(t);
      const a = tok[i + 1], b = tok[i + 2], c = tok[i + 3];
      if (!a || a.usato) continue;
      // «uno e venti», «uno virgola venti», «un euro e 20»: qui «uno» è un numero (24/11/2026: «caffè uno e venti» era 20 €)
      // (con delle cifre nella frase solo se anche i centesimi sono in cifre: «con uno e venti amici 30» costa 30)
      if (n === null && !t.usato && ((t.norm === 'uno' && (a.norm === 'virgola' || a.norm === 'e') && (!inCifre || (b && b.num === undefined))) || (/^uno?$/.test(t.norm) && VALUTA.has(a.norm)))) n = 1;
      if (n === null) continue;
      if (a.norm === 'virgola') {
        const m = intero(b);
        if (m !== null && m < 100) {
          const unaCifra = b.num !== undefined ? m < 10 : b.norm.length === 1;
          unisci(t, n + (unaCifra ? m / 10 : m / 100), a, b);
        }
      } else if (VALUTA.has(a.norm)) {
        if (b && !b.usato && b.norm === 'e') {
          const m = intero(c);
          if (m !== null && m < 100) unisci(t, n + m / 100, b, c, cent(i + 4));
        } else {
          const m = intero(b);
          const dopo = tok[i + 3] && tok[i + 3].norm;
          if (m !== null && (m >= 10 || cent(i + 3)) && m < 100 && !(dopo && (VALUTA.has(dopo) || NON_CENTESIMI.has(dopo)))) unisci(t, n + m / 100, b, cent(i + 3));
        }
      } else if (a.norm === 'e') {
        const m = intero(b);
        if (m === null) continue;
        const c3 = cent(i + 3);
        const dopo = c && c.norm;
        if (n >= 1000 && n % 1000 === 0 && m < 1000 && !c3) { t.num = n + m; a.usato = b.usato = true; }
        else if (m < 100 && (m >= 10 || c3) && !(dopo && NON_CENTESIMI.has(dopo))) unisci(t, n + m / 100, a, b, c3);
      } else if (CENTESIMI.test(a.norm) && n < 100) {
        unisci(t, n / 100, a);
      }
    }
  }

  function leggiImporto(tok) {
    unisciImporti(tok);
    const candidati = [];
    tok.forEach((t, i) => {
      if (t.usato) return;
      let num = t.num !== undefined ? { valore: t.num, decimali: !!t.decimali, segno: 1 } : numeroDaToken(t.norm);
      // «un euro e 20»: «un» vale 1 solo se subito dopo c'è la valuta
      if (!num && (t.norm === 'un' || t.norm === 'uno') && tok[i + 1] && VALUTA.has(tok[i + 1].norm)) num = { valore: 1, decimali: false, segno: 1 };
      if (!num) return;
      const prima = tok[i - 1], dopo = tok[i + 1];
      const conValuta = !!((dopo && VALUTA.has(dopo.norm)) || (prima && prima.norm === '€'));
      const anno = /^(19|20)\d{2}$/.test(t.norm);
      candidati.push({ i, num, conValuta, anno, aParole: !/\d/.test(t.norm) && t.norm !== 'un' && t.norm !== 'uno' });
    });
    if (!candidati.length) return null;
    // con delle cifre nella frase, un numero a parole è l'importo solo se ha accanto «euro» o i centesimi:
    // «pizza con due amici 30» costa 30, «due euro e 90» costa 2,90
    let validi = candidati;
    if (candidati.some(c => !c.aParole)) validi = candidati.filter(c => !c.aParole || c.conValuta || c.num.decimali);
    const nonAnni = validi.filter(c => !c.anno);
    const pool = nonAnni.length ? nonAnni : validi;
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
    // gli altri importi della frase che nessuno ha preso: con «euro» accanto o coi centesimi (24/11/2026)
    const avanzati = validi.filter(c => c !== scelto && !tok[c.i].usato && !c.anno && (c.conValuta || c.num.decimali)).map(c => Math.round(c.num.valore * 100)).filter(v => v > 0);
    return { avanzati, centesimi: Math.round(valore * 100), forte: !scelto.aParole || scelto.conValuta || !!scelto.num.decimali, segno: scelto.num.segno, esplicito: tok[i].orig.trim()[0] === '+' ? 1 : (scelto.num.segno < 0 ? -1 : 0) };
  }

  // ---------------------------------------------------------------- categorie personali
  // personali = { uscita: [{ nome, icona, base, nascosta, eliminata }], ... } nell'ordine scelto da Francesco.
  // «base» è la categoria di partenza da cui prende le parole chiave (null per quelle nuove).
  // «eliminata» tiene il posto di una categoria di partenza tolta, così non ricompare.
  // Le categorie di partenza che mancano dall'elenco personale (aggiunte in versioni nuove) si infilano
  // subito dopo quella che le precede nell'elenco di partenza: «Benessere» dopo «Vestiti», ecc.
  // L'elenco lo chiede ogni riga che si disegna (con un anno di movimenti 1500 volte a disegno, misurato l'11/11/2026):
  // lo si tiene finché le categorie personali non cambiano, riconoscendole da una firma di nomi, simboli e stati.
  // Chi lo usa non modifica gli oggetti dell'elenco: al più lo filtra (e riceve una copia dell'elenco).
  const memoElenco = new Map();
  function firmaPersonali(mie) {
    if (!mie) return '-';
    let s = '';
    for (const p of mie) s += p.nome + '\u0001' + (p.icona || '') + '\u0001' + (p.base || '') + '\u0001' + (p.nascosta ? 1 : 0) + (p.eliminata ? 1 : 0) + '\u0002';
    return s;
  }
  function elenco(tipo, personali) {
    const mie = personali && Array.isArray(personali[tipo]) ? personali[tipo] : null;
    const k = tipo + '\u0003' + firmaPersonali(mie);
    let r = memoElenco.get(k);
    if (!r) {
      if (memoElenco.size > 40) memoElenco.clear();
      r = elencoNuovo(tipo, personali);
      memoElenco.set(k, r);
    }
    return r.slice();
  }
  function elencoNuovo(tipo, personali) {
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

  // «ogni mese», «al mese», «mensile», «tutti i mesi»: il movimento si ripete ogni mese.
  // Dal 10/11/2026 anche il giorno: «ogni 18 del mese», «il 5 di ogni mese», «ogni mese il 18», «tutti i 18»,
  // «il primo di ogni mese». Restituisce { ripeti, giorno } (giorno null se non l'ha detto).
  function giornoDi(t) {
    if (!t || t.usato) return null;
    const v = t.norm === 'primo' ? 1 : intero(t);
    return v !== null && v >= 1 && v <= 31 ? v : null;
  }
  function leggiRipeti(tok) {
    const n = k => tok[k] && !tok[k].usato ? tok[k].norm : null;
    const usa = (...idx) => idx.forEach(k => { if (tok[k]) tok[k].usato = true; });
    // dopo il giorno: «del mese», «di ogni mese», «di tutti i mesi», «di ogni»
    const coda = k => {
      if (n(k) === 'del' && n(k + 1) === 'mese') return [k, k + 1];
      if (n(k) === 'di' && n(k + 1) === 'ogni' && n(k + 2) === 'mese') return [k, k + 1, k + 2];
      if (n(k) === 'di' && n(k + 1) === 'tutti' && n(k + 2) === 'i' && n(k + 3) === 'mesi') return [k, k + 1, k + 2, k + 3];
      return null;
    };
    const vietatoDopo = k => { const d = n(k); return !!d && (VALUTA.has(d) || NON_CENTESIMI.has(d)); };
    for (let i = 0; i < tok.length; i++) {
      const a = n(i);
      if (!a) continue;
      // «ogni 18 (del mese)», «tutti i 18 (del mese)»
      const g1 = a === 'ogni' ? giornoDi(tok[i + 1]) : (a === 'tutti' && n(i + 1) === 'i' ? giornoDi(tok[i + 2]) : null);
      if (g1 !== null) {
        const k = a === 'ogni' ? i + 1 : i + 2;
        const c = coda(k + 1);
        if (c || !vietatoDopo(k + 1)) { usa(...range(i, k), ...(c || [])); return { ripeti: true, giorno: g1 }; }
      }
      // «il 5 di ogni mese», «il 18 del mese», «al 18 di ogni mese»
      const g2 = a === 'il' || a === 'al' ? giornoDi(tok[i + 1]) : null;
      if (g2 !== null) {
        const c = coda(i + 2);
        if (c) { usa(i, i + 1, ...c); return { ripeti: true, giorno: g2 }; }
      }
    }
    for (let i = 0; i < tok.length; i++) {
      const a = n(i), b = n(i + 1), c = n(i + 2);
      if (!a) continue;
      let preso = null;
      if ((a === 'ogni' || a === 'al') && b === 'mese') preso = [i, i + 1];
      else if (a === 'tutti' && b === 'i' && c === 'mesi') preso = [i, i + 1, i + 2];
      else if (a === 'mensile' || a === 'mensili' || a === 'mensilmente') preso = [i];
      if (!preso) continue;
      usa(...preso);
      // «ogni mese il 18»: il giorno subito dopo
      const k = preso[preso.length - 1] + 1;
      if ((n(k) === 'il' || n(k) === 'al') && giornoDi(tok[k + 1]) !== null && !vietatoDopo(k + 2)) {
        const g = giornoDi(tok[k + 1]);
        usa(k, k + 1);
        return { ripeti: true, giorno: g };
      }
      return { ripeti: true, giorno: null };
    }
    return { ripeti: false, giorno: null };
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, j) => a + j);

  function paroleSignificative(descrizione) {
    return normalizza(descrizione).replace(/[^a-z0-9&' ]/g, ' ').split(/\s+/)
      .filter(p => p.length >= 3 && !VUOTE.has(p) && !/^\d+$/.test(p));
  }

  function esiste(tipo, nome, personali) { return elenco(tipo, personali).some(c => c.nome === nome && !c.nascosta); }

  // ---------------------------------------------------------------- conti nominati nella frase (15/11/2026)
  const PREP_DA = new Set(['da', 'dal', 'dalla', 'dallo', 'dai', 'dalle', 'dagli', 'dall\'']);
  const PREP_A = new Set(['a', 'al', 'alla', 'allo', 'ai', 'alle', 'agli', 'all\'', 'su', 'sul', 'sulla', 'sullo', 'sui',
    'sulle', 'sull\'', 'in', 'nel', 'nella', 'nello', 'nei', 'nelle', 'nell\'', 'verso']);
  const PREP_CON = new Set(['con', 'col', 'coi', 'tramite', 'via']);
  const ARTICOLI = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'l\'', 'mio', 'mia', 'miei', 'mie']);
  const FRASI_CONTO = PAROLE_CONTO.map(([p, conto, o]) => ({ parole: normalizza(p).split(' '), conto,
    generica: o.includes('g'), luogo: o.includes('l'), conPrep: o.includes('p') })).sort((a, b) => b.parole.length - a.parole.length);
  const pulita = t => t.norm.replace(/[^a-z0-9&']/g, '');

  // Dove la frase nomina un conto: [{ conto, i, n (parole), ruolo: 'da' | 'a' | 'con' | null, prep (indice della
  // preposizione, -1 se non c'è), generica, luogo }]. «da» e «a» servono a capire la direzione di uno spostamento.
  function menzioniConti(tok) {
    const out = [];
    for (let i = 0; i < tok.length; i++) {
      for (const f of FRASI_CONTO) {
        const n = f.parole.length;
        let ok = true;
        for (let k = 0; k < n && ok; k++) {
          const t = tok[i + k];
          ok = !!t && (n === 1 ? varianti(f.parole[0]).includes(pulita(t)) : pulita(t) === f.parole[k]);
        }
        if (!ok) continue;
        if (f.parole[0] === 'cash' && tok[i + 1] && pulita(tok[i + 1]) === 'collect') continue;   // un certificato, non i contanti
        // la preposizione davanti, saltando l'articolo: «con la carta», «dal mio conto», «in contanti»
        let j = i - 1;
        if (j >= 0 && ARTICOLI.has(tok[j].norm)) j--;
        const prep = j >= 0 ? tok[j].norm : null;
        const ruolo = PREP_DA.has(prep) ? 'da' : PREP_A.has(prep) ? 'a' : PREP_CON.has(prep) ? 'con' : null;
        if (f.conPrep && !ruolo) continue;
        out.push({ conto: f.conto, i, n, ruolo, prep: ruolo ? j : -1, generica: f.generica, luogo: f.luogo });
        i += n - 1;
        break;
      }
    }
    return out;
  }

  // Da quale conto a quale: prima quello che la frase dice con «da» e «a/su/in», poi i conti nominati senza
  // preposizione, poi quello che ci si aspetta da come è detto (predef: il prelievo va da Digitale a Contanti).
  function direzione(menz, predef) {
    let da = null, verso = null;
    const utili = menz.filter(m => !m.luogo);
    for (const m of utili) {
      if (m.ruolo === 'da' && !da) da = m.conto;
      else if (m.ruolo === 'a' && !verso && m.conto !== da) verso = m.conto;
    }
    for (const m of utili) {
      if (m.ruolo === 'da' || m.ruolo === 'a' || m.conto === da || m.conto === verso) continue;
      if (!da && m.conto === predef.da) da = m.conto;
      else if (!verso) verso = m.conto;
      else if (!da) da = m.conto;
    }
    const altro = c => (c === CONTO_BASE ? 'contanti' : CONTO_BASE);
    if (!da) da = predef.da !== verso ? predef.da : altro(verso);
    if (!verso) verso = predef.verso !== da ? predef.verso : altro(da);
    if (da === verso) verso = altro(da);
    return { da, verso };
  }

  /**
   * analizza(testo, { oggi: Date, adesso: Date, imparate: {parola: {tipo, categoria}}, categorie, tipo, conto, imparatiConti })
   * tipo forza il tipo (quando lo sceglie Francesco dal bottone). adesso (con l'ora) serve al «bar».
   * conto = il conto che sta guardando (vale se la frase non ne nomina uno), imparatiConti = {parola: conto}.
   * Restituisce anche conto e, per gli spostamenti (tipo «spostamento»), verso: da conto a verso.
   */
  function analizza(testo, opz) {
    opz = opz || {};
    const adesso = opz.adesso || opz.oggi || new Date();
    const oggi = aMezzanotte(opz.oggi || adesso);
    const tok = tokenizza(testo);
    const risultato = { tipo: 'uscita', importo: null, categoria: null, data: isoDa(oggi), descrizione: '', ripeti: false,
      giornoMese: null, conto: opz.conto || CONTO_BASE, verso: null, contoDa: opz.conto ? 'vista' : 'base',
      certo: { tipo: false, categoria: false, importo: false, data: false, conto: false } };
    if (!tok.length) return risultato;

    // numeri a parole («due», «novanta»): sempre, anche accanto alle cifre («due euro e 90»). Quale sia
    // l'importo lo decide leggiImporto: con delle cifre nella frase, una parola vale solo se ha accanto «euro».
    tok.forEach(t => { const n = numeroDaParola(t.norm); if (n !== null) t.num = n; });
    const contaNumeriLiberi = escluso => tok.filter((t, i) => !t.usato && i !== escluso &&
      (t.num !== undefined || numeroDaToken(t.norm))).length > 0;

    // prima le ricorrenti, così il «18» di «ogni 18 del mese» non diventa né una data né l'importo
    const rip = leggiRipeti(tok);
    risultato.ripeti = rip.ripeti;
    risultato.giornoMese = rip.giorno;
    const data = leggiData(tok, oggi, contaNumeriLiberi);
    if (data) { risultato.data = isoDa(data); risultato.certo.data = true; }
    if (risultato.ripeti && !risultato.giornoMese && data) risultato.giornoMese = data.getDate();

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
    if (imp) { risultato.importo = imp.centesimi; risultato.certo.importo = imp.centesimi > 0; risultato.importoForte = imp.forte; risultato.avanzati = imp.avanzati; }

    const spaziato = ' ' + tok.map(pulita).join(' ') + ' ';
    const primo = tok[0].orig.trim();

    // ---- i conti (15/11/2026): quale conto nomina la frase, e se è uno spostamento fra due conti
    const menz = menzioniConti(tok);
    const delConto = new Set(), generiche = new Set();
    for (const m of menz) {
      for (let k = m.i; k < m.i + m.n; k++) { delConto.add(k); if (m.generica) generiche.add(k); }
      // il modo di pagare non resta nella descrizione, con la sua preposizione: «pizza 12 in contanti» → «Pizza»
      if (m.generica) for (let k = m.prep >= 0 ? m.prep : m.i; k < m.i + m.n; k++) tok[k].usato = true;
    }
    // per la categoria, senza il modo di pagare («spesa 30 col bancomat» è Spesa, non Banca)
    const spaziatoCat = ' ' + tok.filter((t, i) => !generiche.has(i)).map(pulita).join(' ') + ' ';
    // c'è anche una spesa o un'entrata vera, oltre al conto e alla direzione? («prelievo 50» no, «pizza 20 in cripto» sì)
    const spaziatoAltro = ' ' + tok.filter((t, i) => !delConto.has(i) && !DIREZIONE.has(pulita(t))).map(pulita).join(' ') + ' ';
    const altraCat = categoriaPer('uscita', spaziatoAltro, opz.categorie) || categoriaPer('entrata', spaziatoAltro, opz.categorie);
    const segnoEsplicito = primo.startsWith('+') || primo.startsWith('-') || primo.startsWith('−') || !!(imp && imp.esplicito);
    const cripto = menz.some(m => m.conto === 'cripto') && !trova(spaziato, ['etoro']);
    const entraDavvero = trova(spaziato, ENTRA_VERI) || trova(spaziato, RENDITA);
    const prodotto = trova(spaziato, PRODOTTI_INVESTIMENTO);
    const generico = { da: opz.conto || CONTO_BASE, verso: (opz.conto || CONTO_BASE) === CONTO_BASE ? 'contanti' : CONTO_BASE };
    let sposta = null, genere = 'sposta';
    if (opz.tipo === 'spostamento') {
      if (trova(spaziato, PRELIEVO)) genere = 'prelievo';
      else if (trova(spaziato, VERSA)) genere = 'versamento';
      sposta = direzione(menz, genere === 'prelievo' ? (cripto ? { da: 'cripto', verso: CONTO_BASE } : { da: CONTO_BASE, verso: 'contanti' })
        : genere === 'versamento' ? (cripto ? { da: CONTO_BASE, verso: 'cripto' } : { da: 'contanti', verso: CONTO_BASE }) : generico);
    } else if (!opz.tipo && !segnoEsplicito && !trova(spaziato, COSTO) && !prodotto) {
      const soloConti = !altraCat && !entraDavvero;
      const due = menz.filter(m => !m.luogo);
      let predef = null;
      if (trova(spaziato, PRELIEVO)) { genere = 'prelievo'; predef = cripto ? { da: 'cripto', verso: CONTO_BASE } : { da: CONTO_BASE, verso: 'contanti' }; }
      else if (trova(spaziato, VERSA)) { genere = 'versamento'; predef = cripto ? { da: CONTO_BASE, verso: 'cripto' } : { da: 'contanti', verso: CONTO_BASE }; }
      else if (trova(spaziato, SPOSTA)) predef = generico;
      else if (soloConti && cripto) {
        genere = trova(spaziato, VENDE) ? 'vende' : 'compra';
        predef = genere === 'vende' ? { da: 'cripto', verso: CONTO_BASE } : { da: CONTO_BASE, verso: 'cripto' };
      } else if (soloConti && trova(spaziato, ['bancomat', 'atm']) && !trova(spaziato, ESCE)) {
        genere = 'prelievo'; predef = { da: CONTO_BASE, verso: 'contanti' };   // «bancomat 100»: preso al bancomat
      } else if (soloConti && new Set(due.map(m => m.conto)).size >= 2) predef = generico;   // «100 contanti in banca»
      if (predef) sposta = direzione(menz, predef);
    }

    // tipo. Gli investimenti sono uscite in «Investimenti»; venduti, ritirati, dividendi sono entrate in «Ritirato dagli investimenti».
    // Le cripto senza nient'altro (non spostamenti: «+100 bitcoin», «staking 5») si leggono come prima, da investimenti.
    let tipo = 'uscita', certo = false, forzata = null;
    const investe = trova(spaziato, INVESTE) || (cripto && !altraCat && !trova(spaziato, ENTRA_VERI) ? 'cripto' : null);
    if (investe) forzata = trova(spaziato, RENDITA) || trova(spaziato, RITIRA) ? RITIRATO : INVESTIMENTI;
    if (sposta) { tipo = 'spostamento'; certo = true; }
    else if (opz.tipo) { tipo = opz.tipo; certo = true; }
    else if (primo.startsWith('+') || (imp && imp.esplicito === 1)) { tipo = 'entrata'; certo = true; }
    else if (primo.startsWith('-') || primo.startsWith('−') || (imp && imp.esplicito === -1)) { tipo = 'uscita'; certo = true; }
    else if (investe) { certo = true; tipo = forzata === RITIRATO ? 'entrata' : 'uscita'; }
    else if (trova(spaziato, ENTRA) || trova(spaziato, ['provvigione', 'provvigioni', 'stipendio'], true)) {
      // «commissione bonifico 1», «commissione binance 2»: una spesa della banca o dell'exchange, non una provvigione
      const soloCommissione = !trova(spaziato, ENTRA.filter(p => !p.startsWith('commission')));
      if (soloCommissione && (trova(spaziato, BANCA) || cripto)) { tipo = 'uscita'; }
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

    if (sposta) {
      // senza i verbi della direzione davanti: «messo 200 su binance» → «Binance», «comprato bitcoin» → «Bitcoin»;
      // se non resta niente, il nome dello spostamento («prelievo 50» → «Prelievo», «sposto 100 su cripto» → «Spostamento»)
      const via = t => DIREZIONE.has(pulita(t)) || RIEMPITIVI.has(t.norm) || PREP_DA.has(t.norm) || PREP_A.has(t.norm) || PREP_CON.has(t.norm) || ARTICOLI.has(t.norm);
      while (resto.length && via(resto[0])) resto.shift();
      descrizione = resto.map(t => t.orig).join(' ').replace(/\s+'/g, '\'').replace(/'\s+/g, '\'').replace(/\s+([,.])/g, '$1').trim();
      descrizione = descrizione ? descrizione[0].toUpperCase() + descrizione.slice(1) : NOME_SPOSTAMENTO[genere];
      risultato.tipo = 'spostamento';
      risultato.categoria = SPOSTAMENTO;
      risultato.descrizione = descrizione;
      risultato.conto = risultato.da = sposta.da;
      risultato.verso = sposta.verso;
      risultato.contoDa = 'frase';
      Object.assign(risultato.certo, { tipo: true, categoria: true, conto: true });
      return risultato;
    }

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
      const c = categoriaPer(tipo, spaziatoCat, opz.categorie);
      if (c) {
        categoria = c.nome; catCerta = true;
        if (c.base === 'Svago' && c.parola === 'bar' && barDiGiorno(spaziato, risultato.data, adesso)) {
          const cibo = perBase('uscita', 'Cibo', opz.categorie);
          if (cibo) categoria = cibo;
        }
      }
    }
    // «commissione bancomat 1»: tolto il modo di pagare non resta niente, ma è una spesa della banca
    if (!categoria && tipo === 'uscita' && menz.length && trova(spaziato, COSTO)) {
      const c = perBase('uscita', 'Banca e commissioni', opz.categorie);
      if (c) { categoria = c; catCerta = true; }
    }
    if (!categoria) categoria = ripiego(tipo, opz.categorie);

    risultato.tipo = tipo;
    risultato.categoria = categoria;
    risultato.descrizione = descrizione || categoria;
    risultato.certo.tipo = certo;
    risultato.certo.categoria = catCerta;
    // il conto: quello detto nella frase, poi quello che sta guardando, poi quello imparato dalle correzioni, poi Digitale
    const imparatiConti = opz.imparatiConti || {};
    const dalleParole = paroleSignificative(descrizione).map(p => imparatiConti[p]).find(c => CONTI.some(x => x.id === c));
    if (menz.length) { risultato.conto = menz[0].conto; risultato.contoDa = 'frase'; }
    else if (opz.conto) { risultato.conto = opz.conto; risultato.contoDa = 'vista'; }
    else if (dalleParole) { risultato.conto = dalleParole; risultato.contoDa = 'imparato'; }
    else { risultato.conto = CONTO_BASE; risultato.contoDa = 'base'; }
    risultato.verso = null;
    risultato.certo.conto = risultato.contoDa === 'frase';
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
  // «…e 20 per la pizza», «…e 2,50 di pane», «…e 30 euro al bar»: comincia con un importo intero e dopo c'è per cosa. Non è
  // «…e 50» (i centesimi) né «…e 3 birre 40» (quante, non quanto).
  const PER_COSA = new Set(['per', 'di', 'del', 'della', 'dello', 'dei', 'delle', 'degli', 'dell\'', 'da', 'dal', 'dalla', 'in', 'nel', 'nella', 'al', 'alla', 'allo',
    'ai', 'alle', 'a', 'all\'', 'su', 'sul', 'sulla', 'dall\'', 'nell\'', 'sull\'', 'agli', 'x']);
  function importoPerCosa(pezzo, opz, dopoParola) {
    const tok = tokenizza(pezzo);
    tok.forEach(t => { const n = numeroDaParola(t.norm); if (n !== null) t.num = n; });
    const numero = t => t && (t.num !== undefined || !!numeroDaToken(t.norm) || /^uno?$/.test(t.norm));
    if (!numero(tok[0]) && !(tok[0] && tok[0].norm === '€' && numero(tok[1]))) return false;
    let i = 0;
    while (i < tok.length && (numero(tok[i]) || VALUTA.has(tok[i].norm) || tok[i].norm === 'e' || tok[i].norm === 'virgola' || CENTESIMI.test(tok[i].norm))) i++;
    if (i >= tok.length) return false;
    const solo = analizza(tok.slice(0, i).map(t => t.orig).join(' '), opz);
    if (!(solo.importo > 0) || analizza(pezzo, opz).importo !== solo.importo) return false;
    if (PER_COSA.has(tok[i].norm)) return i + 1 < tok.length;
    return dopoParola && cosaNota(tok[i].norm, opz) && quantoNonQuante(solo.importo, tok[i].norm, tok.slice(0, i));
  }
  // «45 benzina e 12 farmacia» (24/11/2026: i 12 si perdevano in silenzio): dopo il numero, senza «di» né «per», c'è una
  // parola che conosce. «12 farmacia» è quanto (una parola al singolare non si conta), «3 birre» e «3 spritz» sono quante.
  const note = new WeakMap();   // per ogni elenco di categorie, le parole che conosce (si fa una volta sola)
  function paroleNote(lista) {
    let s = note.get(lista);
    if (!s) {
      s = new Set();
      for (const c of lista) { s.add(normalizza(c.nome)); for (const p of c.parole) for (const x of varianti(normalizza(p))) s.add(x); }
      note.set(lista, s);
    }
    return s;
  }
  const cosaNota = (parola, opz) => ['uscita', 'entrata'].some(tipo => paroleNote(elenco(tipo, (opz || {}).categorie)).has(parola));
  const SOLO_SPESE = new Set(['tabacchi', 'vestiti', 'detersivi', 'integratori', 'alimentari', 'trasporti', 'abbonamenti']);
  function quantoNonQuante(centesimi, parola, numeri) {
    if (centesimi % 100 || numeri.some(t => VALUTA.has(t.norm) || t.norm === '€' || /€/.test(t.orig))) return true;   // «12,50 farmacia», «12 euro farmacia»
    const n = centesimi / 100;
    if (/[ao]$/.test(parola)) return n > 1;
    if (/[ie]$/.test(parola)) return n >= 5 && SOLO_SPESE.has(parola);
    return n >= 10;   // «30 conad» è quanto, «3 spritz» quante
  }
  // l'ultima parola di un pezzo è un numero o «euro»? Allora «e 50» dopo può essere dei centesimi
  function finisceConNumero(pezzo) {
    const tok = tokenizza(pezzo), u = tok[tok.length - 1];
    return !!u && (VALUTA.has(u.norm) || numeroDaParola(u.norm) !== null || !!numeroDaToken(u.norm) || CENTESIMI.test(u.norm) || /^uno?$/.test(u.norm));
  }
  // «1,20 e 2 di mancia», «30 euro e 2,50 di pane»: i centesimi ci sono già da una parte, quindi sono due importi
  const nonCentesimi = (sx, dx, opz) => analizza(sx, opz).importo % 100 !== 0 ||
    (!/^\s*\S+\s+cent/i.test(dx) && (analizza(dx, opz).importo % 100 !== 0 || analizza(dx, opz).importo >= 10000));
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
      // «due pizze e una birra 20» è uno: con delle cifre nella frase, un pezzo fa un movimento a sé solo se il suo
      // importo è «forte» (in cifre, con «euro» accanto o coi centesimi: «dodici e cinquanta pizza e birra 5» sono due)
      const conCifre = /\d/.test(u);
      const pieno = s => { const r = analizza(s, opz); return r.importo > 0 && (!conCifre || r.importoForte); };
      let resto = u;
      for (;;) {
        const re = /\s+e\s+/gi;
        let m, diviso = false;
        while ((m = re.exec(resto))) {
          const sx = resto.slice(0, m.index), dx = resto.slice(m.index + m[0].length);
          if (pieno(sx) && pieno(dx) && (!iniziaConNumero(dx) || ((!finisceConNumero(sx) || nonCentesimi(sx, dx, opz)) && importoPerCosa(dx, opz, !finisceConNumero(sx))))) { finali.push(sx.trim()); resto = dx; diviso = true; break; }
        }
        if (!diviso) break;
      }
      finali.push(resto.trim());
    }
    return finali.slice(0, 60);   // prima 12: gli altri sparivano in silenzio
  }

  // «45 benzina e 12 mancia»: la parola non la conosce, quindi non divide, ma i 12 rimasti fuori li dice
  function forseFuori(testo, opz) {
    const re = /\s+e\s+/gi;
    let m;
    while ((m = re.exec(testo))) {
      const sx = testo.slice(0, m.index), tok = tokenizza(testo.slice(m.index + m[0].length));
      if (tok.length < 2 || !/^\d+$/.test(tok[0].norm) || !/^[a-z]{3,}[ao]$/.test(tok[1].norm) || PER_COSA.has(tok[1].norm) || VALUTA.has(tok[1].norm) || MESI.includes(tok[1].norm) || GIORNI.includes(tok[1].norm) || NON_CENTESIMI.has(tok[1].norm)) continue;
      const n = Number(tok[0].norm);
      if (n > 1 && n < 10000 && !finisceConNumero(sx) && haImporto(sx, opz) && analizza(testo, opz).importo !== n * 100) return n * 100;
    }
    return null;
  }

  // Come analizza, ma restituisce un elenco: uno per movimento. Chi non ha una data sua prende
  // la prima data detta nella frase («ieri pizza 12, benzina 50»: tutte e due ieri).
  function analizzaFrasi(testo, opz) {
    opz = opz || {};
    if (!String(testo).trim()) return [];
    const risultati = dividi(testo, opz).map(p => {
      const r = Object.assign(analizza(p, opz), { testo: p });
      const fuori = forseFuori(p, opz);
      if (fuori && !(r.avanzati || []).includes(fuori)) r.avanzati = (r.avanzati || []).concat(fuori);
      return r;
    });
    const conData = risultati.find(r => r.certo.data);
    if (conData) for (const r of risultati) if (!r.certo.data) r.data = conData.data;
    return risultati;
  }

  globale.Analizza = { analizza, analizzaFrasi, dividi, CATEGORIE, RIPIEGO, RINOMINATE, ICONE_CAMBIATE, INVESTIMENTI, RITIRATO,
    CONTI, CONTO_BASE, SPOSTAMENTO, elenco, ripiego, perBase, paroleSignificative, icona, isoDa, normalizza, numeroDaParola };
})(typeof window !== 'undefined' ? window : globalThis);
