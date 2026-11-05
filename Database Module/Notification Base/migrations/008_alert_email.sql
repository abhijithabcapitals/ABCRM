-- Staff email, off until the user approves it. Nothing here sends: Edge Function alert-digest reads the build function.
-- No schedule is created here. The schedule and turning email_enabled on are separate release steps.
insert into public.alert_settings (key, value) values ('email_enabled', 'false'), ('email_sender', '"info@abcapital.ae"')
on conflict (key) do nothing;

create table if not exists public.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null default 'Email' check (channel in ('Email')),
  kind text not null check (kind in ('Digest', 'Critical')),
  status text not null check (status in ('Sent', 'Failed')),
  sent_on date not null default ((now() at time zone 'Asia/Dubai')::date),
  sent_at timestamptz not null default now(),
  error text,
  unique (alert_id, user_id, channel, kind, sent_on)
);
alter table public.alert_deliveries enable row level security;
revoke all on public.alert_deliveries from anon, authenticated;

-- Who should get mail now. Selects named fields only, so register references cannot appear.
-- Follows the bell rules: nothing in Preview or for backlog rows, and Triage reaches assigned people only.
create or replace function public.alert_email_build(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_mode text := alert_mode(); v_today date := (now() at time zone 'Asia/Dubai')::date; v_on boolean;
begin
  if p_kind is null or p_kind not in ('Digest', 'Critical') then raise exception 'Kind must be Digest or Critical.'; end if;
  select coalesce((select value = 'true'::jsonb from alert_settings where key = 'email_enabled'), false) into v_on;
  if not v_on or v_mode not in ('Triage', 'Live') then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', x.name, 'email', x.email, 'alerts', x.alerts) order by x.name, x.user_id)
    from (
      select p.id as user_id, p.full_name as name, p.email,
             jsonb_agg(jsonb_build_object('id', a.id, 'number', a.alert_number, 'title', a.title, 'due_date', a.due_date,
                                          'priority', a.priority, 'action', a.action_required)
                       order by array_position(array['Critical', 'High', 'Medium', 'Normal'], a.priority), a.due_date nulls last, a.id) as alerts
      from alert_recipients r
      join alerts a on a.id = r.alert_id
      join profiles p on p.id = r.user_id
      where a.status in ('Open', 'In progress') and not a.backlog
        and nullif(btrim(p.email), '') is not null
        and (r.reason = 'Assigned' or (v_mode = 'Live' and r.reason = 'Manager' and a.assigned_to is null))
        and alert_channel_on(p.id, a.category, 'Email', a.priority)
        and ((p_kind = 'Critical' and a.priority = 'Critical'
              and not exists (select 1 from alert_deliveries d where d.alert_id = a.id and d.user_id = p.id and d.kind = 'Critical' and d.status = 'Sent'))
          or (p_kind = 'Digest'
              and not exists (select 1 from alert_deliveries d where d.alert_id = a.id and d.user_id = p.id and d.kind = 'Digest' and d.status = 'Sent' and d.sent_on = v_today)))
      group by p.id, p.full_name, p.email
    ) x), '[]'::jsonb);
end $$;

-- p_items: [{alert_id, user_id, kind, status, error}]. A retry after a failure updates the same row.
create or replace function public.alert_email_record(p_items jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be a JSON array.'; end if;
  insert into alert_deliveries (alert_id, user_id, kind, status, error)
  select (i->>'alert_id')::uuid, (i->>'user_id')::uuid, i->>'kind', i->>'status', left(i->>'error', 500)
  from jsonb_array_elements(p_items) i
  on conflict (alert_id, user_id, channel, kind, sent_on) do update
    set status = excluded.status, error = excluded.error, sent_at = now();
end $$;

revoke all on function public.alert_email_build(text), public.alert_email_record(jsonb) from public, anon, authenticated;
grant execute on function public.alert_email_build(text), public.alert_email_record(jsonb) to service_role;
