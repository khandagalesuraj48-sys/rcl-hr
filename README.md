# RCL ERP – HR module

HRMS & Attendance module of the RCL ERP (One Click Solution). The plan and the owner's decisions: the Project doc
`architecture/RCL_ERP_HRMS_Plan.md` and `CLAUDE.md`.

## What is here today (12-11-2026 – Phase 1a: HR's own sign-in)
* `sql/hr_step1_base.sql` – **run once by the owner in the rcl-hr Supabase**: `hr_people`, `hr_sessions`, `hr_tickets`,
  `hr_audit`. Only adds; row level security on, nothing for anon / authenticated; no employee data.
* `api/sso.js` – the Portal's ticket is checked (`lib/portal.js`: ES256 signature with `<PORTAL_URL>/api/jwks`, `iss`, `aud` =
  "hr", the time), **used once** (`hr_tickets`), and HR's own sign-in starts (`lib/session.js`: a cookie page scripts cannot
  read; the database keeps only its fingerprint; 15 minutes, renewed by the open page every 10). `api/me.js`, `api/logout.js`.
* `public/index.html` – signs in through the Portal (inside Mechanical's screen: a ticket asked from the Portal; by itself: the
  Portal's `#sso=`), then says who is signed in. The pages of HR come phase by phase.
* `api/menu.js` – the module's pages for Mechanical's dark menu (one page: Home).
* Before the SQL step is run the page says so ("The HR database is not set up yet…") – nothing else happens.
* A Preview (a branch's test deployment) works only with a database marked as a test database (`lib/preview.js`) – never the live one.

## Phase 1 – the Employee Master (12-11-2026: "ata employee step continue kr")
* `sql/hr_step2_employees.sql` – **run once by the owner in the rcl-hr Supabase** (after step 1): `hr_departments`,
  `hr_designations`, `hr_employees`, `hr_employment` (the history), `hr_numbers` + `hr_next_no()` (the codes). Only adds.
* `api/hr.js` – one door for every action: the sign-in first, then the action's access, then the work; only the site of the
  sign-in; **nothing is deleted** (left / switched off); every change in `hr_audit` with the old and the new value.
  * `masterSave` (HR Admin) – departments, designations.
  * `empList`, `empGet`, `empPick`, `empSave` (HR User too) – code `E00001…` by itself; categories Staff / Operator / Driver /
    Labour; a mobile number and an e-mail belong to ONE employee (they are what he will sign in with); under 18 is refused.
  * Status: **incomplete** (DOB, e-mail or mobile missing) → **pending** (complete – waits for his own e-mail OTP) → **active**
    (only by the activation step – not built yet) → **left**.
  * `empTransfer`, `empExit` (HR Admin) – a transfer only to a site of the sign-in, never dated before the present posting.
  * `empImport` – at most 1000 rows; first a check that saves nothing; a faulty row comes back with its line and why.
* `lib/rules.js` – the checks, in one place. `public/hr.js` – the pages (Employees, one employee, forms, import, the two lists).
  An Excel file is read with the main address's own `/vendor/xlsx…` (inside the ERP); a CSV anywhere.
* **Not built yet (the next steps of Phase 1):** activation by e-mail OTP (Resend) and the sign-in with mobile number or e-mail
  (a change in the Portal – asked for separately), documents, the Payroll-only details (bank, PF…), the finer roles and powers,
  the phone app's screens.

## Settings (Vercel → Project → Settings → Environment Variables – never in a file)
| Name | What |
|---|---|
| `PORTAL_URL` | the Portal's address: `https://oneclicksolution.online/portal` (an address, not a secret) |
| `PUBLIC_URL` | this module under the one address: `https://oneclicksolution.online/hr` (an address, not a secret) |
| `SUPABASE_URL` | the HR Supabase project's address |
| `SUPABASE_SECRET_KEY` | its secret key – only in Vercel |

## Tests
`timeout 120 node --test test/unit.test.js` – no real database, no network (the Portal's key and a stand-in of the database are
made in the test).
`timeout 120 node --test test/api.test.js` – the actions on a REAL database: only the local test rig (PostgreSQL + PostgREST with
`sql/` applied to a scratch database, `HR_RIG_URL`, default `http://127.0.0.1:3140`), made-up people. Never a live database.
