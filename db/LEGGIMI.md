# File database (da eseguire in Supabase → SQL Editor)

- `setup_nuovo.sql` — installazione completa da zero (schema 16).
- `aggiornamento_v16.sql` — solo per chi ha già lo schema precedente.
- `aggiungi_prodotti_ordine.sql` — aggiunge a magazzino i 32 prodotti dell'ordine Logista con quantità 0
  (21 riconosciuti dal vecchio catalogo, 11 nuovi). Rieseguibile senza danni. Prezzo 0 = da compilare.
- `controllo_prodotti_ordine.csv` — elenco riga per riga di cosa è stato riconosciuto e come.
- `unisci_nome_in_marca.sql` — un solo nome per prodotto: porta il testo di "nome" dentro "marca" e svuota "nome" (colonna lasciata, vuota). Rieseguibile.
