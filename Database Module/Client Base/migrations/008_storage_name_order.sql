-- Fix for 007: the "one name starts the other" rule joined the words in alphabetical order, so "Curve Ball Events Mgt"
-- (CURVEBALLEVENTSMGT) did not start with "CURVEBALL EVENTS". The joined name now keeps the words in their written order.
-- Rollback: run 007_storage_folders.sql again (it restores the old storage_name_score) and drop storage_name_key.

-- The name as one run of letters and digits, words in written order, legal suffixes dropped.
create or replace function public.storage_name_key(p_name text) returns text
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(string_agg(w, '' order by n), '')
    from regexp_split_to_table(
           regexp_replace(
             replace(replace(translate(upper(coalesce(p_name, '')), 'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ', 'AAAAAAEEEEIIIIOOOOOUUUUCN'), '&', ' AND '), '.', ''),
             '[^A-Z0-9]+', ' ', 'g'),
           ' ') with ordinality as t (w, n)
   where w <> '' and w = any(storage_name_tokens(w))
$$;

create or replace function public.storage_name_score(p_folder text, p_crm text, p_person boolean default false) returns numeric
language sql immutable set search_path = pg_catalog, public as $$
  with t as (select storage_name_tokens(p_folder) f, storage_name_tokens(p_crm) c),
  k as (select f, c, storage_name_key(p_folder) fk, storage_name_key(p_crm) ck,
               (select count(*) from unnest(f) x where x = any(c)) shared,
               (select count(distinct x) from unnest(f || c) x) total from t)
  select round(case
    when cardinality(f) = 0 or cardinality(c) = 0 then 0
    when f = c or fk = ck then 1
    when least(length(fk), length(ck)) >= 6 and (fk like ck || '%' or ck like fk || '%') then 0.85
    when p_person and shared = cardinality(c) then 0.7
    else shared::numeric / total end, 3)
  from k
$$;

revoke all on function public.storage_name_key(text) from public, anon, authenticated;
grant execute on function public.storage_name_key(text) to authenticated;
