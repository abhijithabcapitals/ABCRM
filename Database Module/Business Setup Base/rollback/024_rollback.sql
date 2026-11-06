-- Undoes migrations/024_portal_file_names.sql. business_setup_portal_file goes back to 010 (every quote and letter named .docx) and
-- business_setup_portal_view to 018 (an undecided multi-option proposal is listed again, with Option 1's total). Both texts are copied
-- from those migrations unchanged, with their grants: service role only. No data is touched.
begin;
create or replace function public.business_setup_portal_file(p_account uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account); v_bucket text; v_path text; v_name text;
begin
  if v_client is not null then
    if p_kind = 'quote' then
      select 'hub-documents', q.storage_path, q.document_number || '.docx' into v_bucket, v_path, v_name from hub_documents q
       where q.id = p_id and q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected');
    elsif p_kind = 'letter' then
      select 'hub-documents', l.storage_path, l.document_number || '.docx' into v_bucket, v_path, v_name from hub_documents l join hub_documents q on q.id = l.parent_id
       where l.id = p_id and l.doc_type = 'letter' and q.client_id = v_client and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected');
    elsif p_kind = 'receipt' then
      select 'hub-documents', r.storage_path, replace(r.receipt_number, '/', '-') || '.docx' into v_bucket, v_path, v_name from business_setup_receipts r join business_setup_payments y on y.id = r.payment_id
       where r.id = p_id and y.client_id = v_client;
    elsif p_kind = 'output' then
      select 'business-setup-documents', d.storage_path, d.file_name into v_bucket, v_path, v_name from business_setup_documents d
       where d.id = p_id and d.client_id = v_client and d.is_output and d.client_visible;
    elsif p_kind = 'invoice' then
      select 'business-setup-documents', i.file_path, coalesce(i.invoice_number, 'invoice') || '.pdf' into v_bucket, v_path, v_name from business_setup_invoices i
       where i.id = p_id and i.client_id = v_client;
    end if;
  end if;
  if v_path is null then raise exception 'File not found'; end if;
  return jsonb_build_object('bucket', v_bucket, 'path', v_path, 'file_name', replace(coalesce(v_name, 'file'), '/', '-'));
end $$;
revoke all on function public.business_setup_portal_file(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.business_setup_portal_file(uuid, text, uuid) to service_role;

create or replace function public.business_setup_portal_view(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account);
begin
  return jsonb_build_object(
    'form', business_setup_form_get(p_account),
    'details', client_portal_me(p_account) -> 'record',
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'action', s.action, 'status', s.status, 'started_at', s.started_at,
                    'completed_at', s.completed_at, 'expiry_date', s.expiry_date) order by s.created_at desc), '[]'::jsonb)
                   from business_setup_services s where s.client_id = v_client and not s.historical),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'number', q.document_number, 'date', q.created_at::date, 'status', q.status, 'total', q.total_amount,
                  'net_paid', case when q.status in ('issued', 'accepted') then business_setup_net_paid(q.id) end, 'outstanding', case when q.status in ('issued', 'accepted') then greatest(q.total_amount - business_setup_net_paid(q.id), 0) end, 'has_file', q.storage_path is not null,
                  'closed', exists (select 1 from business_setup_cases c where c.id = q.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')),
                  'signed', (select jsonb_build_object('status', s.status, 'date', s.created_at::date, 'note', case when s.status = 'Refused' then s.note end)
                               from business_setup_signed_quotes s where s.quote_id = q.id order by s.created_at desc limit 1),
                  'expired', q.status = 'issued' and q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Dubai')::date,
                  'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                 from business_setup_acceptances a where a.document_id = q.id order by a.created_at desc limit 1),
                  'can_decide', q.status = 'issued' and not (q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Dubai')::date)
                                and not exists (select 1 from business_setup_acceptances a where a.document_id = q.id)
                                and not exists (select 1 from business_setup_cases c where c.id = q.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')),
                  'letter', (select jsonb_build_object('id', l.id, 'number', l.document_number, 'date', l.created_at::date, 'signed_at', l.signed_at, 'has_file', l.storage_path is not null,
                                      'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                                     from business_setup_acceptances a where a.document_id = l.id order by a.created_at desc limit 1),
                                      'can_decide', q.status = 'accepted' and l.status = 'issued' and not exists (select 1 from business_setup_acceptances a where a.document_id = l.id)
                                                    and not exists (select 1 from business_setup_cases c where c.id = l.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')))
                               from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter' and l.status <> 'superseded' order by l.created_at desc limit 1)) order by q.created_at desc), '[]'::jsonb)
                 from hub_documents q
                where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected')),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'date', y.paid_on, 'amount', y.amount, 'type', y.type, 'reference', y.reference,
                    'receipt_id', r.id, 'receipt_number', r.receipt_number, 'has_file', r.storage_path is not null) order by y.paid_on desc, y.created_at desc), '[]'::jsonb)
                   from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id where y.client_id = v_client),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number, 'date', i.issued_on, 'amount', i.amount, 'has_file', i.file_path is not null,
                    'claim_pending', exists (select 1 from business_setup_payment_claims c where c.invoice_id = i.id and c.status = 'Pending'),
                    -- The rule of business_setup_portal_claim_add, so the screen shows a state instead of a button that fails: the invoice belongs to a case that is not Lost, and no claim waits.
                    -- Nothing owed, no button: the case's balance (as business_setup_case_docs: the accepted or newest live quote's total less net payments) is above zero.
                    'can_claim', coalesce((select cs.stage <> 'Lost'
                                                  and coalesce((select t.total_amount from hub_documents t where t.case_id = cs.id and t.doc_type = 'quote' and t.status not in ('superseded', 'rejected')
                                                                 order by (t.status = 'accepted') desc, t.created_at desc limit 1), 0) - business_setup_case_net_paid(cs.id) > 0
                                             from business_setup_cases cs where cs.id = coalesce(i.case_id, (select q.case_id from hub_documents q where q.id = i.quote_id))), false)
                                 and not exists (select 1 from business_setup_payment_claims c where c.invoice_id = i.id and c.status = 'Pending')) order by i.issued_on desc), '[]'::jsonb)
                   from business_setup_invoices i where i.client_id = v_client),
    'claims', business_setup_portal_claims(p_account),
    'letters', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'number', l.document_number, 'date', l.created_at::date, 'has_file', l.storage_path is not null,
                    'quote_id', q.id, 'quote_number', q.document_number,
                    'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                   from business_setup_acceptances a where a.document_id = l.id order by a.created_at desc limit 1),
                    'can_decide', q.status = 'accepted' and l.status = 'issued' and not exists (select 1 from business_setup_acceptances a where a.document_id = l.id)
                                  and not exists (select 1 from business_setup_cases c where c.id = l.case_id and c.stage in ('Lost', 'Completed', 'Cancelled'))) order by l.created_at desc), '[]'::jsonb)
                  from hub_documents l join hub_documents q on q.id = l.parent_id
                 where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected')
                   and l.doc_type = 'letter' and l.status <> 'superseded'),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'date', d.created_at::date) order by d.created_at desc), '[]'::jsonb)
                    from business_setup_documents d where d.client_id = v_client and d.is_output and d.client_visible));
end $$;
revoke all on function public.business_setup_portal_view(uuid) from public, anon, authenticated;
grant execute on function public.business_setup_portal_view(uuid) to service_role;
commit;
