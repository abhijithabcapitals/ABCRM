-- =====================================================================
-- Client Login Base - client-proposed edits and staff validation    002
-- =====================================================================
-- A client asks to change one field of their record; nothing reaches the CRM until a member of staff with the Clients
-- tab validates it. The table client_portal_change_requests and its one-open-request-per-field index come from 001
-- (001's functions read them). This file adds only functions and rights.
--
--   client_change_submit    service role   the client portal Edge Function, after it has checked the session
--   client_change_official  service role   internal: the value staff would overwrite (also used by the stale check)
--   client_change_apply     service role   internal: writes one value into KYC or the Client Master
--   client_changes_*        authenticated  staff in Clients > Client Inputs > Information Changes, guarded by client_inputs_can()
--
-- Where a validated value goes: banking-linked clients -> banking_kyc_profiles by a direct update, so banking_kyc_percent
-- still runs (licence number also goes to banking_clients); a KYC row is inserted when none exists. The two masterOnly
-- fields, and every field of a client with only a Client Master row, go to client_master.data with a version bump and a
-- client_master_history row, as client_master_save does. Dates are stored as ISO in requests, as date in KYC and as
-- DD/MM/YYYY in the Client Master (what fmtUae writes and parseUaeDate reads).
-- Run after Client Base 003, Admin Base and 001. Idempotent.
-- =====================================================================

-- ---- the field list: keeps in step with Client Login Module/logic/fields.js (a Node test compares the two) ------
-- (key, kind, banking_kyc_profiles column or null for masterOnly, Client Master key, masterOnly)
create or replace function public.client_change_field(p_key text)
returns table (kind text, kyc_col text, master_key text, master_only boolean)
language sql immutable set search_path = pg_catalog as $$
  select v.kind, v.kyc_col, v.master_key, v.master_only from (values
    -- FIELDS:begin
    ('legal_name', 'text', 'legal_name', 'Client Legal Name', false),
    ('trade_name', 'text', 'trade_name', 'Trade Name', false),
    ('legal_structure', 'text', 'legal_structure', 'Entity Type', false),
    ('business_activity', 'text', 'business_activity', 'Main Business Activity', false),
    ('registered_address', 'text', 'registered_address', 'Registered Address', false),
    ('office_address', 'text', 'office_address', 'Office Address', false),
    ('license_number', 'text', 'license_number', 'Trade License Number', false),
    ('issuing_authority', 'text', 'issuing_authority', 'License Issuing Authority', false),
    ('license_issue_date', 'date', 'license_issue_date', 'License Issue Date', false),
    ('license_expiry_date', 'date', 'license_expiry_date', 'License Expiry Date', false),
    ('company_phone', 'text', 'company_phone', 'General Phone', false),
    ('company_email', 'email', 'company_email', 'General Email', false),
    ('website', 'text', 'website', 'Website', false),
    ('vat_trn', 'text', 'vat_trn', 'TRN', false),
    ('ct_registration_number', 'text', null, 'CT Registration Number', true),
    ('financial_year_end', 'date', null, 'Financial Year End', true)
    -- FIELDS:end
  ) v(key, kind, kyc_col, master_key, master_only) where v.key = p_key
$$;

-- A date as YYYY-MM-DD or DD/MM/YYYY -> the ISO text, or null when it is not a real date.
create or replace function public.client_change_iso(v text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare s text := btrim(coalesce(v, '')); y int; m int; d int; r date;
begin
  if s ~ '^\d{4}-\d{2}-\d{2}$' then y := substr(s, 1, 4)::int; m := substr(s, 6, 2)::int; d := substr(s, 9, 2)::int;
  elsif s ~ '^\d{2}/\d{2}/\d{4}$' then d := substr(s, 1, 2)::int; m := substr(s, 4, 2)::int; y := substr(s, 7, 4)::int;
  else return null; end if;
  if y < 1900 or y > 2200 then return null; end if;
  begin r := make_date(y, m, d); exception when others then return null; end;
  return to_char(r, 'YYYY-MM-DD');
end $$;

-- ---- internal helpers (service role only) -------------------------------------------------------------

-- The value as the CRM holds it now: KYC first (licence number: banking_clients next), then the Client Master. Dates as ISO.
create or replace function public.client_change_official(p_account uuid, p_field text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare f record; b uuid; m text; v text;
begin
  select * into f from client_change_field(p_field);
  if not found then raise exception 'That field cannot be changed.'; end if;
  select a.banking_client_id, coalesce(a.client_master_id, c.client_master_id) into b, m
    from client_portal_accounts a left join banking_clients c on c.id = a.banking_client_id where a.id = p_account;
  if f.kyc_col is not null and b is not null then
    execute format('select %s from banking_kyc_profiles where client_id = $1', case when f.kind = 'date' then format('%I::text', f.kyc_col) else format('%I', f.kyc_col) end) into v using b;
    if v is null and p_field = 'license_number' then select license_number into v from banking_clients where id = b; end if;
  end if;
  if nullif(btrim(coalesce(v, '')), '') is null and m is not null then
    select client_master_plain(x.data ->> f.master_key) into v from client_master x where x.client_id = m;
    if f.kind = 'date' and v is not null then v := coalesce(client_change_iso(v), v); end if;
  end if;
  return nullif(btrim(coalesce(v, '')), '');
end $$;

-- Is this licence number held by a different banking client? banking_get_or_create_client matches on licence with limit 1,
-- so a duplicate could attach that client's next case to this portal.
create or replace function public.client_change_license_taken(p_client uuid, p_value text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from banking_clients o where o.id <> p_client and lower(btrim(o.license_number)) = lower(btrim(p_value)))
$$;

-- Writes one validated value. The caller (client_changes_decide) has checked who may and whether the record moved.
create or replace function public.client_change_apply(p_account uuid, p_field text, p_value text, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare f record; b uuid; m text; cur client_master; k text; nv text; ov text;
begin
  select * into f from client_change_field(p_field);
  if not found then raise exception 'That field cannot be changed.'; end if;
  select a.banking_client_id, coalesce(a.client_master_id, c.client_master_id) into b, m
    from client_portal_accounts a left join banking_clients c on c.id = a.banking_client_id where a.id = p_account;
  if regexp_replace(p_value, '\s', '', 'g') ~* 'AE[0-9]{21}' then raise exception 'Store only the last 4 digits of an IBAN'; end if;
  if f.kyc_col is not null and b is not null then
    if p_field = 'license_number' and client_change_license_taken(b, p_value) then
      raise exception 'Another banking client already holds licence number %. Resolve the duplicate before validating this change.', btrim(p_value);
    end if;
    insert into banking_kyc_profiles (client_id) values (b) on conflict (client_id) do nothing;
    if f.kind = 'date' then execute format('update banking_kyc_profiles set %I = $1::date where client_id = $2', f.kyc_col) using p_value, b;
    else execute format('update banking_kyc_profiles set %I = $1 where client_id = $2', f.kyc_col) using p_value, b; end if;
    if p_field = 'license_number' then update banking_clients set license_number = p_value where id = b; end if;
    return;
  end if;
  select * into cur from client_master where client_id = m for update;
  if cur.client_id is null then raise exception 'This client has no Client Master record to update.'; end if;
  k := f.master_key;
  nv := case when f.kind = 'date' then to_char(p_value::date, 'DD/MM/YYYY') else p_value end;
  ov := cur.data ->> k;
  if ov is not distinct from nv then return; end if;
  update client_master set data = data || jsonb_build_object(k, nv), legal_name = case when p_field = 'legal_name' then p_value else legal_name end,
         version = version + 1, updated_at = now(), updated_by = p_actor where client_id = cur.client_id;
  insert into client_master_history (client_id, action, field, old_value, new_value, changed_by) values (cur.client_id, 'Updated', k, ov, nv, p_actor);
end $$;

-- ---- the client's side (service role only: the Edge Function checked the session) ----------------------

create or replace function public.client_change_submit(p_account uuid, p_field text, p_value text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a client_portal_accounts; f record; v text := btrim(coalesce(p_value, '')); off text; cur client_portal_change_requests; m text; new_id uuid;
begin
  select * into f from client_change_field(p_field);
  if not found then raise exception 'That field cannot be changed.'; end if;
  -- one submit at a time per client; also the lock that makes "refused while staff review it" safe
  select * into a from client_portal_accounts where id = p_account for update;
  if a.id is null or a.status <> 'active' then raise exception 'This account cannot make changes.'; end if;
  select coalesce(a.client_master_id, c.client_master_id) into m from banking_clients c where c.id = a.banking_client_id;
  m := coalesce(a.client_master_id, m);
  if a.banking_client_id is null and m is null then raise exception 'Your record is not linked yet. Please contact AB Capital.'; end if;
  if f.master_only and not exists (select 1 from client_master where client_id = m) then raise exception 'This detail is not on file for you, so it cannot be changed here.'; end if;
  if v = '' then raise exception 'The new value cannot be empty.'; end if;
  if length(v) > 500 then raise exception 'The new value is too long (500 characters at most).'; end if;
  -- same rule as client_master_save: never store a full IBAN (spaces ignored)
  if regexp_replace(v, '\s', '', 'g') ~* 'AE[0-9]{21}' then raise exception 'Please do not enter a full IBAN. Give the last 4 digits only.'; end if;
  if f.kind = 'date' then
    v := client_change_iso(v);
    if v is null then raise exception 'Enter a valid date, for example 31/12/2026.'; end if;
  elsif f.kind = 'email' and v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  off := client_change_official(p_account, p_field);
  if off is not distinct from v then raise exception 'That is already your current value.'; end if;
  if (select count(*) from client_portal_change_requests where account_id = p_account and created_at > now() - interval '1 day') >= 100 then
    raise exception 'Too many requests today. Please try again tomorrow.';
  end if;
  select * into cur from client_portal_change_requests where account_id = p_account and field_key = p_field and status in ('pending', 'in_review') for update;
  if cur.id is not null and cur.status = 'in_review' then raise exception 'Staff are reviewing this field now. Please wait for their decision.'; end if;
  if cur.id is not null then update client_portal_change_requests set status = 'superseded' where id = cur.id; end if;
  insert into client_portal_change_requests (account_id, field_key, old_value, new_value) values (p_account, p_field, off, v) returning id into new_id;
  return new_id;
end $$;

-- ---- staff side (authenticated, Clients tab) ---------------------------------------------------------

create or replace function public.client_changes_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'client', t.client, 'field_key', t.field_key, 'old_value', t.old_value, 'new_value', t.new_value,
      'official_value', t.official, 'stale', t.is_open and t.official is distinct from t.old_value, 'status', t.status,
      'license_conflict', t.license_conflict, 'assignee', t.assignee, 'assigned_to', t.assigned_to,
      'can_decide', t.status = 'in_review' and (t.assigned_to = auth.uid() or client_portal_is_admin()),
      'created_at', t.created_at, 'reviewer', t.reviewer, 'reviewed_at', t.reviewed_at, 'review_note', t.review_note)
      order by t.is_open desc, t.created_at desc), '[]'::jsonb)
    from (select r.*, a.display_name as client, pa.full_name as assignee, pr.full_name as reviewer,
                 r.status in ('pending', 'in_review') as is_open,
                 case when r.status in ('pending', 'in_review') then client_change_official(r.account_id, r.field_key) end as official,
                 r.status in ('pending', 'in_review') and r.field_key = 'license_number' and client_change_license_taken(a.banking_client_id, r.new_value) as license_conflict
            from client_portal_change_requests r
            join client_portal_accounts a on a.id = r.account_id
            left join profiles pa on pa.id = r.assigned_to
            left join profiles pr on pr.id = r.reviewed_by
           where r.status <> 'superseded') t);
end $$;

create or replace function public.client_changes_assignees() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', coalesce(p.full_name, p.email, 'Unnamed')) order by coalesce(p.full_name, p.email, 'Unnamed'), p.id), '[]'::jsonb)
            from profiles p where p.role = 'admin' or exists (select 1 from member_tab_access t where t.profile_id = p.id and t.tab_key = 'clients'));
end $$;

-- Atomic: of two people clicking together, only one gets it.
create or replace function public.client_changes_take(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  update client_portal_change_requests set status = 'in_review', assigned_to = auth.uid(), assigned_at = now() where id = p_id and status = 'pending';
  if not found then raise exception 'Someone else has already taken this request.'; end if;
end $$;

-- An unassigned request, or one assigned to the caller (an admin: anyone's), goes to a member who has the Clients tab.
create or replace function public.client_changes_assign(p_id uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  if p_to is null or not (exists (select 1 from profiles where id = p_to and role = 'admin')
                          or exists (select 1 from member_tab_access where profile_id = p_to and tab_key = 'clients')) then
    raise exception 'You can only hand a request to a member who has the Clients tab.';
  end if;
  update client_portal_change_requests set status = 'in_review', assigned_to = p_to, assigned_at = now()
   where id = p_id and (status = 'pending' or (status = 'in_review' and (assigned_to = auth.uid() or client_portal_is_admin())));
  if not found then raise exception 'This request cannot be handed over: it must be unassigned or assigned to you.'; end if;
end $$;

create or replace function public.client_changes_release(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  update client_portal_change_requests set status = 'pending', assigned_to = null, assigned_at = null
   where id = p_id and status = 'in_review' and (assigned_to = auth.uid() or client_portal_is_admin());
  if not found then raise exception 'Only the person it is assigned to can release this request.'; end if;
end $$;

-- Validate writes the value and closes the request in one transaction. If the record changed after the client asked,
-- it is refused unless p_force is true (staff have seen both values and confirmed).
create or replace function public.client_changes_decide(p_id uuid, p_status text, p_note text, p_force boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r client_portal_change_requests; note text := nullif(btrim(coalesce(p_note, '')), ''); stale boolean := false;
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  if p_status is null or p_status not in ('validated', 'rejected') then raise exception 'Unknown decision.'; end if;
  select * into r from client_portal_change_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status not in ('pending', 'in_review') then raise exception 'This request has already been decided.'; end if;
  if r.status = 'pending' then raise exception 'Take this request before deciding it.'; end if;
  if not (r.assigned_to = auth.uid() or client_portal_is_admin()) then raise exception 'Only the person this request is assigned to can decide it.'; end if;
  if p_status = 'rejected' and note is null then raise exception 'Give a reason for the rejection. The client will see it.'; end if;
  if p_status = 'validated' then
    stale := client_change_official(r.account_id, r.field_key) is distinct from r.old_value;
    if stale and not coalesce(p_force, false) then
      raise exception 'This detail has changed since the client made the request. Check the current value, then confirm to overwrite it.';
    end if;
    perform client_change_apply(r.account_id, r.field_key, r.new_value, auth.uid());
  end if;
  update client_portal_change_requests set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = note where id = p_id;
  insert into admin_audit (actor, action, target, detail)
    values (auth.uid(), 'client_change_' || p_status, p_id::text,
            jsonb_build_object('field_key', r.field_key, 'account_id', r.account_id, 'old_value', r.old_value, 'new_value', r.new_value, 'forced', stale and coalesce(p_force, false)));
end $$;

-- ---- execute rights: Supabase grants new functions to everyone, so name them explicitly ----------------

do $$
declare f text;
begin
  foreach f in array array['client_change_field(text)', 'client_change_iso(text)', 'client_change_official(uuid, text)', 'client_change_license_taken(uuid, text)', 'client_change_apply(uuid, text, text, uuid)',
    'client_change_submit(uuid, text, text)', 'client_changes_list()', 'client_changes_assignees()', 'client_changes_take(uuid)',
    'client_changes_assign(uuid, uuid)', 'client_changes_release(uuid)', 'client_changes_decide(uuid, text, text, boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['client_change_official(uuid, text)', 'client_change_apply(uuid, text, text, uuid)', 'client_change_submit(uuid, text, text)']
  loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['client_changes_list()', 'client_changes_assignees()', 'client_changes_take(uuid)', 'client_changes_assign(uuid, uuid)',
    'client_changes_release(uuid)', 'client_changes_decide(uuid, text, text, boolean)']
  loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
