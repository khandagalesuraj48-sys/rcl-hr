-- RCL ERP – HR module, STEP 10: the month's attendance is VERIFIED by the site's HR and APPROVED by the HO HR.
-- Asked 12-11-2026: "MONTH END LA JYA TYA SITE CHA HR ATTENDANCE VERIFY KAREL USER WISE BULK VERIFY … PRESENT DAYS ABSENT DAYS
-- HALF DAYS EXTRA DAYS … SITE HR NI VERIFY KEL KI DIRECT HO HR KADE DATA JAIL … MG HO HR SWATA ATTENDENCE CHECK KRU SHKEL".
-- Decided: a new role HO HR, given by the Super Admin; the site's HR may still change until the HO HR approves.
--
-- Run ONCE in the rcl-hr Supabase → SQL Editor (only there – never in another module's database). After step 7.
--
-- What it does: THREE new tables. Nothing that is there today is changed or deleted.
--   hr_ho_hr          who is HO HR (the sign-in's e-mail; given / taken by the Super Admin)
--   hr_month_people   one row a person a month: the counts the site's HR verified (present, half, absent, leave, weekly off,
--                     holiday, extra days, late days, days for pay), who and when; sent back by the HO HR: who, when, why
--   hr_months         a month of a site the HO HR approved (who, when); opened again by the Super Admin: who, when, why
-- It can be run again (it changes nothing the second time).
--
-- Going back: drop table public.hr_months, public.hr_month_people, public.hr_ho_hr;   (attendance itself is not touched by them)

create table if not exists public.hr_ho_hr (
  email text primary key, active boolean not null default true,
  given_by text not null, given_at timestamptz not null default now(), taken_by text, taken_at timestamptz
);

create table if not exists public.hr_month_people (
  id bigserial primary key, site text not null, month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  employee_id uuid not null references public.hr_employees (id), counts jsonb not null,
  verified_by text not null, verified_at timestamptz not null default now(),
  returned_by text, returned_at timestamptz, return_reason text,
  unique (site, month, employee_id)
);
create index if not exists hr_month_people_month on public.hr_month_people (site, month);

create table if not exists public.hr_months (
  id bigserial primary key, site text not null, month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'approved' check (status in ('approved', 'reopened')),
  people integer not null default 0, note text not null default '',
  approved_by text not null, approved_at timestamptz not null default now(),
  reopened_by text, reopened_at timestamptz, reopen_reason text,
  unique (site, month)
);

do $$ declare t text; begin
  foreach t in array array['hr_ho_hr', 'hr_month_people', 'hr_months'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update on public.hr_ho_hr, public.hr_month_people, public.hr_months to service_role;      -- never deleted
revoke all on sequence public.hr_month_people_id_seq, public.hr_months_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hr_month_people_id_seq, public.hr_months_id_seq to service_role;

notify pgrst, 'reload schema';
select 'HR step 10 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('hr_ho_hr', 'hr_month_people', 'hr_months')) || ' of 3' as done;
