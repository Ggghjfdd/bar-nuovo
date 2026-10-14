-- Un solo nome per prodotto: porta il testo della colonna "nome" dentro "marca" e svuota "nome".
-- La colonna "nome" resta nella tabella (vuota) per non rompere nulla.
-- Sicuro da rieseguire.
update prodotti_master set nome = '' where nome ~ '^[0-9]+$';          -- numeri del vecchio catalogo: non sono nomi
update prodotti_master
   set marca = trim(coalesce(marca,'') || ' ' || nome), nome = ''
 where coalesce(nome,'') <> '';
select count(*) as prodotti, count(*) filter (where coalesce(nome,'')<>'') as con_nome_residuo from prodotti_master;
