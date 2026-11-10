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
let attuale = null;    // { modello, processor, tokenizer, model }
let inCorso = null;    // { modello, promessa } mentre si carica

async function libreria() {
  if (!T) {
    T = await import(LIBRERIA);
    T.env.allowLocalModels = false;
  }
  return T;
}

function carica(modello, dtype, rispondi) {
  if (attuale && attuale.modello === modello) return Promise.resolve(attuale);
  if (inCorso && inCorso.modello === modello) return inCorso.promessa;
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
    const [processor, tokenizer, model] = await Promise.all([
      L.AutoProcessor.from_pretrained(modello, { progress_callback: cb }),
      L.AutoTokenizer.from_pretrained(modello, { progress_callback: cb }),
      L.WhisperForConditionalGeneration.from_pretrained(modello, { dtype, device: 'wasm', progress_callback: cb })
    ]);
    attuale = { modello, processor, tokenizer, model };
    return attuale;
  })();
  inCorso = { modello, promessa };
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
  isolato: !!self.crossOriginIsolated,
  thread: T && T.env && T.env.backends && T.env.backends.onnx && T.env.backends.onnx.wasm ? T.env.backends.onnx.wasm.numThreads || null : null,
  core: (self.navigator && self.navigator.hardwareConcurrency) || null
});

async function gestisci(m, rispondi) {
  m = m || {};
  try {
    if (m.tipo === 'carica') {
      const t0 = performance.now();
      await carica(m.modello, m.dtype, rispondi);
      rispondi(Object.assign({ tipo: 'pronto', id: m.id, ms: Math.round(performance.now() - t0) }, info()));
    } else if (m.tipo === 'trascrivi') {
      const mod = await carica(m.modello, m.dtype, rispondi);
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
