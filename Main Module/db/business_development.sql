-- RETIRED (29/10/2026). Do not run.
--
-- The Business Development schema now lives in the Database Module:
--   Database Module/migrations/bd/001_bd_schema.sql   tables, constraints, indexes (spec: docs/BD_BACKEND_SPEC.md)
--   Database Module/migrations/bd/002_bd_seed.sql     sources, stages, lost reasons, service catalog
--   Database Module/migrations/bd/003_bd_ui_api.sql   the functions and row-level security this page calls
--
-- This file used to create its own bd_* tables with the same names but different columns, so running
-- both would leave the database in a broken state. The functions the UI calls (bd_create_lead,
-- bd_log_activity, bd_create_followup, bd_complete_followup, bd_mark_lead_won, bd_mark_lead_lost) keep
-- their names and payloads in 003; leads are read with bd_ui_leads(), and services and stage changes go
-- through bd_save_service() and bd_change_stage().
do $$ begin
  raise exception 'business_development.sql is retired: run Database Module/migrations/bd/001, 002 and 003 instead.';
end $$;
