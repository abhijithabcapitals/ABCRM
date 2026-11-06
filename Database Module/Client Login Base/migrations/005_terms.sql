-- =====================================================================
-- Client Login Base - Terms and Conditions at client sign-in    005
-- =====================================================================
-- A client agrees to the published Terms before the portal shows or accepts anything (client-portal checks client_portal_terms_state).
-- One version is Published at most. A new version needs agreement again. With none published, nobody is held back, so this file alone changes nothing for clients.
-- Version 1 is seeded as a Draft, not legally reviewed: an admin publishes it from Settings once a lawyer has checked it.
-- Published and Retired text cannot change, and acceptance rows cannot change or go, so the record of what a client agreed to stays as it was.
-- Run after Client Login 001-004. Re-runnable. Undo with rollback/005_rollback.sql.
-- =====================================================================

create table if not exists public.client_portal_terms (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  title text not null,
  body text not null,
  status text not null default 'Draft' check (status in ('Draft', 'Published', 'Retired')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  published_at timestamptz,
  published_by uuid
);
create unique index if not exists client_portal_terms_one_published on public.client_portal_terms ((1)) where status = 'Published';

create table if not exists public.client_portal_terms_acceptances (   -- append-only
  id uuid primary key default gen_random_uuid(),
  terms_id uuid not null references public.client_portal_terms(id),
  version int not null,
  account_id uuid not null references public.client_portal_accounts(id),
  username text not null,
  client_master_id text,
  banking_client_id uuid,
  accepted_at timestamptz not null default now(),
  unique (terms_id, account_id)
);
create index if not exists client_portal_terms_acceptances_account_idx on public.client_portal_terms_acceptances (account_id);

alter table public.client_portal_terms enable row level security;
alter table public.client_portal_terms_acceptances enable row level security;
revoke all on public.client_portal_terms, public.client_portal_terms_acceptances from public, anon, authenticated;

-- Published text is what clients agreed to: only its status can move on, to Retired.
create or replace function public.client_portal_terms_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'Draft' then raise exception 'Published terms cannot be deleted'; end if;
    return old;
  end if;
  if old.status <> 'Draft' and (new.title, new.body, new.version) is distinct from (old.title, old.body, old.version) then
    raise exception 'Published terms cannot be changed. Save a new version.';
  end if;
  if old.status = 'Retired' and new.status <> 'Retired' then raise exception 'Retired terms cannot be published again. Save a new version.'; end if;
  return new;
end $$;
revoke all on function public.client_portal_terms_guard() from public, anon, authenticated;
drop trigger if exists client_portal_terms_guard on public.client_portal_terms;
create trigger client_portal_terms_guard before update or delete on public.client_portal_terms for each row execute function public.client_portal_terms_guard();

create or replace function public.client_portal_terms_acceptance_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'A record of agreement cannot be changed or deleted';
end $$;
revoke all on function public.client_portal_terms_acceptance_guard() from public, anon, authenticated;
drop trigger if exists client_portal_terms_acceptance_guard on public.client_portal_terms_acceptances;
create trigger client_portal_terms_acceptance_guard before update or delete on public.client_portal_terms_acceptances for each row execute function public.client_portal_terms_acceptance_guard();

-- ── For the client-portal function: the account comes from the live session. Service role only ──
create or replace function public.client_portal_terms_state(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('required', true, 'id', t.id, 'version', t.version, 'title', t.title, 'body', t.body)
                     from client_portal_terms t
                    where t.status = 'Published'
                      and not exists (select 1 from client_portal_terms_acceptances a where a.terms_id = t.id and a.account_id = p_account)),
                  jsonb_build_object('required', false))
$$;

create or replace function public.client_portal_terms_accept(p_account uuid, p_terms uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t client_portal_terms; a client_portal_accounts;
begin
  select * into a from client_portal_accounts where id = p_account;
  if a.id is null or a.status <> 'active' then raise exception 'Please sign in again.'; end if;
  select * into t from client_portal_terms where id = p_terms;
  if t.id is null or t.status <> 'Published' then raise exception 'These terms have been replaced. Please read the current version.'; end if;
  insert into client_portal_terms_acceptances (terms_id, version, account_id, username, client_master_id, banking_client_id)
  values (t.id, t.version, a.id, a.username, a.client_master_id, a.banking_client_id)
  on conflict (terms_id, account_id) do nothing;
end $$;
revoke all on function public.client_portal_terms_state(uuid), public.client_portal_terms_accept(uuid, uuid) from public, anon, authenticated;
grant execute on function public.client_portal_terms_state(uuid), public.client_portal_terms_accept(uuid, uuid) to service_role;

-- ── For admins, in Settings ──
create or replace function public.client_portal_terms_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'version', t.version, 'title', t.title, 'body', t.body, 'status', t.status, 'created_at', t.created_at, 'published_at', t.published_at,
            'accepted', (select count(*) from client_portal_terms_acceptances a where a.terms_id = t.id)) order by t.version desc), '[]'::jsonb)
    from client_portal_terms t);
end $$;

-- Saves the given draft, or a new draft when no id is given. Only Drafts can be saved.
create or replace function public.client_portal_terms_save_draft(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_title text := nullif(btrim(coalesce(p ->> 'title', '')), ''); v_body text := nullif(btrim(coalesce(p ->> 'body', '')), '');
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  if v_title is null then raise exception 'Enter a title'; end if;
  if v_body is null then raise exception 'Enter the text of the terms'; end if;
  if v_id is null then
    if exists (select 1 from client_portal_terms where status = 'Draft') then raise exception 'A draft already exists. Edit that one.'; end if;
    perform pg_advisory_xact_lock(hashtext('client_portal_terms'));
    insert into client_portal_terms (version, title, body) select coalesce(max(version), 0) + 1, v_title, v_body from client_portal_terms returning id into v_id;
  else
    update client_portal_terms set title = v_title, body = v_body where id = v_id and status = 'Draft';
    if not found then raise exception 'Only a draft can be edited'; end if;
  end if;
  return v_id;
end $$;

-- Publishing retires the version before it, in one transaction. Every client must then agree again.
create or replace function public.client_portal_terms_publish(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t client_portal_terms;
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  perform pg_advisory_xact_lock(hashtext('client_portal_terms'));
  select * into t from client_portal_terms where id = p_id for update;
  if t.id is null then raise exception 'These terms were not found'; end if;
  if t.status <> 'Draft' then raise exception 'Only a draft can be published'; end if;
  if nullif(btrim(t.body), '') is null then raise exception 'Enter the text of the terms'; end if;
  update client_portal_terms set status = 'Retired' where status = 'Published';
  update client_portal_terms set status = 'Published', published_at = now(), published_by = auth.uid() where id = t.id;
  insert into admin_audit (actor, action, target, detail) values (auth.uid(), 'client_portal_terms_publish', 'version ' || t.version, jsonb_build_object('title', t.title));
end $$;

-- What this login has agreed to, for staff who manage logins.
create or replace function public.client_portal_terms_acceptances_for(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (client_portal_is_admin() or business_setup_can('setup.portal.manage')) then raise exception 'You do not have permission to do this'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('version', a.version, 'title', t.title, 'accepted_at', a.accepted_at, 'username', a.username) order by a.version desc), '[]'::jsonb)
    from client_portal_terms_acceptances a join client_portal_terms t on t.id = a.terms_id where a.account_id = p_account);
end $$;
revoke all on function public.client_portal_terms_list(), public.client_portal_terms_save_draft(jsonb), public.client_portal_terms_publish(uuid), public.client_portal_terms_acceptances_for(uuid) from public, anon;
grant execute on function public.client_portal_terms_list(), public.client_portal_terms_save_draft(jsonb), public.client_portal_terms_publish(uuid), public.client_portal_terms_acceptances_for(uuid) to authenticated;

-- ── Version 1: a draft for a lawyer to review. Never published here, and left alone on a re-run ──
insert into public.client_portal_terms (version, title, body)
select 1, 'Terms and Conditions (DRAFT, not yet legally reviewed)', $terms$
These terms apply when you use this client portal or give documents and information to AB Capital Services FZE, Dubai, UAE ("we", "us"). Please read them before you continue.

1. Your documents and information
You allow us to collect, store and use the documents and information you give us. These may include passports, Emirates IDs, visas, trade licences, memoranda of association, tenancy contracts, bank statements, and the personal details of you, your shareholders, managers and employees.

2. Why we use them
We use them to provide the services you ask us for, to prepare quotes, letters and invoices, to contact you about your services, and to meet our legal and regulatory duties.

3. Who we may share them with
We may share them, only as far as your services or the law require, with government authorities, free zone authorities, banks, and service providers who support our work, including our accounting and document systems. We do not sell your information.

4. What you promise
You confirm that the documents and information you give us are genuine, accurate and complete, and that you will tell us if they change. You confirm that you have the authority to give us any document or information about another person, such as a shareholder, manager or employee, and that they know you are giving it to us.

5. How long we keep them, and your requests
We keep your documents and information for as long as your services and our legal retention duties require. [RETENTION PERIOD: lawyer to confirm] You may ask us for access to your information, and ask us to correct or delete it, subject to those duties. Write to info@abcapital.ae.

6. Your login and electronic agreement
Keep your login details private, and tell us at once if you think someone else has used them. When you click Agree or Accept in this portal, that counts as your agreement in writing. We record the date, the time and the login used.

7. Fees and services
Our services and fees are set out in the quote you accept and in the engagement letter. If those documents differ from these terms, those documents come first on services and fees.

8. Limits of our responsibility
Decisions, requirements, fees and timing of government authorities, free zones and banks are outside our control, and we cannot guarantee their outcome. [LIABILITY LIMIT: lawyer to confirm]

9. Changes to these terms
We may update these terms. When we do, we will ask you to agree to the new version before you continue to use this portal.

10. Law
These terms are governed by the laws of the United Arab Emirates as applied in [EMIRATE: lawyer to confirm]. [COURTS OR ARBITRATION: lawyer to confirm]

Questions: info@abcapital.ae
$terms$
where not exists (select 1 from public.client_portal_terms);
