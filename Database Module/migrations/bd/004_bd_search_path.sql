-- =====================================================================
-- CRM Business Development (BD) backend - hardening            004
-- =====================================================================
-- Supabase security advisor (lint 0011, function_search_path_mutable):
-- pin search_path on the BD functions 001/003 created without one.
-- Idempotent. Run after 003.
-- =====================================================================

alter function public.bd_next_ref(text, regclass)      set search_path = public, pg_temp;
alter function public.bd_leads_guard()                  set search_path = public, pg_temp;
alter function public.bd_quotations_guard()             set search_path = public, pg_temp;
alter function public.bd_append_only()                  set search_path = public, pg_temp;
alter function public.bd_ui_status(text)                set search_path = public, pg_temp;
alter function public.bd_channel_code(text)             set search_path = public, pg_temp;
alter function public.bd_billing_code(text)             set search_path = public, pg_temp;
alter function public.bd_ui_billing(text)               set search_path = public, pg_temp;
alter function public.bd_is_meaningful(text, integer)   set search_path = public, pg_temp;
