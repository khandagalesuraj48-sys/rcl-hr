// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 150 node test/rig/rulebook_pay.js
// The Rule Book in the pay sheet: approved overtime and comp-off "for pay" – and a person without a policy is paid exactly as before.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const PR = require('../../lib/act_payroll'), BK = require('../../lib/act_rulebook'), { db } = require('../../lib/db'), { execSync } = require('child_process');
const sql = q => execSync('timeout 20 su postgres -c "psql -d rig_hr -tA -q"', { input: q }).toString().trim();      // the rig's own database only: to put it back as it was
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const site = 'DEMOBKTX2', month = '2026-10', tag = 'Y' + Date.now(), sup = { role: 'super', site, email: 'rig.super@rig.test' };
  const before = await PR.ACT.payList(sup, { month }); if (!before.ready || before.locked) { console.log('(October is not open for pay on this rig – nothing to test with)'); return; }
  const two = before.rows.slice(0, 2), a = two[0], b = two[1]; let salIds = '0', askIds = '0', pol = null;
  try {
    salIds = (await db('POST', 'hr_salaries', two.map(r => ({ employee_id: r.id, site, pay_type: 'monthly', amount: 31000, valid_from: '2026-10-01', note: 'rig ' + tag, status: 'approved', asked_by: 'rig@rig.test', decided_by: 'rig@rig.test', decided_at: new Date().toISOString() })), 'return=representation')).map(x => x.id).join(',');
    const m0 = await PR.ACT.payList(sup, { month }), a0 = m0.rows.find(r => r.id === a.id), b0 = m0.rows.find(r => r.id === b.id);
    ok(a0.day === 1000 && a0.extra === a0.extra_days * 1000 && a0.overtime === undefined, 'no policy: a day worked on a day off = a day\'s pay more, as before (' + a0.extra_days + ' days); no overtime line');
    // A gets a comp-off policy and an overtime policy; approved for pay: one comp-off day and 2 h overtime; one comp-off "for leave" and one overtime that still waits
    pol = await BK.ACT.rbSave(sup, { kind: 'compoff', name: 'Pay ' + tag, valid_from: '2026-10-01', body: { result: 'pay' }, auth: { approve: [{ role: 'super' }] } });
    await BK.ACT.rbAssign(sup, { kind: 'compoff', policy_id: pol.id, valid_from: '2026-10-01', employees: [a.id], reason: 'rig' });
    const ask = (kind, day, body, status) => ({ site, employee_id: a.id, kind, day, body, status, stage: 'approve', auth: { verify: [], approve: [{ role: 'super' }] }, asked_by: 'rig ' + tag });
    askIds = (await db('POST', 'hr_asks', [ask('compoff', '2026-10-04', { days: 1, result: 'pay' }, 'approved'), ask('compoff', '2026-10-11', { days: 1, result: 'leave' }, 'approved'), ask('overtime', '2026-10-06', { minutes: 90, shift_hours: 8, rate: 1, result: 'pay' }, 'approved'),
      ask('overtime', '2026-10-07', { minutes: 30, shift_hours: 8, rate: 1, result: 'pay' }, 'approved'), ask('overtime', '2026-10-08', { minutes: 600, shift_hours: 8, rate: 1, result: 'pay' }, 'pending'), ask('overtime', '2026-11-02', { minutes: 600, shift_hours: 8, rate: 1, result: 'pay' }, 'approved')], 'return=representation')).map(x => x.id).join(',');
    const m1 = await PR.ACT.payList(sup, { month }), a1 = m1.rows.find(r => r.id === a.id), b1 = m1.rows.find(r => r.id === b.id);
    ok(a1.extra_days === 1 && a1.extra === 1000, 'with a comp-off policy: only the day approved "for pay" is an extra day (the one "for leave" is not paid)');
    ok(a1.ot_hours === 2 && a1.overtime === 250, 'overtime: the 2 approved hours of October = 250 (the waiting one and November\'s are not in it)');
    ok(a1.gross === Math.round((a1.earned + 1000 + 250 + a1.other_earn) * 100) / 100 && a1.earned === a0.earned, 'the gross = earned + extra + overtime; the earned pay is as it was');
    ok(JSON.stringify(b1) === JSON.stringify(b0), 'the other person – no policy – is paid exactly as before'); ok(m1.totals.overtime === 250, 'the month\'s totals carry the overtime');
    ok(JSON.stringify(m1.rows.filter(r => r.id !== a.id)) === JSON.stringify(m0.rows.filter(r => r.id !== a.id)), 'nobody else\'s line changed');
  } finally {
    if (pol) await BK.ACT.rbAssign(sup, { kind: 'compoff', policy_id: null, valid_from: '2026-10-01', employees: [a.id], reason: 'rig back' });
    sql('delete from hr_asks where id in (' + askIds + '); delete from hr_salaries where id in (' + salIds + ');');
  }
  const after = await PR.ACT.payList(sup, { month }); ok(JSON.stringify(after.rows) === JSON.stringify(before.rows) && JSON.stringify(after.totals) === JSON.stringify(before.totals), '(the rig is as before)');
  console.log((n - bad) + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('STOPPED', e && e.stack || e); process.exit(1); });
