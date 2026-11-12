-- RCL ERP – HR module, STEP 12: PAYROLL – the month's pay, made by the HO HR from the approved month and the approved salary.
-- Asked 12-11-2026: "HO HR SWATA ATTENDENCE CHECK KRU SHKEL ANI SALARY CALCULATE KRU SHAKEL JYAT PT PF DEDUCTION SALARY ADVANCE HE SAGLE
-- HO WARUN KARTA YEIL". Decided: a day's pay = the month's salary ÷ the days of that month; an extra day = one day's pay.
--
-- Run ONCE in the rcl-hr Supabase → SQL Editor (only there – never in another module's database). After step 11.
--
-- What it does: SIX new tables and ONE function. Nothing that is there today is changed or deleted.
--   hr_pay_settings  PF, ESIC and Profession Tax as the company's accountant gives them, each version with its date (only added)
--   hr_pay_emp       for whom PF / ESIC / Profession Tax is deducted (a tick each, per employee)
--   hr_advances      a salary advance: the amount, what is taken back a month, what was taken back so far
--   hr_pay_adjust    a month's own additions for a person before the pay is locked (another earning, another deduction, the advance of this month)
--   hr_pay_runs      a site's month whose pay is LOCKED (who, when, the totals)
--   hr_payslips      one row a person of a locked month: everything his pay was made of. Never changed afterwards.
--   hr_pay_lock()    locks a month in one piece: the run, every payslip and what was taken back of the advances – all or nothing
-- It can be run again (it changes nothing the second time).
--
-- Going back: drop function public.hr_pay_lock(text, text, text, jsonb, jsonb);
--             drop table public.hr_payslips, public.hr_pay_runs, public.hr_pay_adjust, public.hr_advances, public.hr_pay_emp, public.hr_pay_settings;

create table if not exists public.hr_pay_settings (
  id bigserial primary key, valid_from date not null, settings jsonb not null,
  created_by text not null, created_at timestamptz not null default now()
);
create table if not exists public.hr_pay_emp (
  employee_id uuid primary key references public.hr_employees (id),
  pf boolean not null default false, esic boolean not null default false, pt boolean not null default false,
  updated_by text not null, updated_at timestamptz not null default now()
);
create table if not exists public.hr_advances (
  id bigserial primary key, employee_id uuid not null references public.hr_employees (id), site text not null,
  amount numeric(12, 2) not null check (amount > 0), monthly numeric(12, 2) not null check (monthly > 0),
  recovered numeric(12, 2) not null default 0 check (recovered >= 0), given_on date not null, note text not null default '',
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by text not null, created_at timestamptz not null default now(), closed_by text, closed_at timestamptz, close_reason text
);
create unique index if not exists hr_advances_one_active on public.hr_advances (employee_id) where status = 'active';
create table if not exists public.hr_pay_adjust (
  site text not null, month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'), employee_id uuid not null references public.hr_employees (id),
  other_earn numeric(12, 2) not null default 0 check (other_earn >= 0), earn_note text not null default '',
  other_ded numeric(12, 2) not null default 0 check (other_ded >= 0), ded_note text not null default '',
  advance numeric(12, 2) check (advance is null or advance >= 0),
  updated_by text not null, updated_at timestamptz not null default now(), primary key (site, month, employee_id)
);
create table if not exists public.hr_pay_runs (
  id bigserial primary key, site text not null, month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  people integer not null, totals jsonb not null, settings_id bigint, locked_by text not null, locked_at timestamptz not null default now(),
  unique (site, month)
);
create table if not exists public.hr_payslips (
  id bigserial primary key, run_id bigint not null references public.hr_pay_runs (id), site text not null, month text not null,
  employee_id uuid not null references public.hr_employees (id), net numeric(12, 2) not null, data jsonb not null,
  unique (run_id, employee_id)
);
create index if not exists hr_payslips_emp on public.hr_payslips (employee_id, month desc);

-- one piece: the run, the payslips, the advances – a month already locked is refused (unique site + month)
create or replace function public.hr_pay_lock(p_site text, p_month text, p_by text, p_run jsonb, p_slips jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_run bigint; s jsonb; v_adv numeric;
begin
  insert into public.hr_pay_runs (site, month, people, totals, settings_id, locked_by)
    values (p_site, p_month, jsonb_array_length(p_slips), p_run -> 'totals', nullif(p_run ->> 'settings_id', '')::bigint, p_by) returning id into v_run;
  for s in select * from jsonb_array_elements(p_slips) loop
    insert into public.hr_payslips (run_id, site, month, employee_id, net, data)
      values (v_run, p_site, p_month, (s ->> 'employee_id')::uuid, (s ->> 'net')::numeric, s -> 'data');
    v_adv := coalesce((s ->> 'advance')::numeric, 0);
    if v_adv > 0 then
      update public.hr_advances set recovered = recovered + v_adv,
        status = case when recovered + v_adv >= amount then 'closed' else status end,
        closed_by = case when recovered + v_adv >= amount then p_by else closed_by end,
        closed_at = case when recovered + v_adv >= amount then now() else closed_at end,
        close_reason = case when recovered + v_adv >= amount then 'Taken back in full' else close_reason end
      where id = (s ->> 'advance_id')::bigint and employee_id = (s ->> 'employee_id')::uuid and status = 'active' and recovered + v_adv <= amount;
      if not found then raise exception 'ADVANCE_CHANGED: the advance of an employee changed – open the pay sheet again'; end if;
    end if;
  end loop;
  return v_run;
end $$;

do $$ declare t text; begin
  foreach t in array array['hr_pay_settings', 'hr_pay_emp', 'hr_advances', 'hr_pay_adjust', 'hr_pay_runs', 'hr_payslips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant select, insert on public.hr_pay_settings, public.hr_pay_runs, public.hr_payslips to service_role;      -- only added – never changed, never deleted
grant select, insert, update on public.hr_pay_emp, public.hr_advances, public.hr_pay_adjust to service_role;
revoke all on sequence public.hr_pay_settings_id_seq, public.hr_advances_id_seq, public.hr_pay_runs_id_seq, public.hr_payslips_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hr_pay_settings_id_seq, public.hr_advances_id_seq, public.hr_pay_runs_id_seq, public.hr_payslips_id_seq to service_role;
revoke all on function public.hr_pay_lock(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.hr_pay_lock(text, text, text, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
select 'HR step 12 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('hr_pay_settings', 'hr_pay_emp', 'hr_advances', 'hr_pay_adjust', 'hr_pay_runs', 'hr_payslips')) || ' of 6' as done;
