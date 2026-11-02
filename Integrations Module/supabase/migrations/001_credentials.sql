-- Credentials added from Settings (mailbox passwords, app API keys and logins).
-- Values are encrypted in Supabase Vault under the name crm_cred:<NAME>. Admins can
-- write and remove them but no browser can read one back: credential_get is
-- executable by the service role only, i.e. by Edge Functions.
-- public.integration_credentials holds only labels, never a value.

alter table email_base.mailboxes add column if not exists login_user text;
comment on column email_base.mailboxes.login_user is 'IMAP/SMTP username when it differs from the address. The password is in Vault or an Edge Function secret.';

create table if not exists public.integration_credentials (
  name text primary key check (name ~ '^[A-Z][A-Z0-9_]{1,99}$'),
  integration_id text,
  integration_name text,
  field_label text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.integration_credentials enable row level security;
revoke all on public.integration_credentials from anon, public, authenticated;
grant select on public.integration_credentials to authenticated;
grant all on public.integration_credentials to service_role;
drop policy if exists integration_credentials_admin_read on public.integration_credentials;
create policy integration_credentials_admin_read on public.integration_credentials for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create or replace function public.admin_credential_set(
  p_name text, p_value text, p_integration_id text default null, p_integration_name text default null, p_field_label text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_vault_name text := 'crm_cred:' || p_name;
  v_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Only a CRM admin can change credentials.';
  end if;
  if p_name is null or p_name !~ '^[A-Z][A-Z0-9_]{1,99}$' or p_name like 'SUPABASE\_%' then
    raise exception 'That credential name is not allowed.';
  end if;
  if nullif(btrim(coalesce(p_value, '')), '') is null or length(p_value) > 20000 then
    raise exception 'Enter a value (up to 20,000 characters).';
  end if;

  select id into v_id from vault.secrets where name = v_vault_name;
  if v_id is null then
    perform vault.create_secret(p_value, v_vault_name, 'CRM credential added in Settings');
  else
    perform vault.update_secret(v_id, p_value);
  end if;

  insert into public.integration_credentials (name, integration_id, integration_name, field_label, updated_by)
  values (p_name, p_integration_id, p_integration_name, p_field_label, auth.uid())
  on conflict (name) do update set
    integration_id = coalesce(excluded.integration_id, integration_credentials.integration_id),
    integration_name = coalesce(excluded.integration_name, integration_credentials.integration_name),
    field_label = coalesce(excluded.field_label, integration_credentials.field_label),
    updated_by = excluded.updated_by, updated_at = now();

  -- The audit entry names the credential, never its value.
  insert into public.admin_audit (actor, action, target, detail)
  values (auth.uid(), 'credential.set', p_name, jsonb_build_object('integration', p_integration_name));
end $$;

create or replace function public.admin_credential_delete(p_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Only a CRM admin can change credentials.';
  end if;
  delete from vault.secrets where name = 'crm_cred:' || p_name;
  delete from public.integration_credentials where name = p_name;
  insert into public.admin_audit (actor, action, target) values (auth.uid(), 'credential.delete', p_name);
end $$;

-- Edge Functions only.
create or replace function public.credential_get(p_name text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'crm_cred:' || p_name limit 1
$$;

revoke all on function public.admin_credential_set(text, text, text, text, text) from public, anon;
revoke all on function public.admin_credential_delete(text) from public, anon;
revoke all on function public.credential_get(text) from public, anon, authenticated;
grant execute on function public.admin_credential_set(text, text, text, text, text) to authenticated;
grant execute on function public.admin_credential_delete(text) to authenticated;
grant execute on function public.credential_get(text) to service_role;
