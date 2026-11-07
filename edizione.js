/* Quale copia di Conti è questa. Vale per la pagina e per il service worker (self = window o worker).
   Questa è l'edizione principale. pubblica.py --edizione <nome> la sostituisce con strumenti/conti/edizioni/<nome>.js
   nella copia che va online: stesso codice, dati e memorie separati, testi propri. */
self.EDIZIONE = {
  nome: 'principale',
  titolo: 'Conti',
  chiave: 'conti.v1',                 // dove stanno i movimenti: non cambiarla, o l'app non li ritrova
  chiavePref: 'conti.preferenze',
  cache: 'conti-',                    // prefisso delle memorie del service worker
  inizioSulSerio: '2026-12-01',       // da questo giorno propone di cancellare i movimenti di prova (null = mai)
  testoCopia: 'Da incollare a Claude, che lo salva nel second brain: è anche la tua copia di sicurezza.',
  avvisoCopiato: 'Copiato: incollalo a Claude o in una nota'
};
