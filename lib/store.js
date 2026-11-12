/* THE FILES of HR – the employees' papers in the PRIVATE bucket "hr-docs" of the HR Supabase (never public, never in git).
 * A file is sent by the browser straight to its place with a link of this server for that ONE file; it is opened only with a
 * link that works for a few minutes. The same address and secret key as the database (Vercel settings). */
'use strict';
const { fail } = require('./http');
const { guard } = require('./preview');
const BUCKET = 'hr-docs';
const NOT_READY = 'The place of the employees\' papers is not set up yet: the Super Admin runs sql/hr_step3_kyc_docs.sql once in the rcl-hr Supabase → SQL Editor.';
function conf() { const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = String(process.env.SUPABASE_SECRET_KEY || ''); if (!url || !key) throw fail(500, 'The HR server is not set up: SUPABASE_URL and SUPABASE_SECRET_KEY are missing in Vercel → Environment Variables.', 'setup'); return { url, key }; }
async function storage(path, body) {
  const c = conf(); await guard(c);
  let r; try { r = await fetch(c.url + '/storage/v1/' + path, { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw fail(503, 'Could not reach the place of the papers – please try again in a moment.', 'net'); }
  const t = await r.text();
  if (!r.ok) { if (/bucket not found/i.test(t)) throw fail(500, NOT_READY, 'notinstalled'); throw fail(500, 'Papers: ' + r.status + ' ' + t.slice(0, 200)); }
  let j; try { j = JSON.parse(t); } catch (e) { j = null; }
  return { c, j };
}
// the place for one new file: where the browser sends it (PUT)
async function uploadUrl(path, bucket) { const { c, j } = await storage('object/upload/sign/' + (bucket || BUCKET) + '/' + path, {}); if (!j || !j.url) throw fail(500, 'Papers: no place was given for the file.'); return c.url + '/storage/v1' + j.url; }
// a link to one file that works for [seconds]; '' = the file is not there
async function link(path, seconds, bucket) { const { c, j } = await storage('object/sign/' + (bucket || BUCKET), { expiresIn: seconds, paths: [path] }); const x = Array.isArray(j) ? j[0] : null; return x && x.signedURL && !x.error ? c.url + '/storage/v1' + x.signedURL : ''; }
const SELFIES = 'hr-selfies';      // (step 4) the proof photo of every punch
module.exports = { BUCKET, SELFIES, NOT_READY, uploadUrl, link };
