# RCL ERP – HR module

HRMS & Attendance module of the RCL ERP (One Click Solution). The plan and the owner's decisions: the Project doc
`architecture/RCL_ERP_HRMS_Plan.md` and `CLAUDE.md`.

## What is here today (12-11-2026 – the frame only)
* `public/index.html` – "HR – being built". Opened from the Portal (a ticket after `#sso=`) it says who the Portal sent.
* `api/sso.js` – checks the Portal's ticket (`lib/portal.js`: ES256 signature with `<PORTAL_URL>/api/jwks`, `iss`, `aud` = "hr",
  the time). **No sign-in is started and nothing is written**: there is no table yet. That a ticket is used once is checked
  from Phase 1 on, when its table exists – until then a ticket opens nothing but this notice.
* `api/menu.js` – the module's pages for Mechanical's dark menu (one page: Home).
* **No table, no SQL, no employee data.**

## Settings (Vercel → Project → Settings → Environment Variables – never in a file)
| Name | What |
|---|---|
| `PORTAL_URL` | the Portal's address: `https://oneclicksolution.online/portal` (an address, not a secret) |
| `PUBLIC_URL` | this module under the one address: `https://oneclicksolution.online/hr` (an address, not a secret) |
| `SUPABASE_URL` | the HR Supabase project's address (used from Phase 1) |
| `SUPABASE_SECRET_KEY` | its secret key (used from Phase 1) – only in Vercel |

## Tests
`timeout 120 node --test test/unit.test.js` – no database, no network (the Portal's key is made in the test).
