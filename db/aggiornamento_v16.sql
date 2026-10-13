-- ============================================================
-- BAR TABACCHI V16 - AGGIORNAMENTO (per chi ha già eseguito setup_nuovo.sql)
-- Incolla TUTTO nello SQL Editor di Supabase e premi Run, una volta.
-- Non tocca prodotti, vendite, turni o PIN. Si può rieseguire senza danni.
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
