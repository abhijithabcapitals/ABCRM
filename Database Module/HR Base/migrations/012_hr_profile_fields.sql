-- =====================================================================
-- HR Base - employee profile fields                                012
-- =====================================================================
-- Photo, visa status and home-country address on the personal row, so the existing rule applies: HR everything, the employee reads their own, managers nothing.
-- The existing address column is shown as the UAE address. photo_path points into the private hr-documents bucket under the employee's folder. Idempotent. Requires 002.
-- =====================================================================
alter table public.hr_employee_personal add column if not exists photo_path text;
alter table public.hr_employee_personal add column if not exists visa_status text;
alter table public.hr_employee_personal add column if not exists permanent_country text;
alter table public.hr_employee_personal add column if not exists permanent_address text;
