-- LOCAL TEST ONLY: Pending deals return to the lead pipeline (017). Runs after 030_board_status_test.sql on the same cluster.
\set QUIET on
\pset tuples_only on
\pset format unaligned
reset role;
truncate public.t_result;

create function public.lead2(t text) returns public.banking_leads language sql as $$
  select l.* from public.banking_leads l join public.banking_cases c on c.lead_id = l.id where c.id = (public.lr2(t)).case_id
$$;
update public.banking_leads l set status = 'Converted', converted_at = now(), picked_up_at = null from public.banking_cases c where c.lead_id = l.id and c.id = (public.lr2('b4')).case_id;
select public.keep('done_status', (public.lead2('b2')).status);
select public.ok('fixture starts Converted', (public.lead2('b4')).status = 'Converted');

\ir ../migrations/017_banking_pending_pipeline.sql
select public.ok('Pending deal returns to the pipeline', (public.lead2('b4')).status = 'Potential Client' and (public.lead2('b4')).picked_up_at is not null and (public.lead2('b4')).converted_at is null);
select public.ok('Done deal is unchanged', (public.lead2('b2')).status = (select v from public.t_ids where k = 'done_status'));
select public.ok('old values are saved', (select status = 'Converted' from public.banking_lead_pipeline_017_backup where lead_id = (public.lead2('b4')).id));
select public.ok('backup is closed to signed-in users', not has_table_privilege('authenticated', 'public.banking_lead_pipeline_017_backup', 'select'));

select public.as_user('0a');
select public.keep('pay', public.banking_payment_add((public.lr2('b4')).case_id, current_date, 500, 'Cash') ->> 'payment_id');
select public.ok('a payment converts it', (public.lead2('b4')).status = 'Converted');
reset role;
\ir ../migrations/017_banking_pending_pipeline.sql
select public.ok('re-running leaves a paid lead Converted', (public.lead2('b4')).status = 'Converted');
select public.as_user('0a');
select public.banking_payment_counter(public.id('pay'), 'Reversal', current_date, 'Test mistake') is not null;
select public.ok('reversing the payment returns it to the pipeline', (public.lead2('b4')).status = 'Potential Client');
select public.keep('pay2', public.banking_payment_add((public.lr2('b2')).case_id, current_date, 500, 'Cash') ->> 'payment_id');
select public.ok('other imported history still ignores payments', (public.lead2('b2')).status = (select v from public.t_ids where k = 'done_status'));

reset role;
update public.banking_leads set status = 'Lost' where id = (public.lead2('b4')).id;
\ir ../migrations/017_banking_pending_pipeline.sql
select public.ok('re-running leaves a Lost lead alone', (public.lead2('b4')).status = 'Lost');

\ir ../rollback/017_rollback.sql
select public.ok('rollback restores Converted', (public.lead2('b4')).status = 'Converted' and (public.lead2('b4')).picked_up_at is null);
\ir ../migrations/017_banking_pending_pipeline.sql
select public.as_user('0a');

-- 018: a row held for its bank is released once the bank exists.
select public.as_user('0a');
select public.keep('fstage', (public.banking_legacy_stage('Fomo.csv', 'sha3', jsonb_build_array(public.board_row('f1', 'Held Pay Co', 'NEWPAY', 'Pending', 'WIP', 'Document Collection'))) ->> 'import_id'));
select public.banking_legacy_apply(public.id('fstage')) is not null;
select public.ok('unknown bank is held', (public.lr2('f1')).decision = 'Skipped' and (public.lr2('f1')).case_id is null);
select public.as_user('0c');
select public.must_fail('sales cannot release', $$select public.banking_legacy_release_bank('f1')$$, 'permission');
select public.as_user('0a');
select public.must_fail('still refused while the bank is missing', $$select public.banking_legacy_release_bank('f1')$$, 'still not');
insert into public.banking_partners (bank_code, bank_name, aliases) values ('NEWPAY', 'NewPay', array['NEWPAY']);
select public.banking_legacy_release_bank('f1') is not null;
select public.ok('release creates the case', (public.lr2('f1')).decision = 'Committed' and (public.lr2('f1')).case_id is not null);
select public.ok('case records the board status', (select legacy_board_status = 'Pending' from public.banking_cases where id = (public.lr2('f1')).case_id));
select public.ok('its lead is In Pipeline', (public.lead2('f1')).status = 'Potential Client' and (public.lead2('f1')).picked_up_at is not null);
select public.must_fail('cannot be released twice', $$select public.banking_legacy_release_bank('f1')$$, 'not held');
select public.ok('FOMOPAY resolves', public.banking_legacy_bank('FOMOPAY') = 'FOMOPAY');
select public.as_user('0a');

\echo === 017 FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === 017 SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
