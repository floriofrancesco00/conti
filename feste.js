/* Che Conti Devastanti — le feste a tema (18/11/2026).
   Francesco: «quando c'è un giorno di festa voglio che ci sia qualcosa a tema». Nei giorni di festa: un saluto sotto la
   data, i colori del titolo, una pioggia di simboli all'apertura, le monete delle entrate a tema e, dove c'è, il suono
   della festa al posto della sigla. Solo feste italiane e di tutti: niente di personale qui (il codice è pubblico); il
   compleanno lo scrive lui nel menù e resta sul telefono.
   Pasqua col calcolo di Gauss (calendario gregoriano); Carnevale dal giovedì al martedì grasso; festa della mamma la
   seconda domenica di maggio. */
(function () {
  'use strict';
  function pasqua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mese - 1, giorno);
  }
  const giorni = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const stesso = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const fisso = (mese, giorno) => d => d.getMonth() === mese - 1 && d.getDate() === giorno;
  // la seconda domenica di maggio
  const mamma = d => { if (d.getMonth() !== 4 || d.getDay() !== 0) return false; return d.getDate() > 7 && d.getDate() <= 14; };
  const NATALE = { simboli: ['❄️', '🎁', '⭐', '🎄', '❄️'], colori: ['#ff3b3b', '#ffd34d', '#3ddc84', '#ff3b3b'], suono: 'festa-natale', moneta: '🎁' };
  const TRICOLORE = { simboli: ['🇮🇹'], colori: ['#2ecc71', '#ffffff', '#ff4b4b'], moneta: '🇮🇹' };
  // id, nome (per il menù), saluto (sotto la data), quando (vero nel giorno), simboli, colori del titolo, suono, moneta
  const FESTE = [
    Object.assign({ id: 'capodanno', nome: 'Capodanno', saluto: '🎆 Buon anno!', quando: fisso(1, 1),
      simboli: ['🎆', '🎇', '✨', '🥂'], colori: ['#ffd34d', '#ffffff', '#ffb347', '#ffd34d'], suono: 'festa-capodanno', moneta: '🥂' }),
    { id: 'befana', nome: 'Epifania', saluto: '🧹 Buona Befana!', quando: fisso(1, 6),
      simboli: ['🍬', '🧦', '⭐', '🍭'], colori: ['#ff9de2', '#ffd34d', '#8fd3ff'], moneta: '🍬' },
    { id: 'sanvalentino', nome: 'San Valentino', saluto: '💘 Buon San Valentino', quando: fisso(2, 14),
      simboli: ['❤️', '💕', '🌹', '💘'], colori: ['#ff6b9d', '#ff2f5b', '#ffb3c7'], moneta: '💕' },
    { id: 'carnevale', nome: 'Carnevale', saluto: '🎭 Buon Carnevale!', quando: d => { const p = pasqua(d.getFullYear()); return d >= giorni(p, -52) && d <= giorni(p, -47); },
      simboli: ['🎭', '🎉', '🎊', '🟡', '🔴', '🟢', '🔵'], colori: ['#ffd34d', '#ff4bd8', '#4bd8ff', '#7dff4b'], suono: 'festa-trombetta', moneta: '🎊' },
    { id: 'papa', nome: 'Festa del papà', saluto: '💙 Auguri a tutti i papà', quando: fisso(3, 19),
      simboli: ['💙', '⭐', '👔'], colori: ['#5aa9ff', '#ffffff', '#5aa9ff'], moneta: '💙' },
    { id: 'pasqua', nome: 'Pasqua', saluto: '🐣 Buona Pasqua!', quando: d => stesso(d, pasqua(d.getFullYear())),
      simboli: ['🥚', '🐣', '🌷', '🐰', '🌸'], colori: ['#ffe08a', '#b8f2c9', '#f7b8ff', '#ffe08a'], suono: 'festa-pasqua', moneta: '🥚' },
    { id: 'pasquetta', nome: 'Pasquetta', saluto: '🧺 Buona Pasquetta!', quando: d => stesso(d, giorni(pasqua(d.getFullYear()), 1)),
      simboli: ['🧺', '🌼', '🌿', '🥪'], colori: ['#b8f2c9', '#ffe08a', '#7bdc8b'], moneta: '🌼' },
    Object.assign({ id: 'liberazione', nome: 'Festa della Liberazione', saluto: '🇮🇹 Festa della Liberazione', quando: fisso(4, 25) }, TRICOLORE),
    { id: 'lavoro', nome: 'Primo maggio', saluto: '🌹 Buon Primo Maggio', quando: fisso(5, 1),
      simboli: ['🌹', '☀️', '🌼'], colori: ['#ff4b4b', '#ffd34d', '#ff4b4b'], moneta: '🌹' },
    { id: 'mamma', nome: 'Festa della mamma', saluto: '💐 Auguri a tutte le mamme', quando: mamma,
      simboli: ['💐', '🌸', '💗'], colori: ['#ffb3d9', '#ff6bb5', '#ffd1e8'], moneta: '🌸' },
    Object.assign({ id: 'repubblica', nome: 'Festa della Repubblica', saluto: '🇮🇹 Festa della Repubblica', quando: fisso(6, 2) }, TRICOLORE),
    { id: 'ferragosto', nome: 'Ferragosto', saluto: '☀️ Buon Ferragosto!', quando: fisso(8, 15),
      simboli: ['☀️', '🏖️', '🍉', '🍦', '🌊'], colori: ['#ffd34d', '#ff9a3c', '#4bc8ff'], moneta: '🍉' },
    { id: 'halloween', nome: 'Halloween', saluto: '🎃 Dolcetto o scherzetto?', quando: fisso(10, 31),
      simboli: ['🎃', '🦇', '👻', '🕸️', '🍬'], colori: ['#ff8c1a', '#b14bff', '#ff8c1a'], suono: 'festa-halloween', moneta: '🍬' },
    { id: 'santi', nome: 'Tutti i Santi', saluto: '🕯️ Tutti i Santi', quando: fisso(11, 1),
      simboli: ['🍂', '🍁', '🕯️'], colori: ['#ffb347', '#ff7a3c', '#ffd34d'], moneta: '🍂' },
    Object.assign({ id: 'immacolata', nome: 'Immacolata', saluto: '🎄 Oggi si fa l\'albero!', quando: fisso(12, 8) }, NATALE, { moneta: '❄️' }),
    Object.assign({ id: 'vigilia', nome: 'Vigilia di Natale', saluto: '🎅 Vigilia di Natale', quando: fisso(12, 24) }, NATALE),
    Object.assign({ id: 'natale', nome: 'Natale', saluto: '🎄 Buon Natale!', quando: fisso(12, 25) }, NATALE, { simboli: ['❄️', '🎁', '⭐', '🎄', '🎅'] }),
    Object.assign({ id: 'stefano', nome: 'Santo Stefano', saluto: '🎁 Buon Santo Stefano', quando: fisso(12, 26) }, NATALE),
    { id: 'silvestro', nome: 'San Silvestro', saluto: '🍾 Ultima sera dell\'anno', quando: fisso(12, 31),
      simboli: ['🍾', '🎉', '✨', '🎆'], colori: ['#ffd34d', '#ffffff', '#ffb347', '#ffd34d'], suono: 'festa-capodanno', moneta: '🍾' }
  ];
  const COMPLEANNO = { id: 'compleanno', nome: 'Il tuo compleanno', saluto: '🎂 Buon compleanno!',
    simboli: ['🎈', '🎂', '🎉', '🎁'], colori: ['#ff6bb5', '#ffd34d', '#5aa9ff', '#7dff4b'], suono: 'festa-trombetta', moneta: '🎈' };
  // compleanno: 'MM-GG' scritto da lui (vince sulle altre feste)
  function festaDi(d, compleanno) {
    if (compleanno && /^\d{2}-\d{2}$/.test(compleanno)) {
      const [m, g] = compleanno.split('-').map(Number);
      if (d.getMonth() === m - 1 && d.getDate() === g) return COMPLEANNO;
    }
    return FESTE.find(f => f.quando(d)) || null;
  }
  // le prossime n feste da oggi (oggi compreso), per il menù
  function prossime(d, n, compleanno) {
    const out = [];
    for (let i = 0; i < 400 && out.length < n; i++) {
      const g = giorni(d, i), f = festaDi(g, compleanno);
      if (f && !(out.length && out[out.length - 1].festa.id === f.id)) out.push({ festa: f, data: g });
    }
    return out;
  }
  const perId = id => (id === 'compleanno' ? COMPLEANNO : FESTE.find(f => f.id === id) || null);
  window.Feste = { FESTE, COMPLEANNO, festaDi, prossime, pasqua, perId };
})();
