# CLAUDE.md – RCL ERP HR module (HRMS & Attendance)

Read this first, then `README.md`. The same owner and rules as the Mechanical module (`rclerp/CLAUDE.md`), the Portal, the
Store, Engineering and Purchase; the short version:

## The owner and how to talk to him
* Sujit Mule, MD of Rachana Construction Limited (RCL).
* **Reply in Marathi (Devanagari).** Answer first. Simple. One step at a time.
* "adhi charcha kar" = discuss first, no code. "fkt check kr" = only check, change nothing.

## Rules
1. **Exactly what he asks, nothing extra.** He decides each step. **Each HR phase is reviewed and approved by him before it starts.**
2. **Simple screens**, clear at a glance.
3. **Live and business-critical:** never delete, reset or overwrite live data; no destructive SQL; no push to `main` / deploy
   without his yes; a database change is justified and approved separately and he runs the SQL himself – **only in the HR
   Supabase** (`rcl-hr`). Nothing of HR is ever put into the Portal's, Mechanical's, the Store's, Engineering's or Purchase's
   database. Existing features and permissions keep working.
4. **Evidence, not claims:** read the code, run the tests, say plainly what was not run or not verified.
5. **Every shell / test / network command has a `timeout`.** A hang: run the one test alone, find the case, fix it. Never just re-run.
6. **Fix a thing everywhere it is used** – also in the phone app (`rcl-mobile`): whatever is added here gets its app screen in
   the same piece of work.
7. **No secret, key, password or personal data in any file** (no employee's name, number, salary, photo or face data – not in a
   test either). Keys live only in Vercel → Environment Variables and are never pasted in chat.
8. Work arrives as a branch + pull request; he merges; Vercel deploys.
9. **Never use or copy code of Horilla (LGPL) or any other HR product** – they are references for workflow only.

## Decisions that shape this repository (12-11-2026; the plan: the Project doc `architecture/RCL_ERP_HRMS_Plan.md`)
* **One Supabase project for HR for EVERY site** (`rcl-hr`, Mumbai): every row carries its site; this server reads and writes
  only the sites of the person's sign-in. Row Level Security on every table with no access given – only this server reaches it.
* **One address:** `https://oneclicksolution.online/hr` (Mechanical's `vercel.json` sends `/hr/…` here), inside Mechanical's screen.
* **The Portal** is the one sign-in and the one place access is given (HR Admin / HR User per site). HR trusts a Portal ticket
  only after checking its ES256 signature with `/api/jwks`, its `aud` ("hr"), `exp`, and that its `jti` is used once
  (`hr_tickets`). The finer roles (Supervisor, Reporting Person, HR Head, Payroll) and the powers the Super Admin
  gives are kept in HR's own database.
* **An employee is not a sign-in:** the Employee Master is HR's; an employee who uses the app is linked to a Portal user.
  Categories: Staff, Operator, Driver, Labour (not the designation). DOB and a verified e-mail (OTP by Resend) are compulsory
  for everybody before activation.
* **Attendance:** each person punches for himself, **today only** (the server's clock decides the day); GPS + selfie with every
  punch; a punch is never changed or deleted – a correction (HR Admin / Super Admin) is a new row with the old time, the new
  time, the reason, who and when; a geofence at every work place; a punch outside is kept and goes to approval; an offline
  punch is sent later with its own number (never twice) and is approved by itself only when GPS, device, time and integrity
  are in order; Developer Options ON blocks **only** HR attendance / punch; selfies are kept 90 days (longer under a hold).
  Labour without a phone: the supervisor's phone (kiosk, Phase 3) or the HR Admin's manual entry (reason, who, when – always).
* **Payroll for everybody**, by category and salary type; PF, ESIC, PT, LWF, TDS and the late / absent rules are settings with
  dates, never numbers in the code; a locked month is never recalculated; two months beside the present method first.
* **Phases:** 1 foundation + Employee Master + import · 2 shifts, holidays, geofence, attendance, rules, muster · 3 face +
  kiosk · 4 leave · 5 payroll · 6 self-service, reports, notifications.
