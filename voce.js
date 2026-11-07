/* Conti — il microfono dell'app: registra e trascrive DENTRO il telefono con Whisper (modello «base»).
   L'audio non esce mai dal telefono. Serve la rete solo la prima volta, per scaricare:
     - la libreria transformers.js da jsDelivr (il service worker la tiene per quando non c'è rete);
     - il modello da Hugging Face, circa 77 MB (la libreria lo tiene nella sua memoria «transformers-cache»).
   Perché così: le app aggiunte alla schermata Home dell'iPhone non hanno il riconoscimento vocale di Safari
   (WebKit bug 225298), ma possono usare il microfono. Provato il 07/11/2026 su 15 frasi lette da una voce
   sintetica italiana: «base» col vocabolario capisce bene gli importi, «tiny» no. */
(function () {
  'use strict';

  const LIBRERIA = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
  const MODELLO = 'onnx-community/whisper-base';
  const PESO_ATTESO = 78e6;   // byte da scaricare la prima volta, per la barra
  // Vocabolario di partenza: solo parole, niente numeri (coi numeri d'esempio Whisper li copiava).
  const VOCABOLARIO = 'Spese ed entrate in euro: provvigione, stipendio, ricevuto, PAC su eToro, Bitcoin, Esselunga, Fineco, caffè, palestra, scherma, bolletta, benzina.';
  // Frasi che Whisper inventa sul silenzio (soprattutto in italiano)
  const INVENTATE = /sottotitol|amara\.org|grazie per la visione|iscriviti al canale|spese ed entrate in euro/i;

  let caricamento = null;
  let ultimo = null;   // l'ultimo audio registrato (16 kHz): serve al banco di prova per controllarlo

  function caricaModello(alProgresso) {
    if (caricamento) return caricamento;
    caricamento = (async () => {
      const T = await import(LIBRERIA);
      T.env.allowLocalModels = false;
      const file = {};
      const cb = e => {
        if (!alProgresso || !e || e.status !== 'progress' || !e.file) return;
        file[e.file] = e.loaded || 0;
        const caricati = Object.values(file).reduce((a, b) => a + b, 0);
        alProgresso(Math.min(0.99, caricati / PESO_ATTESO));
      };
      const [processor, tokenizer, model] = await Promise.all([
        T.AutoProcessor.from_pretrained(MODELLO, { progress_callback: cb }),
        T.AutoTokenizer.from_pretrained(MODELLO, { progress_callback: cb }),
        T.WhisperForConditionalGeneration.from_pretrained(MODELLO, { dtype: 'q8', device: 'wasm', progress_callback: cb })
      ]);
      return { processor, tokenizer, model };
    })();
    caricamento.catch(() => { caricamento = null; });   // se fallisce (niente rete) si potrà riprovare
    return caricamento;
  }

  // ---------------------------------------------------------------- registrazione
  // Va chiamata DENTRO il tocco sul bottone: sull'iPhone l'audio parte solo da un gesto.
  // Si ferma da sola dopo ~1,2 s di silenzio dopo aver parlato, o dopo 15 s, o con ferma().
  function ascolta(opz) {
    opz = opz || {};
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const ripresa = ctx.resume ? ctx.resume() : Promise.resolve();
    let fermata = false, risolvi, rifiuta;
    const finito = new Promise((a, b) => { risolvi = a; rifiuta = b; });
    const pezzi = [], livelli = [];
    let stream = null, proc = null, src = null;
    let parlato = false, primoParlato = -1, ultimoParlato = -1, rumore = null, fila = 0;

    const chiudi = () => {
      try { if (proc) proc.disconnect(); if (src) src.disconnect(); } catch (e) { /* già staccati */ }
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (ctx.state !== 'closed' && ctx.close) ctx.close().catch(() => { /* già chiuso */ });
    };
    const ferma = () => {
      if (fermata) return;
      fermata = true;
      chiudi();
      const durataPezzo = pezzi.length ? pezzi[0].length / ctx.sampleRate : 0;
      if (!parlato || !pezzi.length) { risolvi({ audio: null, parlato: false }); return; }
      // si tiene solo il tratto parlato, con un po' di margine: meno silenzio = meno frasi inventate
      const da = Math.max(0, primoParlato - Math.ceil(0.35 / durataPezzo));
      const a = Math.min(pezzi.length, ultimoParlato + 1 + Math.ceil(0.45 / durataPezzo));
      ultimo = { audio: a16k(pezzi.slice(da, a), ctx.sampleRate), frequenza: ctx.sampleRate, pezzi: pezzi.length, tenuti: a - da };
      risolvi({ audio: ultimo.audio, parlato: true });
    };

    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(s => ripresa.then(() => s))
      .then(s => {
        stream = s;
        if (fermata) { chiudi(); return; }
        src = ctx.createMediaStreamSource(s);
        proc = ctx.createScriptProcessor(4096, 1, 1);
        const durata = 4096 / ctx.sampleRate;
        const inizio = performance.now();
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
          const soglia = Math.max(0.012, Math.min(rumore || 0, 0.02) * 2.5);
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
          if (opz.alLivello) opz.alLivello(Math.min(1, rms / Math.max(soglia * 4, 0.05)), parlato);
          const trascorso = (performance.now() - inizio) / 1000;
          const silenzioDopo = parlato ? (i - ultimoParlato) * durata : 0;
          if ((parlato && silenzioDopo > 1.2) || trascorso > 15 || (!parlato && trascorso > 7)) ferma();
        };
        src.connect(proc);
        proc.connect(ctx.destination);   // il processore lavora solo se collegato: esce silenzio
        if (opz.alVia) opz.alVia();
      })
      .catch(err => { fermata = true; chiudi(); rifiuta(err); });

    return { ferma, finito };
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

  // ---------------------------------------------------------------- trascrizione
  // «parole»: le parole che Francesco usa di più (descrizioni recenti, categorie sue), per aiutare Whisper.
  async function trascrivi(audio, parole) {
    const { processor, tokenizer, model } = await caricaModello();
    const sp = t => tokenizer.convert_tokens_to_ids([t])[0];
    const extra = (parole || []).filter(Boolean).slice(0, 14);
    const suggerimento = VOCABOLARIO + (extra.length ? ' ' + extra.join(', ') + '.' : '');
    const iniziali = [sp('<|startofprev|>'), ...tokenizer.encode(' ' + suggerimento, { add_special_tokens: false }),
      sp('<|startoftranscript|>'), sp('<|it|>'), sp('<|transcribe|>'), sp('<|notimestamps|>')];
    const ingressi = await processor(audio);
    const uscita = await model.generate(Object.assign({}, ingressi, { decoder_input_ids: iniziali, max_new_tokens: 120 }));
    const righe = typeof uscita.tolist === 'function' ? uscita.tolist() : uscita;
    const seq = Array.from(righe[0]).map(Number).slice(iniziali.length);
    let testo = tokenizer.decode(seq, { skip_special_tokens: true }).trim();
    if (INVENTATE.test(testo)) testo = '';
    return testo.replace(/\s+/g, ' ');
  }

  window.Voce = {
    disponibile: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext)),
    caricaModello,
    ascolta,
    trascrivi,
    PESO_MB: Math.round(PESO_ATTESO / 1e6),
    ultimoAudio: () => ultimo
  };
})();
