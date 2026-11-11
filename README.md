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

## Settings (Vercel → Project → Settings → Environment Variables – never in a file)
| Name | What |
|---|---|
| `PORTAL_URL` | the Portal's address: `https://oneclicksolution.online/portal` (an address, not a secret) |
| `PUBLIC_URL` | this module under the one address: `https://oneclicksolution.online/hr` (an address, not a secret) |
| `SUPABASE_URL` | the HR Supabase project's address |
| `SUPABASE_SECRET_KEY` | its secret key – only in Vercel |

## Tests
`timeout 120 node --test test/unit.test.js` – no real database, no network (the Portal's key and a stand-in of the database are
made in the test). The SQL step was run twice on a scratch database of the local test rig (never a live one).
