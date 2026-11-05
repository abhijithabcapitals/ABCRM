-- Removes Phases 4, 5 and 7. Safe to run twice. Runs before rollback/010_rollback.sql.
do $$ begin
  if to_regclass('public.alerts') is not null then
    if to_regclass('public.notifications') is not null then
      delete from public.notifications where type = 'alert_centre' and (link_scope->>'alert_id')::uuid in (
        select id from public.alerts where rule_code like 'manual\_%' or rule_code in ('contact_followup', 'job_followup', 'document_request', 'job_payment_due', 'setup_invoice_due',
          'tax_deadline', 'ct_dereg_review', 'multiple_services', 'client_not_contacted', 'client_inactive', 'company_anniversary', 'compliance_ubo_verification', 'compliance_aml_risk_assessment',
          'compliance_kyc_document', 'compliance_corporate_register_review', 'compliance_regulatory_filing', 'compliance_compliance_review', 'compliance_tax_residency_certificate'));
    end if;
    delete from public.alerts where rule_code like 'manual\_%' or rule_code in ('contact_followup', 'job_followup', 'document_request', 'job_payment_due', 'setup_invoice_due',
      'tax_deadline', 'ct_dereg_review', 'multiple_services', 'client_not_contacted', 'client_inactive', 'company_anniversary', 'compliance_ubo_verification', 'compliance_aml_risk_assessment',
      'compliance_kyc_document', 'compliance_corporate_register_review', 'compliance_regulatory_filing', 'compliance_compliance_review', 'compliance_tax_residency_certificate');
  end if;
  if to_regclass('public.alert_rules') is not null then
    delete from public.alert_rules where code like 'manual\_%' or code in ('contact_followup', 'job_followup', 'document_request', 'job_payment_due', 'setup_invoice_due',
      'tax_deadline', 'ct_dereg_review', 'multiple_services', 'client_not_contacted', 'client_inactive', 'company_anniversary', 'compliance_ubo_verification', 'compliance_aml_risk_assessment',
      'compliance_kyc_document', 'compliance_corporate_register_review', 'compliance_regulatory_filing', 'compliance_compliance_review', 'compliance_tax_residency_certificate');
  end if;
  if to_regclass('public.alert_settings') is not null then
    delete from public.alert_settings where key in ('contact_gap_days', 'inactive_days', 'payment_terms_days');
  end if;
end $$;

-- 013
drop function if exists public.alert_rule_company_anniversary();
drop function if exists public.alert_rule_client_inactive();
drop function if exists public.alert_rule_client_not_contacted();
drop function if exists public.alert_contact_gap(text, int);
drop function if exists public.alert_rule_multiple_services();
drop function if exists public.alert_setting_int(text, int);
-- 012
drop function if exists public.alert_rule_ct_dereg_review();
drop function if exists public.alert_rule_tax_deadline();
drop function if exists public.alert_tax_ingest(jsonb);
drop table if exists public.alert_tax_items;
drop function if exists public.alert_rule_compliance_ubo_verification();
drop function if exists public.alert_rule_compliance_aml_risk_assessment();
drop function if exists public.alert_rule_compliance_kyc_document();
drop function if exists public.alert_rule_compliance_corporate_register_review();
drop function if exists public.alert_rule_compliance_regulatory_filing();
drop function if exists public.alert_rule_compliance_compliance_review();
drop function if exists public.alert_rule_compliance_tax_residency_certificate();
drop function if exists public.alert_compliance_review_candidates(text, text);
-- 011
drop function if exists public.alert_rule_setup_invoice_due();
drop function if exists public.alert_rule_job_payment_due();
drop function if exists public.alert_rule_document_request();
drop function if exists public.alert_rule_job_followup();
drop function if exists public.alert_rule_contact_followup();
drop function if exists public.alert_payment_terms();
drop function if exists public.alert_manual_raise(text, text, text, date);
drop function if exists public.alert_manual_types();
drop function if exists public.client_work_list(text);
drop function if exists public.client_document_answered(uuid, text);
drop function if exists public.client_document_request(jsonb);
drop function if exists public.client_contact_log(jsonb);
drop table if exists public.client_document_requests;
drop table if exists public.client_contacts;
