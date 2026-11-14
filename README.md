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
  * Status: **incomplete** (DOB, e-mail or mobile missing) → **pending** (complete – shown as "Complete" since 13-11-2026) → **active**
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
  * **Who marks where** (13-11-2026 – "konta user konte location war sign in kartoy … konte location sathi konte user aahet … ek
    employee aso ki bulk employee"): the Work places page has three views – the places themselves · **by place** (who is there,
    a place with nobody in red) · **by person** (where each one may mark, where he marked last, "No place – cannot mark" in red).
    `placeMap` reads it with the same rule a punch is checked with; `placePeople` adds / takes single people – one or many
    (tick them, or paste their codes from Excel). A place for everybody / categories / departments is changed only after the
    Admin said yes: it becomes "Chosen people" with the people it is for now. No database change.
    (13-11-2026, "name nko dakhu count war click kel ki list disel … employee ch location change krta yeil mala ani multiple
    location access deu shakel") by place: only the number – a press on it opens the list, with "Change his places" and "Take
    out of here"; by person: "Change" opens his work places as ticks – one or several – `placePerson` sets exactly those.
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
  * **The app's "Me" (12-11-2026, `lib/act_self.js`)** – a person's own record: `myHr` (who he is, how complete his profile is, his
    details to read – PF / UAN / ESIC / bank account masked, the papers still expected, his phone), `myDocs`, `myDocUploadUrl` /
    `myDocAdd` (he attaches a paper himself – the office's same checks), `myDocLink` (he opens his own). Always the employee the
    sign-in is; he changes no detail and removes no paper. No SQL step.
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
* **More of the office (12-11-2026 – "tu je sangtile 1 to 16 ek sath banwala ghe", the first group; no database step)** –
  **Payslip to print:** Payroll → a LOCKED month → "Payslip" of a line opens a page to print / save as PDF (`paySlipOf`; the head
  is the site's name – HR does not know the company's). **Bank list (Excel):** name, name as on bank, bank, IFSC, account number,
  net pay (`payBank` – the HO HR only; the account numbers whole only here; "Bank list taken" in the audit, never a number; a
  person without a bank account in his profile is said). **Coming up** on the dashboard (`hrComing`, `lib/coming.js`): the papers
  of this site's people whose date runs out within 30 days or has run out, the birthdays and the years at work of the coming 7
  days. A person's own (`myHr.coming`): his papers running out, his birthday today, his years at work today – for the app.
  `myAttend` also says `week_off` / `days_off` for the phone's IN / OUT reminders.
* **"All sites" (14-11-2026)** – his words: "hr portal madhe site wise bghta yet but ek as ek option banaw ki all site saglech ekdam
  sagle disel … hr admin tithunch badal pn kru shaktil". The site switch offers **All sites** to a person the Portal gave two or
  more sites with a role (the ticket's `sites[].role` – rcl-portal `api/go.js`). The open page – Dashboard, Employees, Attendance,
  Muster, Leave, Requests, Approvals – is then shown for every one of his sites, one under the other (`public/allsites.js`): each
  part IS that site's own page, opened inside HR's page for that site (`/?as=<SITE>`), so everything works in it as on the site.
  Every request of such a part names its site (`as_site`); `lib/session.js as()` lets it through only for a site of HIS ticket,
  with the role he has THERE – then the action runs as always: on that one site. No action was changed; no SQL. The other pages
  belong to one site.
* **A work place of another site for one person (14-11-2026)** – his words: "vtr cha manus head office la gela tr vtr madhunch tyala
  ho geo fence access deta yawa". The HR office of HIS OWN site (who may manage work places) opens Work places → By person → Change,
  chooses the other site, ticks its work places and writes why (`placeGuest`). He is written to that place (`hr_place_people` – **no
  new table, no SQL**); a place that is not of his site counts for him whatever its "for whom" says, while it is on. Nothing of the
  other site is changed: its office sees only its own people and keeps the guest when it saves its own. His attendance stays his own
  site's. The other sites' work places are shown by NAME only.
* **The Rule Book (step 13, 13-11-2026)** – his words: "super admin kade ek main rule book haway … ek hun anek policy banwayta
  yeil … employee la site la ho la asign krta yetil … authorization … kon verify krel kon approval krel". **UNTIL A POLICY IS GIVEN
  TO A SITE OR A PERSON NOTHING CHANGES** – the muster and the pay sheet of the test rig are the same as before (checked against
  `main` after every part). Six kinds of policy – Attendance, Late & early, Weekly off, Leave, Comp-off, Overtime – each with
  versions from a date and its own "who verifies / who approves" (by role or by name with a stand-in). Only the Super Admin makes
  or changes one; the HR Admin of a site, the HO HR and the Super Admin give it: the site's own (everybody) or chosen people, from
  a date. `lib/rulebook.js` (plain rules), `lib/act_rulebook.js`, page `public/book.js` ("Rule Book", "Approvals").
  * **Leave:** two balances, Paid leave and Comp-off, shown and used as ONE (a leave takes the Comp-off days first – the person
    never chooses); a ledger of every day added and taken; a Sunday worked earns a leave on a site (at most so many a month); a
    request may be longer than the balance (the rest stays absent, marked: refused ✗ / no balance / nothing asked); papers on a
    request (`lib/act_leave_files.js` – never compulsory, never deleted); the opening balance of many people from one sheet
    (looked at first, ONE request, credited when approved, never twice); extra leave through approval.
  * **Approvals** (`lib/act_asks.js`): overtime and comp-off of a month are found from the muster and count only after "verify"
    and "approve"; a bulk correction of a month's attendance from Excel (`lib/act_import.js` – only in the person's favour, one
    reason for the file, the punches stay; a month the HO HR approved is closed).
  * **Pay** (`lib/pay.js`, `lib/act_payroll.js`): approved overtime "for pay" = the hours × a day's pay ÷ the shift's hours × the
    policy's rate; a person WITH a comp-off policy is paid an extra day only for a day approved "for pay"; unused leave is paid
    in the month of his last day when his leave policy says so. A person with no such policy is paid exactly as before. A late
    correction of a locked month is NOT counted by itself: the HO HR adds it as "Other earning" with its note in the next month.
  * **Punch** (`lib/act_attend.js` → `stand`): one IN and OUT a day and the weekly off are the person's own policy's.
  * `sql/hr_step13_rulebook.sql` – ten new tables and one new column with a default, run by the owner ONLY in rcl-hr; before it
    the pages say so and everything else works as before. Tests on the local rig only: `test/rig/rulebook_*.js`.
* **Payroll (step 12, 12-11-2026)** – his words: "HO HR … SALARY CALCULATE KRU SHAKEL JYAT PT PF DEDUCTION SALARY ADVANCE HE SAGLE HO
  WARUN KARTA YEIL"; decided: a day's pay = the month's salary ÷ the days of that month, an extra day = one day's pay. Page
  **Payroll** (web; the HO HR and the Super Admin only – `init.ho`, menu `who: 'ho'`). **Pay sheet:** a site's month, only after
  its attendance is approved (step 10) – counted fresh from the verified counts and each person's approved salary of the month's
  last day (`lib/pay.js`: a month's salary → the days counted for pay; a day's rate → present + half days as ½ + leave; extra days
  one day's pay each). "Set…" per person: ticks PF / ESIC / Profession Tax (kept for the months to come, `hr_pay_emp`), another
  earning / deduction with its note and the advance of this month (`hr_pay_adjust`). **PF · ESIC · PT** are the company's own
  settings with their date (`hr_pay_settings`, the accountant's numbers – none is in the code; empty = not applied; PF to the
  nearest rupee, ESIC rounded up, PT by the highest slab reached; no special month, no difference by gender – use "another
  deduction"). **Advances:** one running advance a person, taken back a month, never more than what is left or than the pay.
  **Lock:** the run, every payslip and the advances in ONE piece (`hr_pay_lock`); a locked month is never counted again nor
  changed (the database gives no update on a payslip) – a mistake is set right in the next month. A person without an approved
  salary is said and left out. **His own payslips:** `mySlips` (the app's "Salary slips"). `sql/hr_step12_payroll.sql` – six new
  tables and one function, run by the owner. Run beside the present method for two months before it is trusted.
* **An employee's salary – onboarding (step 11, 12-11-2026)** – his words: "SITE HR EMPLOYEE ON BORD KRU SHAKEL … TYACHI SALARY PN
  MENTION KARU SHAKEL JI BASIC SALARY ASEL ANI … APPROVAL SATHI JAIL"; decided: straight to the HO HR; a month's salary or a day's
  rate, chosen per person. The employee's page → **Salary…** (HR Admin with the power `salary`, Super Admin): type, amount, from
  which date → it waits for the HO HR (**Month verification → Salary approvals**: a new employee is said; approve / send back
  with the reason – never the person who proposed it). The newest approved salary that began by a day counts on that day; a
  later salary is a new proposal, the old ones stay (`hr_salaries`, `lib/act_pay.js`). A salary is seen by the HR Admin of the
  site, the HO HR and the Super Admin – never an HR User, never the app; the amount is not written into the audit.
  `sql/hr_step11_salary.sql` – one new table, run by the owner. Payroll (the month's pay from the approved month and this salary)
  is the next piece – not built.
* **The month: verified by the site's HR, approved by the HO HR (step 10, 12-11-2026)** – his words: "MONTH END LA JYA TYA SITE CHA HR
  ATTENDANCE VERIFY KAREL USER WISE BULK VERIFY … SITE HR NI VERIFY KEL KI DIRECT HO HR KADE DATA JAIL". Page **Month verification**
  (web only): everybody of a month with his counts – present, half, absent, leave, **extra days** (worked on a weekly off / a
  holiday), late days, days for pay (`lib/month.js`). After the month's last day the **HR Admin** (power `month`, given or taken by
  the Super Admin) ticks people and verifies them – not a person with an "IN without OUT" day or a request still waiting; the counts
  of that moment are kept (`hr_month_people`). A day changed afterwards shows "Changed since verified" – verify again. The **HO HR**
  (`hr_ho_hr`, given by the Super Admin; the Super Admin himself too) sees every site of his sign-in, sends people back with the
  reason, or **approves** the site's month when everybody is verified (`hr_months`): from then on no day of that month is changed
  (`needOpen` – a day set by hand, a request, a doubtful punch, a leave decided). Only the Super Admin opens it again, with the
  reason. Everything is in the audit. `sql/hr_step10_month.sql` – three new tables, run by the owner; before it the page says so and
  everything else works as before.
* **Once a day, a forgotten OUT, the late policy (step 8, 12-11-2026)** – his words: one sign-in and one sign-out a day; who forgets
  OUT is signed out by the system and is absent; three late marks a month, the fourth is a half day; a "no late" policy; the times
  by the shift. All of it is the site's **dated rules** and its **shifts** – nothing in the code (`lib/day.js`):
  rules `once` (the server refuses a second IN: `stand`), `late_free` (so many late days a month are only marked, every later one is a
  half day – counted from the 1st, `lateHalves`), `half_after_min` (later than the shift's start + this = a half day at once); no late
  policy = `grace_min` empty. A shift's **`auto_out`** (`sql/hr_step8_auto_out.sql` – ONE new column, run by the owner): at that time a
  day with IN and no OUT is closed by itself and reads **absent** (a night shift: the next morning) – only READ so, no punch is
  written or changed; he can ask to set it right. The phone is told `next` (`in` / `out` / `done`), `once`, `closed`, his `shift`;
  a night shift's OUT the morning after is taken. Before step 8 is run everything works as before (a closing time typed is refused
  with what to do). Who decides a request (1 or 2 levels) and the leave policy's levels were there already.
* **Leave (step 7, 12-11-2026)** – `sql/hr_step7_leave.sql` (run by the owner in rcl-hr, after step 6; three new tables). His words:
  4 leaves a month at a site, Sunday is a working day there, an absent day or a leave takes one from the balance; the Head Office
  differs (its Sunday off, its holidays). So the **policy is per site, with its date** (`hr_leave_policy`: leaves a month, carry on
  or lapse, an absent day takes one or not, one or two levels of approval) – nothing in the code. **The balance is never stored**:
  `lib/leave.js` walks it day by day from the policy's first day (+ the month's leaves, + what the HR office added in
  `hr_leave_adjust`, − approved leave days, − absent days); a weekly off / holiday never takes a leave. `lib/act_leave.js`: a
  person's `myLeave`, `leaveAsk` (refused beyond the balance), `leaveCancel`, his team's `teamLeaves` / `teamLeaveDecide`; the
  office's `leaveList`, `leaveDecide`, `leaveBalances`, `leaveAdjust`, `leavePolicy(Save)`. In the muster, a person's month and the
  dashboard a day covered by leave reads **L** (the web shows it as LV – L there is "late"). The **Leave** tab: `public/leave.js`.
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
* **An employee's sign-in for the app (12-11-2026)** – the employee's page: "Sign-in for the app…" (HR Admin / Super Admin). The
  page asks the Portal (`<portal>/api/hrlogin`, with the person's own Portal sign-in – `HRPORTAL` in `public/index.html`); the
  Portal makes the user, gives "My HR" (`hrme`) on the employee's site and answers a one-time password, shown once. HR's server
  has no part in it and keeps nothing. Needs the module `hrme` in the Portal.
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

## The employee sheet – one Excel format in and out (13-11-2026)
Asked with the company's own sheet ("Employee Detail All"): "je excel madhe column aahet te same column sagle … apli excel pn same
asel import export sathi … excel madhle code as it is … categery colum remove kruya ani designation he theu … email mobile nasel tr
import nahi honar … adhar pan … bank details … ifsc … sagle kahi import export excel madhe asel … yes no … tas".
**No SQL step** – the new details are kept in the profile's own columns (`hr_employee_profile.data` / `.secret`, step 6) and a
designation's category beside the settings (`hr_settings`, site `*`).
* `lib/act_sheet.js` – `sheetCols`, `sheetImport`, `sheetExport` (the page's Import / Export buttons use them; `empImport` /
  `empExport` stay as they were).
  * **Columns:** the company's 29, heading for heading in its order (Name of Company … Totals), then Mobile, E-mail, Date of
    Birth, Gender, Designation, Department, Aadhaar, the family number, the addresses, the profile, PF / ESIC / bank. No
    "Category": a **designation carries its category** (Designations page; none set / no designation = Staff). A file of before
    with a Category column is still read.
  * **Import = add or change.** A row whose Employee Code is an employee of this site changes him – only the filled cells. A
    new code (kept as it is) or none (made by itself) adds him; **a new employee needs a mobile or an e-mail**. A faulty row
    comes back with its line and why; the good rows are saved; a check first that saves nothing. The company's sheet is read
    as it is: company / branch standing once for a group are carried down, a total's row is left out; with several projects in
    the file the page asks which of them belong to this site – the others are not imported here.
  * **Pay:** CTC, Basic and the other pay details (`GROUPS.pay` in `lib/act_profile.js` – seen and changed only by the HR Admin /
    Super Admin) and Deduct PF / ESIC / PT (`hr_pay_emp`) are read only from the HR Admin / Super Admin. The monthly CTC
    becomes the **approved salary** (`hr_salaries`) only when the HO HR / Super Admin imports, and only when it is not his
    salary already.
  * **Export** = the same columns (the format = the same file without rows). Pay and the secret numbers (Aadhaar, UAN, PF,
    ESIC, bank account) are written only for the HR Admin / Super Admin. Import and export are in the audit – never a number.
* **Removing the demo employees (asked 13-11-2026: "demo saglech delet kraych ahe")** – two one-time files, run by the owner in
  the rcl-hr Supabase, never by the app: `sql/hr_once_remove_demo_1_count.sql` (only counts) and
  `sql/hr_once_remove_demo_2_delete.sql` (**deletes for ever**, in one transaction: every employee of every site and what hangs
  on him – attendance, phones, faces, leave, months, salaries, payslips; the masters, work places, shifts, rules, settings and
  the audit stay; the Portal and the files in Storage are not touched). A backup first.
* **Sign-in by e-mail OR mobile number; everybody at once (13-11-2026 – with the Portal's step 12).** An employee is complete with
  his date of birth and an e-mail **or** a mobile number (`lib/rules.js`). His page's "Sign-in" sends both to the Portal
  (`api/hrlogin`); the user ID of an employee without an e-mail (`<number>@mobile.id`) is kept in `hr_employees.portal_email`
  (`signinLinked`) – "My HR" finds him by it, also after his number changed. **"Give sign-in to all"** (`signinPeople`, the
  Portal 20 a call): the Super Admin, or an HR Admin he gave the power `signin` (Shifts & rules → Powers; off until given).
  HR's server keeps and sees nothing of the passwords. No SQL step in HR.
* Still to come: the phone app's sign-in box and its screens for the new details.

## The new look of the web pages and Ctrl K (13-11-2026 – the pictures he approved: "all approved aahe … ctrl k thew … pr de")
* **The frame:** the pages are a menu down the left side (People · Attendance · Leave & pay), the search and the site on top. In
  Mechanical's screen (`?embed=1`) and on a narrow screen the menu is the row of buttons as before. The same pages for the same
  people – a page a person may not open is not in his menu.
* **Ctrl K** (`public/find.js`, also the search box on top): one box finds a page, an employee of the site (name, code, mobile,
  e-mail – the server's own `empList`), a department, a designation or an action (Add employee, Import, Export, Give sign-in to
  all – only when that button is on his screen). Arrows, Enter, Esc.
* **The dashboard** as in the picture: six counts, the day's sky, today's ring, "Needs you"; then who is in, the places, what
  comes up, the week and the quick actions. It asks nothing new (`attDash`, `hrComing`); Requests / Phones / Attendance show the
  number waiting beside their name in the menu.
* **The other pages:** the new cards, tables and buttons (the look only – every button and rule as before).
* **The rest of the pictures (13-11-2026, "ek sath saglech kr"):**
  * the counts on top of **Attendance** (punches, people, first IN, sent later, to be looked at), **Phones** (in use, released,
    tries, people who tried – and the tries beside the list), **Leave** (the list shown) and **Payroll** (the totals + the
    month Open / Locked) – each counted from what the page already has;
  * the dashboard's **Absent today** and **On leave**: `attDash` now also says `count.leave`, `count.absent` and each person's
    `mark` – both are inside "not marked" as before (on + out + off + none = everybody); it still only reads;
  * **Work places:** one map of every work place of the list beside it – a place on the map opens the same form as its row;
  * **Employees: the column "Sign-in"** (Given / Not given / Switched off) – asked from the PORTAL (`api/hrlogin` with `check`,
    read only; the HR Admin of the site and the Super Admin). With an older Portal or for an HR User the column stays away;
  * **Shifts & rules:** the HR Admin's powers as switches (the same checkbox, the same action).
* **An employee is ONE full page (13-11-2026, "ekach screen madhe sagle … half screen nkot full screen"):** a press on a person
  opens his page beside the menu – his head (photo, code, status, how far the profile is filled, the buttons Change · Transfer ·
  Sign-in · Salary · Face · Relieve · Delete), then **Overview** (work, contact, history, attendance, documents & KYC, "Still
  to do") and the tabs of his **full profile** (Profile, Job, Statutory & bank, Pay details, Family, Education, Experience,
  Skills – a tab shows how many compulsory details it still misses). "+ Add employee" and "Change" are a full page too. A
  window closed without saving goes back to his page; another page of the menu leaves it. The same actions of the server.
  Still small windows over his page: the sign-in, Personal details & KYC, Documents, Salary, Face, Transfer, Relieve, Delete.
  Not built from the picture: the month's strip of days, the "Pay" card, "Sign-in given / Phone tied" in the history.
* **A save is seen at once (13-11-2026, "save mhanle ki ek pop up yewa confirmation cha ani lagech save pn hoyla pahije"):** the
  button says "Saving…" the moment it is pressed; when the server has saved, a window in the middle says "Saved" (it goes by
  itself, or OK / Enter / Esc); an error stays on the page and nothing is said saved. A profile tab is answered from what was
  just read and saved (`profSave` does not read the whole profile a second time).
* **Departments & designations on ONE page (13-11-2026, "department and designation ektr thew … edit and delet pn karta yawet …
  construction line madhe je astat te auto tu fill kr"):** the two lists side by side with a search; a name is a line – Edit,
  Switch off / on, **Delete** (`masterDelete`: only a name that no employee has today or in his history – one in use is refused
  and is switched off instead; written in the audit). **"Add the usual construction list"** (`masterSeed`, `lib/act_masters.js`):
  the usual departments and designations of a road / construction company, each designation with its category – only the names
  that are not there yet; nothing of before is changed. (His Excel has no department / designation column – nothing was taken from it.)
* **An employee's page in ONE reading (13-11-2026, "data lagech yet nahi to pn fast yeyla hawa"):** `empPage` gives the person, his
  attendance, his papers and his profile together (the four readings of before, each with its own check); opened again within
  5 minutes the page shows at once what it read, and the fresh answer follows. The buttons of his head stay readable meanwhile.
* **"Not available" (13-11-2026, "jith details available nahit … not available ha option de"):** a tick under a box of the profile
  that is a name, a number or a date (PF number, CUG number, IFSC …) – kept as `NA`, it counts as filled. Never for an amount,
  Yes / No, a time or a list. The Excel sheet takes and gives "NA" too.
* **Sign in / Sign out (time) are not on the page any more (13-11-2026, "apan shift wise deto … ethe he nko"):** the shift says
  the times. The two columns stay in the Excel sheet as before (`sheet: true`); the page, the count of details and the app do
  not show them, and a save of the Job tab leaves them as they are.
* **"‹ Portal" and "Log out" on top (13-11-2026, "prt portal la jayla option disat nahiye n log out kahich nahi"):** when HR is
  opened by itself. "‹ Portal" goes back (the sign-in stays); "Log out" ends HR's sign-in and the Portal's, then shows the
  Portal's sign-in page. Inside Mechanical's screen they are not shown (its own are there).
* **One look wherever HR is opened from (13-11-2026, "hr portal kuthun pn open houde asach disla pahije ani ethun portal madhe
  back ani site madhe back jata ale pahije"):** when the ERP shows HR in its screen, HR takes the whole window (the site, the
  page and the person go along in the address) – its own menu on the left, **"‹ ERP"**, "‹ Portal" and "Log out" on top. The
  ERP also loads HR ahead, out of sight: while its frame is hidden nothing is taken. The browser's Back returns to the ERP.
  Nothing of the ERP (Mechanical) is changed for it.
* **The RCL look (13-11-2026, his picture: "dashbord ui asa asawa … aplela logo pn lawaycha aahe … tree line war click kel ki menu
  open … je haw tya war click kel ki te open ani menu band ekdam smooth … rcl logo cha jo colur aahe tyach fade madhe … red balance
  thew … baki che pages pn yach colour shade madhe"):** white pages with thin grey lines; the logo's red only for what matters –
  the page of the menu, the main button, the day's panel, an employee's head. The menu is white with the company's logo (the
  same picture as the ERP's; `rcl-mark.png` when it cannot be loaded), in the groups of the picture (HR Management ·
  Organization · Payroll) with a sign for each page. **The three lines** open and close it with a slide; a page picked closes
  it; a narrow screen starts closed and the menu slides over the page. The top row stays on top of every page. The dashboard:
  a greeting, the day's curve of arrivals with "Now" and the shift, the rows of the picture, one row of quick actions.
  Not in the picture's way: "Reports" (no such page), the drawings of machines, "Mark attendance / Move / Leave request" (the
  office does not punch for a person) – the quick actions are the real ones.
* **Only the web.** Nothing of the phone app and nothing of the database is changed; of the server only `attDash` (reading).

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
