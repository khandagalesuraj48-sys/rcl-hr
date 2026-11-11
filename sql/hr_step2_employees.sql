-- =====================================================================
-- RCL ERP – HR, step 2: the Employee Master (Phase 1, asked 12-11-2026: "ata employee step continue kr").
-- Run ONCE in the HR Supabase project (rcl-hr) – after step 1. Supabase → SQL Editor → New query → paste → Run.
-- It can be run again safely: it only ADDS; nothing is changed or deleted. It touches NO other database.
--
--   hr_departments, hr_designations   the masters (names; switched off, never deleted)
--   hr_employees     one row per employee: code, name, category (staff / operator / driver / labour), DOB, mobile, e-mail,
--                    the site, department, designation and reporting person of TODAY, joining / leaving, status
--                    (incomplete → pending → active → left). A mobile number and an e-mail belong to ONE employee.
--   hr_employment    the history: every site / department / designation / reporting person with its dates (a transfer = a new row)
--   hr_numbers + hr_next_no()   the employee codes, never given twice
-- Every table is for the HR server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while no employee is entered): drop function public.hr_next_no(text, int);
--   drop table public.hr_employment, public.hr_employees, public.hr_designations, public.hr_departments, public.hr_numbers;
-- =====================================================================
create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true,
  created_by text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists hr_departments_name on public.hr_departments (lower(name));
create table if not exists public.hr_designations (
  id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true,
  created_by text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists hr_designations_name on public.hr_designations (lower(name));

create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null check (category in ('staff', 'operator', 'driver', 'labour')),
  gender text not null default '' check (gender in ('', 'male', 'female', 'other')),
  dob date, mobile text not null default '', email text not null default '',
  site text not null,
  department_id uuid references public.hr_departments (id), designation_id uuid references public.hr_designations (id),
  reports_to uuid references public.hr_employees (id),
  joined_on date, left_on date, left_reason text not null default '',
  status text not null default 'incomplete' check (status in ('incomplete', 'pending', 'active', 'left')),
  email_verified_at timestamptz, portal_email text not null default '',
  created_by text not null default '', created_at timestamptz not null default now(),
  updated_by text not null default '', updated_at timestamptz not null default now(),
  check (email = lower(email)), check (mobile = '' or mobile ~ '^[6-9][0-9]{9}$')
);
-- a mobile number and an e-mail are what a person signs in with: each belongs to one employee
create unique index if not exists hr_employees_mobile on public.hr_employees (mobile) where mobile <> '';
create unique index if not exists hr_employees_email on public.hr_employees (email) where email <> '';
create index if not exists hr_employees_site on public.hr_employees (site, status, name);

create table if not exists public.hr_employment (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.hr_employees (id),
  site text not null, department_id uuid references public.hr_departments (id), designation_id uuid references public.hr_designations (id),
  reports_to uuid references public.hr_employees (id),
  valid_from date not null, valid_to date, note text not null default '',
  created_by text not null default '', created_at timestamptz not null default now()
);
create index if not exists hr_employment_emp on public.hr_employment (employee_id, valid_from desc);

create table if not exists public.hr_numbers (kind text primary key, next_no bigint not null default 1 check (next_no >= 1));
-- the next p_count numbers of a kind in one step (the first of them is returned) – two people saving at once never get the same
create or replace function public.hr_next_no(p_kind text, p_count int default 1)
returns bigint language plpgsql security definer set search_path = public as $$
declare first_no bigint; n int := greatest(1, least(coalesce(p_count, 1), 5000));
begin
  insert into public.hr_numbers (kind, next_no) values (p_kind, 1) on conflict (kind) do nothing;
  update public.hr_numbers set next_no = next_no + n where kind = p_kind returning next_no - n into first_no;
  return first_no;
end $$;
revoke all on function public.hr_next_no(text, int) from public, anon, authenticated;
grant execute on function public.hr_next_no(text, int) to service_role;

do $$ declare t text; begin
  foreach t in array array['hr_departments', 'hr_designations', 'hr_employees', 'hr_employment', 'hr_numbers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
select 'HR step 2 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('hr_departments', 'hr_designations', 'hr_employees', 'hr_employment', 'hr_numbers')) || ' of 5' as done;
