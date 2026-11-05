-- Read functions (Task 5). Prints "ok ..." per check and stops at the first failure.
-- Runs after 010, 020 and 030 (mode Live, managers b1 and b2, admins a1 and a2).
-- Figures from the functions are compared with counts taken straight from the tables as postgres, before "set role".
\set ON_ERROR_STOP on

select '00000000-0000-0000-0000-0000000000a1'::uuid as adm,
       '00000000-0000-0000-0000-0000000000b1'::uuid as mgr1,
       '00000000-0000-0000-0000-0000000005d1'::uuid as d1,
       '00000000-0000-0000-0000-0000000005d2'::uuid as d2 \gset
select (now() at time zone 'Asia/Dubai')::date as today \gset
update alert_settings set value = '"Live"' where key = 'alert_mode';

create function t.errtext(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlerrm; end $$;

insert into profiles values (:'d1', 'Dana Reads', 'd1@x', 'member'), (:'d2', 'Dev Reads', 'd2@x', 'member');
insert into client_master values ('T5CL', 'T5 Client Ltd');
insert into alert_rules (code, category, department, title_template, enabled) values
  ('t5_dead', 'Deadlines', 'Business Setup', '{subject}', false),
  ('t5_docs', 'Client Documents', 'Accounting', '{subject}', false),
  ('t5_gov', 'Government Applications', 'Accounting', '{subject}', false);

-- ═══ Fixtures ════════════════════════════════════════════════════════
-- Dana (d1) holds nine open alerts and one resolved; Dev (d2) one; two are unassigned. One of Dana's is backlog (raised in Preview).
select alert_raise('t5_dead', 't5-a1', 'CL000001', 'T5 a1', 'Business Setup', :'today'::date - 2, -1, 'High', :'d1', 't', 'i') as a1 \gset
select alert_raise('t5_dead', 't5-a2', 'CL000001', 'T5 a2', 'Business Setup', :'today'::date, 0, 'Medium', :'d1', 't', 'i') as a2 \gset
select alert_raise('t5_dead', 't5-a3', 'CL000001', 'T5 a3', 'Business Setup', :'today'::date + 3, 3, 'Critical', :'d1', 't', 'i') as a3 \gset
select alert_raise('t5_docs', 't5-a4', 'CL000001', 'T5 a4', 'Accounting', :'today'::date - 5, -1, 'Normal', :'d1', 't', 'i') as a4 \gset
select alert_raise('t5_gov', 't5-a5', 'CL000001', 'T5 a5', 'Business Setup', :'today'::date + 1, 1, 'Medium', :'d1', 't', 'i') as a5 \gset
select alert_raise('licence_expiry', 't5-a6', 'CL000001', 'T5 a6', 'Business Setup', :'today'::date + 20, 30, 'High', :'d1', 't', 'i') as a6 \gset
select alert_raise('licence_expiry', 't5-a7', 'CL000001', 'T5 a7', 'Business Setup', :'today'::date - 1, -1, 'Critical', :'d1', 't', 'i') as a7 \gset
select alert_raise('t5_dead', 't5-a8', 'CL000001', 'T5 a8', 'Business Setup', :'today'::date + 2, 2, 'High', :'d1', 't', 'i') as a8 \gset
select alert_raise('t5_dead', 't5-a9', 'CL000001', 'T5 a9', 'Business Setup', null, 1, 'Normal', :'d1', 't', 'i') as a9 \gset
select alert_raise('t5_dead', 't5-u1', 'CL000001', 'T5 u1', 'Business Setup', :'today'::date + 1, 1, 'High', null, 't', 'i') as u1 \gset
select alert_raise('t5_docs', 't5-u2', 'CL000001', 'T5 u2', 'Accounting', :'today'::date - 1, -1, 'Medium', null, 't', 'i') as u2 \gset
select alert_raise('t5_gov', 't5-e1', 'T5CL', 'T5 e1', 'Accounting', :'today'::date - 4, -4, 'Critical', :'d2', 't', 'i') as e1 \gset
update alert_settings set value = '"Preview"' where key = 'alert_mode';
select alert_raise('t5_dead', 't5-b1', 'CL000001', 'T5 b1', 'Business Setup', :'today'::date + 4, 4, 'Normal', :'d1', 't', 'i') as b1 \gset
update alert_settings set value = '"Live"' where key = 'alert_mode';
select set_config('test.uid', :'d1', false);
select alert_resolve(:'a8', 'done');
select alert_mark_read(:'a2');
select set_config('test.uid', '', false);
select t.ok('fixtures: Dana has ten alerts, nine open, b1 is backlog and the rest are not',
  (select count(*) = 10 and count(*) filter (where status = 'Open') = 9 and count(*) filter (where backlog) = 1 and bool_or(backlog and dedupe_key = 't5-b1')
   from alerts where assigned_to = :'d1'));

-- ═══ Independent counts, straight from the table ═════════════════════
select
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress')) as d1_open,
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress') and due_date < :'today') as d1_overdue,
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress') and due_date >= :'today' and due_date <= :'today'::date + 7) as d1_upcoming,
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress') and category = 'Client Documents') as d1_docs,
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress') and category = 'Government Applications') as d1_gov,
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress') and rule_code in ('licence_expiry', 'visa_expiry') and current_step >= 0) as d1_renew,
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress') and due_date = :'today') as d1_today,
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress') and (created_at at time zone 'Asia/Dubai')::date = :'today') as d1_new,
  (select count(*) from alerts where assigned_to = :'d1' and status in ('Open', 'In progress') and backlog) as d1_backlog \gset
select
  (select count(*) from alerts where status in ('Open', 'In progress')) as m_open,
  (select count(*) from alerts where status in ('Open', 'In progress') and due_date < :'today') as m_overdue,
  (select count(*) from alerts where status in ('Open', 'In progress') and due_date >= :'today' and due_date <= :'today'::date + 7) as m_upcoming,
  (select count(*) from alerts where status in ('Open', 'In progress') and category = 'Client Documents') as m_docs,
  (select count(*) from alerts where status in ('Open', 'In progress') and category = 'Government Applications') as m_gov,
  (select count(*) from alerts where status in ('Open', 'In progress') and rule_code in ('licence_expiry', 'visa_expiry') and current_step >= 0) as m_renew,
  (select count(*) from alerts where status in ('Open', 'In progress') and assigned_to is null) as m_unassigned,
  (select count(*) from alerts where status in ('Open', 'In progress') and due_date = :'today') as m_today,
  (select count(*) from alerts where status in ('Open', 'In progress') and (created_at at time zone 'Asia/Dubai')::date = :'today') as m_new,
  (select count(*) from alerts where status in ('Open', 'In progress') and backlog) as m_backlog,
  (select count(*) from alerts where status in ('Open', 'In progress') and priority = 'Critical') as m_critical,
  (select count(*) from alerts where status in ('Open', 'In progress') and (priority = 'Critical' or (priority = 'High' and due_date < :'today'))) as m_urgent,
  (select count(*) from alerts where status in ('Open', 'In progress') and department = 'Accounting') as acc_open,
  (select count(*) from alerts where status in ('Open', 'In progress') and department = 'Accounting' and category = 'Client Documents') as acc_docs,
  (select count(*) from alerts where status in ('Open', 'In progress') and priority = 'Critical' and client_id = 'CL000001') as cl1_crit,
  (select count(*) from alerts where status in ('Open', 'In progress') and priority = 'Critical' and client_id = 'T5CL') as t5cl_crit,
  (select count(*) from alerts where status = 'Resolved' and resolved_by = :'d1') as d1_resolved,
  (select count(*) from alerts where status in ('Open', 'In progress') and assigned_to = :'d2') as d2_open,
  (select count(*) from alerts where status = 'Resolved' and resolved_by = :'d2') as d2_resolved,
  (select count(*) from alert_recipients where user_id = :'adm' and read_at is not null) as adm_read \gset
select t.ok('independent counts are real numbers the fixtures move', :d1_open = 9 and :d1_overdue = 3 and :d1_upcoming = 4 and :d1_docs = 1 and :d1_gov = 1
  and :d1_renew = 1 and :d1_today = 1 and :d1_new = 9 and :d1_backlog = 1 and :d1_resolved = 1);

-- ═══ Live: member sees My only ═══════════════════════════════════════
set role authenticated;
select set_config('test.uid', :'d1', false);
select alert_list('My') as l_my \gset
select alert_list('My', 'Urgent') as l_urg \gset
select alert_list('My', 'Due Today') as l_today \gset
select alert_list('My', 'Client Pending') as l_docs \gset
select alert_list('My', 'Government Pending') as l_gov \gset
select alert_list('My', 'Backlog') as l_back \gset
select alert_tiles('My') as ti_my \gset
select alert_my_access() as acc_d1 \gset
select t.fails('member refused Management', $q$select alert_list('Management')$q$, 'You do not have');
select t.fails('member refused Management tiles', $q$select alert_tiles('Management')$q$, 'You do not have');
select t.fails('untagged member refused Department scope', $q$select alert_list('Department', 'All', 'Accounting')$q$, 'You do not have');
select t.fails('untagged member refused Department tiles', $q$select alert_tiles('Department', 'Accounting')$q$, 'You do not have');
select t.fails('member refused management summary', 'select alert_management_summary()', 'You do not have');
select t.fails('member refused coverage', 'select alert_coverage()', 'You do not have');
select t.fails('unknown scope is refused', $q$select alert_list('Everyone')$q$, 'Scope must be');
select t.fails('unknown filter is refused', $q$select alert_list('My', 'Bogus')$q$, 'Filter must be');
select set_config('test.uid', '', false);
select t.fails('nobody signed in is refused', $q$select alert_list('My')$q$, 'You do not have');
select t.fails('nobody signed in is refused tiles', $q$select alert_tiles('My')$q$, 'You do not have');
select set_config('test.uid', :'d2', false);
select alert_list('My') as l_d2 \gset
select alert_detail(:'e1') as det_d2_own \gset
select t.errtext(format('select alert_detail(%L)', :'a1')) as err_forbidden \gset
select t.errtext($q$select alert_detail('00000000-0000-0000-0000-00000000ffff')$q$) as err_missing \gset
select set_config('test.uid', :'d1', false);
select alert_detail(:'a1') as det_a1 \gset
select t.fails('member cannot read the detail of an alert not theirs', format('select alert_detail(%L)', :'u1'), 'You do not have');
reset role;

select t.ok('My shows only assigned', (:'l_my'::jsonb->>'total')::int = :d1_open
  and jsonb_array_length(:'l_my'::jsonb->'rows') = :d1_open
  and (select bool_and((r->>'assigned_to')::uuid = :'d1' and r->>'status' in ('Open', 'In progress')) from jsonb_array_elements(:'l_my'::jsonb->'rows') r));
select t.ok('My shows another member only theirs', (:'l_d2'::jsonb->>'total')::int = :d2_open and :'l_d2'::jsonb->'rows'->0->>'subject' = 'T5 e1');
select t.ok('resolved alert is not in My', not exists (select 1 from jsonb_array_elements(:'l_my'::jsonb->'rows') r where r->>'subject' = 'T5 a8'));
select t.ok('rows carry the spec fields, names and a per-caller read, and no dedupe key', (select bool_and(
    r ?& array['id', 'alert_number', 'category', 'title', 'description', 'action_required', 'client_id', 'service_id', 'case_id', 'source_table', 'source_id',
               'rule_code', 'assigned_to', 'department', 'priority', 'trigger_date', 'due_date', 'created_at', 'status', 'escalation_level', 'escalated_at',
               'resolved_at', 'resolved_by', 'resolution_note', 'current_step', 'backlog', 'client_name', 'assignee_name', 'read']
    and not (r ? 'dedupe_key') and r->>'client_name' = 'TEST Client' and r->>'assignee_name' = 'Dana Reads')
  from jsonb_array_elements(:'l_my'::jsonb->'rows') r));
select t.ok('read is per caller: only the alert Dana marked is read', (select count(*) = 1 and bool_and(r->>'subject' = 'T5 a2')
  from jsonb_array_elements(:'l_my'::jsonb->'rows') r where (r->>'read')::boolean));
select t.ok('sorted by priority, then due date, no date last',
  (select array_agg(r->>'subject' order by ord) = array['T5 a7', 'T5 a3', 'T5 a1', 'T5 a6', 'T5 a2', 'T5 a5', 'T5 a4', 'T5 b1', 'T5 a9']
   from jsonb_array_elements(:'l_my'::jsonb->'rows') with ordinality as x(r, ord)));
select t.ok('Urgent holds Critical and overdue High only', (:'l_urg'::jsonb->>'total')::int = 3
  and (select array_agg(r->>'subject' order by r->>'subject') = array['T5 a1', 'T5 a3', 'T5 a7'] from jsonb_array_elements(:'l_urg'::jsonb->'rows') r));
select t.ok('Normal priority not Urgent, even overdue; High not yet due is not Urgent either',
  not exists (select 1 from jsonb_array_elements(:'l_urg'::jsonb->'rows') r where r->>'subject' in ('T5 a4', 'T5 a6', 'T5 a2')));
select t.ok('Due Today, Client Pending, Government Pending, Backlog filters', (:'l_today'::jsonb->>'total')::int = :d1_today and :'l_today'::jsonb->'rows'->0->>'subject' = 'T5 a2'
  and (:'l_docs'::jsonb->>'total')::int = :d1_docs and :'l_docs'::jsonb->'rows'->0->>'subject' = 'T5 a4'
  and (:'l_gov'::jsonb->>'total')::int = :d1_gov and :'l_gov'::jsonb->'rows'->0->>'subject' = 'T5 a5'
  and (:'l_back'::jsonb->>'total')::int = :d1_backlog and :'l_back'::jsonb->'rows'->0->>'subject' = 'T5 b1');
select t.ok('tiles equal independent counts', (:'ti_my'::jsonb->>'overdue')::int = :d1_overdue and (:'ti_my'::jsonb->>'upcoming')::int = :d1_upcoming
  and (:'ti_my'::jsonb->>'documents')::int = :d1_docs and (:'ti_my'::jsonb->>'authority')::int = :d1_gov and (:'ti_my'::jsonb->>'renewals')::int = :d1_renew
  and (:'ti_my'::jsonb->>'unassigned')::int = 0 and (:'ti_my'::jsonb->>'due_today')::int = :d1_today and (:'ti_my'::jsonb->>'new_today')::int = :d1_new
  and (:'ti_my'::jsonb->>'backlog')::int = :d1_backlog);
select t.ok('tiles equal list counts for each tile with a list filter', (:'ti_my'::jsonb->>'due_today')::int = (:'l_today'::jsonb->>'total')::int
  and (:'ti_my'::jsonb->>'documents')::int = (:'l_docs'::jsonb->>'total')::int and (:'ti_my'::jsonb->>'authority')::int = (:'l_gov'::jsonb->>'total')::int
  and (:'ti_my'::jsonb->>'backlog')::int = (:'l_back'::jsonb->>'total')::int);
select t.ok('resolved excluded from tiles: Dana tiles count no a8 (due in 2 days, resolved)', (:'ti_my'::jsonb->>'upcoming')::int = 4 and :d1_upcoming = 4);
select t.ok('access: member is neither admin nor manager, mode Live', :'acc_d1'::jsonb = '{"is_admin": false, "is_manager": false, "mode": "Live"}'::jsonb);

-- Detail
select t.ok('detail has alert, recipients and events, with names and no dedupe key', (:'det_a1'::jsonb->'alert'->>'subject') = 'T5 a1'
  and not (:'det_a1'::jsonb->'alert' ? 'dedupe_key') and :'det_a1'::jsonb->'alert'->>'client_name' = 'TEST Client'
  and jsonb_array_length(:'det_a1'::jsonb->'recipients') = 1 and :'det_a1'::jsonb->'recipients'->0->>'name' = 'Dana Reads' and :'det_a1'::jsonb->'recipients'->0->>'reason' = 'Assigned'
  and :'det_a1'::jsonb->'events'->0->>'event' = 'raised');
select t.ok('member sees detail of their own alert', :'det_d2_own'::jsonb->'alert'->>'subject' = 'T5 e1');
select t.ok('forbidden and missing detail refuse with the same text', :'err_forbidden' = :'err_missing' and :'err_forbidden' like 'You do not have%');

-- ═══ Live: manager, Department scope ═════════════════════════════════
set role authenticated;
select set_config('test.uid', :'mgr1', false);
select alert_list('Department', 'All', 'Accounting', 500) as l_dep \gset
select alert_tiles('Department', 'Accounting') as ti_dep \gset
select alert_tiles('Department') as ti_dep_all \gset
select alert_list('My') as l_mgr_my \gset
select alert_detail(:'u1') as det_u1_mgr \gset
select alert_my_access() as acc_mgr \gset
select t.fails('tagged manager refused Management', $q$select alert_list('Management')$q$, 'You do not have');
select t.fails('tagged manager refused management summary', 'select alert_management_summary()', 'You do not have');
select t.fails('tagged manager refused coverage', 'select alert_coverage()', 'You do not have');
reset role;
select t.ok('Department shows the chosen department, all of it', (:'l_dep'::jsonb->>'total')::int = :acc_open
  and (select bool_and(r->>'department' = 'Accounting') from jsonb_array_elements(:'l_dep'::jsonb->'rows') r)
  and (select count(*) = 3 from jsonb_array_elements(:'l_dep'::jsonb->'rows') r where r->>'subject' in ('T5 a4', 'T5 u2', 'T5 e1')));
select t.ok('Department tiles equal independent counts', (:'ti_dep'::jsonb->>'documents')::int = :acc_docs and (:'ti_dep'::jsonb->>'unassigned')::int >= 1);
select t.ok('Department with no name covers every department, as Management does', :'ti_dep_all'::jsonb->>'overdue' = :'m_overdue' and :'ti_dep_all'::jsonb->>'documents' = :'m_docs'
  and :'ti_dep_all'::jsonb->>'unassigned' = :'m_unassigned');
select t.ok('manager My list is only the manager''s own assignments', (:'l_mgr_my'::jsonb->>'total')::int = 0);
select t.ok('manager sees the detail of any alert, with its manager recipients', :'det_u1_mgr'::jsonb->'alert'->>'subject' = 'T5 u1'
  and (select count(*) = 2 and bool_and(r->>'reason' = 'Manager') from jsonb_array_elements(:'det_u1_mgr'::jsonb->'recipients') r));
select t.ok('access: tagged manager', :'acc_mgr'::jsonb = '{"is_admin": false, "is_manager": true, "mode": "Live"}'::jsonb);

-- ═══ Live: admin, Management ═════════════════════════════════════════
set role authenticated;
select set_config('test.uid', :'adm', false);
select alert_list('Management', 'All', null, 500) as l_man \gset
select alert_list('Management', 'Urgent', null, 500) as l_man_urg \gset
select alert_list('Management', 'Due Today', null, 500) as l_man_today \gset
select alert_list('Management', 'Client Pending', null, 500) as l_man_docs \gset
select alert_list('Management', 'Government Pending', null, 500) as l_man_gov \gset
select alert_list('Management', 'Backlog', null, 500) as l_man_back \gset
select alert_tiles('Management') as ti_man \gset
select alert_management_summary() as summ \gset
select alert_detail(:'a1') as det_a1_adm \gset
select alert_my_access() as acc_adm \gset
reset role;
select t.ok('Management total is every open alert in the system', (:'l_man'::jsonb->>'total')::int = :m_open);
select t.ok('Management tiles equal independent counts', (:'ti_man'::jsonb->>'overdue')::int = :m_overdue and (:'ti_man'::jsonb->>'upcoming')::int = :m_upcoming
  and (:'ti_man'::jsonb->>'documents')::int = :m_docs and (:'ti_man'::jsonb->>'authority')::int = :m_gov and (:'ti_man'::jsonb->>'renewals')::int = :m_renew
  and (:'ti_man'::jsonb->>'unassigned')::int = :m_unassigned and (:'ti_man'::jsonb->>'due_today')::int = :m_today and (:'ti_man'::jsonb->>'new_today')::int = :m_new
  and (:'ti_man'::jsonb->>'backlog')::int = :m_backlog);
select t.ok('Management tiles equal list counts for each tile with a list filter', (:'ti_man'::jsonb->>'due_today')::int = (:'l_man_today'::jsonb->>'total')::int
  and (:'ti_man'::jsonb->>'documents')::int = (:'l_man_docs'::jsonb->>'total')::int and (:'ti_man'::jsonb->>'authority')::int = (:'l_man_gov'::jsonb->>'total')::int
  and (:'ti_man'::jsonb->>'backlog')::int = (:'l_man_back'::jsonb->>'total')::int);
select t.ok('Management Urgent matches the independent Urgent count', (:'l_man_urg'::jsonb->>'total')::int = :m_urgent);
select t.ok('Management shows the backlog row, unassigned ones and read false for the admin', (select count(*) = 1 from jsonb_array_elements(:'l_man'::jsonb->'rows') r where r->>'subject' = 'T5 b1' and (r->>'backlog')::boolean)
  and (select count(*) = 2 from jsonb_array_elements(:'l_man'::jsonb->'rows') r where r->>'subject' in ('T5 u1', 'T5 u2'))
  and (select count(*) = :adm_read from jsonb_array_elements(:'l_man'::jsonb->'rows') r where (r->>'read')::boolean));
select t.ok('every open and in-progress alert appears and no closed one', (select bool_and(r->>'status' in ('Open', 'In progress')) from jsonb_array_elements(:'l_man'::jsonb->'rows') r)
  and not exists (select 1 from jsonb_array_elements(:'l_man'::jsonb->'rows') r where r->>'subject' = 'T5 a8'));
select t.ok('summary headline figures equal independent counts', (:'summ'::jsonb->>'critical')::int = :m_critical and (:'summ'::jsonb->>'today')::int = :m_today
  and (:'summ'::jsonb->>'client_pending')::int = :m_docs and (:'summ'::jsonb->>'government_pending')::int = :m_gov and (:'summ'::jsonb->>'renewals')::int = :m_renew
  and (:'summ'::jsonb->>'unassigned')::int = :m_unassigned and (:'summ'::jsonb->>'delayed')::int = 0);
select t.ok('performance counts per person', (select (p->>'pending')::int = :d1_open and (p->>'resolved')::int = :d1_resolved and p->>'name' = 'Dana Reads'
    from jsonb_array_elements(:'summ'::jsonb->'performance') p where (p->>'user_id')::uuid = :'d1')
  and (select (p->>'pending')::int = :d2_open and (p->>'resolved')::int = :d2_resolved from jsonb_array_elements(:'summ'::jsonb->'performance') p where (p->>'user_id')::uuid = :'d2')
  and (select count(*) = count(distinct p->>'user_id') from jsonb_array_elements(:'summ'::jsonb->'performance') p));
select t.ok('client risk counts open Critical per client', (select (c->>'critical')::int = :cl1_crit from jsonb_array_elements(:'summ'::jsonb->'client_risk') c where c->>'client_id' = 'CL000001')
  and (select (c->>'critical')::int = :t5cl_crit and c->>'client_name' = 'T5 Client Ltd' from jsonb_array_elements(:'summ'::jsonb->'client_risk') c where c->>'client_id' = 'T5CL')
  and (select bool_and((c->>'critical')::int > 0) from jsonb_array_elements(:'summ'::jsonb->'client_risk') c));
select t.ok('admin sees the detail of any alert, with its events', :'det_a1_adm'::jsonb->'alert'->>'subject' = 'T5 a1' and jsonb_array_length(:'det_a1_adm'::jsonb->'events') >= 1);
select t.ok('access: admin', :'acc_adm'::jsonb = '{"is_admin": true, "is_manager": false, "mode": "Live"}'::jsonb);

-- ═══ Preview: nothing for members and managers, everything for admins ═
update alert_settings set value = '"Preview"' where key = 'alert_mode';
set role authenticated;
select set_config('test.uid', :'d1', false);
select alert_list('My') as p_my \gset
select alert_tiles('My') as p_ti \gset
select t.fails('member in Preview refused Department', $q$select alert_list('Department')$q$, 'You do not have');
select t.fails('member in Preview refused Management', $q$select alert_list('Management')$q$, 'You do not have');
select t.errtext(format('select alert_detail(%L)', :'a1')) as p_err \gset
select alert_my_access() as p_acc \gset
select set_config('test.uid', :'mgr1', false);
select alert_list('Department', 'All', 'Accounting') as p_dep \gset
select alert_tiles('Department') as p_dep_ti \gset
select alert_list('My') as p_mgr_my \gset
select t.errtext(format('select alert_detail(%L)', :'u1')) as p_mgr_err \gset
select set_config('test.uid', :'adm', false);
select alert_list('Management', 'All', null, 500) as p_man \gset
select alert_tiles('Management') as p_man_ti \gset
reset role;
select t.ok('member in Preview gets empty My list', (:'p_my'::jsonb->>'total')::int = 0 and jsonb_array_length(:'p_my'::jsonb->'rows') = 0);
select t.ok('member in Preview gets zero tiles', (select bool_and(value::int = 0) and count(*) = 9 from jsonb_each_text(:'p_ti'::jsonb)));
select t.ok('member in Preview is refused the detail of their own alert', :'p_err' like 'You do not have access%' and :'p_err' = :'err_missing');
select t.ok('access in Preview shows the mode', :'p_acc'::jsonb->>'mode' = 'Preview');
select t.ok('tagged manager in Preview gets nothing from Department, tiles or detail', (:'p_dep'::jsonb->>'total')::int = 0 and jsonb_array_length(:'p_dep'::jsonb->'rows') = 0
  and (select bool_and(value::int = 0) from jsonb_each_text(:'p_dep_ti'::jsonb)) and (:'p_mgr_my'::jsonb->>'total')::int = 0 and :'p_mgr_err' like 'You do not have access%');
select t.ok('admin in Preview still sees everything in Management, backlog included',
  (:'p_man'::jsonb->>'total')::int = :m_open and (:'p_man_ti'::jsonb->>'backlog')::int >= :m_backlog and (:'p_man_ti'::jsonb->>'overdue')::int = :m_overdue);
update alert_settings set value = '"Live"' where key = 'alert_mode';

-- ═══ Limit is capped on the server ═══════════════════════════════════
begin;
insert into alerts (title, dedupe_key, status, priority, department, assigned_to)
select 'bulk ' || g, 't5-bulk-' || g, 'Open', 'Normal', 'Accounting', :'d2' from generate_series(1, 520) g;
select count(*) as bulk_open from alerts where status in ('Open', 'In progress') \gset
set role authenticated;
select set_config('test.uid', :'adm', false);
select alert_list('Management', 'All', null, 100000) as big \gset
select alert_list('Management', 'All', null, 100000, 500) as big2 \gset
select alert_list('Management', 'All', null, 0) as zero \gset
select alert_list('Management', 'All', null, -5, -3) as neg \gset
select alert_list('Management', 'All', null, null, null) as nul \gset
select alert_list('Management', 'All', null, 10, 5) as page \gset
reset role;
select t.ok('p_limit is capped at 500 and total is the full count', jsonb_array_length(:'big'::jsonb->'rows') = 500 and (:'big'::jsonb->>'total')::int = :bulk_open and :bulk_open > 520);
select t.ok('offset pages through the rest', jsonb_array_length(:'big2'::jsonb->'rows') = :bulk_open - 500);
select t.ok('limit 0, negative and null fall back safely, and a page is the size asked', jsonb_array_length(:'zero'::jsonb->'rows') = 1 and jsonb_array_length(:'neg'::jsonb->'rows') = 1
  and jsonb_array_length(:'nul'::jsonb->'rows') = 100 and jsonb_array_length(:'page'::jsonb->'rows') = 10);
select t.ok('pages do not overlap or skip', (:'page'::jsonb->'rows'->0->>'id') = (:'big'::jsonb->'rows'->5->>'id') and (:'page'::jsonb->'rows'->9->>'id') = (:'big'::jsonb->'rows'->14->>'id'));
rollback;

-- ═══ Coverage ════════════════════════════════════════════════════════
begin;
delete from alert_scan_log;
set role authenticated;
select set_config('test.uid', :'adm', false);
select alert_coverage() as cov0 \gset
reset role;
select t.ok('coverage with no scan ever is stale and says so, with null counts rather than zero', (:'cov0'::jsonb->>'stale')::boolean and :'cov0'::jsonb->>'last_scan_status' is null
  and (select bool_and(r->'checked' = 'null'::jsonb) and count(*) >= 7 from jsonb_array_elements(:'cov0'::jsonb->'rules') r));

insert into alert_scan_log (started_at, finished_at, status, rule_counts) values
  (now() - interval '30 hours', now() - interval '30 hours', 'Ok',
   '{"licence_expiry": {"checked": 5, "with_data": 2, "raised": 1, "closed": 0, "error": null}}');
set role authenticated;
select set_config('test.uid', :'adm', false);
select alert_coverage() as cov1 \gset
reset role;
select t.ok('coverage reports missing data, the in-step count as raised, and a stale scan', (:'cov1'::jsonb->>'stale')::boolean and :'cov1'::jsonb->>'last_scan_status' = 'Ok'
  and (select (r->>'checked')::int = 5 and (r->>'with_data')::int = 2 and (r->>'missing_data')::int = 3 and (r->>'raised')::int = 1 and (r->>'closed')::int = 0 and r->'error' = 'null'::jsonb
      from jsonb_array_elements(:'cov1'::jsonb->'rules') r where r->>'rule' = 'licence_expiry')
  and (select r->'checked' = 'null'::jsonb and r->'missing_data' = 'null'::jsonb from jsonb_array_elements(:'cov1'::jsonb->'rules') r where r->>'rule' = 'visa_expiry')
  and :'cov1'::jsonb ? 'raised_means');

insert into alert_scan_log (started_at, finished_at, status, rule_counts, error) values
  (now() - interval '1 hour', now() - interval '1 hour', 'Failed',
   '{"job_due": {"checked": 4, "with_data": 0, "raised": 0, "closed": 0, "error": "boom"}, "escalation": {"error": "esc boom"}}', 'Failed: job_due, escalation'),
  (now(), now(), 'Skipped', '{}', null);
set role authenticated;
select set_config('test.uid', :'adm', false);
select alert_coverage() as cov2 \gset
reset role;
select t.ok('coverage reads the latest Ok or Failed scan, not a Skipped one, and a failed scan carries its error', :'cov2'::jsonb->>'last_scan_status' = 'Failed'
  and :'cov2'::jsonb->>'last_scan_error' = 'Failed: job_due, escalation' and :'cov2'::jsonb->>'escalation_error' = 'esc boom'
  and (select r->>'error' = 'boom' and (r->>'missing_data')::int = 4 from jsonb_array_elements(:'cov2'::jsonb->'rules') r where r->>'rule' = 'job_due')
  and (select r->'checked' = 'null'::jsonb from jsonb_array_elements(:'cov2'::jsonb->'rules') r where r->>'rule' = 'licence_expiry'));
select t.ok('a Failed scan does not clear stale: the last Ok is still 30 hours old', (:'cov2'::jsonb->>'stale')::boolean);

insert into alert_scan_log (started_at, finished_at, status, rule_counts) values (now() - interval '1 hour', now() - interval '1 hour', 'Ok', '{}');
set role authenticated;
select set_config('test.uid', :'adm', false);
select alert_coverage() as cov3 \gset
reset role;
select t.ok('an Ok scan inside 26 hours is not stale', not (:'cov3'::jsonb->>'stale')::boolean and :'cov3'::jsonb->>'last_scan_status' = 'Ok');
rollback;

-- ═══ Settings reads ══════════════════════════════════════════════════
begin;
set role authenticated;
select set_config('test.uid', :'adm', false);
select alert_rule_list() as rl \gset
select alert_manager_list() as ml \gset
reset role;
select t.ok('rule list returns every rule with code, category, department, enabled and steps, in code order',
  jsonb_array_length(:'rl'::jsonb) = (select count(*) from alert_rules)
  and (select bool_and(e ?& array['code', 'category', 'department', 'enabled', 'steps']) from jsonb_array_elements(:'rl'::jsonb) e)
  and (select array_agg(e->>'code' order by ord) = (select array_agg(code order by code) from alert_rules) from jsonb_array_elements(:'rl'::jsonb) with ordinality x(e, ord))
  and (select e->>'enabled' = 'false' and e->>'category' = 'Deadlines' and e->>'department' = 'Business Setup' from jsonb_array_elements(:'rl'::jsonb) e where e->>'code' = 't5_dead')
  and (select jsonb_array_length(e->'steps') = 4 from jsonb_array_elements(:'rl'::jsonb) e where e->>'code' = 'licence_expiry'));
select t.ok('manager list names the tagged managers and says no fallback',
  not (:'ml'::jsonb->>'fell_back')::boolean and jsonb_array_length(:'ml'::jsonb->'managers') = 2
  and (select array_agg(e->>'name' order by e->>'name') = array['Manager Banking', 'Manager HR'] from jsonb_array_elements(:'ml'::jsonb->'managers') e)
  and (select bool_and(e ? 'user_id') from jsonb_array_elements(:'ml'::jsonb->'managers') e));
set role authenticated;
select set_config('test.uid', :'mgr1', false);
select alert_manager_list() as ml2 \gset
select t.fails('a tagged manager cannot read the rule list', 'select alert_rule_list()', 'permission to view alert rules');
reset role;
select t.ok('a tagged manager can read the manager list', jsonb_array_length(:'ml2'::jsonb->'managers') = 2);
set role authenticated;
select set_config('test.uid', :'d1', false);
select t.fails('an employee cannot read the rule list', 'select alert_rule_list()', 'permission to view alert rules');
select t.fails('an employee cannot read the manager list', 'select alert_manager_list()', 'permission to view the manager list');
reset role;
-- Nobody tagged: the admins stand in and fell_back says so.
delete from banking_user_roles where role = 'MANAGER';
delete from hr_employees where designation ilike 'manager';
set role authenticated;
select set_config('test.uid', :'adm', false);
select alert_manager_list() as ml3 \gset
reset role;
select t.ok('with nobody tagged the list is the admins and fell_back is true',
  (:'ml3'::jsonb->>'fell_back')::boolean and (select count(*) = (select count(*) from profiles where role = 'admin') from jsonb_array_elements(:'ml3'::jsonb->'managers')));
rollback;

-- ═══ Grants ══════════════════════════════════════════════════════════
select t.ok('authenticated runs the browser reads, and the scope helper is not one of them',
  (select count(*) = 8 and bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
       and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
       and p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=public, pg_temp'])
   from pg_proc p where p.oid in ('alert_list(text,text,text,int,int)'::regprocedure, 'alert_tiles(text,text)'::regprocedure, 'alert_detail(uuid)'::regprocedure,
     'alert_management_summary()'::regprocedure, 'alert_coverage()'::regprocedure, 'alert_my_access()'::regprocedure,
     'alert_rule_list()'::regprocedure, 'alert_manager_list()'::regprocedure))
  and not has_function_privilege('authenticated', 'alert_scope_rows(text,text)', 'execute') and not has_function_privilege('anon', 'alert_scope_rows(text,text)', 'execute'));
set role anon;
select t.fails('anon cannot list', $q$select alert_list('My')$q$, 'permission denied');
select t.fails('anon cannot read tiles', $q$select alert_tiles('My')$q$, 'permission denied');
select t.fails('anon cannot read detail', format('select alert_detail(%L)', :'a1'), 'permission denied');
select t.fails('anon cannot read the summary', 'select alert_management_summary()', 'permission denied');
select t.fails('anon cannot read coverage', 'select alert_coverage()', 'permission denied');
select t.fails('anon cannot read access', 'select alert_my_access()', 'permission denied');
select t.fails('anon cannot read the rule list', 'select alert_rule_list()', 'permission denied');
select t.fails('anon cannot read the manager list', 'select alert_manager_list()', 'permission denied');
reset role;
set role authenticated;
select t.fails('authenticated cannot call the scope helper', $q$select * from alert_scope_rows('Management')$q$, 'permission denied');
reset role;
select set_config('test.uid', '', false);

-- run-local.sh expects the tests to leave the mode on Live.
update alert_settings set value = '"Live"' where key = 'alert_mode';
