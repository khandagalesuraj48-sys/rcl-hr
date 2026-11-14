/* (with Mechanical's update-243, asked 14-11-2026) THE BACKUP EXPORT – the Portal's, Engineering's and Purchase's file (one line of its
 * heading is worded differently here: HR's files never hold the word for a sign-in secret – test/unit.test.js; and the list of
 * tables is asked eight at a time – HR has some fifty).
 * Mechanical's nightly backup copies this module's data into the Google Sheets of the backup (the Portal's into its own numbered
 * Sheets; Engineering's rows of a site into that site's Sheets). It asks here – and nobody else may – with BACKUP_EXPORT_SECRET
 * (the same value in Vercel for rclerp, rcl-portal and rcl-engineering; never in a file, never in the page).
 * This module keeps its own database key. What may leave is listed in TABLES (api/backup-export.js): a sign-in secret or a recovery
 * code goes as "(hidden)"; sign-ins, used tickets, counters and signing keys are not in the list at all.
 *   { action: 'catalog', site? }  → { tables: [{ name, title, cols, key, since, count, newest }] }
 *   { action: 'rows', table, site?, since?, offset, limit ≤ 1000 } → { rows }   (since: only rows new or changed since then –
 *     for the backup's Sheet 2 and after; a table without its own time column is given whole)
 *   { action: 'usage' } → { db, files: [{ bucket, n, bytes }] }   (Mechanical's update-158: how full this database and its files
 *     are, for the Super Admin's Storage – no row of any table; needs the step that adds web_usage(), opts.usageStep) */
'use strict';
const crypto = require('crypto');
const { fail } = require('./http');
const { guard } = require('./preview');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function allowed(req) {
  const s = String(process.env.BACKUP_EXPORT_SECRET || '').trim();      // (a newline pasted with the value in Vercel is not part of it)
  if (s.length < 24) throw fail(503, 'The backup export is not set up here (BACKUP_EXPORT_SECRET in Vercel, the same as in rclerp).', 'setup');
  if (!same(String(req.headers.authorization || ''), 'Bearer ' + s)) throw fail(401, 'Refused.', 'denied');
}
// one read of the database (asked again on a fault – a read done twice is the same)
async function rest(c, path, headers) {
  await guard(c);
  let last = '';
  for (let i = 0; i < 3; i++) {
    let r;
    try { r = await fetch(c.url + '/rest/v1/' + path, { headers: Object.assign({ apikey: c.key }, headers || {}), signal: AbortSignal.timeout(20000) }); }
    catch (e) { last = String((e && e.message) || e); await sleep(400 * (i + 1)); continue; }
    if (r.ok) return r;
    last = r.status + ' ' + (await r.text()).slice(0, 200);
    if (r.status >= 500 || r.status === 429) { await sleep(400 * (i + 1)); continue; }
    throw fail(500, 'Database: ' + last);
  }
  throw fail(503, 'The database did not answer: ' + last);
}
// every table's columns, in their order (the database's own description)
async function columns(c) {
  const j = await (await rest(c, '', { Accept: 'application/openapi+json' })).json();
  const d = j.definitions || (j.components && j.components.schemas) || {}, out = {};
  Object.keys(d).forEach(t => { out[t] = Object.keys((d[t] && d[t].properties) || {}); });
  return out;
}
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
// TABLES: { name: { title, key: 'a,b', since?: 'col' | (iso) => filter, hide?: [cols], cols?: [cols] } };  opts.site: every table is
// filtered by its site. cols (review 25-10-2026): ONLY these columns leave (and the hidden ones, as "(hidden)") – a column added to
// that table later never leaves by itself
const colsOf = (t, have) => Array.isArray(t.cols) ? have.filter(x => t.cols.indexOf(x) > -1 || (t.hide || []).indexOf(x) > -1) : have;
function make(TABLES, opts) {
  opts = opts || {};
  return async function run(c, x) {
    x = x || {};
    if (x.action === 'usage') return usage(c, opts);
    const site = String(x.site || '').trim().toUpperCase();
    if (opts.site && !/^[A-Z0-9]{1,12}$/.test(site)) throw fail(400, 'Which site?');
    const sf = opts.site ? '&site=eq.' + encodeURIComponent(site) : '';
    if (x.action === 'catalog') {
      const cols = await columns(c), tables = [];
      // (HR: some fifty tables – asked eight at a time, so the list is there within the backup's short wait; the order stays)
      const names = Object.keys(TABLES).filter(name => cols[name]);      // (not a table this database does not have yet)
      const one = async name => {
        const t = TABLES[name];
        const nc = cols[name].indexOf('updated_at') > -1 ? 'updated_at' : typeof t.since === 'string' ? t.since : '';
        const r = await rest(c, name + '?select=' + (nc || t.key.split(',')[0]) + sf + (nc ? '&order=' + nc + '.desc.nullslast' : '') + '&limit=1', { Prefer: 'count=exact' });
        const n = Number(String(r.headers.get('content-range') || '').split('/')[1]), rows = await r.json();
        return { name: name, title: t.title, cols: colsOf(t, cols[name]), key: t.key, since: !!t.since, count: isFinite(n) ? n : 0, newest: nc && rows[0] && rows[0][nc] ? String(rows[0][nc]) : '' };
      };
      for (let i = 0; i < names.length; i += 8) tables.push(...await Promise.all(names.slice(i, i + 8).map(one)));
      return { tables: tables };
    }
    if (x.action === 'rows') {
      const name = String(x.table || ''), t = Object.prototype.hasOwnProperty.call(TABLES, name) ? TABLES[name] : null;
      if (!t) throw fail(400, 'Not a table of the backup.');
      const off = Math.max(0, Math.floor(Number(x.offset) || 0)), lim = Math.max(1, Math.min(1000, Math.floor(Number(x.limit) || 1000)));
      const since = String(x.since || '');
      if (since && !ISO.test(since)) throw fail(400, 'since: a time like 2026-10-24T10:00:00Z.');
      const sinceF = since && t.since ? (typeof t.since === 'function' ? t.since(encodeURIComponent(since)) : '&' + t.since + '=gte.' + encodeURIComponent(since)) : '';
      const order = t.key.split(',').map(k => k + '.asc').join(',');
      const sel = Array.isArray(t.cols) ? t.cols.concat(t.hide || []).join(',') : '*';
      const rows = await (await rest(c, name + '?select=' + sel + sf + sinceF + '&order=' + order + '&offset=' + off + '&limit=' + lim)).json();
      (t.hide || []).forEach(h => rows.forEach(row => { if (row[h] !== null && row[h] !== undefined && row[h] !== '') row[h] = { __hidden: true }; }));
      return { rows: rows };
    }
    throw fail(400, 'Unknown action.');
  };
}
// (update-158) the size of this database and of its files (web_usage – it only reads)
async function usage(c, opts) {
  await guard(c);
  let r;
  try { r = await fetch(c.url + '/rest/v1/rpc/web_usage', { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw fail(503, 'The database did not answer – try again in a moment.'); }
  if (r.status === 404) return { needSql: true, error: 'This needs one database step first: run ' + (opts.usageStep || 'the step with web_usage') + ' in Supabase → SQL Editor.' };
  if (!r.ok) throw fail(500, 'Database: ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const u = await r.json() || {};
  return { db: Number(u.db) || 0, files: (Array.isArray(u.files) ? u.files : []).map(f => ({ bucket: String(f.bucket || ''), n: Number(f.n) || 0, bytes: Number(f.bytes) || 0 })) };
}
module.exports = { allowed, make };
