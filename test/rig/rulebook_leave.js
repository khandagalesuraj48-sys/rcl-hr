// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 120 node test/rig/rulebook_leave.js
// Leave walked with the Rule Book on a site: a Sunday worked earns one; the balance, the ledger, and back to "as before".
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const LV = require('../../lib/act_leave'), BK = require('../../lib/act_rulebook'), M = require('../../lib/act_muster'), { db } = require('../../lib/db');
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const site = 'DEMOBKTX2', sup = { role: 'super', site, email: 'rig.super@rig.test' }, tag = 'L' + Date.now(), from = '2026-11-01', where = 'site=eq.' + site;
  const emps = (await db('GET', 'hr_employees?select=id,code,name,category,site,department_id,reports_to,status,joined_on,left_on&site=eq.' + site + '&status=neq.left&order=code&limit=50')) || [];
  const key = st => JSON.stringify(emps.map(e => [st.by[e.id].balance, Object.keys(st.by[e.id].marks).sort()]));
  const a = await LV.state(site, where, emps);      // (the first run on a fresh rig walks the way of before; after it the rig keeps credit rows, so the new walk is used – with the same result, checked at the end)
  const mA = JSON.stringify((await M.ACT.muster(sup, { month: '2026-11' })).rows.map(w => [w.code, w.codes, w.total]));
  const p = await BK.ACT.rbSave(sup, { kind: 'leave', name: 'Site Sunday ' + tag, valid_from: from, body: { earn: 'sunday', per_month: 4, carry: true, auto_absent: false }, auth: { verify: [{ role: 'site_hr' }], approve: [{ role: 'ho_hr' }] } });
  await BK.ACT.rbDefault(sup, { kind: 'leave', policy_id: p.id, valid_from: from });
  const b = await LV.state(site, where, emps); ok(b.book === true, 'walked with the Rule Book');
  const rows = emps.map(e => b.by[e.id]), sun = rows.map(r => (r.ledger || []).filter(x => x.source === 'sunday').reduce((s, x) => s + x.days, 0));
  ok(rows.every(r => Array.isArray(r.ledger) && r.comp === 0), 'everybody has a ledger and an empty Comp-off balance');
  ok(sun.every(v => v >= 0 && v <= 4), 'Sundays worked earned (the rig\'s only Sunday was a day off – the unit test covers a worked one): ' + JSON.stringify([...new Set(sun)]));
  ok(rows.every(r => !(r.ledger || []).some(x => x.source === 'month')), 'nothing is added at the month\'s start with this policy');
  const abs = rows.reduce((s, r) => s + Object.keys(r.absent || {}).length, 0); ok(abs > 0, 'absent days are marked, not paid from the balance: ' + abs);
  // the muster reads L only where an approved leave was taken from a balance that had it
  const mB = (await M.ACT.muster(sup, { month: '2026-11' })).rows; ok(mB.length === emps.length || mB.length > 0, 'the muster still answers');
  // one person gets 6 days of opening balance and a comp-off day (rows only added)
  const one = emps[0]; await db('POST', 'hr_leave_credits', [{ employee_id: one.id, site, day: '2026-11-03', bucket: 'paid', days: 6, source: 'opening', reason: 'Opening balance (rig ' + tag + ')', entered_by: sup.email }, { employee_id: one.id, site, day: '2026-11-04', bucket: 'comp', days: 1, source: 'compoff', reason: 'Worked on a holiday (rig ' + tag + ')', entered_by: sup.email }], 'return=minimal');
  const c = await LV.state(site, 'employee_id=eq.' + one.id, [one]), me = c.by[one.id]; ok(me.balance === b.by[one.id].balance + 6 && me.comp === 1, 'his balances: paid ' + b.by[one.id].balance + ' → ' + me.balance + ', comp-off ' + me.comp);
  ok(me.ledger.some(x => x.source === 'opening' && x.days === 6) && me.ledger.some(x => x.bucket === 'comp' && x.days === 1), 'the ledger says where they came from');
  // taken away: counted as before again (the two credit rows stay – they are his; so he is still walked the new way, the others as before)
  await db('POST', 'hr_leave_credits', [{ employee_id: one.id, site, day: '2026-11-03', bucket: 'paid', days: -6, source: 'hr', reason: 'rig: taken back', entered_by: sup.email }, { employee_id: one.id, site, day: '2026-11-04', bucket: 'comp', days: -1, source: 'hr', reason: 'rig: taken back', entered_by: sup.email }], 'return=minimal');
  await BK.ACT.rbDefault(sup, { kind: 'leave', policy_id: null, valid_from: from });
  const z = await LV.state(site, where, emps); ok(key(z) === key(a), 'the site\'s policy taken away: every balance and every leave day as before');
  const mZ = JSON.stringify((await M.ACT.muster(sup, { month: '2026-11' })).rows.map(w => [w.code, w.codes, w.total])); ok(mZ === mA, 'and the muster is what it was');
  console.log((n - bad) + ' passed, ' + bad + ' failed');
})().catch(e => { console.log('ERR', e.stack || e.message); process.exit(1); });
