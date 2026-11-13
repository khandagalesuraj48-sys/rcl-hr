-- =====================================================================
-- RCL ERP – HR module. ONE TIME, part 2 of 2 (13-11-2026): REMOVE EVERY EMPLOYEE OF THE DEMO and everything that hangs on him.
-- Asked 13-11-2026: "DEMO SAGLECH DELET KRAYCH AHE" (every employee in HR today is a demo one; the company's own sheet is
-- imported afterwards with its own codes).
--
-- !!  THIS DELETES FOR EVER. It cannot be taken back from here.  !!
-- BEFORE: 1. run part 1 (hr_once_remove_demo_1_count.sql) and read the numbers;
--         2. make a backup: Supabase → project rcl-hr → Database → Backups (or download the tables you want to keep);
--         3. nobody should be marking attendance while it runs.
-- WHERE: Supabase → project rcl-hr → SQL Editor → paste the whole file → Run. ONLY in rcl-hr – never another project.
--
-- REMOVED (all sites): the employees, their history, personal details, profile, papers' records, punches and their reviews, days
--   entered by hand, requests, phones, faces, who-marks-where and shift lists, leave, the month's verification and approval,
--   salaries, PF / ESIC / PT ticks, pay adjustments, advances, payslips and pay runs.
-- KEPT: departments, designations, the lists, work places and projects, shifts, holidays, the rules, the leave policy, the pay
--   settings, the Admin's powers, the HO HR, the settings, the audit (what was done stays written), the sign-ins.
-- NOT TOUCHED: the Portal (its users and passwords), every other module's database, and the FILES in Storage (selfies, papers,
--   face pictures) – they are no longer shown anywhere; they can be emptied in Supabase → Storage when you wish.
-- The counter of the codes made by themselves starts again at RCL001 (the import moves it past the sheet's codes).
-- It runs in ONE transaction: all of it or nothing. It stops by itself if the database has a table it does not know.
-- =====================================================================
begin;

do $$
declare known text[] := array['hr_employees', 'hr_employment', 'hr_employee_private', 'hr_employee_profile', 'hr_employee_rows', 'hr_employee_docs',
  'hr_punches', 'hr_punch_reviews', 'hr_day_entries', 'hr_regularize', 'hr_devices', 'hr_device_tries', 'hr_faces', 'hr_face_tries', 'hr_place_people', 'hr_shift_people',
  'hr_leave_requests', 'hr_leave_adjust', 'hr_month_people', 'hr_salaries', 'hr_pay_emp', 'hr_pay_adjust', 'hr_advances', 'hr_payslips'];
  other text;
begin
  -- every table that hangs on an employee (directly or through another table) must be one this file knows
  with recursive r(t) as (
    select 'public.hr_employees'::regclass
    union select c.conrelid::regclass from pg_constraint c join r on c.confrelid = r.t where c.contype = 'f')
  select string_agg(t::text, ', ') into other from r where replace(t::text, 'public.', '') <> all (known);
  if other is not null then raise exception 'Stopped, nothing was removed: the database has a table this file does not know (%). Ask for the file to be brought up to date.', other; end if;
end $$;

-- what is there before
select 'before' as "when", (select count(*) from public.hr_employees) as employees, (select count(*) from public.hr_punches) as punches;

do $$
declare t text; list text := '';
begin
  foreach t in array array['hr_employees', 'hr_employment', 'hr_employee_private', 'hr_employee_profile', 'hr_employee_rows', 'hr_employee_docs',
    'hr_punches', 'hr_punch_reviews', 'hr_day_entries', 'hr_regularize', 'hr_devices', 'hr_device_tries', 'hr_faces', 'hr_face_tries', 'hr_place_people', 'hr_shift_people',
    'hr_leave_requests', 'hr_leave_adjust', 'hr_month_people', 'hr_months', 'hr_salaries', 'hr_pay_emp', 'hr_pay_adjust', 'hr_advances', 'hr_payslips', 'hr_pay_runs'] loop
    if to_regclass('public.' || t) is not null then list := list || case when list = '' then '' else ', ' end || 'public.' || quote_ident(t); end if;      -- (a step not installed yet: its tables are not there)
  end loop;
  execute 'truncate table ' || list;
end $$;

update public.hr_numbers set next_no = 1 where kind = 'emp';
insert into public.hr_audit (site, email, action, target, detail)
select '*', 'sql', 'Demo employees removed', 'all sites', jsonb_build_object('file', 'hr_once_remove_demo_2_delete.sql', 'asked', '13-11-2026')
where to_regclass('public.hr_audit') is not null;

-- what is there after (must be 0 and 0)
select 'after' as "when", (select count(*) from public.hr_employees) as employees, (select count(*) from public.hr_punches) as punches;

commit;
