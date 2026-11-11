/* THE HR DATABASE – the HR module's own Supabase project (rcl-hr), ONE for EVERY site: every row carries its
 * site; this server reads and writes only the sites of the person's sign-in. Its address and secret key are Vercel settings,
 * never in a file (12-11-2026: "PRATEK COMPNY CHA DATA BASE WEGLA ASEL" – each company has its own):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY   – the rcl-hr project's */
'use strict';
const { fail } = require('./http');
const { guard } = require('./preview');      // (21-10-2026) a Preview works only with the test database
const sleep = ms => new Promise(r => setTimeout(r, ms));
function conf() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = String(process.env.SUPABASE_SECRET_KEY || '');
  if (!url || !key) throw fail(500, 'The HR server is not set up: add SUPABASE_URL and SUPABASE_SECRET_KEY (the rcl-hr Supabase project\'s) in Vercel → Environment Variables, then Redeploy.', 'setup');
  return { url, key };
}
const enc = v => encodeURIComponent(String(v === undefined || v === null ? '' : v));
/* one REST call (3 tries on a network fault or a busy database); the answer's rows, or null.
 * (24-10-2026, Mechanical's update-155 – the audit's R3) A read, a change (PATCH – it sets values) and a delete are asked again as
 * before: done twice, they leave the same. A NEW ROW (POST) is sent again only when the database said it
 * did not do it (503 – not reachable, 429 – too busy) or when it never left this server (no connection): after no answer at
 * all it may have been done, so it is not sent a second time – the person is told to look first (no second copy, no false "already
 * there"). */
// (update-155) the request never left this server (no connection, the name not found): sent again, as before – nothing can have been done
const NOT_SENT = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/;
const notSent = e => { const c = (e && e.cause) || e || {}, list = Array.isArray(c.errors) && c.errors.length ? c.errors : [c]; return list.every(x => NOT_SENT.test(String((x && x.code) || ''))); };
async function db(method, path, body, prefer) {
  const c = conf();
  await guard(c);
  const write = method === 'POST' && !/merge-duplicates/.test(String(prefer || ''));      // (an upsert is the same done twice)
  let last = '';
  for (let i = 0; i < 3; i++) {
    let r;
    try {
      r = await fetch(c.url + '/rest/v1/' + path, { method, headers: Object.assign({ apikey: c.key, 'Content-Type': 'application/json' }, prefer ? { Prefer: prefer } : {}),
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch (e) {
      last = String((e && e.message) || e);
      if (write && !notSent(e)) throw fail(503, 'No answer from the HR database – it may or may not have been saved: open the page again and look before you try again.', 'net');
      await sleep(300 * (i + 1)); continue;
    }
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : null;
    last = r.status + ' ' + t.slice(0, 300);
    if (r.status === 503 || r.status === 429 || (!write && r.status >= 500)) { await sleep(400 * (i + 1)); continue; }
    if ((r.status === 404 || r.status === 400) && /PGRST205|42P01|Could not find the table/i.test(t)) throw fail(500, 'The HR database is not set up yet: the Super Admin runs sql/hr_step1_base.sql once in the rcl-hr Supabase → SQL Editor.', 'notinstalled');
    if (/23505|duplicate key/.test(t)) throw fail(409, 'This already exists.', 'duplicate');
    if (r.status === 401 || r.status === 403) throw fail(500, 'The HR database refused the key – check SUPABASE_SECRET_KEY in Vercel.', 'key');
    throw fail(500, 'Database: ' + last);
  }
  throw fail(503, 'Could not reach the HR database – please try again in a moment.', 'net');
}
module.exports = { db, enc };
