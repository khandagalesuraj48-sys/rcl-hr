-- =====================================================================
-- RCL ERP – HR module. Step 6 (12-11-2026): THE EMPLOYEE'S FULL PROFILE.
-- Asked 12-11-2026 (with pictures of a reference product): "PROPER HE SAGLE OPTION BANWAYCHE AAHE" and
-- "TU FIX AS KAHI BANAU NAKO CHANGES KARAT AYAWET SUPER ADMIN LA ANI ADMIN LA PN".
-- WHERE: Supabase → project rcl-hr → SQL Editor → paste the whole file → Run. ONLY in rcl-hr. After step 5.
-- WHAT:  four NEW tables. Nothing existing is changed, nothing is deleted. Safe to run twice.
--   hr_lists            – every pick-list of the profile (prefix, marital status, blood group, nationality, employee type,
--                         type of worker, employment type, skill category, branch, relation, qualification, skill):
--                         the HR Admin / Super Admin add, rename and switch off the values – none is fixed in the code.
--   hr_employee_profile – one row an employee: his profile and job details (data), and his PF / UAN / ESIC / bank
--                         details (secret – never in a list or an export; an HR User sees the numbers masked).
--   hr_employee_rows    – what a person has several of: family members, education, experience, skills.
--   hr_settings         – a site's settings (first: which details are compulsory for "profile complete").
-- Every table is for the HR server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing is entered): drop table public.hr_employee_rows, public.hr_employee_profile, public.hr_settings, public.hr_lists;
-- =====================================================================
do $$ begin
  if to_regclass('public.hr_employees') is null then raise exception 'Run sql/hr_step2_employees.sql first.'; end if;
end $$;

create table if not exists public.hr_lists (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z_]{2,30}$'), name text not null check (length(btrim(name)) between 1 and 60),
  active boolean not null default true, sort integer not null default 0,
  created_by text not null default '', created_at timestamptz not null default now(), updated_by text not null default '', updated_at timestamptz not null default now()
);
create unique index if not exists hr_lists_kind_name on public.hr_lists (kind, lower(name));

create table if not exists public.hr_employee_profile (
  employee_id uuid primary key references public.hr_employees (id),
  data jsonb not null default '{}', secret jsonb not null default '{}',
  updated_by text not null default '', updated_at timestamptz not null default now()
);

create table if not exists public.hr_employee_rows (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.hr_employees (id),
  kind text not null check (kind in ('family', 'education', 'experience', 'skill')), data jsonb not null default '{}',
  created_by text not null default '', created_at timestamptz not null default now(), updated_by text not null default '', updated_at timestamptz not null default now(),
  removed_by text not null default '', removed_at timestamptz, removed_reason text not null default ''
);
create index if not exists hr_employee_rows_emp on public.hr_employee_rows (employee_id, kind) where removed_at is null;

create table if not exists public.hr_settings (
  site text not null, key text not null check (key ~ '^[a-z_]{2,40}$'), value jsonb not null default '{}',
  updated_by text not null default '', updated_at timestamptz not null default now(), primary key (site, key)
);

do $$ declare t text; begin
  foreach t in array array['hr_lists', 'hr_employee_profile', 'hr_employee_rows', 'hr_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);      -- no delete: a value is switched off, a row is "removed" with who and why
  end loop;
end $$;

-- A first set of values, so that the forms can be used at once. Each can be renamed, switched off or added to in HR → Lists.
insert into public.hr_lists (kind, name, sort, created_by)
select v.kind, v.name, v.sort, 'step 6' from (values
  ('prefix', 'Mr.', 1), ('prefix', 'Mrs.', 2), ('prefix', 'Ms.', 3),
  ('marital', 'Single', 1), ('marital', 'Married', 2),
  ('blood', 'A+', 1), ('blood', 'A-', 2), ('blood', 'B+', 3), ('blood', 'B-', 4), ('blood', 'AB+', 5), ('blood', 'AB-', 6), ('blood', 'O+', 7), ('blood', 'O-', 8),
  ('nationality', 'Indian', 1),
  ('employee_type', 'National', 1), ('employee_type', 'Expat', 2),
  ('employment_type', 'Probation', 1), ('employment_type', 'Confirmed', 2),
  ('skill_category', 'Highly skilled', 1), ('skill_category', 'Skilled', 2), ('skill_category', 'Semi-skilled', 3), ('skill_category', 'Unskilled', 4),
  ('relation', 'Father', 1), ('relation', 'Mother', 2), ('relation', 'Spouse', 3), ('relation', 'Son', 4), ('relation', 'Daughter', 5), ('relation', 'Brother', 6), ('relation', 'Sister', 7)
) as v(kind, name, sort)
where not exists (select 1 from public.hr_lists l where l.kind = v.kind and lower(l.name) = lower(v.name));

notify pgrst, 'reload schema';
