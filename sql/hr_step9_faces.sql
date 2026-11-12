-- RCL ERP – HR module, STEP 9: the face of an employee for attendance.
-- Asked 12-11-2026: "realtime face recogniz ani geofence he 2 ni haway yatle ek jari nahi zal attendence mark nahi honar … face
-- first time register krawa lagel … nantr same face ala tr sign in"; decided: our own check (the app + this server, nothing sent
-- to another company), at once for everybody, no approval of the registration, "90 percentage jri face match zala tr sign in".
--
-- Run ONCE in the rcl-hr Supabase → SQL Editor (only there – never in another module's database). After step 8.
--
-- What it does – TWO NEW tables, nothing existing is changed or deleted:
--   hr_faces       the registered face of an employee: the measurements of his face (numbers – 128 a picture; a face cannot be
--                  drawn back from them), where the five pictures of the registration are kept (the PRIVATE bucket hr-docs),
--                  who / when / which phone. One active face a person. It is never deleted: "reset" by the HR Admin / Super
--                  Admin with the reason (active = false) – then he registers again.
--   hr_face_tries  every check: the registration and each attendance – matched or not, how far (the percentage shown), the
--                  proof photo's place. Only added – never changed, never deleted (the database refuses it).
-- Row Level Security on both with no access given: only the HR server reaches them. No file is made public.
-- It can be run again (it changes nothing the second time).
--
-- Going back (only while nobody is registered): drop table public.hr_face_tries, public.hr_faces;

create table if not exists public.hr_faces (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.hr_employees (id), site text not null,
  descriptors jsonb not null,                                        -- [[128 numbers], …] – one a picture of the registration
  photos jsonb not null default '[]',                                -- [{ pose, path }] in the private bucket hr-docs
  device_id text not null default '', model text not null default '',
  active boolean not null default true,
  enrolled_by text not null, enrolled_at timestamptz not null default now(),
  reset_by text not null default '', reset_at timestamptz, reset_reason text not null default ''
);
create unique index if not exists hr_faces_one on public.hr_faces (employee_id) where active;
create index if not exists hr_faces_site on public.hr_faces (site, active);

create table if not exists public.hr_face_tries (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null,
  kind text not null check (kind in ('enrol', 'punch')),
  result text not null check (result in ('ok', 'nomatch', 'noface', 'manyfaces')),
  match_pct integer, distance numeric(6, 4), min_pct integer,        -- how far it matched, and the site's rule of that moment
  client_id text not null default '', selfie_path text not null default '',
  at timestamptz not null default now()
);
create index if not exists hr_face_tries_emp on public.hr_face_tries (employee_id, at desc);
create index if not exists hr_face_tries_client on public.hr_face_tries (client_id) where client_id <> '';

do $$ declare t text; begin
  foreach t in array array['hr_faces', 'hr_face_tries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update on public.hr_faces to service_role;      -- a face is reset (active = false), never deleted
grant select, insert on public.hr_face_tries to service_role;         -- only added – never changed, never deleted
revoke all on sequence public.hr_face_tries_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hr_face_tries_id_seq to service_role;

notify pgrst, 'reload schema';
select 'HR step 9 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('hr_faces', 'hr_face_tries')) || ' of 2' as done;
