-- Aggiunge a magazzino i prodotti dell'ordine Logista con quantita' 0.
-- Sicuro da rieseguire: non tocca i prodotti gia' presenti.
-- Prezzo 0 = da compilare (la cassa non lo vende finche' non lo inserisci).
do $$ begin
  if to_regclass('public.codici_alias') is null then
    raise exception 'Esegui prima aggiornamento_v16.sql';
  end if;
end $$;

insert into prodotti_master (barcode, marca, nome, prezzo, quantita, codice_aams, categoria) values  -- marca = nome completo, nome vuoto
  ('V0RCD','VEEV ONE BLUEBERRY 1.8%','',0.00,0,'V0RCD','KS'),
  ('80845331','BENSON&HEDGES RED 100S','',5.50,0,'3013','KS'),
  ('478','CAMEL BLUE','',0.00,0,'478','KS'),
  ('632','CAMEL BLUE CART','',0.00,0,'632','KS'),
  ('201','CHESTERFIELD BLUE KS','',0.00,0,'201','KS'),
  ('96','CHESTERFIELD ORIGINAL KS','',0.00,0,'96','KS'),
  ('233','DIANA ROSSA KS','',0.00,0,'233','KS'),
  ('649','DUNHILL CLUB BIANCA','',0.00,0,'649','KS'),
  ('177','DUNHILL MS BIONDE','',0.00,0,'177','KS'),
  ('02287595','JPS RED 100','',0.00,0,'2287','KS'),
  ('9','MARLBORO GOLD KS','',0.00,0,'9','KS'),
  ('618','MARLBORO GOLD KS CART','',0.00,0,'618','KS'),
  ('3340','MARLBORO GOLD LINE','',0.00,0,'3340','KS'),
  ('395','MARLBORO KS','',0.00,0,'395','KS'),
  ('396','MARLBORO KS CART','',0.00,0,'396','KS'),
  ('3504','MARLBORO POCKET PACK CART','',0.00,0,'3504','KS'),
  ('59460626','ROTHMANS OF LONDON BLUE 20','',5.50,0,'2652','KS'),
  ('59038306','ROTHMANS OF LONDON D-SERIES','',5.50,0,'2270','KS'),
  ('80802730','WINSTON BLUE','',5.80,0,'338','KS'),
  ('80851462','WINSTON BLUE 100S','',5.80,0,'1784','KS'),
  ('1783','WINSTON RED 100S','',0.00,0,'1783','KS'),
  ('80828594','WINSTON RED','',0.00,0,'91','KS'),
  ('3900','AL CAPONE POCKETS ORIG. FILTER 18','',0.00,0,'3900','ALTRO'),
  ('1963','AMERICAN SPIRIT ORIGINAL BLUE 30G 30GR','',0.00,0,'1963','TRINCIATO'),
  ('03495623','MARLBORO GOLD 30GR','',0.00,0,'3495','TRINCIATO'),
  ('1927','PUEBLO CLASSIC 30GR','',0.00,0,'1927','TRINCIATO'),
  ('20215','PUEBLO PINK 30GR','',0.00,0,'20215','TRINCIATO'),
  ('21882','DELIA CLASSIC AZURE','',0.00,0,'21882','ALTRO'),
  ('21232','DELIA CLASSIC GREEN','',0.00,0,'21232','ALTRO'),
  ('20659376','TEREA AZURE','',0.00,0,'20659','ALTRO'),
  ('20150','TEREA RUSSET','',0.00,0,'20150','ALTRO'),
  ('20154382','TEREA TURQUOSE','',0.00,0,'20154','ALTRO')
on conflict (barcode) do nothing;

-- imposta il vero AAMS dove mancava o era uguale al barcode
update prodotti_master set codice_aams = v.aams
from (values ('80845331','3013'),('02287595','2287'),('59460626','2652'),('59038306','2270'),('80802730','338'),('80851462','1784'),('80828594','91'),('03495623','3495'),('20659376','20659'),('20154382','20154')) as v(barcode,aams)
where prodotti_master.barcode=v.barcode
  and (coalesce(prodotti_master.codice_aams,'')='' or prodotti_master.codice_aams=prodotti_master.barcode);

select count(*) as prodotti_totali from prodotti_master;
