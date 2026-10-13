-- ============================================================
-- BAR TABACCHI V16 - NUOVA INSTALLAZIONE (progetto Supabase vuoto)
-- Incolla TUTTO questo file nello SQL Editor e premi Run, una volta.
-- PIN iniziale dell'app: 246810  (cambialo subito dall'app)
-- ============================================================

-- 0) Tabella prodotti
create table if not exists prodotti_master (
  barcode text primary key,
  marca text not null default '',
  nome text not null default '',
  prezzo numeric(10,2) not null default 0,
  quantita integer not null default 0 check (quantita >= 0),
  codice_aams text,
  codice_logista text,
  categoria text default 'KS',
  data_ultimo_carico timestamptz,
  media_giornaliera numeric(10,3) not null default 0,
  giorni_copertura numeric(10,1),
  scorta integer not null default 20,
  updated_at timestamptz not null default now()
);
create index if not exists prodotti_aams_idx on prodotti_master (codice_aams);
create index if not exists prodotti_logista_idx on prodotti_master (codice_logista);

alter table prodotti_master enable row level security;
drop policy if exists "prodotti lettura" on prodotti_master;
create policy "prodotti lettura" on prodotti_master for select to anon, authenticated using (true);
drop policy if exists "prodotti scrittura" on prodotti_master;
create policy "prodotti scrittura" on prodotti_master for insert to anon, authenticated with check (true);
drop policy if exists "prodotti modifica" on prodotti_master;
create policy "prodotti modifica" on prodotti_master for update to anon, authenticated using (true) with check (true);
-- niente policy di DELETE: dall'app non si puo' cancellare un prodotto

-- ============================================================
-- BAR TABACCHI V15 - setup database
-- Eseguire UNA VOLTA nello SQL Editor di Supabase, PRIMA di
-- caricare la nuova app. Si può rieseguire senza danni.
-- ============================================================

-- 1) Scorta (livello target) condivisa tra i dispositivi
alter table prodotti_master add column if not exists scorta integer not null default 20;

-- 2) Turni (uno solo può essere aperto alla volta)
create table if not exists turni (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  start_at timestamptz not null default now(),
  end_at timestamptz,
  fondo_cassa numeric(10,2) not null default 0,
  contanti_contati numeric(10,2),
  legacy_id text unique
);
create unique index if not exists turni_uno_aperto on turni ((true)) where end_at is null;

-- 3) Vendite (scontrini)
create table if not exists vendite (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  turno_id uuid references turni(id),
  turno_nome text,
  pagamento text not null check (pagamento in ('contanti','carta')),
  totale numeric(10,2) not null,
  items jsonb not null,
  stornata boolean not null default false,
  storno_at timestamptz,
  client_id text unique
);
create index if not exists vendite_created_idx on vendite (created_at desc);
create index if not exists vendite_turno_idx on vendite (turno_id);

-- 4) Registro dei PDF Logista già caricati (anti doppio caricamento)
create table if not exists carichi_pdf (
  id uuid primary key default gen_random_uuid(),
  hash text not null,
  nome text,
  created_at timestamptz not null default now(),
  righe jsonb
);
create index if not exists carichi_pdf_hash_idx on carichi_pdf (hash);

-- 5) Impostazioni (PIN amministratore, salvato solo come hash)
create table if not exists impostazioni (
  chiave text primary key,
  valore text not null
);
-- PIN iniziale = 246810. CAMBIALO subito dall'app (Magazzino > CAMBIA PIN).
insert into impostazioni (chiave, valore)
values ('admin_pin_hash', encode(sha256(convert_to('246810','UTF8')),'hex'))
on conflict (chiave) do nothing;

-- 6) Sicurezza righe: le nuove tabelle sono leggibili, ma si scrive solo tramite le funzioni qui sotto
alter table turni enable row level security;
alter table vendite enable row level security;
alter table carichi_pdf enable row level security;
alter table impostazioni enable row level security;  -- nessuna policy: non leggibile dall'esterno

drop policy if exists "lettura turni" on turni;
create policy "lettura turni" on turni for select to anon, authenticated using (true);
drop policy if exists "lettura vendite" on vendite;
create policy "lettura vendite" on vendite for select to anon, authenticated using (true);
drop policy if exists "lettura carichi" on carichi_pdf;
create policy "lettura carichi" on carichi_pdf for select to anon, authenticated using (true);

-- 7) Riepilogo turni (esclude gli scontrini stornati)
create or replace view turni_riepilogo as
select t.*,
  coalesce(sum(v.totale) filter (where not v.stornata), 0) as incasso,
  coalesce(sum(v.totale) filter (where not v.stornata and v.pagamento = 'contanti'), 0) as contanti,
  coalesce(sum(v.totale) filter (where not v.stornata and v.pagamento = 'carta'), 0) as carta,
  count(v.id) filter (where not v.stornata) as scontrini,
  coalesce(sum(p.pezzi) filter (where not v.stornata), 0) as pezzi
from turni t
left join vendite v on v.turno_id = t.id
left join lateral (
  select sum((i->>'qty')::int) as pezzi from jsonb_array_elements(v.items) i
) p on true
group by t.id;
grant select on turni_riepilogo to anon, authenticated;

-- ============================================================
-- FUNZIONI
-- ============================================================

create or replace function versione_schema() returns int
language sql stable as $$ select 15 $$;

-- PIN ---------------------------------------------------------
create or replace function verifica_pin(p_pin text) returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from impostazioni
    where chiave = 'admin_pin_hash'
      and valore = encode(sha256(convert_to(coalesce(p_pin,''),'UTF8')),'hex')
  );
$$;

create or replace function cambia_pin(p_old text, p_new text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not verifica_pin(p_old) then return false; end if;
  if p_new is null or p_new !~ '^[0-9]{6,12}$' then
    raise exception 'Il nuovo PIN deve avere da 6 a 12 cifre';
  end if;
  update impostazioni
     set valore = encode(sha256(convert_to(p_new,'UTF8')),'hex')
   where chiave = 'admin_pin_hash';
  return true;
end $$;

-- Turni -------------------------------------------------------
create or replace function apri_turno(p_nome text, p_fondo numeric default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r turni%rowtype;
begin
  if coalesce(trim(p_nome),'') = '' then raise exception 'Nome turno obbligatorio'; end if;
  select * into r from turni where end_at is null;
  if found then raise exception 'C''è già un turno aperto: %', r.nome; end if;
  insert into turni (nome, fondo_cassa)
  values (upper(trim(p_nome)), coalesce(p_fondo,0))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function chiudi_turno(p_id uuid, p_contanti numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r turni%rowtype;
begin
  update turni set end_at = now(), contanti_contati = p_contanti
   where id = p_id and end_at is null
  returning * into r;
  if not found then raise exception 'Turno già chiuso o inesistente'; end if;
  return to_jsonb(r);
end $$;

-- Vendita atomica (scala il magazzino e registra lo scontrino in un'unica transazione)
create or replace function vendi_carrello(
  p_turno uuid, p_pagamento text, p_items jsonb, p_client_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  v_qty int;
  v_prod record;
  v_items jsonb := '[]'::jsonb;
  v_tot numeric(10,2) := 0;
  v_ex vendite%rowtype;
  v_turno turni%rowtype;
  v_new vendite%rowtype;
begin
  if p_pagamento not in ('contanti','carta') then raise exception 'Pagamento non valido'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Carrello vuoto';
  end if;

  -- doppio invio (doppio tap, ritrasmissione): restituisce lo scontrino già registrato
  if p_client_id is not null then
    select * into v_ex from vendite where client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_ex.id, 'totale', v_ex.totale, 'created_at', v_ex.created_at,
                                'items', v_ex.items, 'turno_nome', v_ex.turno_nome,
                                'pagamento', v_ex.pagamento, 'duplicato', true);
    end if;
  end if;

  select * into v_turno from turni where id = p_turno and end_at is null;
  if not found then raise exception 'Nessun turno aperto: apri un turno prima di vendere'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantità non valida'; end if;

    update prodotti_master
       set quantita = quantita - v_qty, updated_at = now()
     where barcode = it->>'code' and quantita >= v_qty
    returning marca, nome, prezzo into v_prod;

    if not found then
      raise exception 'Giacenza insufficiente o prodotto inesistente: %', it->>'code';
    end if;

    v_tot := v_tot + (v_prod.prezzo * v_qty);
    v_items := v_items || jsonb_build_object(
      'code', it->>'code', 'marca', v_prod.marca, 'nome', v_prod.nome,
      'prezzo', v_prod.prezzo, 'qty', v_qty);
  end loop;

  insert into vendite (turno_id, turno_nome, pagamento, totale, items, client_id)
  values (v_turno.id, v_turno.nome, p_pagamento, v_tot, v_items, p_client_id)
  returning * into v_new;

  return jsonb_build_object('id', v_new.id, 'totale', v_new.totale, 'created_at', v_new.created_at,
                            'items', v_new.items, 'turno_nome', v_new.turno_nome,
                            'pagamento', v_new.pagamento, 'duplicato', false);
end $$;

-- Storno: rimette a magazzino e marca lo scontrino come stornato
create or replace function storna_vendita(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vendite%rowtype; it jsonb;
begin
  select * into v from vendite where id = p_id for update;
  if not found then raise exception 'Scontrino non trovato'; end if;
  if v.stornata then raise exception 'Scontrino già stornato'; end if;
  for it in select * from jsonb_array_elements(v.items) loop
    update prodotti_master
       set quantita = quantita + (it->>'qty')::int, updated_at = now()
     where barcode = it->>'code';
  end loop;
  update vendite set stornata = true, storno_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'totale', v.totale);
end $$;

-- Magazzino ---------------------------------------------------
create or replace function carica_giacenza(p_barcode text, p_qty int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantità non valida'; end if;
  update prodotti_master
     set quantita = quantita + p_qty, data_ultimo_carico = now(), updated_at = now()
   where barcode = p_barcode
  returning quantita into v;
  if not found then raise exception 'Prodotto non trovato'; end if;
  return v;
end $$;

-- Rettifica relativa (+1 / -1), non tocca la data ultimo carico
create or replace function rettifica_giacenza(p_barcode text, p_delta int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update prodotti_master
     set quantita = greatest(0, quantita + p_delta), updated_at = now()
   where barcode = p_barcode
  returning quantita into v;
  if not found then raise exception 'Prodotto non trovato'; end if;
  return v;
end $$;

-- Inventario: imposta la giacenza contata
create or replace function imposta_giacenza(p_barcode text, p_qty int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if p_qty is null or p_qty < 0 then raise exception 'Quantità non valida'; end if;
  update prodotti_master set quantita = p_qty, updated_at = now()
   where barcode = p_barcode
  returning quantita into v;
  if not found then raise exception 'Prodotto non trovato'; end if;
  return v;
end $$;

-- Carico da PDF Logista, con protezione contro il doppio caricamento
create or replace function carica_pdf(p_hash text, p_nome text, p_righe jsonb, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; q int;
begin
  if not p_force and exists (select 1 from carichi_pdf where hash = p_hash) then
    return jsonb_build_object('duplicato', true,
      'data', (select max(created_at) from carichi_pdf where hash = p_hash));
  end if;
  for r in select * from jsonb_array_elements(p_righe) loop
    q := (r->>'qty')::int;
    if q is null or q <= 0 then continue; end if;
    update prodotti_master
       set quantita = quantita + q, data_ultimo_carico = now(), updated_at = now()
     where barcode = r->>'barcode';
    if found then n := n + 1; end if;
  end loop;
  insert into carichi_pdf (hash, nome, righe) values (p_hash, p_nome, p_righe);
  return jsonb_build_object('duplicato', false, 'caricati', n);
end $$;

-- Rotazione ---------------------------------------------------
-- Pezzi venduti per prodotto negli ultimi N giorni (scontrini stornati esclusi).
-- "giorni" = finestra effettiva: se lo storico è più corto di N giorni, usa i giorni realmente trascorsi.
create or replace function medie_vendita(p_giorni int default 30)
returns table (barcode text, pezzi bigint, giorni numeric)
language sql stable security definer set search_path = public as $$
  with prima as (select min(created_at) as t from vendite where not stornata)
  select i->>'code',
         sum((i->>'qty')::int)::bigint,
         greatest(1, least(p_giorni, ceil(extract(epoch from (now() - p.t)) / 86400.0)))::numeric
  from vendite v
  cross join lateral jsonb_array_elements(v.items) as i
  cross join prima p
  where not v.stornata
    and v.created_at >= now() - make_interval(days => p_giorni)
  group by i->>'code', p.t
$$;

-- Salva media e giorni di copertura (una sola chiamata invece di una per prodotto)
create or replace function aggiorna_medie(p_data jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update prodotti_master p
     set media_giornaliera = r.media, giorni_copertura = r.gg
    from jsonb_to_recordset(p_data) as r(barcode text, media numeric, gg numeric)
   where p.barcode = r.barcode
     and (p.media_giornaliera is distinct from r.media or p.giorni_copertura is distinct from r.gg);
  get diagnostics n = row_count;
  return n;
end $$;

-- Import dello storico vecchio (localStorage del tablet di cassa), idempotente
create or replace function importa_storico(p_turni jsonb, p_vendite jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nt int; nv int;
begin
  insert into turni (nome, start_at, end_at, fondo_cassa, legacy_id)
  select t.nome, t.start_at, t.end_at, 0, t.legacy_id
    from jsonb_to_recordset(coalesce(p_turni,'[]'::jsonb))
         as t(nome text, start_at timestamptz, end_at timestamptz, legacy_id text)
  on conflict (legacy_id) do nothing;
  get diagnostics nt = row_count;

  insert into vendite (created_at, turno_id, turno_nome, pagamento, totale, items, client_id)
  select v.created_at, t.id, v.turno_nome,
         case when v.pagamento = 'carta' then 'carta' else 'contanti' end,
         v.totale, v.items, 'legacy-' || v.legacy_id
    from jsonb_to_recordset(coalesce(p_vendite,'[]'::jsonb))
         as v(created_at timestamptz, legacy_turno text, turno_nome text, pagamento text,
              totale numeric, items jsonb, legacy_id text)
    left join turni t on t.legacy_id = v.legacy_turno
  on conflict (client_id) do nothing;
  get diagnostics nv = row_count;

  return jsonb_build_object('turni', nt, 'vendite', nv);
end $$;

grant execute on all functions in schema public to anon, authenticated;

-- ============================================================
-- V16: codici AAMS alternativi e carico da ordine PDF
-- ============================================================
-- Codici AAMS alternativi: "questo codice dell'ordine = quel prodotto"
create table if not exists codici_alias (
  codice text primary key,
  barcode text not null references prodotti_master(barcode) on update cascade on delete cascade,
  created_at timestamptz not null default now()
);
alter table codici_alias enable row level security;
drop policy if exists "lettura alias" on codici_alias;
create policy "lettura alias" on codici_alias for select to anon, authenticated using (true);

-- Associa un codice AAMS dell'ordine a un prodotto già esistente.
-- Se il prodotto non ha ancora un AAMS, diventa il suo AAMS; altrimenti viene salvato come alternativo.
create or replace function associa_codice(p_codice text, p_barcode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cod text := upper(regexp_replace(coalesce(p_codice,''),'[^0-9A-Za-z]','','g'));
  v_aams text;
begin
  if v_cod = '' then raise exception 'Codice AAMS vuoto'; end if;
  select codice_aams into v_aams from prodotti_master where barcode = p_barcode;
  if not found then raise exception 'Prodotto non trovato'; end if;
  if coalesce(v_aams,'') = '' then
    update prodotti_master set codice_aams = v_cod, updated_at = now() where barcode = p_barcode;
    return jsonb_build_object('tipo','principale');
  end if;
  if regexp_replace(upper(regexp_replace(v_aams,'[^0-9A-Za-z]','','g')),'^0+(?=[0-9])','') = regexp_replace(v_cod,'^0+(?=[0-9])','') then
    return jsonb_build_object('tipo','gia_uguale');
  end if;
  insert into codici_alias (codice, barcode) values (v_cod, p_barcode)
  on conflict (codice) do update set barcode = excluded.barcode;
  return jsonb_build_object('tipo','alias');
end $$;

create or replace function versione_schema() returns int
language sql stable as $$ select 16 $$;

grant execute on all functions in schema public to anon, authenticated;
