-- Each person chooses which categories reach them, per channel. No row means on.
-- Critical alerts always reach the bell. Lists and recipients do not change: a preference only stops the notice.
create table if not exists public.alert_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null,
  channel text not null check (channel in ('Bell', 'Email')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, category, channel)
);
alter table public.alert_preferences enable row level security;
revoke all on public.alert_preferences from anon, authenticated;

create or replace function public.alert_categories() returns text[]
language sql immutable security definer set search_path = public, pg_temp as $$
  select array['Deadlines', 'Licence', 'Visa & Emirates ID', 'Ejari & Establishment Card', 'Client Documents', 'Government Applications',
               'Follow-ups', 'Payments', 'UBO & AML', 'Tax', 'Regulatory', 'Client Activity']
$$;

create or replace function public.alert_channel_on(p_user uuid, p_category text, p_channel text, p_priority text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_channel = 'Bell' and p_priority = 'Critical' then true
              else coalesce((select enabled from alert_preferences where user_id = p_user and category = p_category and channel = p_channel), true) end
$$;

create or replace function public.alert_preferences_get() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in to see your preferences.'; end if;
  return jsonb_build_object('categories', to_jsonb(alert_categories()), 'channels', '["Bell", "Email"]'::jsonb,
    'off', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'channel', channel) order by category, channel)
                     from alert_preferences where user_id = auth.uid() and not enabled), '[]'::jsonb));
end $$;

create or replace function public.alert_preferences_save(p_category text, p_channel text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in to change your preferences.'; end if;
  if p_category is null or not (p_category = any (alert_categories())) then raise exception 'Unknown category.'; end if;
  if p_channel is null or p_channel not in ('Bell', 'Email') then raise exception 'Channel must be Bell or Email.'; end if;
  if p_enabled is null then raise exception 'Choose on or off.'; end if;
  insert into alert_preferences (user_id, category, channel, enabled) values (auth.uid(), p_category, p_channel, p_enabled)
  on conflict (user_id, category, channel) do update set enabled = excluded.enabled, updated_at = now();
end $$;

-- 001's bell, plus the preference check. Preview, backlog and Triage rules are unchanged.
create or replace function public.alert_bell(p_id uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mode text := alert_mode(); v_a alerts%rowtype;
begin
  if v_mode = 'Preview' then return; end if;
  if v_mode = 'Triage' and p_reason <> 'Assigned' then return; end if;
  select * into v_a from alerts where id = p_id;
  if not found or v_a.backlog then return; end if;
  if not alert_channel_on(p_user, v_a.category, 'Bell', v_a.priority) then return; end if;
  insert into notifications (user_id, task_id, type, title, body, link_scope, read)
  values (p_user, null, 'alert_centre', v_a.title, v_a.action_required, jsonb_build_object('alert_id', p_id), false);
end $$;

revoke all on function public.alert_categories(), public.alert_channel_on(uuid, text, text, text),
  public.alert_preferences_get(), public.alert_preferences_save(text, text, boolean) from public, anon, authenticated;
grant execute on function public.alert_preferences_get(), public.alert_preferences_save(text, text, boolean) to authenticated;
