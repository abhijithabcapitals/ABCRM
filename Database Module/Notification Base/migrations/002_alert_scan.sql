-- Notification Centre, Phase 1: step function and rule seed.
-- Re-runnable. Rollback: rollback/001_004_rollback.sql.

-- Steps are a JSON array of {"days": int, "priority": text}. Sorted by days descending, the last step with
-- p_days_left <= days wins. Outside the largest step: no row. Negative days mean overdue.
create or replace function public.alert_step_for(p_steps jsonb, p_days_left int)
returns table (step int, priority text)
language sql immutable security definer set search_path = public, pg_temp as $$
  select (s->>'days')::int, s->>'priority'
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) s
  where p_days_left <= (s->>'days')::int
  order by (s->>'days')::int asc
  limit 1
$$;

revoke execute on function public.alert_step_for(jsonb, int) from public, anon, authenticated;

-- Seed is insert-only, so steps edited later survive a reapply.
insert into public.alert_rules (code, category, department, title_template, action_template, steps) values
  ('licence_expiry', 'Licence', 'Business Setup', 'Licence expiry: {subject}', 'Confirm the licence date, then start the renewal.',
    '[{"days":90,"priority":"Medium"},{"days":60,"priority":"Medium"},{"days":30,"priority":"High"},{"days":-1,"priority":"Critical"}]'),
  ('visa_expiry', 'Visa & Emirates ID', 'Business Setup', 'Visa expiry: {subject}', 'Confirm the visa date, then start the renewal or cancellation.',
    '[{"days":90,"priority":"Medium"},{"days":60,"priority":"Medium"},{"days":30,"priority":"High"},{"days":15,"priority":"High"},{"days":7,"priority":"High"},{"days":-1,"priority":"Critical"}]'),
  ('job_due', 'Deadlines', 'Accounting', 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]'),
  ('service_due', 'Deadlines', 'Business Setup', 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]'),
  ('setup_task_due', 'Deadlines', 'Business Setup', 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]'),
  ('banking_task_due', 'Deadlines', 'Business Banking', 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]'),
  ('crm_task_due', 'Deadlines', null, 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]')
on conflict (code) do nothing;
