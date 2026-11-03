-- =====================================================================
-- Knowledge Base - staff Knowledge tab: entries, price lines, banking price read, search view    001
-- Needs Admin Base (admin_is, my_tabs), Banking Base and Services Base. Idempotent.
-- Members need the 'knowledge' tab to read; only admins write. Agent commission figures do not belong here.
-- =====================================================================
create table if not exists public.knowledge_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);
insert into public.knowledge_categories (name, sort_order) values
  ('Business Setup', 1), ('Banking', 2), ('Accounting', 3), ('Tax', 4), ('Visas', 5), ('General', 6)
on conflict (name) do nothing;

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.knowledge_categories(id),
  entry_type text not null check (entry_type in ('procedure', 'checklist', 'plan', 'client_answer')),
  title text not null,
  body text not null default '',                                  -- HTML from the editor or the import
  status text not null default 'Draft' check (status in ('Draft', 'Approved')),
  visibility text not null default 'Internal' check (visibility in ('Shareable', 'Internal')),
  source_ref text unique,                                          -- stops a re-import duplicating a row
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table if not exists public.knowledge_price_lines (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.knowledge_categories(id),
  template text not null,                                         -- free text, so more zones can be added
  line_group text not null,
  item text not null,
  amount_aed numeric(12,2) not null check (amount_aed >= 0),
  payee text,
  confidence text check (confidence in ('High', 'Medium', 'Low')),
  basis text,                                                     -- admin only on screen, never copied
  valid_until date,
  status text not null default 'Draft' check (status in ('Draft', 'Approved')),
  visibility text not null default 'Internal' check (visibility in ('Shareable', 'Internal')),
  source_ref text unique,
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Stamps the edit, records who approved, and sends an Approved row back to Draft when its content changes.
create or replace function public.knowledge_touch() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare content_changed boolean := false;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' and old.status = 'Approved' and new.status = 'Approved' then
    if tg_table_name = 'knowledge_entries' then
      content_changed := (new.title, new.body) is distinct from (old.title, old.body);
    else
      content_changed := (new.template, new.line_group, new.item, new.amount_aed, new.payee)
        is distinct from (old.template, old.line_group, old.item, old.amount_aed, old.payee);
    end if;
    if content_changed then new.status := 'Draft'; end if;
  end if;
  if new.status = 'Approved' then
    if tg_op = 'INSERT' or old.status is distinct from 'Approved' then
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;

drop trigger if exists knowledge_entries_touch on public.knowledge_entries;
create trigger knowledge_entries_touch before insert or update on public.knowledge_entries
  for each row execute function public.knowledge_touch();
drop trigger if exists knowledge_price_lines_touch on public.knowledge_price_lines;
create trigger knowledge_price_lines_touch before insert or update on public.knowledge_price_lines
  for each row execute function public.knowledge_touch();

-- Access rules: members with the tab read Shareable, undeleted rows; only admins write.
do $$
declare t text;
begin
  foreach t in array array['knowledge_categories', 'knowledge_entries', 'knowledge_price_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.admin_is())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.admin_is()) with check (public.admin_is())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.admin_is())', t || '_delete', t);
  end loop;
end $$;
create policy knowledge_categories_read on public.knowledge_categories for select to authenticated
  using (public.admin_is() or 'knowledge' = any(public.my_tabs()));
create policy knowledge_entries_read on public.knowledge_entries for select to authenticated
  using (public.admin_is() or ('knowledge' = any(public.my_tabs()) and visibility = 'Shareable' and deleted_at is null));
create policy knowledge_price_lines_read on public.knowledge_price_lines for select to authenticated
  using (public.admin_is() or ('knowledge' = any(public.my_tabs()) and visibility = 'Shareable' and deleted_at is null));

-- banking_pricing is open to Banking users only, so this gives Knowledge users the customer-facing columns.
-- The service fee range, source, remarks and the collected-by flag stay out.
-- Like Banking quotes: a blank service fee means the default setting, the newest row wins a same-day tie, and VAT mode falls back to inclusive.
create or replace function public.knowledge_banking_prices()
returns table (price_id uuid, bank_name text, scheme_name text, account_opening_fee numeric, initial_deposit numeric,
  minimum_balance numeric, other_bank_charges numeric, service_fee numeric, effective_date date, expiry_date date, vat_mode text)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from (
    select distinct on (p.bank_id, p.scheme_id)
      p.id, b.bank_name, s.scheme_name, p.account_opening_fee, p.initial_deposit, p.minimum_balance,
      p.other_bank_charges, coalesce(p.service_fee, (banking_setting('default_service_fee'))::text::numeric),
      p.effective_date, p.expiry_date, coalesce(banking_setting('vat') ->> 'mode', 'inclusive')
    from banking_pricing p
    join banking_partners b on b.id = p.bank_id
    left join banking_schemes s on s.id = p.scheme_id
    where (public.admin_is() or 'knowledge' = any(public.my_tabs()))
      and b.is_active and b.deleted_at is null
      and (p.scheme_id is null or (s.is_active and s.deleted_at is null))
      and p.effective_date <= (now() at time zone 'Asia/Dubai')::date
      and (p.expiry_date is null or p.expiry_date >= (now() at time zone 'Asia/Dubai')::date)
    order by p.bank_id, p.scheme_id, p.effective_date desc, p.created_at desc
  ) latest
  order by 2, 3
$$;
revoke all on function public.knowledge_banking_prices() from public, anon;
grant execute on function public.knowledge_banking_prices() to authenticated;

-- One searchable list. security_invoker keeps the access rules above in force for the caller.
create or replace view public.v_knowledge_search with (security_invoker = on) as
  select 'entry'::text as kind, e.id as source_id, e.title, c.name as department,
         e.title || ' ' || regexp_replace(e.body, '<[^>]*>', ' ', 'g') as search_text,
         e.status, e.visibility, e.updated_at
  from public.knowledge_entries e join public.knowledge_categories c on c.id = e.category_id
  where e.deleted_at is null
  union all
  select 'price', l.id, l.template || ' - ' || l.item, c.name,
         l.template || ' ' || l.line_group || ' ' || l.item,
         l.status, l.visibility, l.updated_at
  from public.knowledge_price_lines l join public.knowledge_categories c on c.id = l.category_id
  where l.deleted_at is null
  union all
  select 'banking', k.price_id, k.bank_name || coalesce(' - ' || k.scheme_name, ''), 'Banking',
         k.bank_name || ' ' || coalesce(k.scheme_name, ''),
         'Approved', 'Shareable', k.effective_date::timestamptz
  from public.knowledge_banking_prices() k
  union all
  select 'service', i.id, i.name, sc.department, sc.name || ' ' || i.name,
         'Approved', 'Shareable', null::timestamptz
  from public.service_items i join public.service_categories sc on sc.id = i.category_id
  where i.is_active and sc.is_active and (public.admin_is() or 'knowledge' = any(public.my_tabs()));
revoke all on public.v_knowledge_search from anon, authenticated;
grant select on public.v_knowledge_search to authenticated;
