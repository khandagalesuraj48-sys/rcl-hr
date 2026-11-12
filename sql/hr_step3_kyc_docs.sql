-- =====================================================================
-- RCL ERP – HR, step 3: the employee's own details and papers (asked 12-11-2026: "EMPLOYEE MADHE TYACHI KYC DOCUMENT ATTACH
-- KARAYCHE AHET … ADHAR PAN SECONDRY MOBILE NUMBER FAMILY NUMBER TYACH ADDRESS").
-- Run ONCE in the HR Supabase project (rcl-hr) – after step 2. Supabase → SQL Editor → New query → paste → Run.
-- It can be run again safely: it only ADDS; nothing is changed or deleted. It touches NO other database.
--
--   hr_employee_private   one row per employee: Aadhaar, PAN, second mobile, a family member (name, relation, mobile), the
--                         present and the permanent address. Kept apart from hr_employees: never in a list or an export.
--   hr_employee_docs      the papers: kind (photo, aadhaar, pan, education, licence, bank_passbook, salary_slip, experience,
--                         other), its number and expiry where it has one, the file's place. A paper is never deleted: it is
--                         "removed" with who, when and why – the row and the file stay.
--   the PRIVATE bucket "hr-docs" (10 MB a file; JPG, PNG, WebP, PDF) – never public; a file opens only through a link of the
--                         HR server that works for a few minutes.
-- Every table is for the HR server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing is entered): drop table public.hr_employee_docs, public.hr_employee_private; (the empty bucket: Storage → hr-docs → delete)
-- =====================================================================
create table if not exists public.hr_employee_private (
  employee_id uuid primary key references public.hr_employees (id),
  aadhaar text not null default '' check (aadhaar = '' or aadhaar ~ '^[2-9][0-9]{11}$'),
  pan text not null default '' check (pan = '' or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  mobile2 text not null default '' check (mobile2 = '' or mobile2 ~ '^[6-9][0-9]{9}$'),
  family_name text not null default '', family_relation text not null default '',
  family_mobile text not null default '' check (family_mobile = '' or family_mobile ~ '^[6-9][0-9]{9}$'),
  address_current text not null default '', address_permanent text not null default '',
  updated_by text not null default '', updated_at timestamptz not null default now()
);
-- an Aadhaar and a PAN belong to one employee
create unique index if not exists hr_employee_private_aadhaar on public.hr_employee_private (aadhaar) where aadhaar <> '';
create unique index if not exists hr_employee_private_pan on public.hr_employee_private (pan) where pan <> '';

create table if not exists public.hr_employee_docs (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.hr_employees (id),
  kind text not null check (kind in ('photo', 'aadhaar', 'pan', 'education', 'licence', 'bank_passbook', 'salary_slip', 'experience', 'other')),
  title text not null default '', number text not null default '', expires_on date,
  path text not null unique, mime text not null, bytes bigint not null check (bytes > 0),
  active boolean not null default true, removed_by text not null default '', removed_at timestamptz, removed_reason text not null default '',
  created_by text not null default '', created_at timestamptz not null default now()
);
create index if not exists hr_employee_docs_emp on public.hr_employee_docs (employee_id, active, kind);

do $$ declare t text; begin
  foreach t in array array['hr_employee_private', 'hr_employee_docs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);      -- no delete
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hr-docs', 'hr-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;

notify pgrst, 'reload schema';
select 'HR step 3 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('hr_employee_private', 'hr_employee_docs')) || ' of 2 · private bucket hr-docs '
  || (select count(*) from storage.buckets where id = 'hr-docs' and public = false) as done;
