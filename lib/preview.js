/* (21-10-2026 – the same guard as Mechanical, the Portal and the Store: "Staging database … KR PERFECT", 20-10-2026)
 * A PREVIEW NEVER TOUCHES THE LIVE DATA. A Preview (a test deployment of a branch – VERCEL_ENV = 'preview') works ONLY with a
 * database that says of itself "I am a test database": the row app_settings THIS_IS_A_TEST_DATABASE = 'yes' (Mechanical's
 * staging/STAGING_SETUP.md – only the staging database has it; the live HR database has no such table). Before a
 * Preview's first call to the database the row is asked (once in 5 minutes); a database without it – the live one, if a Vercel
 * setting of the Preview was left pointing there – is refused: nothing is read or saved. Production asks nothing. */
'use strict';
const { fail } = require('./http');

const isPreview = () => String(process.env.VERCEL_ENV || '') === 'preview';
/* (02-11-2026, asked: "ethun pudhe je kahi asel agodr testing hoil … mi kahi user la testing sathi deu shakel … je current chalu aahe
 * te bighdnar nahi") THE BETA COPY – the testers' copy of the next version, on the LIVE data: the branch "beta" deployed as a Preview
 * with RCL_CHANNEL = beta set in Vercel for that one branch only. All three must hold; any other Preview keeps the rule above (only
 * a test database). The beta copy runs no timed job (Vercel runs those only on the live one). */
const isBeta = () => isPreview() && String(process.env.VERCEL_GIT_COMMIT_REF || '') === 'beta' && String(process.env.RCL_CHANNEL || '') === 'beta';
// what the page is told: a test copy (the orange band) or the beta copy (its own band) – the live one: neither
const band = () => isBeta() ? { beta: true } : isPreview() ? { preview: true } : {};
const NO = 'This is a Preview (a test copy of the app): it works only with the TEST database, and this database is not marked as one – nothing was read or saved. (STAGING_SETUP.md: the Preview\'s settings in Vercel must point to the staging database.)';
const seen = new Map();      // the database's address → { ok, at }

async function guard(c) {
  if (!isPreview() || isBeta() || !c || !c.url) return;
  const was = seen.get(c.url);
  if (was && Date.now() - was.at < (was.ok ? 300000 : 10000)) { if (!was.ok) throw fail(503, NO, 'preview'); return; }
  let ok = false;
  try {
    const r = await fetch(c.url + '/rest/v1/app_settings?id=eq.THIS_IS_A_TEST_DATABASE&select=value', { headers: { apikey: c.key, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (r.status >= 500) throw new Error('database ' + r.status);
    if (r.ok) { const j = await r.json(); ok = Array.isArray(j) && !!j[0] && j[0].value === 'yes'; }
  } catch (e) { throw fail(503, 'Could not reach the HR database – please try again in a moment.', 'net'); }
  seen.set(c.url, { ok: ok, at: Date.now() });
  if (!ok) throw fail(503, NO, 'preview');
}
module.exports = { isPreview, isBeta, band, guard, NO, _forget: () => seen.clear() };
