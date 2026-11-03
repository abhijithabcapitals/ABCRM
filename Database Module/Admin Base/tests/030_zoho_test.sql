-- Zoho tables: constraints and who may read or write. Runs on the throwaway cluster after 020.
\set ON_ERROR_STOP on
create schema t3;
grant usage on schema t3 to public;
create function t3.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t3.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok %', label;
    return;
  end;
  raise exception 'FAILED: % (it worked)', label;
end $$;
grant execute on all functions in schema t3 to public;

insert into public.client_master values ('C-1');
insert into public.zoho_contact_links (client_id, zoho_contact_id, zoho_contact_name) values ('C-1', 'z1', 'Acme');
insert into public.zoho_documents (department, source_table, source_id, kind, reference, state)
  values ('Banking', 'banking_quotations', '11111111-1111-1111-1111-111111111111', 'estimate', 'Q-1', 'creating');
select t3.ok('a document row gets an id and a time', (select id is not null and created_at is not null from public.zoho_documents));
select t3.fails('source_table rejects other values', $$insert into public.zoho_documents (department, source_table, source_id, kind, reference, state) values ('Banking', 'deals', gen_random_uuid(), 'estimate', 'r', 'creating')$$);
select t3.fails('department rejects other values', $$insert into public.zoho_documents (department, source_table, source_id, kind, reference, state) values ('HR', 'hub_documents', gen_random_uuid(), 'estimate', 'r', 'creating')$$);
select t3.fails('kind rejects credit', $$insert into public.zoho_documents (department, source_table, source_id, kind, reference, state) values ('Banking', 'hub_documents', gen_random_uuid(), 'credit', 'r', 'creating')$$);
select t3.fails('a bad state fails', $$insert into public.zoho_documents (department, source_table, source_id, kind, reference, state) values ('Banking', 'hub_documents', gen_random_uuid(), 'estimate', 'r', 'sent')$$);
select t3.fails('a second row for one source and kind fails', $$insert into public.zoho_documents (department, source_table, source_id, kind, reference, state) values ('Banking', 'banking_quotations', '11111111-1111-1111-1111-111111111111', 'estimate', 'Q-1b', 'creating')$$);
insert into public.zoho_documents (department, source_table, source_id, kind, reference, state)
  values ('Banking', 'banking_quotations', '11111111-1111-1111-1111-111111111111', 'invoice', 'Q-1', 'failed');
select t3.fails('a link needs a real client', $$insert into public.zoho_contact_links (client_id, zoho_contact_id, zoho_contact_name) values ('nope', 'z', 'n')$$);
select t3.fails('a state cannot be null', $$insert into public.zoho_documents (department, source_table, source_id, kind, reference) values ('Banking', 'hub_documents', gen_random_uuid(), 'estimate', 'r')$$);

set role authenticated;
select t3.ok('authenticated can read documents', (select count(*) = 2 from public.zoho_documents));
select t3.ok('authenticated can read links', (select count(*) = 1 from public.zoho_contact_links));
select t3.fails('authenticated cannot insert a document', $$insert into public.zoho_documents (department, source_table, source_id, kind, reference, state) values ('Banking', 'hub_documents', gen_random_uuid(), 'estimate', 'r', 'creating')$$);
select t3.fails('authenticated cannot update a document', $$update public.zoho_documents set state = 'gone'$$);
select t3.fails('authenticated cannot delete a document', $$delete from public.zoho_documents$$);
select t3.fails('authenticated cannot insert a link', $$insert into public.zoho_contact_links (client_id, zoho_contact_id, zoho_contact_name) values ('C-1', 'z', 'n')$$);
select t3.fails('authenticated cannot update a link', $$update public.zoho_contact_links set zoho_contact_id = 'x'$$);
select t3.fails('authenticated cannot delete a link', $$delete from public.zoho_contact_links$$);
reset role;
set role anon;
select t3.fails('anon cannot read documents', $$select count(*) from public.zoho_documents$$);
select t3.fails('anon cannot read links', $$select count(*) from public.zoho_contact_links$$);
reset role;
set role service_role;
update public.zoho_documents set state = 'created', zoho_id = 'zd1', total = 10.5 where kind = 'estimate';
update public.zoho_contact_links set zoho_contact_name = 'Acme 2';
insert into public.zoho_documents (department, source_table, source_id, kind, reference, state) values ('Business Setup', 'hub_documents', gen_random_uuid(), 'invoice', 'r', 'creating');
delete from public.zoho_documents where reference = 'r';
reset role;
select t3.ok('the service role wrote documents and links', (select count(*) = 1 from public.zoho_documents where state = 'created' and total = 10.5) and (select zoho_contact_name = 'Acme 2' from public.zoho_contact_links));
select t3.ok('zoho_documents is under row level security', (select relrowsecurity from pg_class where oid = 'public.zoho_documents'::regclass));
select t3.ok('zoho_contact_links is under row level security', (select relrowsecurity from pg_class where oid = 'public.zoho_contact_links'::regclass));
