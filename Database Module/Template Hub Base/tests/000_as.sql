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

-- A library request for a template and file, with the browser's extra keys merged in.
create or replace function public.at_lib(p_template text, p_file bigint, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('template_key', p_template, 'file_id', p_file, 'client_name', 'Sample Trading LLC', 'contact_name', 'Sam Sample',
    'contact_email', 'sam@sample.example', 'contact_phone', '+971500000000', 'client_address', 'Dubai',
    'field_values', jsonb_build_object('purpose', 'test'),
    'lines', jsonb_build_array(jsonb_build_object('description', 'Setup fee', 'amount', 1000, 'remarks', 'one time', 'rate', 1000),
                               jsonb_build_object('description', 'Filing fee', 'amount', 500.50))) || p_extra
$$;
grant execute on function public.at_lib(text, bigint, jsonb) to authenticated;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b3'), ('00000000-0000-0000-0000-0000000000b4') on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'LB Manager', 'member'),
  ('00000000-0000-0000-0000-0000000000b2', 'LB Quoter', 'member'),
  ('00000000-0000-0000-0000-0000000000b3', 'LB Ardent', 'member'),
  ('00000000-0000-0000-0000-0000000000b4', 'LB Outsider', 'member')
on conflict (id) do nothing;
-- manager: settings.manage and setup.quotes.manage. quoter: setup.quotes.manage only. ardent: the ArdentTax tab only.
insert into public.banking_user_permissions (user_id, permission, allowed) values ('00000000-0000-0000-0000-0000000000b1', 'settings.manage', true) on conflict do nothing;
insert into public.business_setup_user_permissions (user_id, permission, allowed) values
  ('00000000-0000-0000-0000-0000000000b1', 'setup.quotes.manage', true),
  ('00000000-0000-0000-0000-0000000000b2', 'setup.quotes.manage', true) on conflict do nothing;
insert into public.member_tab_access (profile_id, tab_key) values ('00000000-0000-0000-0000-0000000000b3', 'ardentax') on conflict do nothing;
