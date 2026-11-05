-- Removes the review fixes and restores each function body exactly as it stood before 015. Safe to run twice. Runs before rollback/014_rollback.sql.

-- ── 015: C1 ──
create or replace function public.client_contact_log(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_client text := nullif(btrim(p->>'client_id'), ''); v_on date; v_follow date;
begin
  if auth.uid() is null then raise exception 'Sign in to log a contact.'; end if;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  begin
    v_on := coalesce(nullif(p->>'contacted_on', '')::date, (now() at time zone 'Asia/Dubai')::date);
    v_follow := nullif(p->>'follow_up_on', '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Dates must be real dates, written YYYY-MM-DD.'; end;
  if v_follow is not null and v_follow < v_on then raise exception 'The follow-up date is before the contact date.'; end if;
  insert into client_contacts (client_id, channel, note, contacted_on, follow_up_on, created_by)
  values (v_client, coalesce(nullif(p->>'channel', ''), 'Other'), nullif(btrim(p->>'note'), ''), v_on, v_follow, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
create or replace function public.client_document_request(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_client text := nullif(btrim(p->>'client_id'), ''); v_what text := nullif(btrim(p->>'what'), ''); v_due date;
begin
  if auth.uid() is null then raise exception 'Sign in to log a request.'; end if;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  if v_what is null then raise exception 'Say which documents were requested.'; end if;
  begin
    v_due := coalesce(nullif(p->>'due_on', '')::date, (now() at time zone 'Asia/Dubai')::date + 7);
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Dates must be real dates, written YYYY-MM-DD.'; end;
  insert into client_document_requests (client_id, what, due_on, created_by) values (v_client, v_what, v_due, auth.uid()) returning id into v_id;
  return v_id;
end $$;
create or replace function public.client_document_answered(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in to update a request.'; end if;
  update client_document_requests set status = 'Answered', answered_on = (now() at time zone 'Asia/Dubai')::date, note = nullif(btrim(p_note), '')
  where id = p_id and status = 'Open';
  if not found then raise exception 'That request is not open.'; end if;
end $$;
create or replace function public.client_work_list(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return jsonb_build_object(
    'contacts', coalesce((select jsonb_agg(x) from (select c.id, c.channel, c.note, c.contacted_on, c.follow_up_on, p.full_name as by_name from client_contacts c left join profiles p on p.id = c.created_by
                          where c.client_id = p_client order by c.contacted_on desc, c.created_at desc limit 20) x), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(x) from (select r.id, r.what, r.requested_on, r.due_on, r.status from client_document_requests r
                          where r.client_id = p_client and r.status = 'Open' order by r.due_on limit 20) x), '[]'::jsonb));
end $$;
create or replace function public.alert_manual_raise(p_type text, p_client text, p_detail text default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t jsonb; v_name text; v_dept text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to log an item.'; end if;
  select e into v_t from jsonb_array_elements(alert_manual_types()) e where e->>'type' = p_type;
  if v_t is null then raise exception 'Unknown item type.'; end if;
  select legal_name into v_name from client_master where client_id = p_client;
  if v_name is null then raise exception 'Unknown client.'; end if;
  select department into v_dept from alert_rules where code = v_t->>'rule';
  v_id := alert_raise(v_t->>'rule', 'manual:' || gen_random_uuid(), p_client, p_type || ' - ' || v_name, v_dept,
                      coalesce(p_due, (now() at time zone 'Asia/Dubai')::date + 7), 0, v_t->>'priority',
                      coalesce(alert_owner(p_client, v_dept), auth.uid()), 'client_master', p_client, null, nullif(btrim(p_detail), ''));
  return v_id;
end $$;
drop function if exists public.client_work_can(text);
