-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- RCL ERP – HR – STEP 5: shifts, holidays, the attendance rules, the muster, regularization, manual entry / correction
-- Run ONCE in the HR Supabase (rcl-hr) → SQL Editor, AFTER step 4. It only ADDS: no table, row or column of the steps before is
-- changed or removed. Safe to run again.
--
--   hr_shifts, hr_shift_people   a shift (from – to, its break) and for whom: everybody / categories / departments / chosen people
--   hr_holidays                  the site's holidays (a removed one stays, with who removed it)
--   hr_att_rules                 the rules WITH THEIR DATE (hours for a full / half day, grace, weekly off …): a new version is a
--                                new row – a day is always measured with the version of that day. Only added, never changed.
--   hr_regularize                a person's request to set an old day right (missed IN / OUT) – and who decided it, level by level
--   hr_day_entries               what counts for a day INSTEAD of its punches: a manual entry, an approved request, a correction –
--                                with the old times, the new times, the reason, who and when. Only added, never changed: the
--                                newest row of a day counts; the punches themselves are never touched.
--   hr_admin_powers              which powers the Super Admin gave the HR Admin on a site (no row = allowed)
-- Row Level Security is ON for every table with no access given: only the HR server (its secret key) reaches them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('public.hr_punches') is null then raise exception 'Run sql/hr_step4_attendance.sql first.'; end if;
end $$;

create table if not exists public.hr_shifts (
  id uuid primary key default gen_random_uuid(), site text not null, name text not null,
  start_time time not null, end_time time not null, break_min integer not null default 0 check (break_min >= 0 and break_min <= 240),
  scope text not null default 'all' check (scope in ('all', 'category', 'department', 'people')), scope_values jsonb not null default '[]',
  valid_from date not null default current_date, active boolean not null default true,
  removed_at timestamptz, removed_by text not null default '', removed_reason text not null default '',
  created_by text not null default '', created_at timestamptz not null default now(), updated_by text not null default '', updated_at timestamptz not null default now(),
  check (start_time <> end_time)
);
create index if not exists hr_shifts_site on public.hr_shifts (site) where removed_at is null;

create table if not exists public.hr_shift_people (
  shift_id uuid not null references public.hr_shifts (id), employee_id uuid not null references public.hr_employees (id),
  created_by text not null default '', created_at timestamptz not null default now(), primary key (shift_id, employee_id)
);
create index if not exists hr_shift_people_emp on public.hr_shift_people (employee_id);

create table if not exists public.hr_holidays (
  id uuid primary key default gen_random_uuid(), site text not null, day date not null, name text not null,
  created_by text not null default '', created_at timestamptz not null default now(),
  removed_at timestamptz, removed_by text not null default ''
);
create unique index if not exists hr_holidays_day on public.hr_holidays (site, day) where removed_at is null;

create table if not exists public.hr_att_rules (
  id bigserial primary key, site text not null, valid_from date not null, rules jsonb not null default '{}',
  created_by text not null, created_at timestamptz not null default now()
);
create index if not exists hr_att_rules_site on public.hr_att_rules (site, valid_from desc, id desc);

create table if not exists public.hr_regularize (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null, day date not null,
  in_time time, out_time time, out_next_day boolean not null default false, reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  level integer not null default 1 check (level in (1, 2)),          -- where it waits: 1 = the reporting person, 2 = the HR office
  steps jsonb not null default '[]',                                 -- who decided what, level by level
  asked_by text not null, asked_at timestamptz not null default now(), decided_at timestamptz,
  check (in_time is not null or out_time is not null)
);
create index if not exists hr_regularize_site on public.hr_regularize (site, status, asked_at desc);
create index if not exists hr_regularize_emp on public.hr_regularize (employee_id, day);
create unique index if not exists hr_regularize_one_waiting on public.hr_regularize (employee_id, day) where status = 'pending';

create table if not exists public.hr_day_entries (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null, day date not null,
  in_at timestamptz, out_at timestamptz,                             -- both empty = "no attendance on this day" (a wrong punch set aside)
  old_in timestamptz, old_out timestamptz,                           -- what counted before this row
  source text not null check (source in ('manual', 'regularized', 'correction')),
  reason text not null check (length(btrim(reason)) >= 3),
  request_id bigint references public.hr_regularize (id),
  entered_by text not null, entered_at timestamptz not null default now(),
  check (out_at is null or in_at is null or out_at > in_at)
);
create index if not exists hr_day_entries_emp on public.hr_day_entries (employee_id, day, id desc);
create index if not exists hr_day_entries_site on public.hr_day_entries (site, day);

create table if not exists public.hr_admin_powers (
  site text not null, power text not null, allowed boolean not null, set_by text not null, set_at timestamptz not null default now(),
  primary key (site, power)
);

do $$ declare t text; begin
  foreach t in array array['hr_shifts', 'hr_shift_people', 'hr_holidays', 'hr_att_rules', 'hr_regularize', 'hr_day_entries', 'hr_admin_powers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update on public.hr_shifts, public.hr_holidays, public.hr_regularize, public.hr_admin_powers to service_role;
grant select, insert, delete on public.hr_shift_people to service_role;                    -- for whom a shift is can be taken back
grant select, insert on public.hr_att_rules, public.hr_day_entries to service_role;       -- only added – never changed, never deleted
revoke all on sequence public.hr_att_rules_id_seq, public.hr_regularize_id_seq, public.hr_day_entries_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hr_att_rules_id_seq, public.hr_regularize_id_seq, public.hr_day_entries_id_seq to service_role;

notify pgrst, 'reload schema';
select 'HR step 5 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('hr_shifts', 'hr_shift_people', 'hr_holidays', 'hr_att_rules', 'hr_regularize', 'hr_day_entries', 'hr_admin_powers')) || ' of 7' as done;
