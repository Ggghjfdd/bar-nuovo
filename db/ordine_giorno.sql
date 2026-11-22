-- ============================================================
-- ORDINE RAPIDO: quantita' di stecche scelte oggi (si salvano online)
-- Da incollare UNA VOLTA nell'editor SQL di Supabase e premere RUN.
-- Si puo' rieseguire senza danni.
-- ============================================================
create table if not exists ordini_giorno (
  giorno        date primary key,
  righe         jsonb not null default '{}'::jsonb,   -- { barcode: stecche }
  esportato_at  timestamptz,                          -- ultima volta che e' stato creato il file Excel
  updated_at    timestamptz not null default now()
);
alter table ordini_giorno enable row level security;
drop policy if exists "lettura ordini" on ordini_giorno;
create policy "lettura ordini" on ordini_giorno for select to anon, authenticated using (true);
-- si scrive solo con le funzioni qui sotto

create or replace function ordine_giorno_leggi(p_giorno date) returns jsonb
language sql security definer set search_path = public as $$
  select to_jsonb(o) from ordini_giorno o where giorno = p_giorno;
$$;

create or replace function ordine_giorno_salva(p_giorno date, p_righe jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  insert into ordini_giorno (giorno, righe, updated_at) values (p_giorno, coalesce(p_righe,'{}'::jsonb), now())
  on conflict (giorno) do update set righe = excluded.righe, updated_at = now()
  returning updated_at into v;
  return v;
end $$;

create or replace function ordine_giorno_esportato(p_giorno date) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into ordini_giorno (giorno, esportato_at) values (p_giorno, now())
  on conflict (giorno) do update set esportato_at = now();
  return true;
end $$;

grant execute on function ordine_giorno_leggi(date) to anon, authenticated;
grant execute on function ordine_giorno_salva(date, jsonb) to anon, authenticated;
grant execute on function ordine_giorno_esportato(date) to anon, authenticated;
