// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 150 node test/rig/rulebook_opening.js
// The opening leave balance of many people from one sheet: looked at first, one request for the whole file, credited when approved, never twice.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const AK = require('../../lib/act_asks'), { db } = require('../../lib/db'), { execSync } = require('child_process');
const sql = q => execSync('timeout 20 su postgres -c "psql -d rig_hr -tA -q"', { input: q }).toString().trim();      // the rig's own database only: to put it back as it was
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } }, no = async (p, t) => { try { await p; ok(false, t + ' (was allowed)'); } catch (e) { ok(e.status >= 400 && e.status < 500, t + ' → ' + e.status + ' ' + e.message); } };
  const site = 'DEMOBKTX2', tag = 'o' + Date.now(), sup = { role: 'super', site, email: 'rig.super@rig.test' }, adm = { role: 'admin', site, email: 'rig.admin@rig.test' }, usr = { role: 'user', site, email: 'rig.user.' + tag + '@rig.test' };
  const has = {}; ((await db('GET', 'hr_leave_credits?select=employee_id&site=eq.' + site + '&source=eq.opening&limit=5000')) || []).forEach(c => { has[c.employee_id] = 1; });
  const emps = ((await db('GET', 'hr_employees?select=id,code,status&site=eq.' + site + '&status=neq.left&order=code')) || []).filter(e => !has[e.id]), a = emps[0], b = emps[1], c = emps[2];
  const before = +sql("select count(*) from hr_leave_credits where site='" + site + "'");
  const rows = [{ code: a.code, paid: 5, comp: 1.5 }, { code: ' ' + b.code.toLowerCase() + ' ', paid: '2', comp: '' }, { code: c.code, paid: 0, comp: '' }, { code: 'NOSUCH99', paid: 1 }, { code: a.code, paid: 3 }, { code: emps[3].code, paid: 'abc' }, { code: emps[4].code, paid: 1.3 }, { code: '', paid: 4 }];
  const look = await AK.ACT.leaveOpening(adm, { rows: rows, dry: true });
  ok(look.dry === true && look.people === 2 && look.paid === 7 && look.comp === 1.5, 'looked at: 2 people, paid 7, comp-off 1.5'); ok(look.skipped === 2, 'an empty code and a row of zeros are simply skipped: ' + look.skipped);
  ok(look.refusedCount === 4 && ['not on this site', 'twice', 'half days', 'half days'].every((w, i) => look.refused[i].why.indexOf(w) > -1), 'refused with the reason: ' + look.refused.map(r => r.why).join(' | '));
  ok(+sql("select count(*) from hr_leave_credits where site='" + site + "'") === before && ((await db('GET', 'hr_asks?select=id&site=eq.' + site + '&asked_by=eq.' + adm.email + '&kind=eq.leave_credit&status=eq.pending&body->>reason=eq.' + tag)) || []).length === 0, 'looking keeps nothing');
  await no(AK.ACT.leaveOpening(adm, { rows: rows }), 'no reason for the file'); await no(AK.ACT.leaveOpening(adm, { rows: [] , reason: 'x y z' }), 'an empty sheet');
  await no(AK.ACT.leaveOpening(usr, { rows: rows, dry: true }), 'an HR User'); await no(AK.ACT.leaveOpening({ role: 'self', site, email: 'x@rig.test' }, { rows: rows, dry: true }), '"My HR"');
  await no(AK.ACT.leaveOpening(adm, { rows: rows, reason: 'x y z', day: '2099-01-01' }), 'a day to come');
  const sent = await AK.ACT.leaveOpening(adm, { rows: rows, reason: tag, file_name: 'opening.xlsx', day: '2026-11-01' }); ok(sent.waits === true && sent.id > 0 && sent.people === 2, 'sent: ONE request for the whole file waits (' + sent.stage + ')');
  ok(+sql("select count(*) from hr_leave_credits where site='" + site + "'") === before, 'nothing is added before the approval');
  const again = await AK.ACT.leaveOpening(adm, { rows: rows, dry: true }); ok(again.people === 0 && again.refused.some(r => /waits for approval/.test(r.why)), 'the same people again: refused – it waits already');
  const list = await AK.ACT.askList(sup, { status: 'pending' }), row = list.rows.find(r => r.id === sent.id); ok(row && row.body.opening === true && row.body.people === 2 && row.body.rows === undefined && row.name === '', 'in Approvals: one line for 2 people, without the list of people in it');
  let st = { status: 'pending' }; for (let i = 0; i < 2 && st.status === 'pending'; i++) st = await AK.ACT.askDecide(sup, { id: sent.id, ok: true }); ok(st.status === 'approved', 'approved');
  const cr = (await db('GET', 'hr_leave_credits?select=employee_id,bucket,days,source,day,reason&ask_id=eq.' + sent.id + '&order=id')) || [];
  ok(cr.length === 3 && cr.every(x => x.source === 'opening' && x.day === '2026-11-01' && x.reason === 'Opening balance'), 'three lines are added, all "opening balance" as of the day given');
  ok(cr.filter(x => x.employee_id === a.id).map(x => x.bucket + (+x.days)).sort().join() === 'comp1.5,paid5' && cr.filter(x => x.employee_id === b.id).map(x => x.bucket + (+x.days)).join() === 'paid2', 'each person got his own days');
  const led = await AK.ACT.leaveLedger(sup, { id: a.id }); ok(JSON.stringify(led).indexOf('Opening balance') > -1, 'his ledger says "Opening balance"');
  const third = await AK.ACT.leaveOpening(adm, { rows: rows, dry: true }); ok(third.people === 0 && third.refused.some(r => /already/.test(r.why)), 'a second file for them: refused – no balance twice');
  // the rig goes back as it was (the rig's own database only)
  sql('delete from hr_leave_credits where ask_id=' + sent.id + '; delete from hr_asks where id=' + sent.id + ';'); ok(+sql("select count(*) from hr_leave_credits where site='" + site + "'") === before, '(the rig is as before)');
  console.log(n - bad + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('STOPPED', e && e.stack || e); process.exit(1); });
