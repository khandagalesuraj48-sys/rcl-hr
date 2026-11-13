// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 120 node test/rig/rulebook_muster.js
// The muster with and without Rule Book policies: none given = exactly as before; given = the person's own rules count; taken away = as before again.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const M = require('../../lib/act_muster'), BK = require('../../lib/act_rulebook');
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const site = 'DEMOBKTX2', sup = { role: 'super', site, email: 'rig.super@rig.test' }, tag = 'M' + Date.now(), month = '2026-11', from = '2026-11-01';
  const snap = async () => { const r = await M.ACT.muster(sup, { month }); return { rows: r.rows, key: JSON.stringify(r.rows.map(w => [w.code, w.codes, w.late, w.total])) }; };
  const count = (rows, code) => rows.reduce((a, w) => a + w.codes.filter(c => c === code).length, 0);
  const a = await snap(); ok(a.rows.length > 5, 'the muster has people');
  // a weekly-off policy with NO day off, for the whole site: the Sundays stop being "WO"
  const wo = await BK.ACT.rbSave(sup, { kind: 'weekoff', name: 'Road site ' + tag, valid_from: from, body: { days: [] }, auth: { approve: [{ role: 'super' }] } });
  await BK.ACT.rbDefault(sup, { kind: 'weekoff', policy_id: wo.id, valid_from: from });
  const sun = r => r.filter(w => w.codes[7] === 'WO' || w.codes[7] === 'WOP').length; const b = await snap(); ok(sun(a.rows) > 0 && sun(b.rows) === 0, 'Sunday the 8th off for: ' + sun(a.rows) + ' → ' + sun(b.rows));
  const work = r => ['A', 'P', 'HD', 'L', 'MIS'].reduce((x, k) => x + count(r, k), 0); ok(work(b.rows) > work(a.rows), 'those days are now working days (present / absent / leave): ' + work(a.rows) + ' → ' + work(b.rows));
  // one person gets his own: Sunday and every Saturday off – only his row changes back
  const one = a.rows[0], own = await BK.ACT.rbSave(sup, { kind: 'weekoff', name: 'Sat Sun ' + tag, valid_from: from, body: { days: [0, 6] }, auth: { approve: [{ role: 'super' }] } });
  await BK.ACT.rbAssign(sup, { kind: 'weekoff', policy_id: own.id, valid_from: from, employees: [one.id], reason: 'rig' });
  const c = await snap(), mine = c.rows.find(w => w.id === one.id), other = c.rows.find(w => w.id !== one.id), otherB = b.rows.find(w => w.id === other.id);
  ok(mine.codes.filter(x => x === 'WO' || x === 'WOP').length >= 2, 'his Saturdays and Sundays are off: ' + mine.codes.filter(x => x === 'WO' || x === 'WOP').length); ok(JSON.stringify(other.codes) === JSON.stringify(otherB.codes), 'nobody else changed');
  // the HR office's word on one day: the 7th (a Saturday) is a working day for him too
  await BK.ACT.rbDayOff(sup, { day: '2026-11-07', off: false, reason: 'rig: fifth Saturday works' });
  const d = await snap(), mine2 = d.rows.find(w => w.id === one.id); ok(mine2.codes[6] !== 'WO' && mine2.codes[6] !== 'WOP' && (mine.codes[6] === 'WO' || mine.codes[6] === 'WOP'), 'the 7th: ' + mine.codes[6] + ' → ' + mine2.codes[6]);
  await BK.ACT.rbDayOff(sup, { day: '2026-11-07', off: true, reason: 'rig: off again' }); const d2 = await snap(); ok(['WO', 'WOP'].indexOf(d2.rows.find(w => w.id === one.id).codes[6]) > -1, 'the office\'s newest word counts');
  await BK.ACT.rbDayOff(sup, { day: '2026-11-07', off: false, reason: 'rig: a working Saturday, as the site\'s rules say' });
  // a late policy: late after 0 minutes, no late day allowed – a late present day becomes a half day
  const late = await BK.ACT.rbSave(sup, { kind: 'late', name: 'Strict ' + tag, valid_from: from, body: { grace_min: 0, early_min: 0, free: 0 }, auth: { approve: [{ role: 'super' }] } });
  await BK.ACT.rbDefault(sup, { kind: 'late', policy_id: late.id, valid_from: from });
  const e = await snap(); console.log('late days', a.rows.reduce((x, w) => x + w.total.late, 0), '→', e.rows.reduce((x, w) => x + w.total.late, 0), '· half days', count(a.rows, 'HD'), '→', count(e.rows, 'HD'));
  ok(count(e.rows, 'HD') >= count(c.rows, 'HD'), 'never fewer half days with the strict policy');
  // everything taken away: the muster is exactly what it was
  await BK.ACT.rbDefault(sup, { kind: 'late', policy_id: null, valid_from: from }); await BK.ACT.rbDefault(sup, { kind: 'weekoff', policy_id: null, valid_from: from }); await BK.ACT.rbAssign(sup, { kind: 'weekoff', policy_id: null, valid_from: from, employees: [one.id], reason: 'rig back' });
  const z = await snap(); ok(z.key !== a.key ? (await (async () => { /* the 7th still has the office's word "off" – a Saturday that was no weekly off before */ return z.rows.filter(w => JSON.stringify(w.codes) !== JSON.stringify(a.rows.find(v => v.id === w.id).codes)).every(w => { const o = a.rows.find(v => v.id === w.id).codes; return w.codes.every((x, i) => i === 6 || x === o[i]); }); })()) : true, 'taken away: as before (but for the day the office set)');
  console.log((n - bad) + ' passed, ' + bad + ' failed');
})().catch(e => { console.log('ERR', e.stack || e.message); process.exit(1); });
