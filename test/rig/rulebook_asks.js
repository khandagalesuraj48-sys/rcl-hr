// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 150 node test/rig/rulebook_asks.js
// Verify → approve: extra leave asked by the site's HR and approved by the HO HR; comp-off / overtime counted, sent, approved into the Comp-off balance.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const AS = require('../../lib/act_asks'), BK = require('../../lib/act_rulebook'), { db } = require('../../lib/db');
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } }, no = async (p, t) => { try { await p; ok(false, t + ' (was allowed)'); } catch (e) { ok(e.status >= 400 && e.status < 500, t + ' → ' + e.message); } };
  const site = 'DEMOBKTX2', tag = 'A' + Date.now(), from = '2026-11-01', sup = { role: 'super', site, email: 'rig.super@rig.test' }, adm = { role: 'admin', site, email: 'rig.admin@rig.test' }, usr = { role: 'user', site, email: 'rig.user@rig.test' }, ho = { role: 'user', site, email: 'rig.ho.' + tag.toLowerCase() + '@rig.test' };
  await db('POST', 'hr_ho_hr', [{ email: ho.email, active: true, given_by: sup.email, given_at: new Date().toISOString() }], 'return=minimal');
  const emps = (await db('GET', 'hr_employees?select=id,code&site=eq.' + site + '&status=neq.left&order=code&limit=5')) || [], one = emps[0];
  // a leave policy: the site's HR verifies, the HO HR approves
  const lp = await BK.ACT.rbSave(sup, { kind: 'leave', name: 'Leave ' + tag, valid_from: from, body: { earn: 'month', per_month: 1 }, auth: { verify: [{ role: 'site_hr' }], approve: [{ role: 'ho_hr' }] } });
  await BK.ACT.rbAssign(sup, { kind: 'leave', policy_id: lp.id, valid_from: from, employees: [one.id], reason: 'rig' });
  const l0 = await AS.ACT.leaveLedger(adm, { id: one.id }); ok(l0.book === true, 'his leave is walked with the Rule Book');
  await no(AS.ACT.leaveCreditAsk(usr, { id: one.id, days: 2, reason: 'extra' }), 'an HR User cannot ask for extra leave');
  await no(AS.ACT.leaveCreditAsk(adm, { id: one.id, days: 0, reason: 'extra' }), 'zero days'); await no(AS.ACT.leaveCreditAsk(adm, { id: one.id, days: 2, reason: '' }), 'no reason');
  const a = await AS.ACT.leaveCreditAsk(adm, { id: one.id, days: 2, reason: 'worked through Diwali ' + tag }); ok(a.stage === 'verify', 'it waits for "verify" first');
  ok((await AS.ACT.leaveLedger(adm, { id: one.id })).paid === l0.paid, 'nothing is added before it is approved');
  let list = await AS.ACT.askList(ho, { status: 'pending' }); ok(list.rows.find(r => r.id === a.id).can === false, 'the HO HR cannot verify');
  await no(AS.ACT.askDecide(ho, { id: a.id, ok: true }), 'the HO HR cannot do the site HR\'s step');
  list = await AS.ACT.askList(adm, { status: 'pending' }); ok(list.rows.find(r => r.id === a.id).can === true, 'the site\'s HR Admin can verify');
  const v = await AS.ACT.askDecide(adm, { id: a.id, ok: true }); ok(v.status === 'pending' && v.stage === 'approve', 'verified: now it waits for approval');
  await no(AS.ACT.askDecide(adm, { id: a.id, ok: true }), 'the site\'s HR cannot approve'); await no(AS.ACT.askDecide(ho, { id: a.id, ok: false, note: '' }), 'a refusal needs its reason');
  const d = await AS.ACT.askDecide(ho, { id: a.id, ok: true }); ok(d.status === 'approved', 'approved by the HO HR');
  const l1 = await AS.ACT.leaveLedger(adm, { id: one.id }); ok(l1.paid === l0.paid + 2 && l1.ledger.some(x => x.days === 2 && /Diwali/.test(x.text)), 'the 2 days are in his balance and his ledger says why: ' + l0.paid + ' → ' + l1.paid);
  await no(AS.ACT.askDecide(ho, { id: a.id, ok: true }), 'decided once');
  // a refused one adds nothing
  const b = await AS.ACT.leaveCreditAsk(adm, { id: one.id, days: 5, reason: 'refuse me ' + tag }); await AS.ACT.askDecide(adm, { id: b.id, ok: false, note: 'not agreed' });
  ok((await AS.ACT.leaveLedger(adm, { id: one.id })).paid === l1.paid && (await AS.ACT.askList(adm, { status: 'refused' })).rows.some(r => r.id === b.id), 'refused: nothing added, it is in the refused list');
  // comp-off and overtime: counted from the muster, sent, approved → the Comp-off balance
  const co = await BK.ACT.rbSave(sup, { kind: 'compoff', name: 'Comp ' + tag, valid_from: from, body: { result: 'leave', full_shift: false }, auth: { approve: [{ role: 'site_hr' }] } });
  const ot = await BK.ACT.rbSave(sup, { kind: 'overtime', name: 'OT ' + tag, valid_from: from, body: { after_min: 30, round_min: 30, result: 'leave' }, auth: { approve: [{ role: 'site_hr' }] } });
  await BK.ACT.rbDefault(sup, { kind: 'compoff', policy_id: co.id, valid_from: from }); await BK.ACT.rbDefault(sup, { kind: 'overtime', policy_id: ot.id, valid_from: from });
  // the office says: Wednesday the 11th was a day off – who worked on it has a comp-off to be approved
  await BK.ACT.rbDayOff(sup, { day: '2026-11-11', off: true, reason: 'rig: a day off, to count comp-off' });
  const f = await AS.ACT.extraFind(adm, { month: '2026-11' }); ok(f.ready === true && f.rows.some(r => r.kind === 'compoff'), 'the month is counted and has comp-off days'); console.log('found: comp-off', f.rows.filter(r => r.kind === 'compoff').length, '· overtime', f.rows.filter(r => r.kind === 'overtime').length);
  const fresh = f.rows.filter(r => !r.status).slice(0, 3);
  if (fresh.length) {
    const s1 = await AS.ACT.extraAsk(adm, { month: '2026-11', rows: fresh.map(r => ({ employee_id: r.employee_id, day: r.day, kind: r.kind })) }); ok(s1.sent === fresh.length, 'sent for approval: ' + s1.sent);
    await no(AS.ACT.extraAsk(adm, { month: '2026-11', rows: fresh.map(r => ({ employee_id: r.employee_id, day: r.day, kind: r.kind })) }), 'not sent twice');
    const mine = (await AS.ACT.askList(adm, { status: 'pending' })).rows.filter(r => fresh.some(q => q.employee_id === r.employee_id && q.day === r.day && q.kind === r.kind));
    const first = mine[0], before = (await AS.ACT.leaveLedger(adm, { id: first.employee_id })).comp; await AS.ACT.askDecide(adm, { id: first.id, ok: true });
    const after = (await AS.ACT.leaveLedger(adm, { id: first.employee_id })).comp; ok(after === before + (first.body.days || 0), 'approved ' + first.kind + ': his Comp-off balance ' + before + ' → ' + after);
    for (const r of mine.slice(1)) await AS.ACT.askDecide(adm, { id: r.id, ok: false, note: 'rig: not this one' });
  } else console.log('(nothing fresh to send on this rig – every such day was sent in an earlier run)');
  await BK.ACT.rbDayOff(sup, { day: '2026-11-11', off: false, reason: 'rig: a working day, as before' });
  // the rig is left as it was: the site's comp-off / overtime policy taken away, his leave policy too, the 2 days taken back
  await BK.ACT.rbDefault(sup, { kind: 'compoff', policy_id: null, valid_from: from }); await BK.ACT.rbDefault(sup, { kind: 'overtime', policy_id: null, valid_from: from });
  const back = await AS.ACT.leaveCreditAsk(sup, { id: one.id, days: -2, reason: 'rig: taken back ' + tag }); await AS.ACT.askDecide(sup, { id: back.id, ok: true }); await AS.ACT.askDecide(sup, { id: back.id, ok: true }).catch(() => {});
  await BK.ACT.rbAssign(sup, { kind: 'leave', policy_id: null, valid_from: from, employees: [one.id], reason: 'rig back' });
  await db('PATCH', 'hr_ho_hr?email=eq.' + encodeURIComponent(ho.email), { active: false, taken_by: sup.email, taken_at: new Date().toISOString() }, 'return=minimal');
  console.log((n - bad) + ' passed, ' + bad + ' failed');
})().catch(e => { console.log('ERR', e.stack || e.message); process.exit(1); });
