-- =====================================================================
-- Banking Base - old CRM board status on the case list             016
-- =====================================================================
-- Adds each case's board status, and counts to compare with the old CRM dashboard. Counts cover every case
-- whatever the search or who holds it. board_held counts old CRM rows with no case yet. Safe to re-run.
-- =====================================================================
create or replace function public.banking_case_list(p_search text default null, p_limit int default 100, p_offset int default 0, p_include_historical boolean default false) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('total', (select count(*) from banking_cases c join banking_clients cl on cl.id = c.client_id where banking_can('cases.view') and c.accounts_status is distinct from 'With Accounts' and (p_include_historical or not c.is_historical) and (p_search is null or cl.display_name ilike '%' || p_search || '%' or c.case_ref ilike '%' || p_search || '%')),
   'board_counts', coalesce((select jsonb_object_agg(legacy_board_status, n) from (select legacy_board_status, count(*) n from banking_cases where banking_can('cases.view') and legacy_board_status is not null group by 1) s), '{}'::jsonb),
   'board_held', coalesce((select jsonb_object_agg(board, n) from (select raw -> 'Banking Sheet' ->> 'Task Status' board, count(*) n from banking_excel_import_rows where banking_can('cases.view') and raw ? 'Banking Sheet' and legacy_task_id is not null and application_id is null group by 1) s), '{}'::jsonb),
   'rows', coalesce((select jsonb_agg(row_to_json(t)) from (
    select c.id, c.case_ref, c.current_stage, c.outcome, c.is_historical, c.legacy_status, c.legacy_board_status, c.accounts_status, c.accounts_remarks, cl.id client_id, cl.display_name client, cl.client_master_id, cl.link_status, p.full_name employee,
           b.bank_name bank, a.status app_status, q.total_amount total,
           coalesce((select sum(signed_amount) from banking_payments x where x.case_id = c.id), 0) received
      from banking_cases c join banking_clients cl on cl.id = c.client_id
      left join profiles p on p.id = c.assigned_to
      left join banking_bank_recommendations rc on rc.case_id = c.id and rc.is_selected
      left join banking_partners b on b.id = rc.bank_id
      left join lateral (select * from banking_applications ap where ap.case_id = c.id order by ap.is_active desc, ap.created_at desc limit 1) a on true
      left join lateral (select * from banking_current_quote(c.id)) q on true
     where banking_can('cases.view') and c.accounts_status is distinct from 'With Accounts' and (p_include_historical or not c.is_historical) and (p_search is null or cl.display_name ilike '%' || p_search || '%' or c.case_ref ilike '%' || p_search || '%')
     order by c.created_at desc limit p_limit offset p_offset) t), '[]'::jsonb))
$$;
