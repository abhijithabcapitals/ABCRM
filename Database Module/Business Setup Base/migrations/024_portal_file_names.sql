-- =====================================================================
-- Business Setup Base - Portal file names follow the stored file          024
-- =====================================================================
-- Re-runnable. Runs after 018. A Business Formation Proposal and its letter are stored as PDF (hub_documents.storage_path), but
-- business_setup_portal_file named every quote and letter ".docx". The download name now takes the stored file's own extension
-- (.pdf stays .pdf; anything else keeps .docx as before). Nothing else about the function changes.
create or replace function public.business_setup_portal_file(p_account uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account); v_bucket text; v_path text; v_name text;
begin
  if v_client is not null then
    if p_kind = 'quote' then
      select 'hub-documents', q.storage_path, q.document_number || case when q.storage_path ~* '\.pdf$' then '.pdf' else '.docx' end into v_bucket, v_path, v_name from hub_documents q
       where q.id = p_id and q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected');
    elsif p_kind = 'letter' then
      select 'hub-documents', l.storage_path, l.document_number || case when l.storage_path ~* '\.pdf$' then '.pdf' else '.docx' end into v_bucket, v_path, v_name from hub_documents l join hub_documents q on q.id = l.parent_id
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
