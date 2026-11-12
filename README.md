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
  * `empList`, `empGet`, `empPick`, `empSave` (HR User too) – code `RCL001, RCL002 …` by itself, or typed, and it can be changed (asked 12-11-2026 – never another employee's; the change is written down); categories Staff / Operator / Driver /
    Labour; a mobile number and an e-mail belong to ONE employee (they are what he will sign in with); under 18 is refused.
  * Status: **incomplete** (DOB, e-mail or mobile missing) → **pending** (complete – waits for his own e-mail OTP) → **active**
    (only by the activation step – not built yet) → **left**.
  * `empTransfer`, `empExit` (HR Admin) – a transfer only to a site of the sign-in, never dated before the present posting.
  * `empImport` – at most 1000 rows; first a check that saves nothing; a faulty row comes back with its line and why.
* `lib/rules.js` – the checks, in one place. `public/hr.js` – the pages (Employees, one employee, forms, import, the two lists).
  An Excel file is read with the main address's own `/vendor/xlsx…` (inside the ERP); a CSV anywhere.
* **His own details and papers (12-11-2026: "KYC DOCUMENT ATTACH … ADHAR PAN SECONDRY MOBILE NUMBER FAMILY NUMBER ADDRESS")** –
  `sql/hr_step3_kyc_docs.sql` (run by the owner in rcl-hr, after step 2): `hr_employee_private`, `hr_employee_docs`, the PRIVATE
  bucket `hr-docs`. Actions `privGet` / `privSave`, `docList` / `docUploadUrl` / `docAdd` / `docLink` / `docRemove`; `lib/store.js`.
  * Aadhaar is checked by its check digit; an HR User sees it only as `XXXX XXXX 1234`, the HR Admin / Super Admin whole; one
    Aadhaar / PAN = one employee; the record of changes holds only the last four.
  * Papers: photo, Aadhaar, PAN, education, driving licence (number, valid up to), bank passbook, salary slip of the last company,
    experience letter, other. JPG / PNG / WebP / PDF, 10 MB. Opened by a link of 5 minutes; **the pay papers (bank passbook,
    salary slip) only by the HR Admin / Super Admin**; every opening is written down. Removed = kept, with who and why.
  * The employee's page says which papers are still expected (a driver: his licence) – a reminder, never a block.
* **Attendance, the core (12-11-2026: "GEOFENCE BAHER KAHICH NHI HONAR", "DEVICE BINDING", "SELFI … FKT PROOF")** –
  `sql/hr_step4_attendance.sql` (run by the owner in rcl-hr, after step 3): `hr_projects`, `hr_places`, `hr_place_people`,
  `hr_devices`, `hr_device_tries`, `hr_punches`, `hr_punch_reviews`, the PRIVATE bucket `hr-selfies`; the role `self`.
  `lib/geo.js` (inside / how far), `lib/attend.js` (the rules), `lib/act_attend.js` (the actions), `public/att.js` (the pages).
  * **Work places** (`placeList`, `placeSave`, `placeBulk`, `placeImport`, `placeRemove`, `projSave` – changes: HR Admin / Super
    Admin): a point + metres (20–5000), an area drawn on the map, or along the road with metres each side; for everybody, some
    categories, some departments or chosen people; from a date; On / Off; many at once. Removed = kept with who and why.
    The map: Leaflet (BSD, `public/vendor/leaflet`) with OpenStreetMap's pictures.
  * **A punch** (`myAttend`, `selfieUrl`, `punch`, `myMonth` – every person for himself; the employee is the one whose e-mail the
    sign-in has): today only by the server's clock; refused – and nothing saved – outside his work places, with a reading worse
    than 100 m, with Developer Options ON or a made-up location, from another phone, without its photo, IN after IN / OUT
    without IN. The first punch ties the phone (`hr_devices`); one phone a person and one person a phone – the database itself
    holds it. The photo goes straight to the private bucket (JPEG, 1 MB) and is never replaced.
  * **No network:** the phone sends the punch later with its own number (`client_id` – sent twice, kept once), the server's time
    of its last contact and its own counter since switch-on; in order → it counts for its own moment; restarted, clock moved,
    older than 72 hours or out of order → `review`: the HR Admin accepts or refuses (`punchReview`, a new row – the punch stays).
  * **Phones** (`devList`, `devRelease` – HR Admin / Super Admin, with a reason); tries from another phone are listed.
  * **"My HR"** – the Portal's second module key `hrme` gives the role `self`: only the four actions above, no page of the office.
  * `hr_punches`, `hr_punch_reviews`, `hr_device_tries`: the server's key may only read and add – never change or delete.
  * Not built yet: the removal of photos after 90 days, the check of the phone by Play Integrity; until the e-mail OTP is there
    an employee whose details are complete ("pending") may punch (`MAY_PUNCH` in `lib/act_attend.js`).
* **The site is chosen in HR too; an employee's site; his page (12-11-2026: "HR MADHE PN SITE SELECT KARAYCHA OPTION DE …
  EMPLOYEE LA SITE ASIGN KRTA YEIL … EMPLOYEE MASTER JAR OPEN KEL SAGLE KAHI ASEL")** – no SQL.
  * The sites are the Portal's (HR makes none): the bar has a chooser of the sites where this person has HR – another site is a
    new ticket of the Portal for it, then the page opens again (`sitePick` in `public/index.html`).
  * The employee's form has **Site**: a new employee is put on the chosen site; another site for an employee of today is a
    transfer from today (HR Admin; the history keeps the old site) – `empSave`. "Transfer…" (from a date, with a note) stays.
  * The employee's page shows his attendance too (`empAround`): his work places of today, shift, phone, today, this month's
    count, requests waiting.
* **The employee's full profile (step 6, 12-11-2026)** – `sql/hr_step6_profile.sql` (run by the owner in rcl-hr, after step 5; four
  new tables, nothing existing changed). Asked with pictures of a reference product, and "nothing fixed – the Super Admin and
  the Admin change it". `lib/act_profile.js` describes every detail ONCE (`GROUPS`: Profile, Job, Statutory & bank; `ROWS`:
  Family, Education, Experience, Skills) – the server checks with it and `public/prof.js` draws the forms from it. Every
  pick-list is `hr_lists` (the **Lists** tab: add, rename, switch off; a value in use is never deleted); which details are
  compulsory for "profile complete" is the site's setting (`hr_settings`). PF / UAN / ESIC / bank numbers: masked for an HR
  User, never in a list, an export or the audit. A row is "removed" with who and why. Opened from an employee's page: **Full profile**.
  Still to come (his yes first): policies per employee, leave, salary structure and payroll, letters and ID card; the app's own screens.
* **One look on every page; the Employees tab, the employee's page and form; export; delete (12-11-2026)** – no SQL step.
  Every page has the same head (`HRHEAD.set` in `public/hr.js`: its name, one line, on the right its own controls and the site);
  the menu for Mechanical lists **Dashboard** first. Employees: the list shows **Active from** (joining) and **Relieving date**;
  "Has left" is now **Relieve…** (the same action `empExit`, the same record – only the words); **Export Excel** (`empExport`:
  the people the list shows, all of them; .xlsx with Mechanical's `/vendor/xlsx…`, else a .csv; the column names are the ones
  the import reads). **Delete…** (`empDelete`, HR Admin / Super Admin, with the reason): ONLY an employee added by mistake –
  refused while he has attendance, a phone, papers, KYC or people reporting to him (then: relieve him). What he was is in the audit.
* **The attendance dashboard and the muster's look (12-11-2026, the pictures he approved – "hech design final aahe web sathi")** –
  no SQL step, nothing is written. `lib/act_dash.js` → `attDash` (HR office only): today counted with the muster's own measure
  (`daysOf`) – at work now, present, late, not marked, **absent of yesterday** (nobody is absent while the day runs), the arrivals
  by half hour, who is at which work place (the place of his IN), the last 7 days, and what waits (requests, doubtful punches,
  tries with another phone in 7 days, people not marked with no phone tied). `public/dash.js` is the page (the first tab; asks
  again every minute while it is on the screen). The muster (`public/mus.js`) has colour cells (L = present but late) and a
  day opens in a **panel on the right** – the same actions as before (`dayGet`, `daySet`, `regDecide`); `dayGet` now also gives
  each punch's work place. "Tried from outside" of the picture is not there: nothing is saved outside a work place.
* **The muster, shifts, rules, requests (12-11-2026)** – `sql/hr_step5_muster.sql` (run by the owner in rcl-hr, after step 4):
  `hr_shifts`, `hr_shift_people`, `hr_holidays`, `hr_att_rules`, `hr_regularize`, `hr_day_entries`, `hr_admin_powers`.
  `lib/day.js` (one day → its code), `lib/powers.js`, `lib/act_muster.js` (the actions), `public/mus.js` (the pages).
  * **A day's code** – P, HD, A, WO, H, WOP / HP (worked on a weekly off / a holiday), IN (at work now), MIS (IN without OUT on
    a day gone). **The rules are settings with a date** (`rulesSave` → a new version; a day is measured with the version and the
    shift of THAT day): hours for a full / a half day, grace minutes, early-leaving minutes, late days for one half day, the
    weekly off, who decides a request (1 or 2 levels). **A rule left empty is not applied** – no number is in the code. Days
    before the site's first recorded attendance stay empty.
  * **Shifts** (from – to, also over midnight; break; for everybody / categories / departments / chosen people – the most exact
    wins), **holidays** (one, or a list – all or none).
  * **Muster** (`muster`, `dayGet`): the month of everybody, a CSV. What counts for a day: the newest `hr_day_entries` row, else
    the first IN and last OUT of the punches in order (a doubtful punch only when accepted; an OUT after midnight closes the IN
    of the evening before).
  * **A day set by the office** (`daySet`): a manual entry (a day without a punch) or a correction (a day with punches or an
    entry; also "no attendance on this day") – always a NEW row with the old times, the new times, the reason, who and when.
    The punches are never touched. The HR Admin: 60 days back; the Super Admin: any day.
  * **Requests** (`regAsk`, `myRegs` – a person for a day gone; `regList`, `regDecide` – the HR office; `teamRegs`,
    `teamRegDecide` – the reporting person when the rules say 2 levels): approved = the day's new entry.
  * **The HR Admin's powers** (`powerSet`, Super Admin only; no row = allowed): work places, phones, doubtful punches, shifts /
    holidays / rules, manual entry, correction, requests – each can be switched off per site.
  * Not built yet: the app's screens for a request and the reporting person; payroll's lock of a month; leave.
  * Today HR fills these. The employee filling them himself comes with his own sign-in (the activation step).
* **Not built yet (the next steps of Phase 1):** activation by e-mail OTP (Resend) and the sign-in with mobile number or e-mail
  (a change in the Portal – asked for separately), the Payroll-only details (bank account, PF…), the finer roles and powers,
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
