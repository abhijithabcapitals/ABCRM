-- Lead Base: editing lead details from outside the CRM screen (Database Module/Lead Base),
-- through the same permission, validation, duplicate and audit rules as the CRM.
-- Also removes TRUNCATE from browser roles on every BD table (row-level security
-- does not apply to TRUNCATE).

-- Edit the descriptive fields of one lead. Stage, status, owner and commercial
-- fields keep their own workflows (bd_change_stage, follow-ups, won/lost, services).
-- p_changes keys: name, contact_name, designation, mobile, whatsapp, email, website,
-- country, emirate, priority (Low|Medium|High|Urgent), estimated_budget, budget_currency,
-- notes, source_detail, duplicate_exception (managers only).
create or replace function public.bd_update_lead(p_lead_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.bd_leads;
  v_new public.bd_leads;
  v_allowed text[] := array['name', 'contact_name', 'designation', 'mobile', 'whatsapp', 'email', 'website',
                            'country', 'emirate', 'priority', 'estimated_budget', 'budget_currency', 'notes',
                            'source_detail', 'duplicate_exception'];
  v_bad text;
  v_name text;
  v_email text;
  v_mobile text;
  v_dup boolean := false;
  v_priority text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not public.bd_can_edit_lead(p_lead_id) then
    raise exception 'You cannot edit this lead.';
  end if;
  select k into v_bad from jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) k where k <> all (v_allowed) limit 1;
  if v_bad is not null then raise exception 'Field "%" cannot be edited here.', v_bad; end if;

  select * into v_old from public.bd_leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found.'; end if;
  v_new := v_old;

  if p_changes ? 'name' then
    v_name := btrim(coalesce(p_changes->>'name', ''));
    if v_name = '' then raise exception 'The lead name cannot be empty.'; end if;
    v_new.prospect_name := v_name;
    if v_old.lead_type = 'Company' then v_new.company_name := v_name; end if;
  end if;
  if p_changes ? 'contact_name' then v_new.primary_contact_name := nullif(btrim(p_changes->>'contact_name'), ''); end if;
  if p_changes ? 'designation' then v_new.designation := nullif(btrim(p_changes->>'designation'), ''); end if;
  if p_changes ? 'mobile' then v_new.mobile_number := nullif(btrim(p_changes->>'mobile'), ''); end if;
  if p_changes ? 'whatsapp' then v_new.whatsapp_number := nullif(btrim(p_changes->>'whatsapp'), ''); end if;
  if p_changes ? 'email' then
    v_email := nullif(btrim(p_changes->>'email'), '');
    if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Enter a valid email address.';
    end if;
    v_new.email := v_email;
  end if;
  if p_changes ? 'website' then v_new.website := nullif(btrim(p_changes->>'website'), ''); end if;
  if p_changes ? 'country' then v_new.country := nullif(btrim(p_changes->>'country'), ''); end if;
  if p_changes ? 'emirate' then v_new.emirate := nullif(btrim(p_changes->>'emirate'), ''); end if;
  if p_changes ? 'priority' then
    v_priority := case btrim(coalesce(p_changes->>'priority', '')) when 'Medium' then 'Normal' when '' then 'Normal'
                  else initcap(btrim(p_changes->>'priority')) end;
    if v_priority not in ('Low', 'Normal', 'High', 'Urgent') then raise exception 'Priority must be Low, Medium, High or Urgent.'; end if;
    v_new.priority := v_priority;
  end if;
  if p_changes ? 'estimated_budget' then
    v_new.estimated_budget := nullif(btrim(coalesce(p_changes->>'estimated_budget', '')), '')::numeric;
  end if;
  if p_changes ? 'budget_currency' then
    v_new.budget_currency := upper(coalesce(nullif(btrim(p_changes->>'budget_currency'), ''), 'AED'));
  end if;
  if p_changes ? 'notes' then v_new.internal_notes := nullif(btrim(p_changes->>'notes'), ''); end if;
  if p_changes ? 'source_detail' then v_new.source_detail := nullif(btrim(p_changes->>'source_detail'), ''); end if;

  if v_new.mobile_number is null and v_new.email is null then
    raise exception 'A lead needs at least one contact method: mobile or email.';
  end if;

  -- Duplicate check when contact details or the name change (same rule as bd_create_lead).
  if v_new.mobile_number is distinct from v_old.mobile_number or v_new.email is distinct from v_old.email
     or v_new.prospect_name is distinct from v_old.prospect_name then
    v_mobile := nullif(regexp_replace(coalesce(v_new.mobile_number, ''), '\D', '', 'g'), '');
    select exists (
      select 1 from public.bd_leads e
      where e.id <> p_lead_id and e.archived_at is null
        and ((v_mobile is not null and right(e.mobile_normalized, 9) = right(v_mobile, 9))
          or (v_new.email is not null and e.email_normalized = lower(btrim(v_new.email)))
          or (e.lead_type = v_new.lead_type and lower(regexp_replace(btrim(e.prospect_name), '\s+', ' ', 'g'))
                                               = lower(regexp_replace(btrim(v_new.prospect_name), '\s+', ' ', 'g'))))) into v_dup;
    if v_dup and not coalesce((p_changes->>'duplicate_exception')::boolean, false) then
      raise exception 'Another lead already has this name, email or mobile. Review it before saving.';
    end if;
    if v_dup and not public.bd_is_manager() then
      raise exception 'Only a manager can approve a duplicate-lead exception.';
    end if;
  end if;

  update public.bd_leads set
    prospect_name = v_new.prospect_name, company_name = v_new.company_name,
    primary_contact_name = v_new.primary_contact_name, designation = v_new.designation,
    mobile_number = v_new.mobile_number, whatsapp_number = v_new.whatsapp_number, email = v_new.email,
    -- an edited mobile arrives as one full number (the UI shows code + number together)
    mobile_country_code = case when p_changes ? 'mobile' then null else v_old.mobile_country_code end,
    website = v_new.website, country = v_new.country, emirate = v_new.emirate, priority = v_new.priority,
    estimated_budget = v_new.estimated_budget, budget_currency = v_new.budget_currency,
    internal_notes = v_new.internal_notes, source_detail = v_new.source_detail,
    duplicate_override = v_old.duplicate_override or v_dup, updated_by = auth.uid()
  where id = p_lead_id
  returning * into v_new;

  perform public.bd_audit('bd_leads', p_lead_id, 'Update', to_jsonb(v_old), to_jsonb(v_new), 'Edited via Lead Base');
  return public.bd_lead_ui_json(p_lead_id);
end $$;

revoke all on function public.bd_update_lead(uuid, jsonb) from public, anon;
grant execute on function public.bd_update_lead(uuid, jsonb) to authenticated;

-- Browser roles never need TRUNCATE; row-level security does not apply to it.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname like 'bd\_%' and c.relkind in ('r', 'v', 'p')
  loop
    execute format('revoke truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;
