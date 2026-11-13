// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 150 node test/rig/rulebook_import.js
// A bulk correction: only in the person's favour, the punches untouched, every changed day a new entry; with an attendance policy that names approvers it waits.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const IM = require('../../lib/act_import'), M = require('../../lib/act_muster'), BK = require('../../lib/act_rulebook'), AS = require('../../lib/act_asks'), { db } = require('../../lib/db');
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } }, no = async (p, t) => { try { await p; ok(false, t + ' (was allowed)'); } catch (e) { ok(e.status >= 400 && e.status < 500, t + ' → ' + e.message); } };
  const site = 'DEMOBKTX2', month = '2026-11', tag = 'I' + Date.now(), sup = { role: 'super', site, email: 'rig.super@rig.test' }, adm = { role: 'admin', site, email: 'rig.admin@rig.test' }, usr = { role: 'user', site, email: 'rig.user@rig.test' };
  const mus = async () => (await M.ACT.muster(sup, { month })).rows, day = i => month + '-' + String(i + 1).padStart(2, '0');
  const a = await mus(), cells = []; a.forEach(w => w.codes.forEach((c, i) => cells.push({ code: w.code, id: w.id, day: day(i), was: c })));
  const abs = cells.filter(c => c.was === 'A' || c.was === 'L'), pres = cells.filter(c => c.was === 'P'), off = cells.filter(c => c.was === 'WO'); console.log('absent days on the rig:', abs.length, '· present:', pres.length);
  if (abs.length < 4) { console.log('(not enough absent days left on this rig to test with)'); return; }
  const punches0 = ((await db('GET', 'hr_punches?select=id&site=eq.' + site + '&limit=1', undefined, 'count=exact')) || []).length, pc = async () => (await db('GET', 'hr_punches?select=id&site=eq.' + site + '&day=gte.' + month + '-01&limit=5000')).length, p0 = await pc();
  const rows = [{ code: abs[0].code, day: abs[0].day, to: 'P', reason: 'was on site – ' + tag }, { code: abs[1].code, day: abs[1].day, to: 'hd' }, { code: abs[2].code, day: abs[2].day, to: abs[2].was },
    { code: pres[0].code, day: pres[0].day, to: 'A' }, { code: pres[1].code, day: pres[1].day, to: 'HD' }, { code: 'NOBODY', day: day(3), to: 'P' }, { code: abs[0].code, day: '2026-12-01', to: 'P' }, { code: pres[2].code, day: pres[2].day, to: '' }].concat(off.length ? [{ code: off[0].code, day: off[0].day, to: 'P' }] : []);
  await no(IM.ACT.attImport(usr, { month, rows, reason: 'x' }), 'an HR User cannot import');
  const dry = await IM.ACT.attImport(adm, { month, rows, dry: true }); ok(dry.dry && dry.changes.length === 2 && dry.skipped === 2, 'looked at: 2 can be set right, 2 skipped (the same / empty)');
  ok(dry.refused.length === (off.length ? 5 : 4) && dry.refused.every(r => r.why), 'refused with why: ' + dry.refused.map(r => r.why).join(' | ').slice(0, 220));
  ok(JSON.stringify(await mus()) === JSON.stringify(a), 'looking changes nothing');
  await no(IM.ACT.attImport(adm, { month, rows, reason: '' }), 'one reason for the whole file is compulsory');
  await no(IM.ACT.attImport(adm, { month, rows: [{ code: pres[0].code, day: pres[0].day, to: 'A' }], reason: 'against him' }), 'a file with nothing in the person\'s favour');
  const done = await IM.ACT.attImport(adm, { month, rows, reason: 'November set right ' + tag, file_name: 'nov.xlsx' }); ok(done.waits === false && done.changed === 2, 'applied at once (no attendance policy names an approver): ' + done.changed + ' days');
  const b = await mus(), at = (list, c) => list.find(w => w.id === c.id).codes[+c.day.slice(8) - 1];
  ok(at(b, abs[0]) === 'P' && at(b, abs[1]) === 'HD', 'the two days: ' + abs[0].was + ' → ' + at(b, abs[0]) + ', ' + abs[1].was + ' → ' + at(b, abs[1])); ok(at(b, abs[2]) === abs[2].was && at(b, pres[0]) === 'P' && at(b, pres[1]) === 'P', 'the refused ones are as they were');
  ok(await pc() === p0, 'no punch was added, changed or removed'); const ent = (await db('GET', 'hr_day_entries?select=id,reason,source,old_in&employee_id=eq.' + abs[0].id + '&day=eq.' + abs[0].day + '&order=id.desc&limit=1'))[0];
  ok(ent && /was on site/.test(ent.reason) && /bulk correction #/.test(ent.reason), 'the day has a new entry with its own reason: ' + (ent && ent.reason)); ok((await IM.ACT.attImports(adm)).rows[0].changed === 2, 'the import is in the list');
  await no(IM.ACT.attImport(adm, { month, rows: rows.slice(0, 2), reason: 'again' }), 'the same file again: nothing left to set right');
  // with an attendance policy that names who approves, a file waits – and is applied when approved
  const more = abs[3];
  const pol = await BK.ACT.rbSave(sup, { kind: 'attendance', name: 'Att ' + tag, valid_from: '2026-11-01', body: {}, auth: { approve: [{ role: 'ho_hr' }] } }); await BK.ACT.rbDefault(sup, { kind: 'attendance', policy_id: pol.id, valid_from: '2026-11-01' });
  const w = await IM.ACT.attImport(adm, { month, rows: [{ code: more.code, day: more.day, to: 'P' }], reason: 'waits ' + tag }); ok(w.waits === true && w.stage === 'approve', 'it waits for approval'); ok(at(await mus(), more) === more.was, 'nothing is changed while it waits');
  const ask = (await AS.ACT.askList(sup, { status: 'pending' })).rows.find(r => r.kind === 'att_import' && r.body.reason === 'waits ' + tag); await no(AS.ACT.askDecide(adm, { id: ask.id, ok: true }), 'the site\'s HR cannot approve its own file');
  await AS.ACT.askDecide(sup, { id: ask.id, ok: true }); ok(at(await mus(), more) === 'P', 'approved: the day is present');
  await BK.ACT.rbDefault(sup, { kind: 'attendance', policy_id: null, valid_from: '2026-11-01' });
  console.log((n - bad) + ' passed, ' + bad + ' failed');
})().catch(e => { console.log('ERR', e.stack || e.message); process.exit(1); });
