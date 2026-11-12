-- RCL ERP – HR module, STEP 11: an employee's SALARY, proposed by the site's HR and approved by the HO HR (onboarding).
-- Asked 12-11-2026: "NEW EMPLOYEE SITE WAR ALA KI SITE HR EMPLOYEE ON BORD KRU SHAKEL … TYACHI SALARY PN MENTION KARU SHAKEL JI BASIC
-- SALARY ASEL ANI … APPROVAL SATHI JAIL". Decided: straight to the HO HR; a month's salary or a day's rate, chosen per person.
--
-- Run ONCE in the rcl-hr Supabase → SQL Editor (only there – never in another module's database). After step 10.
--
-- What it does: ONE new table. Nothing that is there today is changed or deleted.
--   hr_salaries   one row a proposal: the employee, a month's salary or a day's rate, the amount, from which date, who proposed it;
--                 the HO HR approves it or sends it back with the reason. A new salary later = a new row – the old ones stay.
-- It can be run again (it changes nothing the second time).
--
-- Going back: drop table public.hr_salaries;

create table if not exists public.hr_salaries (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null,
  pay_type text not null check (pay_type in ('monthly', 'daily')), amount numeric(12, 2) not null check (amount > 0),
  valid_from date not null, note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  asked_by text not null, asked_at timestamptz not null default now(),
  decided_by text, decided_at timestamptz, decide_note text
);
create index if not exists hr_salaries_emp on public.hr_salaries (employee_id, valid_from desc, id desc);
create index if not exists hr_salaries_waiting on public.hr_salaries (site) where status = 'pending';
create unique index if not exists hr_salaries_one_waiting on public.hr_salaries (employee_id) where status = 'pending';

alter table public.hr_salaries enable row level security;
revoke all on public.hr_salaries from public, anon, authenticated;
grant select, insert, update on public.hr_salaries to service_role;      -- never deleted
revoke all on sequence public.hr_salaries_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hr_salaries_id_seq to service_role;

notify pgrst, 'reload schema';
select 'HR step 11 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'hr_salaries') || ' of 1' as done;
