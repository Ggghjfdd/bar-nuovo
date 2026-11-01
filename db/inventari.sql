-- ============================================================
-- STORICO INVENTARI + SALVATAGGIO DELLA CONTA IN CORSO
-- Da incollare UNA VOLTA nell'editor SQL di Supabase e premere RUN.
-- Si puo' rieseguire senza danni.
-- ============================================================
create table if not exists inventari (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  chiuso_at   timestamptz,
  stato       text not null default 'in_corso' check (stato in ('in_corso','applicato','annullato')),
  snapshot    jsonb not null,                 -- giacenze di TUTTI i prodotti a inizio conta: [{c,n,q}]
  conte       jsonb not null default '{}'::jsonb   -- conta fatta: { barcode: {counted,sys,ts} }
);
create index if not exists inventari_stato_idx on inventari (stato, created_at desc);

alter table inventari enable row level security;
drop policy if exists "lettura inventari" on inventari;
create policy "lettura inventari" on inventari for select to anon, authenticated using (true);
-- si scrive solo con le funzioni qui sotto (nessuna policy di insert/update/delete)

-- conta ancora aperta (la piu' recente), oppure null
create or replace function inventario_corrente() returns jsonb
language sql security definer set search_path = public as $$
  select to_jsonb(i) - 'snapshot' from inventari i
   where stato = 'in_corso' order by created_at desc limit 1;
$$;

-- apre una nuova conta salvando la fotografia delle giacenze di quel momento
create or replace function inventario_nuovo(p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from inventari where stato='in_corso' order by created_at desc limit 1;
  if v is not null then return v; end if;
  insert into inventari (snapshot) values (coalesce(p_snapshot,'[]'::jsonb)) returning id into v;
  return v;
end $$;

-- salva i prodotti contati finora
create or replace function inventario_salva(p_id uuid, p_conte jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update inventari set conte = coalesce(p_conte,'{}'::jsonb), updated_at = now()
   where id = p_id and stato = 'in_corso';
  return found;
end $$;

-- chiude la conta: 'applicato' (giacenze corrette) oppure 'annullato'
create or replace function inventario_chiudi(p_id uuid, p_stato text, p_conte jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_stato not in ('applicato','annullato') then raise exception 'Stato non valido'; end if;
  update inventari set stato = p_stato, conte = coalesce(p_conte, conte), chiuso_at = now(), updated_at = now()
   where id = p_id and stato = 'in_corso';
  return found;
end $$;

grant execute on function inventario_corrente() to anon, authenticated;
grant execute on function inventario_nuovo(jsonb) to anon, authenticated;
grant execute on function inventario_salva(uuid, jsonb) to anon, authenticated;
grant execute on function inventario_chiudi(uuid, text, jsonb) to anon, authenticated;
