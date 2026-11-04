-- LOCAL TEST ONLY. Sign-in stand-in, checks and test people. No Supabase objects are touched.
create or replace function public.at_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('role', case when p_user is null then 'postgres' else 'authenticated' end, false);
end $$;
grant execute on function public.at_as(uuid) to authenticated;

create or replace function public.at_check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'ok   %', p_name; else raise exception 'FAIL %', p_name; end if;
end $$;
grant execute on function public.at_check(text, boolean) to authenticated;

-- Runs p_sql and reports whether it raised an error containing p_text.
create or replace function public.at_refused(p_sql text, p_text text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return position(p_text in sqlerrm) > 0;
end $$;
grant execute on function public.at_refused(text, text) to authenticated;

-- A valid request for the fixture client, with its own request id.
create or replace function public.at_req(p_type text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('request_id', gen_random_uuid(), 'doc_type', p_type,
    'details', jsonb_build_object('docType', p_type, 'quoteType', 'Standard', 'selected', 'Established',
      'client', jsonb_build_object('legal', 'Sample Trading LLC'),
      'tiers', jsonb_build_object('S', jsonb_build_object('docs', 3600, 'year', 4199)), 'options', '{}'::jsonb,
      'rows', jsonb_build_object('ONB', jsonb_build_object('inc', true, 'fee', 1500, 'type', 'One-time'), 'ANN', jsonb_build_object('inc', true, 'type', 'Annual')),
      'custom', jsonb_build_object('items', '[]'::jsonb)),
    'totals', jsonb_build_object('one_time', 1500, 'annual', 4199, 'year1', 5699),
    'mail_to', 'poc@sample.example', 'mail_subject', 'S', 'mail_body', 'B') || p_extra
$$;
grant execute on function public.at_req(text, jsonb) to authenticated;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'), ('00000000-0000-0000-0000-0000000000a3') on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'AT Admin', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'AT Member', 'member'),
  ('00000000-0000-0000-0000-0000000000a3', 'AT Outsider', 'member')
on conflict (id) do nothing;
insert into public.member_tab_access (profile_id, tab_key) values ('00000000-0000-0000-0000-0000000000a2', 'ardentax') on conflict do nothing;
