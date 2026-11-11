/* Conti — il microfono dell'app: registra e trascrive DENTRO il telefono con Whisper.
   L'audio non esce mai dal telefono. Serve la rete solo la prima volta, per scaricare la libreria
   (transformers.js da jsDelivr, il service worker la tiene per quando non c'è rete) e il modello da
   Hugging Face (la libreria lo tiene nella sua memoria «transformers-cache»).
   Perché così: le app aggiunte alla schermata Home dell'iPhone non hanno il riconoscimento vocale di Safari
   (WebKit bug 225298, chiuso «LATER»), ma possono usare il microfono.

   Rifatto il 10/11/2026 («il microfono fa proprio schifo»). Misure sul PC con 15 frasi della voce sintetica:
     - «Veloce» = whisper-base:  78 MB, 2,2 s a frase con un thread, 0,9 s con più thread; sbaglia spesso
       («milleottocento» → 1880, «cioccolato» → «Ci ho colato», «e venti» → «i venti»);
     - «Preciso» = whisper-small: 250 MB, 7,2 s con un thread, 2,6 s con più thread; scrive giusti
       decimali e parole («43,20», «1,20 €», «eToro», «Esselunga»).
   Il lavoro di Whisper sta in voce-lavoro.js (un worker): la pagina non si blocca mentre trascrive. */
(function () {
  'use strict';

  // «Preciso veloce» (11/11/2026): lo stesso Whisper small, ma la parte pesante (il codificatore, che lavora sempre su
  // 30 secondi di audio anche per una frase di 2) gira sulla scheda grafica con WebGPU, che Safari 26 ha. Sul PC:
  // 3,2-3,7 s a frase invece di 9-10 col processore, stesse parole. Il decodificatore resta quello di «Preciso»:
  // se «Preciso» c'è già, si scarica solo il codificatore (177 MB). Se la scheda grafica non va, il worker torna da
  // solo al processore.
  const MODELLI = {
    preciso: { id: 'onnx-community/whisper-small', dtype: 'q8', mb: 250, nome: 'Preciso' },
    rapido: { id: 'onnx-community/whisper-small', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q8' },
      device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' }, mb: 177, mbDaZero: 334, nome: 'Preciso veloce', gpu: true },
    veloce: { id: 'onnx-community/whisper-base', dtype: 'q8', mb: 78, nome: 'Veloce' }
  };

  // ---------------------------------------------------------------- il worker
  let lavoro = null, prossimo = 1, alProgresso = null, pronto = null;   // pronto = { chiave, promessa }
  let lavoroRisponde = false;   // il worker ha già risposto almeno una volta
  let nellaPagina = null;       // se il worker non parte: voce-lavoro.js caricato nella pagina
  const attese = new Map();
  const risposta = m => {
    if (m.tipo === 'progresso') { if (alProgresso) alProgresso(m); return; }
    const a = attese.get(m.id);
    if (!a) return;
    attese.delete(m.id);
    if (m.tipo === 'errore') a.rifiuta(new Error(m.messaggio)); else a.risolvi(m);
  };
  function worker() {
    if (lavoro) return lavoro;
    lavoro = new Worker('voce-lavoro.js', { type: 'module' });
    lavoro.onmessage = e => { lavoroRisponde = true; risposta(e.data || {}); };
    lavoro.onerror = e => {
      if (e && e.preventDefault) e.preventDefault();
      try { lavoro.terminate(); } catch (x) { /* già fermo */ }
      lavoro = null;
      if (!lavoroRisponde) {
        // il worker non è mai partito (telefono che non li regge): si rifà tutto dentro la pagina
        const ancora = [...attese.values()];
        attese.clear();
        for (const a of ancora) mandaNellaPagina(a.messaggio).then(a.risolvi, a.rifiuta);
        return;
      }
      // il worker è caduto (memoria finita): si rifiuta tutto e la volta dopo se ne crea uno nuovo
      const err = new Error((e && e.message) || 'il riconoscimento vocale si è fermato');
      for (const a of attese.values()) a.rifiuta(err);
      attese.clear();
      pronto = null;
    };
    return lavoro;
  }
  function mandaNellaPagina(messaggio) {
    if (!nellaPagina) nellaPagina = import('./voce-lavoro.js').then(() => window.VoceLavoro);
    return nellaPagina.then(L => new Promise((risolvi, rifiuta) => {
      const id = prossimo++;
      attese.set(id, { risolvi, rifiuta, messaggio });
      L.gestisci(Object.assign({}, messaggio, { id }), risposta);
    }));
  }
  function chiedi(messaggio, trasferibili) {
    if (nellaPagina || (window.Voce && window.Voce.forzaPagina)) return mandaNellaPagina(messaggio);
    return new Promise((risolvi, rifiuta) => {
      const id = prossimo++;
      attese.set(id, { risolvi, rifiuta, messaggio });
      try { worker().postMessage(Object.assign({ id }, messaggio), trasferibili || []); }
      catch (e) { attese.delete(id); mandaNellaPagina(messaggio).then(risolvi, rifiuta); }
    });
  }

  // Carica il modello nel worker (dalla rete la prima volta, poi dalla memoria del telefono).
  // alProg(frazione 0-1) solo durante lo scaricamento.
  function prepara(chiave, alProg) {
    const M = MODELLI[chiave];
    alProgresso = alProg ? (m => alProg(Math.min(0.99, m.caricati / Math.max(m.totale || 0, M.mb * 1e6)))) : null;
    if (pronto && pronto.chiave === chiave) return pronto.promessa;
    const promessa = chiedi({ tipo: 'carica', modello: M.id, dtype: M.dtype, device: M.device || 'wasm' });
    pronto = { chiave, promessa };
    promessa.catch(() => { if (pronto && pronto.promessa === promessa) pronto = null; });
    return promessa;
  }

  // «parole»: quelle che Francesco usa di più (descrizioni recenti, categorie sue), per aiutare Whisper.
  async function trascrivi(chiave, audio, parole) {
    const M = MODELLI[chiave];
    prepara(chiave);
    // si copia (non si trasferisce): se il worker non parte, lo stesso audio si rimanda alla pagina
    const r = await chiedi({ tipo: 'trascrivi', modello: M.id, dtype: M.dtype, device: M.device || 'wasm', audio: audio.slice(), parole: parole || [] });
    return { testo: r.testo || '', ms: r.ms, isolato: r.isolato, thread: r.thread, gpu: !!r.gpu };
  }

  // Cancella dalla memoria del telefono i file di un modello (per liberare spazio).
  async function cancellaModello(chiave) {
    const M = MODELLI[chiave];
    if (!window.caches) return 0;
    let tolti = 0;
    for (const nome of await caches.keys()) {
      if (!/transformers/i.test(nome)) continue;
      const c = await caches.open(nome);
      for (const r of await c.keys()) {
        if (!r.url.includes(M.id + '/')) continue;
        if (chiave === 'rapido' && !/encoder_model_fp16/.test(r.url)) continue;
        if (chiave === 'preciso' && /encoder_model_fp16/.test(r.url)) continue;
        await c.delete(r); tolti++;
      }
    }
    if (pronto && pronto.chiave === chiave) { try { lavoro.terminate(); } catch (e) { /* già fermo */ } lavoro = null; pronto = null; }
    return tolti;
  }

  // ---------------------------------------------------------------- registrazione
  let ultimo = null;   // l'ultimo audio registrato (16 kHz): serve al banco di prova per controllarlo
  // Va chiamata DENTRO il tocco sul bottone: sull'iPhone l'audio parte solo da un gesto.
  // Si ferma con ferma() (secondo tocco), da sola dopo 2 s di silenzio dopo aver parlato, o dopo 30 s.
  // annulla() butta via quello che ha sentito.
  function ascolta(opz) {
    opz = opz || {};
    const SILENZIO = opz.silenzio || 2.0, MASSIMO = 30, SENZA_VOCE = 8;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const ripresa = ctx.resume ? ctx.resume() : Promise.resolve();
    let fermata = false, risolvi, rifiuta;
    const finito = new Promise((a, b) => { risolvi = a; rifiuta = b; });
    const pezzi = [], livelli = [];
    let stream = null, proc = null, src = null, inizio = 0;
    let parlato = false, primoParlato = -1, ultimoParlato = -1, rumore = null, fila = 0;

    const chiudi = () => {
      try { if (proc) proc.disconnect(); if (src) src.disconnect(); } catch (e) { /* già staccati */ }
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (ctx.state !== 'closed' && ctx.close) ctx.close().catch(() => { /* già chiuso */ });
    };
    const ferma = buttaVia => {
      if (fermata) return;
      fermata = true;
      chiudi();
      const secondi = inizio ? (performance.now() - inizio) / 1000 : 0;
      if (buttaVia || !parlato || !pezzi.length) { risolvi({ audio: null, parlato: false, annullato: !!buttaVia, secondi }); return; }
      const durataPezzo = pezzi[0].length / ctx.sampleRate;
      // si tiene solo il tratto parlato, con un po' di margine: meno silenzio = meno frasi inventate
      const da = Math.max(0, primoParlato - Math.ceil(0.4 / durataPezzo));
      const a = Math.min(pezzi.length, ultimoParlato + 1 + Math.ceil(0.5 / durataPezzo));
      const audio = normalizza(a16k(pezzi.slice(da, a), ctx.sampleRate));
      ultimo = { audio, frequenza: ctx.sampleRate, pezzi: pezzi.length, tenuti: a - da };
      risolvi({ audio, parlato: true, secondi });
    };

    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(s => ripresa.then(() => s))
      .then(s => {
        stream = s;
        if (fermata) { chiudi(); return; }
        src = ctx.createMediaStreamSource(s);
        proc = ctx.createScriptProcessor(4096, 1, 1);
        const durata = 4096 / ctx.sampleRate;
        inizio = performance.now();
        proc.onaudioprocess = e => {
          if (fermata) return;
          const d = e.inputBuffer.getChannelData(0);
          pezzi.push(new Float32Array(d));
          let somma = 0;
          for (let i = 0; i < d.length; i++) somma += d[i] * d[i];
          const rms = Math.sqrt(somma / d.length);
          livelli.push(rms);
          // rumore di fondo: dai primi pezzi, poi aggiornato lentamente quando non si parla
          if (livelli.length <= 3) rumore = livelli.slice().sort((x, y) => x - y)[Math.floor(livelli.length / 2)];
          // tetto al rumore: se si comincia a parlare subito, i primi pezzi sono già voce
          const soglia = Math.max(0.01, Math.min(rumore || 0, 0.02) * 2.5);
          const i = pezzi.length - 1;
          if (rms > soglia) {
            fila++;
            if (fila >= 2 || rms > soglia * 2) {
              if (!parlato) { parlato = true; primoParlato = Math.max(0, i - fila); }
              ultimoParlato = i;
            }
          } else {
            fila = 0;
            if (!parlato && livelli.length > 3) rumore = rumore * 0.9 + rms * 0.1;
          }
          const trascorso = (performance.now() - inizio) / 1000;
          if (opz.alLivello) opz.alLivello(Math.min(1, rms / Math.max(soglia * 5, 0.06)), parlato, trascorso);
          const silenzioDopo = parlato ? (i - ultimoParlato) * durata : 0;
          if ((parlato && silenzioDopo > SILENZIO) || trascorso > MASSIMO || (!parlato && trascorso > SENZA_VOCE)) ferma();
        };
        src.connect(proc);
        proc.connect(ctx.destination);   // il processore lavora solo se collegato: esce silenzio
        if (opz.alVia) opz.alVia();
      })
      .catch(err => { fermata = true; chiudi(); rifiuta(err); });

    return { ferma: () => ferma(false), annulla: () => ferma(true), finito };
  }

  // ---------------------------------------------------------------- il riconoscimento di Apple
  // Quello della dettatura della tastiera: veloce, le parole arrivano mentre si parla, e capisce l'italiano molto
  // meglio di Whisper small. Nelle app della schermata Home fino a iOS 18 non c'era (WebKit bug 225298); per iOS 26
  // nessuna fonte lo dice (cercato l'11/11/2026): lo prova l'app al primo tocco, e se non va lo dice e torna a Whisper.
  // La voce la riconosce iOS, come con la dettatura: non è più l'app a farlo.
  const RiconoscitoreApple = window.SpeechRecognition || window.webkitSpeechRecognition;
  // Errori che vogliono dire «qui non c'è»: si torna a Whisper e lo si ricorda fino al prossimo aggiornamento di iOS.
  const APPLE_ASSENTE = ['service-not-allowed', 'not-allowed', 'audio-capture', 'language-not-supported', 'non-parte'];
  // opz: alVia(), alTesto(testo) mentre parla, alTempo(secondi, sentito). Come ascolta(): { ferma, annulla, finito };
  // finito dà { testo, parlato, annullato, secondi } o fallisce con err.codice (vedi APPLE_ASSENTE, o 'network').
  function ascoltaApple(opz) {
    opz = opz || {};
    const SILENZIO = (opz.silenzio || 2.0) * 1000, MASSIMO = 30000, SENZA_VOCE = 8000, PARTENZA = 3500;
    const r = new RiconoscitoreApple();
    r.lang = 'it-IT';
    r.continuous = true;        // si ferma quando lo decide l'app: 2 s di silenzio dopo l'ultima parola, o ■
    r.interimResults = true;    // le parole mentre parla
    r.maxAlternatives = 1;
    let partito = false, fermata = false, concluso = false, annullato = false, testo = '';
    let t0 = performance.now(), ultimo = 0, risolvi, rifiuta;
    const finito = new Promise((a, b) => { risolvi = a; rifiuta = b; });
    const secondi = () => (performance.now() - t0) / 1000;
    const concludi = () => {
      if (concluso) return;
      concluso = true;
      clearInterval(orologio);
      risolvi(annullato ? { testo: '', parlato: false, annullato: true, secondi: secondi() } : { testo, parlato: !!testo, secondi: secondi() });
    };
    const fallisci = codice => {
      if (concluso) return;
      concluso = true; fermata = true;
      clearInterval(orologio);
      try { r.abort(); } catch (e) { /* già fermo */ }
      const err = new Error('riconoscimento di Apple: ' + codice);
      err.codice = codice;
      rifiuta(err);
    };
    const ferma = buttaVia => {
      if (fermata) return;
      fermata = true;
      annullato = !!buttaVia;
      try { if (buttaVia) r.abort(); else r.stop(); } catch (e) { /* già fermo */ }
      setTimeout(concludi, 1500);   // stop() fa arrivare le ultime parole e poi «end»: se «end» non arriva, si chiude lo stesso
    };
    // Si ricostruisce il testo da tutti i risultati a ogni evento. iOS a volte ripete in un risultato tutto il già
    // detto: se un pezzo comincia con quello che c'è già, lo sostituisce invece di accodarsi.
    const leggi = e => {
      const pezzi = [];
      for (let i = 0; i < e.results.length; i++) {
        const alt = e.results[i] && e.results[i][0];
        const t = alt && alt.transcript ? String(alt.transcript).trim() : '';
        if (!t) continue;
        const finora = pezzi.join(' ');
        if (finora && t.toLowerCase().startsWith(finora.toLowerCase())) { pezzi.length = 0; pezzi.push(t); }
        else pezzi.push(t);
      }
      return pezzi.join(' ').replace(/\s+/g, ' ').trim();
    };
    r.onstart = () => { partito = true; t0 = performance.now(); if (opz.alVia) opz.alVia(); };
    r.onaudiostart = () => { partito = true; };
    r.onresult = e => {
      partito = true;
      const t = leggi(e);
      if (t && t !== testo) { testo = t; ultimo = performance.now(); if (opz.alTesto && !fermata) opz.alTesto(testo); }
    };
    r.onerror = e => {
      const codice = (e && e.error) || 'errore';
      if (codice === 'no-speech' || (codice === 'aborted' && fermata)) { fermata = true; concludi(); return; }
      if (testo) { fermata = true; concludi(); return; }   // qualcosa l'aveva sentito: si tiene
      fallisci(codice);
    };
    r.onend = () => {
      if (!partito && !concluso) { fallisci('non-parte'); return; }
      fermata = true;
      concludi();
    };
    const orologio = setInterval(() => {
      if (concluso || fermata) return;
      const ora = performance.now();
      if (!partito) { if (ora - t0 > PARTENZA) fallisci('non-parte'); return; }
      if (opz.alTempo) opz.alTempo(secondi(), !!testo);
      if ((testo && ora - ultimo > SILENZIO) || (!testo && ora - t0 > SENZA_VOCE) || ora - t0 > MASSIMO) ferma(false);
    }, 200);
    try { r.start(); } catch (e) { setTimeout(() => fallisci('non-parte'), 0); }
    return { ferma: () => ferma(false), annulla: () => ferma(true), finito };
  }

  // Voce bassa (telefono lontano): si alza fino a 6 volte, così Whisper la sente meglio.
  function normalizza(audio) {
    let picco = 0;
    for (let i = 0; i < audio.length; i++) { const v = Math.abs(audio[i]); if (v > picco) picco = v; }
    if (!(picco > 0) || picco >= 0.5) return audio;
    const g = Math.min(6, 0.7 / picco);
    for (let i = 0; i < audio.length; i++) audio[i] *= g;
    return audio;
  }

  // Da 44,1/48 kHz a 16 kHz con un filtro passa-basso vero (sinc con finestra di Hann, taglio a 7,2 kHz):
  // una semplice media lasciava passare distorsione e Whisper capiva peggio («Pizzadodici»).
  // Fatto a mano: OfflineAudioContext a 16 kHz non si comporta uguale su tutti i telefoni.
  function a16k(pezzi, frequenza) {
    const n = pezzi.reduce((a, p) => a + p.length, 0);
    const tutto = new Float32Array(n);
    let o = 0;
    for (const p of pezzi) { tutto.set(p, o); o += p.length; }
    if (frequenza === 16000) return tutto;
    const rapporto = frequenza / 16000;
    const taglio = 0.45 / rapporto;               // in cicli per campione d'ingresso
    const mezzo = Math.ceil(8 * rapporto);         // metà larghezza del filtro, in campioni d'ingresso
    const lunghezza = Math.floor(n / rapporto);
    const uscita = new Float32Array(lunghezza);
    for (let i = 0; i < lunghezza; i++) {
      const centro = i * rapporto, c0 = Math.floor(centro);
      let somma = 0, pesi = 0;
      for (let k = Math.max(0, c0 - mezzo); k <= Math.min(n - 1, c0 + mezzo); k++) {
        const x = k - centro;
        const sinc = x === 0 ? 2 * taglio : Math.sin(2 * Math.PI * taglio * x) / (Math.PI * x);
        const h = sinc * (0.5 + 0.5 * Math.cos(Math.PI * x / (mezzo + 1)));
        somma += tutto[k] * h;
        pesi += h;
      }
      uscita[i] = pesi ? somma / pesi : 0;
    }
    return uscita;
  }

  window.Voce = {
    disponibile: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext) && window.Worker),
    isolato: !!window.crossOriginIsolated,
    apple: !!RiconoscitoreApple,
    APPLE_ASSENTE,
    ascoltaApple,
    gpu: !!navigator.gpu,   // la pagina ha WebGPU; se il worker non ce l'ha, «Preciso veloce» torna al processore da solo
    MODELLI,
    prepara,
    trascrivi,
    ascolta,
    cancellaModello,
    caricato: chiave => !!(pronto && pronto.chiave === chiave),
    nellaPagina: () => !!nellaPagina,   // vero se il worker non è partito e Whisper gira nella pagina
    forzaPagina: false,                 // per il banco di prova
    ultimoAudio: () => ultimo
  };
})();
