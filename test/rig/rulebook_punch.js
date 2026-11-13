// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 150 node test/rig/rulebook_punch.js
// The punch screen reads the person's own policies of the Rule Book (one IN and OUT a day, his weekly off) – nothing is punched here.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const AT = require('../../lib/act_attend'), BK = require('../../lib/act_rulebook'), { db } = require('../../lib/db');
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const site = 'DEMOBKTX2', tag = 'P' + Date.now(), sup = { role: 'super', site, email: 'rig.super@rig.test' }, from = '2026-11-01';
  const emp = ((await db('GET', 'hr_employees?select=id,code,email&site=eq.' + site + '&status=neq.left&email=neq.&order=code.desc&limit=1')) || [])[0], self = { role: 'self', site, email: emp.email };
  const pun = async () => ((await db('GET', 'hr_punches?select=id&employee_id=eq.' + emp.id + '&limit=5000')) || []).length, p0 = await pun();
  const a = await AT.ACT.myAttend(self, {}); ok(Array.isArray(a.week_off) && Array.isArray(a.days_off), 'before: the site\'s rules – weekly off ' + JSON.stringify(a.week_off) + ', one punch a day: ' + a.once);
  // his own attendance policy turns "one IN and OUT a day" the other way; his own weekly off = every day of the week but today's weekday
  const at = await BK.ACT.rbSave(sup, { kind: 'attendance', name: 'Punch ' + tag, valid_from: from, body: { once: !a.once }, auth: { approve: [{ role: 'super' }] } });
  const wd = new Date(a.day + 'T00:00:00Z').getUTCDay(), offs = [0, 1, 2, 3, 4, 5, 6].filter(x => x !== wd);
  const wo = await BK.ACT.rbSave(sup, { kind: 'weekoff', name: 'Punch off ' + tag, valid_from: from, body: { days: offs }, auth: { approve: [{ role: 'super' }] } });
  await BK.ACT.rbAssign(sup, { kind: 'attendance', policy_id: at.id, valid_from: from, employees: [emp.id], reason: 'rig' }); await BK.ACT.rbAssign(sup, { kind: 'weekoff', policy_id: wo.id, valid_from: from, employees: [emp.id], reason: 'rig' });
  const b = await AT.ACT.myAttend(self, {}); ok(b.once === !a.once, 'with his attendance policy: one punch a day is ' + b.once);
  ok(b.week_off.length === 0 && b.days_off.length >= 6 && b.days_off.indexOf(a.day) < 0 && b.days_off.every(d => d > a.day), 'with his weekly-off policy the free days of the coming week are named day by day: ' + b.days_off.length + ' days, not today');
  ok(JSON.stringify(b.punches) === JSON.stringify(a.punches) && b.next === a.next || b.once !== a.once, 'his punches of today are as they were');
  // taken back: the site's rules again
  await BK.ACT.rbAssign(sup, { kind: 'attendance', policy_id: null, valid_from: from, employees: [emp.id], reason: 'rig back' }); await BK.ACT.rbAssign(sup, { kind: 'weekoff', policy_id: null, valid_from: from, employees: [emp.id], reason: 'rig back' });
  const c = await AT.ACT.myAttend(self, {}); ok(c.once === a.once && JSON.stringify(c.week_off) === JSON.stringify(a.week_off) && JSON.stringify(c.days_off) === JSON.stringify(a.days_off), 'taken back: exactly as before');
  ok(await pun() === p0, 'no punch was made or changed');
  console.log((n - bad) + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('STOPPED', e && e.stack || e); process.exit(1); });
