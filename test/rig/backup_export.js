/* RIG (the local copy of HR's database – never the live one): the backup export against the REAL tables.
 *   SUPABASE_URL=http://127.0.0.1:3140 SUPABASE_SECRET_KEY=… node test/rig/backup_export.js
 * Every table of the list is in the database, with its key and its "since" column; every table's rows are given; the sign-ins and
 * the tickets are not; the face numbers are hidden; and no table of the database is forgotten. */
'use strict';
process.env.BACKUP_EXPORT_SECRET = 'r'.repeat(32);
const E = require('../../api/backup-export.js'), T = E.TABLES;
let pass = 0, bad = 0; const ok = (n, c, x) => { if (c) pass++; else { bad++; console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); } };
const call = async body => { let status = 0, out = null; const res = { setHeader() {}, end(t) { out = JSON.parse(t); }, set statusCode(v) { status = v; } };
  await E({ method: 'POST', headers: { authorization: 'Bearer ' + 'r'.repeat(32) }, body: body }, res); return { status, j: out }; };
(async () => {
  const t0 = Date.now(), c = await call({ action: 'catalog' }), ms = Date.now() - t0;
  ok('the list of tables', c.status === 200, c.j);
  const got = (c.j.tables || []).map(t => t.name);
  ok('every table of the list is in the database (' + got.length + ')', got.length === Object.keys(T).length && got.join() === Object.keys(T).join(), Object.keys(T).filter(t => got.indexOf(t) < 0));
  ok('the list is there well within the backup\'s 10 seconds (' + ms + ' ms)', ms < 5000, ms);
  const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/', { headers: { apikey: process.env.SUPABASE_SECRET_KEY, Accept: 'application/openapi+json' } }), d = (await r.json()).definitions || {};
  ok('no table of the database is forgotten – only the sign-ins and the tickets stay out', Object.keys(d).filter(t => /^hr_/.test(t) && !T[t]).sort().join() === 'hr_sessions,hr_tickets', Object.keys(d).filter(t => /^hr_/.test(t) && !T[t]));
  for (const t of c.j.tables || []) {
    const have = Object.keys((d[t.name] || {}).properties || {});
    ok(t.name + ': its key columns exist', T[t.name].key.split(',').every(k => have.indexOf(k) > -1), T[t.name].key);
    ok(t.name + ': every column is given', t.cols.join() === have.join(), [t.cols, have]);
    if (T[t.name].since) ok(t.name + ': its "since" column exists', have.indexOf(T[t.name].since) > -1, T[t.name].since);
    const all = await call({ action: 'rows', table: t.name, offset: 0, limit: 1000 });
    ok(t.name + ': its rows are given (' + ((all.j.rows || []).length) + ' of ' + t.count + ')', all.status === 200 && Array.isArray(all.j.rows) && all.j.rows.length === Math.min(1000, t.count), all.j);
    const later = await call({ action: 'rows', table: t.name, since: '2999-01-01T00:00:00Z' });
    ok(t.name + ': "since" – ' + (T[t.name].since ? 'only the new rows' : 'given whole'), later.status === 200 && later.j.rows.length === (T[t.name].since ? 0 : Math.min(1000, t.count)), later.j);
    if (t.name === 'hr_faces') ok('the face numbers are hidden', all.j.rows.every(x => x.descriptors === null || (x.descriptors && x.descriptors.__hidden === true)), all.j.rows[0]);
  }
  for (const t of ['hr_sessions', 'hr_tickets']) ok(t + ' is never given', (await call({ action: 'rows', table: t })).status === 400);
  console.log(pass + ' pass, ' + bad + ' fail'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAULT', e); process.exit(1); });
