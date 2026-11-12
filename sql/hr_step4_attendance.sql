-- =====================================================================
-- RCL ERP – HR, step 4: ATTENDANCE – projects, work places (geofence), one phone a person, the punches (12-11-2026: "PURN HR
-- MODUAL BANWAYLA GHE"). His decisions: each person punches for himself, TODAY only; inside his work place only – "GEOFENCE BAHER
-- KAHICH NHI HONAR"; one phone at a time, released only by the HR Admin / Super Admin; a selfie with every punch as PROOF only;
-- no face matching; with no network the punch is kept in the phone and sent later exactly as it was taken.
-- Run ONCE in the HR Supabase project (rcl-hr) – after step 3. Supabase → SQL Editor → New query → paste → Run.
-- Safe to run again. It ADDS tables and one bucket; the ONLY change to what exists: the sign-in tables of step 1 also accept the
-- role 'self' (an employee who uses HR only for himself). No row is changed or deleted. It touches NO other database.
--
--   hr_projects        a project under a site
--   hr_places          a work place: circle (point + radius), polygon (area) or corridor (along the road, metres each side);
--                      for everybody of the site, some categories, some departments or chosen people; from a date; on / off;
--                      "removed" keeps the row (old punches point at it)
--   hr_place_people    the chosen people of a place
--   hr_devices         the phone a person's attendance is linked to (one active a person, one person a phone) and its releases
--   hr_device_tries    another phone that tried
--   hr_punches         every Sign in / Sign out, exactly as taken – rows are only ADDED (the server cannot change or delete one)
--   hr_punch_reviews   the decision on a punch that came in doubtful (who, when, why) – also only added
--   the PRIVATE bucket "hr-selfies" (JPG, 1 MB) – the proof photos
-- Rollback (only while no punch is taken): drop table public.hr_punch_reviews, public.hr_punches, public.hr_device_tries,
--   public.hr_devices, public.hr_place_people, public.hr_places, public.hr_projects;
-- =====================================================================
-- the sign-in tables: also the role 'self'
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'hr_sessions_role_check' and pg_get_constraintdef(oid) not like '%self%') then
    alter table public.hr_sessions drop constraint hr_sessions_role_check;
    alter table public.hr_sessions add constraint hr_sessions_role_check check (role in ('super', 'admin', 'user', 'self'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'hr_people_role_check' and pg_get_constraintdef(oid) not like '%self%') then
    alter table public.hr_people drop constraint hr_people_role_check;
    alter table public.hr_people add constraint hr_people_role_check check (role in ('super', 'admin', 'user', 'self'));
  end if;
end $$;

create table if not exists public.hr_projects (
  id uuid primary key default gen_random_uuid(), site text not null, name text not null, active boolean not null default true,
  created_by text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists hr_projects_name on public.hr_projects (site, lower(name));

create table if not exists public.hr_places (
  id uuid primary key default gen_random_uuid(), site text not null, project_id uuid references public.hr_projects (id),
  name text not null,
  kind text not null default 'site' check (kind in ('office', 'site_office', 'site', 'camp', 'plant', 'workshop', 'other')),
  shape text not null default 'circle' check (shape in ('circle', 'polygon', 'corridor')),
  lat double precision, lng double precision, radius_m integer check (radius_m is null or (radius_m >= 20 and radius_m <= 5000)),
  points jsonb not null default '[]',
  scope text not null default 'all' check (scope in ('all', 'category', 'department', 'people')), scope_values jsonb not null default '[]',
  valid_from date not null default current_date, active boolean not null default true,
  removed_at timestamptz, removed_by text not null default '', removed_reason text not null default '',
  created_by text not null default '', created_at timestamptz not null default now(), updated_by text not null default '', updated_at timestamptz not null default now(),
  check ((shape = 'circle' and lat is not null and lng is not null and radius_m is not null) or (shape = 'polygon' and jsonb_array_length(points) >= 3)
      or (shape = 'corridor' and jsonb_array_length(points) >= 2 and radius_m is not null))
);
create index if not exists hr_places_site on public.hr_places (site, active);
create table if not exists public.hr_place_people (
  place_id uuid not null references public.hr_places (id), employee_id uuid not null references public.hr_employees (id),
  created_by text not null default '', created_at timestamptz not null default now(), primary key (place_id, employee_id)
);
create index if not exists hr_place_people_emp on public.hr_place_people (employee_id);

create table if not exists public.hr_devices (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.hr_employees (id),
  device_id text not null, model text not null default '', os text not null default '',
  active boolean not null default true, bound_at timestamptz not null default now(),
  released_at timestamptz, released_by text not null default '', release_reason text not null default ''
);
create unique index if not exists hr_devices_one_a_person on public.hr_devices (employee_id) where active;
create unique index if not exists hr_devices_one_person_a_phone on public.hr_devices (device_id) where active;
create table if not exists public.hr_device_tries (
  id bigserial primary key, at timestamptz not null default now(), employee_id uuid not null references public.hr_employees (id),
  device_id text not null, model text not null default '', why text not null default ''
);
create index if not exists hr_device_tries_emp on public.hr_device_tries (employee_id, at desc);

create table if not exists public.hr_punches (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.hr_employees (id), site text not null,
  kind text not null check (kind in ('in', 'out')),
  day date not null, at timestamptz not null,                      -- the moment it counts for (the server's clock; an offline punch: the phone's own untouchable clock)
  received_at timestamptz not null default now(), at_device timestamptz,
  lat double precision not null, lng double precision not null, accuracy_m real,
  place_id uuid references public.hr_places (id), inside boolean not null, distance_m integer not null default 0,
  selfie_path text not null, device_row uuid references public.hr_devices (id),
  client_id text not null unique,                                   -- the phone's own number of this punch: sent twice, kept once
  offline boolean not null default false, flags jsonb not null default '{}',
  status text not null default 'ok' check (status in ('ok', 'review'))
);
create index if not exists hr_punches_emp_day on public.hr_punches (employee_id, day, at);
create index if not exists hr_punches_site_day on public.hr_punches (site, day);
create table if not exists public.hr_punch_reviews (
  id bigserial primary key, punch_id uuid not null references public.hr_punches (id), decision text not null check (decision in ('accepted', 'refused')),
  note text not null default '', by text not null, at timestamptz not null default now()
);
create index if not exists hr_punch_reviews_punch on public.hr_punch_reviews (punch_id);

do $$ declare t text; begin
  foreach t in array array['hr_projects', 'hr_places', 'hr_place_people', 'hr_devices', 'hr_device_tries', 'hr_punches', 'hr_punch_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update on public.hr_projects, public.hr_places, public.hr_devices to service_role;
grant select, insert, delete on public.hr_place_people to service_role;              -- who a place is for can be taken back
grant select, insert on public.hr_device_tries, public.hr_punches, public.hr_punch_reviews to service_role;   -- only added – never changed, never deleted
revoke all on sequence public.hr_device_tries_id_seq, public.hr_punch_reviews_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hr_device_tries_id_seq, public.hr_punch_reviews_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hr-selfies', 'hr-selfies', false, 1048576, array['image/jpeg'])
  on conflict (id) do nothing;

notify pgrst, 'reload schema';
select 'HR step 4 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('hr_projects', 'hr_places', 'hr_place_people', 'hr_devices', 'hr_device_tries', 'hr_punches', 'hr_punch_reviews')) || ' of 7 · private bucket hr-selfies '
  || (select count(*) from storage.buckets where id = 'hr-selfies' and public = false) as done;
