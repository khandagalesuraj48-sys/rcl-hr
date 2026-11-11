-- =====================================================================
-- RCL ERP – HR, step 1: the HR module's own sign-in (Phase 1a, asked 12-11-2026: "ata tu kam chalu kr").
-- Run ONCE in the HR Supabase project (rcl-hr – one project for EVERY site of this company; every row carries its site).
-- Supabase → SQL Editor → New query → paste → Run.
-- It can be run again safely: it only ADDS; nothing is changed or deleted. It touches NO other database (the Portal, Mechanical,
-- the Store, Engineering, Purchase and the sites' databases are not changed by it). It holds no employee data.
--
--   hr_people    who signed in to HR on a site (with the role the Portal gave: Admin / User / Super Admin)
--   hr_sessions  HR's sign-ins – a fingerprint only, 15 minutes, renewed by the open page
--   hr_tickets   the Portal tickets already used (a ticket is accepted once)
--   hr_audit     who did what, when – rows are only added
-- Every table is for the HR server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing else is built on it): drop table public.hr_audit, public.hr_tickets, public.hr_sessions, public.hr_people;
-- =====================================================================
create table if not exists public.hr_people (
  site text not null, email text not null, name text not null default '',
  role text not null default 'user' check (role in ('super', 'admin', 'user')),
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  primary key (site, email)
);
create table if not exists public.hr_sessions (
  id_hash text primary key, site text not null, email text not null, name text not null default '',
  role text not null check (role in ('super', 'admin', 'user')), info jsonb not null default '{}',
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index if not exists hr_sessions_email on public.hr_sessions (email);
create table if not exists public.hr_tickets (jti text primary key, expires_at timestamptz not null);
create table if not exists public.hr_audit (
  id bigserial primary key, at timestamptz not null default now(), site text not null default '', email text not null default '',
  action text not null, target text not null default '', detail jsonb
);
create index if not exists hr_audit_at on public.hr_audit (site, at desc);

do $$ declare t text; begin
  foreach t in array array['hr_people', 'hr_sessions', 'hr_tickets', 'hr_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.hr_audit_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hr_audit_id_seq to service_role;

notify pgrst, 'reload schema';
select 'HR step 1 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('hr_people', 'hr_sessions', 'hr_tickets', 'hr_audit')) || ' of 4' as done;
