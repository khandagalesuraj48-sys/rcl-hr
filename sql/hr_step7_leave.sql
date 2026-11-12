-- =====================================================================
-- RCL ERP – HR module. Step 7 (12-11-2026): LEAVE.
-- Asked 12-11-2026: "leave apply karta yeil … leave balance hr add krel pratek employee cha … leave policy asel pratek month
-- madhe site sathi 4 aahe sunday working ahe sunday absent or leave asel tr te balance leave madhun kmi hot head office policy
-- wegli aahe … apply leave approval zal reject zal te bghta yeil".
-- WHERE: Supabase → project rcl-hr → SQL Editor → paste the whole file → Run. ONLY in rcl-hr. After step 6.
-- WHAT:  three NEW tables. Nothing existing is changed, nothing is deleted. Safe to run twice.
--   hr_leave_policy   – a site's leave policy WITH ITS DATE (so many leaves a month; unused ones go on or lapse; an absent day
--                       takes one by itself or not; who approves). A new version is a new row – only added, never changed.
--   hr_leave_adjust   – what the HR office adds to (or takes from) one employee's balance, with the reason. Only added.
--   hr_leave_requests – a person's request for leave and who decided it, level by level.
-- The balance is never a stored number: it is always counted from the policy, these rows and the muster.
-- Every table is for the HR server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing is entered): drop table public.hr_leave_requests, public.hr_leave_adjust, public.hr_leave_policy;
-- =====================================================================
do $$ begin
  if to_regclass('public.hr_day_entries') is null then raise exception 'Run sql/hr_step5_muster.sql first.'; end if;
end $$;

create table if not exists public.hr_leave_policy (
  id bigserial primary key, site text not null, valid_from date not null,
  per_month numeric(4,1) not null check (per_month >= 0 and per_month <= 31),
  carry boolean not null default true,          -- unused leaves go on to the next month (false: they lapse at the month's end)
  auto_absent boolean not null default true,    -- an absent day takes one leave from the balance by itself (while there is one)
  levels smallint not null default 2 check (levels in (1, 2)),   -- 2: the reporting person first, then the HR office; 1: the HR office only
  created_by text not null default '', created_at timestamptz not null default now()
);
create index if not exists hr_leave_policy_site on public.hr_leave_policy (site, valid_from desc, id desc);

create table if not exists public.hr_leave_adjust (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null,
  day date not null, days numeric(5,1) not null check (days <> 0 and days between -366 and 366),
  reason text not null check (length(btrim(reason)) >= 3),
  entered_by text not null default '', entered_at timestamptz not null default now()
);
create index if not exists hr_leave_adjust_emp on public.hr_leave_adjust (employee_id, day);

create table if not exists public.hr_leave_requests (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null,
  from_day date not null, to_day date not null check (to_day >= from_day),
  part text not null default 'full' check (part in ('full', 'first', 'second')),
  days numeric(4,1) not null check (days > 0 and days <= 62),
  reason text not null check (length(btrim(reason)) >= 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused', 'cancelled')),
  level smallint not null default 2 check (level in (1, 2)), steps jsonb not null default '[]',
  asked_by text not null default '', asked_at timestamptz not null default now(), decided_at timestamptz
);
create index if not exists hr_leave_requests_emp on public.hr_leave_requests (employee_id, from_day);
create index if not exists hr_leave_requests_site on public.hr_leave_requests (site, status, asked_at);

do $$ declare t text; begin
  foreach t in array array['hr_leave_policy', 'hr_leave_adjust', 'hr_leave_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant select, insert on public.hr_leave_policy, public.hr_leave_adjust to service_role;      -- only added – never changed, never deleted
grant select, insert, update on public.hr_leave_requests to service_role;
revoke all on sequence public.hr_leave_policy_id_seq, public.hr_leave_adjust_id_seq, public.hr_leave_requests_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hr_leave_policy_id_seq, public.hr_leave_adjust_id_seq, public.hr_leave_requests_id_seq to service_role;

notify pgrst, 'reload schema';
