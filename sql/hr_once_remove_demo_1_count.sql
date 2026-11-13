-- =====================================================================
-- RCL ERP – HR module. ONE TIME, part 1 of 2 (13-11-2026): COUNT what the demo employees hold. THIS FILE CHANGES NOTHING.
-- Asked 13-11-2026: "DEMO SAGLECH DELET KRAYCH AHE" – every employee in HR today was added for the demo; they are removed
-- before the company's own employee sheet is imported.
-- WHERE: Supabase → project rcl-hr → SQL Editor → paste the whole file → Run. It only reads.
-- Look at the numbers. If a REAL person is among them, stop and say so – part 2 removes ALL of them.
-- =====================================================================
select site, status, count(*) as employees, min(code) as first_code, max(code) as last_code
from public.hr_employees group by site, status order by site, status;

select t.table_name as "table", (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text::bigint as "rows"
from information_schema.tables t
where t.table_schema = 'public' and t.table_name in ('hr_employees', 'hr_employment', 'hr_employee_private', 'hr_employee_profile', 'hr_employee_rows', 'hr_employee_docs',
  'hr_punches', 'hr_punch_reviews', 'hr_day_entries', 'hr_regularize', 'hr_devices', 'hr_device_tries', 'hr_faces', 'hr_face_tries', 'hr_place_people', 'hr_shift_people',
  'hr_leave_requests', 'hr_leave_adjust', 'hr_month_people', 'hr_months', 'hr_salaries', 'hr_pay_emp', 'hr_pay_adjust', 'hr_advances', 'hr_payslips', 'hr_pay_runs')
order by 1;
