-- Undoes migrations 013 onward (the case restructure), newest first, in one transaction. Migrations 001 to 012 stay.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- Run with psql (it uses \ir to re-run the file that last defined a replaced function). Each migration adds its section
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- at the top of the body, above the one before it, so the order here is the reverse of the order they were applied.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- WARNING: cases and everything stored only on them are lost. Quotes, letters, payments and forms keep their rows.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
begin;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- ── 018_portal.sql ───────────────────────────────────────────────────
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- The portal view goes back to 010's (no signed-copy fields) and the client upload function goes.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_portal_signed_add(uuid, uuid, text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
\ir ../migrations/010_portal.sql
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- ── 015_documentation.sql ────────────────────────────────────────────
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- hub_document_create goes back to 014's, and fee_item_save to 005's, by running those files again. Quotes keep their rows: the
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- vat_rate and scope stored on their lines stay in the JSON, where nothing reads them, and a quote issued with line VAT keeps its amounts.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- The three company items go unless a service uses them (then they stay, at 0), and every other empty amount becomes 0.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
\ir ../migrations/014_leads_ownership.sql
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
\ir ../migrations/005_kyc_fees.sql
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
delete from public.business_setup_fee_items f where f.grp = 'Company' and f.name in ('Company registration', 'Company renewal', 'Visa') and f.default_amount is null
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
   and not exists (select 1 from public.business_setup_services s where s.fee_item_id = f.id);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
update public.business_setup_fee_items set default_amount = 0 where default_amount is null;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
alter table public.business_setup_fee_items alter column default_amount set not null;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
alter table public.business_setup_fee_items drop column if exists vat_rate;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- ── 014_leads_ownership.sql ──────────────────────────────────────────
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop policy if exists business_setup_staff_upload on storage.objects;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_staff_upload_ok(text, text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- Linking a quote to a client, as Business Setup Base 006 defines it (014 also fills the case).
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
create or replace function public.business_setup_quote_link(p_id uuid, p_client text) returns void
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
language plpgsql security definer set search_path = public, pg_temp as $$
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
declare
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  q hub_documents;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
begin
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  perform business_setup_require('setup.quotes.manage');
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  select * into q from hub_documents where id = p_id for update;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.id is null then raise exception 'Quote not found'; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be linked to a client'; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if not exists (select 1 from client_master where client_id = p_client) then raise exception 'Client % not found', p_client; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.client_id is not null and q.client_id <> p_client then raise exception 'This quote is already linked to a different client'; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.client_id = p_client then return; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  update hub_documents set client_id = p_client where id = q.id;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  perform business_setup_audit('hub_documents', q.id::text, 'quote_link', null,
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
          jsonb_build_object('client_id', p_client, 'document_number', q.document_number));
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
end $$;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop trigger if exists business_setup_case_service on public.business_setup_services;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_service_trg();
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_new(jsonb);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_take(uuid);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_link_client(uuid, text, boolean);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_shared(uuid);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_lost(uuid, text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_confirm(uuid);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_assign(uuid, uuid, text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_list(text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_reassign_request(uuid, uuid, text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_reassign_respond(uuid, boolean, text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_form_staff_save(uuid, jsonb);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_form_doc_add(uuid, text, text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop table if exists public.business_setup_reassign_requests;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- Accepting a quote, as Business Setup Base 006 defines it (014 adds a one-accepted-quote-per-case check).
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
create or replace function public.business_setup_quote_accept(p_id uuid, p_allow_expired boolean default false) returns jsonb
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
language plpgsql security definer set search_path = public, pg_temp as $$
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
declare
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  q hub_documents; v_root uuid; ln jsonb; kyc jsonb; v_today date := (now() at time zone 'Asia/Dubai')::date;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  v_name text; v_action text; v_renews uuid; v_fee uuid; v_svc uuid; n int := 0;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
begin
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  perform business_setup_require('setup.quotes.manage');
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  select * into q from hub_documents where id = p_id;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.id is null then raise exception 'Quote not found'; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be accepted'; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  v_root := coalesce(q.root_quote_id, q.id);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  perform 1 from hub_documents where id = v_root for update;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  select * into q from hub_documents where id = p_id for update;   -- read again: it may have changed while we waited
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if exists (select 1 from hub_documents where doc_type = 'quote' and status = 'accepted' and coalesce(root_quote_id, id) = v_root) then
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    raise exception 'A quote in this revision chain is already accepted';
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be accepted (this one is %)', q.status; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.client_id is null then raise exception 'Link this quote to a client before accepting it'; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  kyc := business_setup_kyc_status(q.client_id);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  -- KYC already done (validated here, or marked Done in the old records) is not asked for again.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if (kyc ->> 'percent')::int < 100 and not exists (select 1 from business_setup_kyc_profiles where client_id = q.client_id and kyc_state = 'Done') then
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    raise exception 'The client KYC is incomplete: missing %', (select string_agg(m, ', ') from jsonb_array_elements_text(kyc -> 'missing') m);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  if q.valid_until is not null and q.valid_until < v_today and not coalesce(p_allow_expired, false) then
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    raise exception 'This quote expired on %: confirm to accept it anyway', to_char(q.valid_until, 'DD Mon YYYY');
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  update hub_documents set status = 'accepted', status_at = now(), status_by = auth.uid(),
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
         status_reason = case when q.valid_until is not null and q.valid_until < v_today then 'Accepted after expiry' else null end
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
   where id = q.id;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  for ln in select value from jsonb_array_elements(coalesce(q.lines, '[]'::jsonb)) loop
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    v_name := coalesce(nullif(btrim(coalesce(ln ->> 'service_name', '')), ''), nullif(btrim(coalesce(ln ->> 'description', '')), ''));
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    if v_name is null then raise exception 'Every quote line needs a service name'; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    v_action := coalesce(nullif(btrim(coalesce(ln ->> 'action', '')), ''), 'New');
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    if v_action not in ('New','Renewal','Rectification','Cancellation') then raise exception 'Unknown action % on a quote line', v_action; end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    v_renews := nullif(ln ->> 'renews_service_id', '')::uuid;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    if v_renews is not null and not exists (select 1 from business_setup_services where id = v_renews and client_id = q.client_id) then
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
      raise exception 'A renewal must link to an earlier service of the same client';
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    end if;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    v_fee := nullif(ln ->> 'fee_item_id', '')::uuid;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    insert into business_setup_services (client_id, quote_id, fee_item_id, name, action, amount, renews_service_id)
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    values (q.client_id, q.id, v_fee, v_name, v_action, nullif(ln ->> 'amount', '')::numeric, v_renews)
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    returning id into v_svc;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    insert into business_setup_service_history (service_id, from_status, to_status, note)
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    values (v_svc, null, 'Not started', 'Created from quote ' || q.document_number);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    n := n + 1;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  end loop;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  perform business_setup_audit('hub_documents', q.id::text, 'quote_accept', null,
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'services_created', n,
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
                             'after_expiry', q.valid_until is not null and q.valid_until < v_today));
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  return jsonb_build_object('quote_id', q.id, 'status', 'accepted', 'services_created', n);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
end $$;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- Payments stop following their quote's case, and net paid goes back to a sum by quote (Business Setup Base 006).
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop trigger if exists business_setup_payment_case_fill on public.business_setup_payments;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_payment_case_fill();
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
create or replace function public.business_setup_net_paid(p_quote uuid) returns numeric
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
language sql stable security definer set search_path = public, pg_temp as $$
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  select coalesce(sum(case when type = 'Payment' then amount else -amount end), 0) from business_setup_payments where quote_id = p_quote
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
$$;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- The dashboard, as Business Setup Base 008 defines it (009 and 011 only replace its helpers, which 014 leaves alone).
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
create or replace function public.business_setup_dashboard() returns jsonb
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
language plpgsql stable security definer set search_path = public, pg_temp as $$
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
declare v_exp jsonb;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
begin
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  perform business_setup_require('setup.access');
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  v_exp := business_setup_expiries();
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  return jsonb_build_object(
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'forms_waiting', business_setup_dash_forms(),
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'open_quotes', (select count(*) from hub_documents where department = 'Business Setup' and doc_type = 'quote' and status = 'issued'),
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'accepted_without_letter', (select count(*) from hub_documents q where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
                                   and not exists (select 1 from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter')),
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'outstanding', (select coalesce(sum(greatest(q.total_amount - business_setup_net_paid(q.id), 0)), 0) from hub_documents q
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
                     where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'),
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'active_services', (select count(*) from business_setup_services where status not in ('Completed', 'Cancelled') and not historical),
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'expiries', jsonb_build_object('upcoming', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Upcoming'),
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
                                   'past', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Past date'))
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  ) || business_setup_dash_handover();
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
end $$;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- hub_document_create, as 013 defines it. The 013 section below then puts back the version before 013.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
\ir ../migrations/013_cases.sql
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- ── 013_cases.sql ────────────────────────────────────────────────────
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop trigger if exists business_setup_case_form on public.business_setup_onboarding_forms;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop trigger if exists business_setup_case_doc_ins on public.hub_documents;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop trigger if exists business_setup_case_doc_status on public.hub_documents;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop trigger if exists business_setup_case_payment on public.business_setup_payments;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- Payments go back to fully append-only.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop trigger if exists business_setup_payments_immutable on public.business_setup_payments;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
create trigger business_setup_payments_immutable before update or delete on public.business_setup_payments
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  for each row execute function public.business_setup_append_only();
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_form_trg();
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_sync_trg();
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_payment_guard();
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_sync(uuid);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_docs(uuid);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop function if exists public.business_setup_case_set_stage(uuid, text, text);
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
alter table public.hub_documents drop column if exists case_id cascade;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
alter table public.business_setup_payments drop column if exists case_id cascade;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
alter table public.business_setup_onboarding_forms drop column if exists case_id cascade;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop table if exists public.business_setup_cases cascade;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
drop sequence if exists public.business_setup_case_seq;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
delete from public.business_setup_role_permissions where permission in ('setup.leads.manage', 'setup.cases.approve');
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
delete from public.business_setup_user_permissions where permission in ('setup.leads.manage', 'setup.cases.approve');
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- The permission list, as Business Setup Base 001 defines it.
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
create or replace function public.business_setup_permissions() returns text[]
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
language sql immutable set search_path = public, pg_temp as $$
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
  select array[
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'setup.access', 'setup.kyc.manage', 'setup.kyc.sensitive', 'setup.quotes.manage',
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'setup.payments.manage', 'setup.payments.override', 'setup.services.manage', 'setup.services.override',
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'setup.fees.manage', 'setup.portal.manage', 'setup.import.manage', 'setup.audit.view', 'setup.settings.manage',
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
    'kyc.view', 'kyc.manage']
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
$$;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
-- hub_document_create, as Business Setup Base 004 defines it (no later file replaces it before 013).
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
\ir ../migrations/004_hub_extension.sql
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;

-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
commit;
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop table if exists public.business_setup_signed_quotes;
