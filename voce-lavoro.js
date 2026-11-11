/* Conti — il lavoro pesante del microfono, in un «worker» a parte: la pagina resta fluida mentre Whisper pensa.
   Lo crea voce.js. Riceve { tipo: 'carica' | 'trascrivi', id, modello, dtype, audio, parole } e risponde
   { tipo: 'pronto' | 'testo' | 'errore', id, ... }; durante lo scaricamento manda { tipo: 'progresso' }.
   Se la pagina è «isolata» (crossOriginIsolated, intestazioni messe dal service worker) la libreria usa
   più thread: sul PC il 10/11/2026 la trascrizione è diventata 2,5-3 volte più veloce.
   Se il telefono non riesce a far partire il worker, voce.js carica questo stesso file nella pagina
   (window.VoceLavoro.gestisci): più lento a rispondere ai tocchi mentre trascrive, ma funziona. */
const LIBRERIA = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
// Vocabolario di partenza: solo parole, niente numeri (coi numeri d'esempio Whisper li copiava). Il 10/11/2026 sera
// allungato con le parole di tutti i giorni che la voce sentiva male («Scena» per cena, «carameli», «Parkeggio»).
const VOCABOLARIO = 'Spese ed entrate in euro e centesimi: provvigione, stipendio, rimborso, ricevuto, PAC su eToro, Bitcoin, ' +
  'Esselunga, Fineco, supermercato, caffè, colazione, pranzo, cena, aperitivo, dolcetto, caramelle, gelato, parcheggio, ' +
  'benzina, palestra, scherma, bolletta, affitto, abbonamento, Spotify, Netflix, Amazon, tabacchi, cioccolato, ogni mese.';
// Frasi che Whisper inventa sul silenzio (soprattutto in italiano), e il vocabolario ricopiato
const INVENTATE = /sottotitol|amara\.org|grazie per la visione|iscriviti al canale|spese ed entrate in euro/i;

let T = null;
let attuale = null;    // { chiave, processor, tokenizer, model, gpu }
let inCorso = null;    // { chiave, promessa } mentre si carica

async function libreria() {
  if (!T) {
    T = await import(LIBRERIA);
    T.env.allowLocalModels = false;
  }
  return T;
}

// La scheda grafica c'è davvero? WebGPU nel worker, un adattatore, e i numeri a 16 bit (il codificatore «fp16»).
async function schedaGrafica() {
  try {
    if (!self.navigator || !self.navigator.gpu) return false;
    const a = await self.navigator.gpu.requestAdapter();
    return !!(a && a.features && a.features.has('shader-f16'));
  } catch (e) { return false; }
}

function carica(modello, dtype, rispondi, device) {
  device = device || 'wasm';
  const chiave = JSON.stringify([modello, dtype, device]);
  if (attuale && attuale.chiave === chiave) return Promise.resolve(attuale);
  if (inCorso && inCorso.chiave === chiave) return inCorso.promessa;
  const promessa = (async () => {
    const L = await libreria();
    if (attuale) {   // un modello alla volta: la memoria del telefono non basta per due
      try { await attuale.model.dispose(); } catch (e) { /* già libero */ }
      attuale = null;
    }
    const file = {};
    const cb = e => {
      if (!e || e.status !== 'progress' || !e.file) return;
      file[e.file] = { caricati: e.loaded || 0, totale: e.total || 0 };
      const v = Object.values(file);
      rispondi({ tipo: 'progresso', caricati: v.reduce((a, x) => a + x.caricati, 0), totale: v.reduce((a, x) => a + x.totale, 0) });
    };
    // sulla scheda grafica se c'è; se no, o se non riesce a partire, lo stesso modello col processore
    const vuoleGpu = typeof device === 'object' && Object.values(device).includes('webgpu');
    const gpu = vuoleGpu && await schedaGrafica();
    const conProcessore = typeof dtype === 'object' ? 'q8' : dtype;
    const [processor, tokenizer] = await Promise.all([
      L.AutoProcessor.from_pretrained(modello, { progress_callback: cb }),
      L.AutoTokenizer.from_pretrained(modello, { progress_callback: cb })
    ]);
    let model = null, suGpu = false;
    if (gpu) {
      try {
        model = await L.WhisperForConditionalGeneration.from_pretrained(modello, { dtype, device, progress_callback: cb });
        suGpu = true;
      } catch (e) { model = null; }
    }
    if (!model) model = await L.WhisperForConditionalGeneration.from_pretrained(modello, { dtype: conProcessore, device: 'wasm', progress_callback: cb });
    attuale = { chiave, processor, tokenizer, model, gpu: suGpu };
    return attuale;
  })();
  inCorso = { chiave, promessa };
  promessa.then(() => { inCorso = null; }, () => { inCorso = null; });
  return promessa;
}

async function trascrivi(m, audio, parole) {
  const { processor, tokenizer, model } = m;
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

const info = () => ({
  gpu: !!(attuale && attuale.gpu),
  isolato: !!self.crossOriginIsolated,
  thread: T && T.env && T.env.backends && T.env.backends.onnx && T.env.backends.onnx.wasm ? T.env.backends.onnx.wasm.numThreads || null : null,
  core: (self.navigator && self.navigator.hardwareConcurrency) || null
});

async function gestisci(m, rispondi) {
  m = m || {};
  try {
    if (m.tipo === 'carica') {
      const t0 = performance.now();
      await carica(m.modello, m.dtype, rispondi, m.device);
      rispondi(Object.assign({ tipo: 'pronto', id: m.id, ms: Math.round(performance.now() - t0) }, info()));
    } else if (m.tipo === 'trascrivi') {
      const mod = await carica(m.modello, m.dtype, rispondi, m.device);
      const t0 = performance.now();
      const testo = await trascrivi(mod, m.audio, m.parole);
      rispondi(Object.assign({ tipo: 'testo', id: m.id, testo, ms: Math.round(performance.now() - t0) }, info()));
    }
  } catch (err) {
    rispondi({ tipo: 'errore', id: m.id, messaggio: String((err && err.message) || err).slice(0, 200) });
  }
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = e => gestisci(e.data, r => self.postMessage(r));
} else {
  self.VoceLavoro = { gestisci };
}
