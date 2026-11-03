-- AB Capital's Annual leave balances for 2026 and join dates, from the sheet the user gave on 2026-11-03. Run on live, after seed_ab_capital.sql.
-- A join date replaces what the record holds. Attendance starts from it, so a blank working day after it counts Absent.
-- Opening goes in as entitlement and Used as a negative adjustment, so Remaining shows the sheet's Closing. Used has no dates, so it cannot be leave requests.
-- Every named person gets a row. Lakshay and Abhijith have no balance on the sheet: 0. Names follow the live records, where the sheet's Aishwarya is Aiswarya.
-- The sheet's Tagore and Rishu are left out: the live list of 14 employees on 2026-11-03 has no record for them.
-- All or nothing: it stops and saves nothing if a name does not match exactly one employee, or if 2026 Annual leave is already approved. A second run sets the same values.
do $$
declare
  annual uuid;
  problems text;
begin
  select id into annual from public.hr_leave_types where name = 'Annual';
  if annual is null then raise exception 'No Annual leave type. Run seed_ab_capital.sql first.'; end if;

  create temp table sheet (name text primary key, join_date date, opening numeric, used numeric, closing numeric) on commit drop;
  insert into sheet values
    ('ALEX', '2025-06-02', 27, 25, 2),
    ('NOOR', '2024-07-08', 28, 1.5, 26.5),
    ('ABAIZ', '2025-02-12', 3, 0, 3),
    ('GARIMA', '2025-03-25', 21.5, 0.5, 21),
    ('NAVNEET', '2025-07-01', 31.5, 0.5, 31),
    ('AISWARYA', '2025-11-19', 0, 0, 0),
    ('GEO', '2026-01-05', 29, 0, 29),
    ('YOMALI', '2026-08-10', 0, 0, 0),
    ('MADHAVI', '2026-09-07', 0, 0, 0),
    ('HIMANSHU', '2026-09-28', 0, 0, 0),
    ('LAKSHAY', '2026-10-05', 0, 0, 0),
    ('ABHIJITH', '2026-10-26', 0, 0, 0);

  -- Matches the whole name or its first word, ignoring case. Exact matching stops ALEX taking ALEXANDER.
  create temp table matched on commit drop as
    select s.name, s.join_date, s.opening, s.used, s.closing, e.id as employee_id, e.full_name
    from sheet s left join public.hr_employees e
      on upper(btrim(e.full_name)) = s.name or split_part(upper(btrim(e.full_name)), ' ', 1) = s.name;

  select string_agg(name || ' matches ' || n || ': ' || who, '; ' order by name) into problems
  from (select name, count(employee_id) as n, coalesce(string_agg(full_name, ', '), 'nobody') as who from matched group by name) c
  where n <> 1;
  if problems is not null then raise exception 'Names to fix, nothing saved: %', problems; end if;

  select string_agg(m.full_name || ' ' || r.days || ' days', '; ') into problems
  from matched m join public.hr_leave_requests r on r.employee_id = m.employee_id
  where r.leave_type_id = annual and r.status = 'approved' and extract(year from r.from_date) = 2026;
  if problems is not null then raise exception 'Approved 2026 Annual leave would count twice, nothing saved: %', problems; end if;

  insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitlement, adjustment)
  select employee_id, annual, 2026, opening, -used from matched
  on conflict (employee_id, leave_type_id, year) do update set entitlement = excluded.entitlement, adjustment = excluded.adjustment;

  update public.hr_employees e set join_date = m.join_date
  from matched m where e.id = m.employee_id and e.join_date is distinct from m.join_date;
end $$;

-- Remaining here should equal the sheet's Closing.
select e.full_name, e.join_date, b.entitlement, b.adjustment, b.entitlement + b.adjustment as remaining
from public.hr_leave_balances b
join public.hr_employees e on e.id = b.employee_id
join public.hr_leave_types t on t.id = b.leave_type_id
where t.name = 'Annual' and b.year = 2026
order by e.full_name;
