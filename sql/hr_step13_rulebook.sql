-- =====================================================================
-- RCL ERP – HR module. Step 13 (13-11-2026): THE RULE BOOK.
-- Asked 13-11-2026: "super admin kade ek main rule book haway … attendance policy leave policy late come policy late come early
-- go policy holiday policy comoff policy … ek hun anek policy banwayta yeil … employee la site la ho la asign krta yetil …
-- pratek site wise weg wegle niyam … comoff … overtime … authorization … kon verify krel kon approval krel … bulk attendance
-- correct … export … import … leave form attachment".
-- WHERE: Supabase → project rcl-hr → SQL Editor → paste the whole file → Run. ONLY in rcl-hr. After step 12.
-- WHAT:  TEN NEW tables and ONE new column (hr_leave_requests.bucket, with a default – every row of today keeps working).
--        Nothing existing is deleted, no row of today is changed. Safe to run twice.
--   hr_policies        – a policy of the Rule Book: its kind, its name, for which sites it is open, in use or closed.
--   hr_policy_versions – what a policy says FROM A DATE (and who verifies / who approves). A change is a new row – only added.
--   hr_policy_assign   – which policy a person has FROM A DATE, one for each kind. Only added (the newest one counts).
--   hr_policy_defaults – the policy a site gives to everybody who has none of his own, FROM A DATE. Only added.
--   hr_weekoff_days    – the HR office's word on ONE day of a site (a fifth Saturday: off or working). Only added.
--   hr_leave_credits   – days added to (or taken from) a person's Paid-leave or Comp-off balance, each with where it comes
--                        from (opening balance, the HR office, overtime, work on a day off). Only added.
--   hr_asks            – a thing that waits for "verify" and "approve": overtime, comp-off, extra leave, a bulk correction.
--   hr_att_imports     – a bulk correction of a month's attendance: who, when, why, how many days it set right.
--   hr_att_import_rows – which day entries a bulk correction made (the punches stay as they came – as always).
--   hr_leave_files     – a paper attached to a leave request (a photo or a PDF, kept in HR's private store).
-- UNTIL A POLICY IS GIVEN TO A SITE OR A PERSON NOTHING CHANGES: the rules, the leave policy and the shifts of today go on
-- counting exactly as they do.
-- Every table is for the HR server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing is entered): drop table public.hr_leave_files, public.hr_att_import_rows, public.hr_att_imports,
--   public.hr_asks, public.hr_leave_credits, public.hr_weekoff_days, public.hr_policy_defaults, public.hr_policy_assign,
--   public.hr_policy_versions, public.hr_policies;  alter table public.hr_leave_requests drop column bucket;
-- =====================================================================
do $$ begin
  if to_regclass('public.hr_leave_requests') is null then raise exception 'Run sql/hr_step7_leave.sql first.'; end if;
  if to_regclass('public.hr_day_entries') is null then raise exception 'Run sql/hr_step5_muster.sql first.'; end if;
end $$;

create table if not exists public.hr_policies (
  id bigserial primary key,
  kind text not null check (kind in ('attendance', 'late', 'weekoff', 'leave', 'compoff', 'overtime')),
  name text not null check (length(btrim(name)) >= 2),
  sites text[] not null default '{}',            -- the sites it is open for; empty = every site
  active boolean not null default true,          -- false = closed: it stays where it is used, nobody new gets it
  created_by text not null default '', created_at timestamptz not null default now(),
  closed_by text not null default '', closed_at timestamptz
);
create unique index if not exists hr_policies_name on public.hr_policies (kind, lower(btrim(name)));

create table if not exists public.hr_policy_versions (
  id bigserial primary key, policy_id bigint not null references public.hr_policies (id), valid_from date not null,
  body jsonb not null default '{}',              -- what the policy says (lib/rulebook.js checks it)
  auth jsonb not null default '{}',              -- { verify: […], approve: […] } – who verifies, who approves
  created_by text not null default '', created_at timestamptz not null default now()
);
create index if not exists hr_policy_versions_pol on public.hr_policy_versions (policy_id, valid_from desc, id desc);

create table if not exists public.hr_policy_assign (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null,
  kind text not null check (kind in ('attendance', 'late', 'weekoff', 'leave', 'compoff', 'overtime')),
  policy_id bigint references public.hr_policies (id),      -- empty = back to the site's own policy from that date
  valid_from date not null, reason text not null default '',
  assigned_by text not null default '', assigned_at timestamptz not null default now()
);
create index if not exists hr_policy_assign_emp on public.hr_policy_assign (employee_id, kind, valid_from desc, id desc);
create index if not exists hr_policy_assign_site on public.hr_policy_assign (site, kind);

create table if not exists public.hr_policy_defaults (
  id bigserial primary key, site text not null,
  kind text not null check (kind in ('attendance', 'late', 'weekoff', 'leave', 'compoff', 'overtime')),
  policy_id bigint references public.hr_policies (id),      -- empty = no policy of the Rule Book: the site's rules of before
  valid_from date not null, set_by text not null default '', set_at timestamptz not null default now()
);
create index if not exists hr_policy_defaults_site on public.hr_policy_defaults (site, kind, valid_from desc, id desc);

create table if not exists public.hr_weekoff_days (
  id bigserial primary key, site text not null, day date not null, off boolean not null,
  reason text not null check (length(btrim(reason)) >= 3),
  set_by text not null default '', set_at timestamptz not null default now()
);
create index if not exists hr_weekoff_days_site on public.hr_weekoff_days (site, day, id desc);

create table if not exists public.hr_leave_credits (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null,
  day date not null, bucket text not null check (bucket in ('paid', 'comp')),
  days numeric(5,1) not null check (days <> 0 and days between -366 and 366),
  source text not null check (source in ('opening', 'hr', 'overtime', 'compoff')),
  reason text not null check (length(btrim(reason)) >= 3),
  ask_id bigint,                                 -- the request it was approved with (hr_asks)
  entered_by text not null default '', entered_at timestamptz not null default now()
);
create index if not exists hr_leave_credits_emp on public.hr_leave_credits (employee_id, day);

create table if not exists public.hr_asks (
  id bigserial primary key, site text not null, employee_id uuid references public.hr_employees (id),
  kind text not null check (kind in ('overtime', 'compoff', 'leave_credit', 'att_import')),
  day date not null, body jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused', 'cancelled')),
  stage text not null default 'approve' check (stage in ('verify', 'approve')),   -- where it waits
  auth jsonb not null default '{}',              -- who verifies / approves – taken from the policy when it was asked
  steps jsonb not null default '[]',             -- who did what, step by step
  asked_by text not null default '', asked_at timestamptz not null default now(), decided_at timestamptz
);
create index if not exists hr_asks_site on public.hr_asks (site, status, asked_at desc);
create index if not exists hr_asks_emp on public.hr_asks (employee_id, kind, day);
create unique index if not exists hr_asks_one on public.hr_asks (employee_id, kind, day) where status in ('pending', 'approved') and kind in ('overtime', 'compoff');

create table if not exists public.hr_att_imports (
  id bigserial primary key, site text not null, month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  reason text not null check (length(btrim(reason)) >= 3), file_name text not null default '',
  asked integer not null default 0, changed integer not null default 0, refused integer not null default 0,
  ask_id bigint, imported_by text not null default '', imported_at timestamptz not null default now()
);
create index if not exists hr_att_imports_site on public.hr_att_imports (site, month, id desc);

create table if not exists public.hr_att_import_rows (
  import_id bigint not null references public.hr_att_imports (id), entry_id bigint not null references public.hr_day_entries (id),
  employee_id uuid not null, day date not null, was text not null default '', now_is text not null default '',
  primary key (import_id, entry_id)
);

create table if not exists public.hr_leave_files (
  id bigserial primary key, request_id bigint not null references public.hr_leave_requests (id),
  employee_id uuid not null references public.hr_employees (id), site text not null,
  path text not null, name text not null default '', mime text not null default '', size integer not null default 0,
  added_by text not null default '', added_at timestamptz not null default now(),
  removed_by text not null default '', removed_at timestamptz
);
create index if not exists hr_leave_files_req on public.hr_leave_files (request_id);

-- from which balance a leave is taken: every request of today is "paid" (the one balance there was)
alter table public.hr_leave_requests add column if not exists bucket text not null default 'paid';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hr_leave_requests_bucket_check') then
    alter table public.hr_leave_requests add constraint hr_leave_requests_bucket_check check (bucket in ('paid', 'comp'));
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['hr_policies', 'hr_policy_versions', 'hr_policy_assign', 'hr_policy_defaults', 'hr_weekoff_days', 'hr_leave_credits', 'hr_asks', 'hr_att_imports', 'hr_att_import_rows', 'hr_leave_files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update on public.hr_policies, public.hr_asks, public.hr_leave_files to service_role;
grant delete on public.hr_policies to service_role;      -- only a policy that was never used (the server checks it)
-- only added – never changed, never deleted
grant select, insert on public.hr_policy_versions, public.hr_policy_assign, public.hr_policy_defaults, public.hr_weekoff_days, public.hr_leave_credits, public.hr_att_imports, public.hr_att_import_rows to service_role;
grant delete on public.hr_policy_versions to service_role;      -- together with a never-used policy only
do $$ declare q text; begin
  foreach q in array array['hr_policies_id_seq', 'hr_policy_versions_id_seq', 'hr_policy_assign_id_seq', 'hr_policy_defaults_id_seq', 'hr_weekoff_days_id_seq', 'hr_leave_credits_id_seq', 'hr_asks_id_seq', 'hr_att_imports_id_seq', 'hr_leave_files_id_seq'] loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', q);
    execute format('grant usage, select on sequence public.%I to service_role', q);
  end loop;
end $$;

notify pgrst, 'reload schema';
select 'HR step 13 done · Rule Book tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('hr_policies', 'hr_policy_versions', 'hr_policy_assign', 'hr_policy_defaults', 'hr_weekoff_days', 'hr_leave_credits', 'hr_asks', 'hr_att_imports', 'hr_att_import_rows', 'hr_leave_files')) || ' of 10' as result;
