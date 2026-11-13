// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 150 node test/rig/rulebook_leave_ask.js
// A leave request under a Rule Book leave policy: the policy says who verifies and who approves; one leave from both balances; longer than the balance is allowed.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const LV = require('../../lib/act_leave'), BK = require('../../lib/act_rulebook'), { db } = require('../../lib/db');
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } }, no = async (p, t) => { try { await p; ok(false, t + ' (was allowed)'); } catch (e) { ok(e.status >= 400 && e.status < 500, t + ' → ' + e.message); } };
  const site = 'DEMOBKTX2', tag = 'q' + Date.now(), sup = { role: 'super', site, email: 'rig.super@rig.test' }, adm = { role: 'admin', site, email: 'rig.admin@rig.test' }, ho = { role: 'user', site, email: 'rig.ho.' + tag + '@rig.test' };
  await db('POST', 'hr_ho_hr', [{ email: ho.email, active: true, given_by: sup.email, given_at: new Date().toISOString() }], 'return=minimal');
  const emp = ((await db('GET', 'hr_employees?select=id,code,email&site=eq.' + site + '&status=neq.left&email=neq.&order=code.desc&limit=1')) || [])[0], self = { role: 'self', site, email: emp.email };
  const pol = await BK.ACT.rbSave(sup, { kind: 'leave', name: 'Ask ' + tag, valid_from: '2026-11-01', body: { earn: 'month', per_month: 1 }, auth: { verify: [{ role: 'site_hr' }], approve: [{ role: 'ho_hr' }] } });
  await BK.ACT.rbAssign(sup, { kind: 'leave', policy_id: pol.id, valid_from: '2026-11-01', employees: [emp.id], reason: 'rig' });
  await db('POST', 'hr_leave_credits', [{ employee_id: emp.id, site, day: '2026-11-05', bucket: 'comp', days: 1, source: 'compoff', reason: 'rig ' + tag, entered_by: sup.email }], 'return=minimal');
  const m0 = await LV.ACT.myLeave(self); ok(m0.book === true && m0.balance === m0.paid + m0.comp && m0.comp >= 1, 'his one balance = paid ' + m0.paid + ' + comp-off ' + m0.comp + ' = ' + m0.balance); ok(Array.isArray(m0.ledger) && m0.ledger.length > 0, 'he sees his ledger');
  // a request longer than the balance is taken (the days the balance has are leave, the others stay absent)
  let base = null, d = null, m1 = null, len = Math.ceil(Math.max(0, m0.available)) + 3;
  for (let i = 0; i < 40 && !m1; i++) { base = new Date(Date.now() + (20 + Math.floor(Math.random() * 320)) * 86400000); const bb = base; d = k => new Date(bb.getTime() + k * 86400000).toISOString().slice(0, 10); try { m1 = await LV.ACT.leaveAsk(self, { from: d(0), to: d(len), reason: 'long leave ' + tag }); } catch (e) { if (e.code !== 'duplicate' && e.code !== 'day') throw e; } }
  if (!m1) { console.log('(the rig\'s year ahead is full of this test\'s earlier leaves – nothing more to ask)'); return; }
  const req = m1.requests[0]; ok(req.status === 'pending' && req.level === 1 && req.days > m0.available, 'asked ' + req.days + ' days with ' + m0.available + ' available: taken, it waits for "verify"');
  let list = await LV.ACT.leaveList(ho, { status: 'pending' }), row = list.rows.find(r => r.id === req.id); ok(row.can === false && row.stage === 'verify', 'the HO HR cannot verify'); await no(LV.ACT.leaveDecide(ho, { id: req.id, decision: 'approved' }), 'the HO HR at the verify step');
  list = await LV.ACT.leaveList(adm, { status: 'pending' }); ok(list.rows.find(r => r.id === req.id).can === true, 'the site\'s HR Admin can verify');
  await LV.ACT.leaveDecide(adm, { id: req.id, decision: 'approved' }); list = await LV.ACT.leaveList(adm, { status: 'pending' }); row = list.rows.find(r => r.id === req.id); ok(row && row.level === 2 && row.stage === 'approve' && row.can === false, 'verified: it waits for approval – not the site HR\'s to approve');
  await no(LV.ACT.leaveDecide(adm, { id: req.id, decision: 'approved' }), 'the site\'s HR at the approve step');
  await LV.ACT.leaveDecide(ho, { id: req.id, decision: 'approved' }); const m2 = await LV.ACT.myLeave(self); ok(m2.requests.find(r => r.id === req.id).status === 'approved' && m2.booked > 0, 'approved by the HO HR; booked ahead: ' + m2.booked);
  // a second one is refused at the verify step with its reason
  let m3 = null; for (let i = 20; i < 110 && !m3; i += 3) { const f2 = d(i); if (f2 > new Date(Date.now() + 360 * 86400000).toISOString().slice(0, 10)) break; try { m3 = await LV.ACT.leaveAsk(self, { from: f2, to: f2, reason: 'one day ' + tag }); } catch (e) { if (e.code !== 'duplicate' && e.code !== 'free') throw e; } } const r2 = m3.requests[0]; await no(LV.ACT.leaveDecide(adm, { id: r2.id, decision: 'refused', note: '' }), 'a refusal needs its reason');
  await LV.ACT.leaveDecide(adm, { id: r2.id, decision: 'refused', note: 'work is on' }); ok((await LV.ACT.myLeave(self)).requests.find(r => r.id === r2.id).status === 'refused', 'refused at the verify step');
  // a person with no Rule Book policy: decided as before (the HR office with its power; level by the site's old policy)
  const lo = await LV.ACT.leaveList(adm, { status: 'pending' }); console.log('other people\'s waiting requests on the rig:', lo.rows.filter(r => r.code !== emp.code).length, '– with a Rule Book step:', lo.rows.filter(r => r.code !== emp.code && r.can !== undefined).length);
  await BK.ACT.rbAssign(sup, { kind: 'leave', policy_id: null, valid_from: '2026-11-01', employees: [emp.id], reason: 'rig back' });
  await db('PATCH', 'hr_ho_hr?email=eq.' + encodeURIComponent(ho.email), { active: false, taken_by: sup.email, taken_at: new Date().toISOString() }, 'return=minimal');
  console.log((n - bad) + ' passed, ' + bad + ' failed');
})().catch(e => { console.log('ERR', e.stack || e.message); process.exit(1); });
