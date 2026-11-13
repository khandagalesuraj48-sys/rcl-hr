// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 150 node test/rig/rulebook_leave_files.js
// The papers of a leave request: never compulsory, attached by the person or the HR office, seen only by them and the reporting person, never deleted.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const LF = require('../../lib/act_leave_files'), LV = require('../../lib/act_leave'), { db } = require('../../lib/db');
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } }, no = async (p, t) => { try { await p; ok(false, t + ' (was allowed)'); } catch (e) { ok(e.status >= 400 && e.status < 500, t + ' → ' + e.status + ' ' + e.message); } };
  const site = 'DEMOBKTX2', tag = 'f' + Date.now(), adm = { role: 'admin', site, email: 'rig.admin@rig.test' }, far = { role: 'admin', site: 'NOSUCHSITE', email: 'rig.far@rig.test' };
  const F = 'id,code,email,reports_to', emp = ((await db('GET', 'hr_employees?select=' + F + '&site=eq.' + site + '&status=neq.left&email=neq.&order=code.desc&limit=1')) || [])[0];
  // a second person of the rig with a sign-in: a made-up rig address, given once (the rig's own employee – nobody real)
  let other = ((await db('GET', 'hr_employees?select=' + F + '&site=eq.' + site + '&email=eq.rig.other@rig.test&limit=1')) || [])[0];
  if (!other) { const free = ((await db('GET', 'hr_employees?select=id&site=eq.' + site + '&status=neq.left&email=eq.&id=neq.' + emp.id + '&order=code&limit=1')) || [])[0]; other = (await db('PATCH', 'hr_employees?id=eq.' + free.id, { email: 'rig.other@rig.test' }, 'return=representation'))[0]; }
  const self = { role: 'self', site, email: emp.email }, self2 = { role: 'self', site, email: other.email };
  const day = new Date(Date.now() + (400 + Math.floor(Math.random() * 300)) * 86400000).toISOString().slice(0, 10);
  const q = (await db('POST', 'hr_leave_requests', [{ employee_id: emp.id, site, from_day: day, to_day: day, part: 'full', days: 1, reason: 'rig papers ' + tag, level: 2, asked_by: emp.email }], 'return=representation'))[0];
  const pdf = Buffer.from('%PDF-1.4 rig ' + tag), send = async (who, act, type, body) => { const u = await LF.ACT[act + 'Url'](who, { request: q.id, type: type, bytes: body.length }); const r = await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': type, 'x-upsert': 'false' }, body: body, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('PUT ' + r.status); return LF.ACT[act + 'Add'](who, { request: q.id, path: u.path, name: 'note.pdf', bytes: body.length }); };
  const l0 = await LF.ACT.myLeaveFiles(self, { request: q.id }); ok(l0.files.length === 0 && l0.canAdd === true && l0.max === 5, 'a request starts with no paper – none is needed');
  await no(LF.ACT.myLeaveFileUrl(self, { request: q.id, type: 'application/zip', bytes: 10 }), 'a zip file');
  await no(LF.ACT.myLeaveFileUrl(self, { request: q.id, type: 'application/pdf', bytes: 11 * 1048576 }), 'an 11 MB file');
  await no(LF.ACT.myLeaveFileAdd(self, { request: q.id, path: 'leave/' + other.id + '/' + 'a'.repeat(24) + '.pdf', bytes: 10 }), 'a file of another person\'s folder');
  await no(LF.ACT.myLeaveFileAdd(self, { request: q.id, path: 'leave/' + emp.id + '/' + 'b'.repeat(24) + '.pdf', bytes: 10 }), 'a file that never arrived');
  const a1 = await send(self, 'myLeaveFile', 'application/pdf', pdf); ok(a1.ok && a1.id > 0, 'the person attaches a PDF');
  const l1 = await LF.ACT.myLeaveFiles(self, { request: q.id }); ok(l1.files.length === 1 && l1.files[0].canRemove === true && l1.files[0].name === 'note.pdf', 'he sees it and may remove his own while the request waits');
  const mine = await LV.ACT.myLeave(self); ok((mine.requests.find(r => r.id === q.id) || {}).files === 1, 'his list of requests says: 1 paper');
  const k1 = await LF.ACT.myLeaveFileLink(self, { file: a1.id }), got = await fetch(k1.url, { signal: AbortSignal.timeout(15000) }); ok(got.ok && Buffer.from(await got.arrayBuffer()).equals(pdf), 'the link opens the very file');
  // nobody else: another employee (unless he is the reporting person), another site's office
  const boss = emp.reports_to === other.id;
  if (!boss) { await no(LF.ACT.myLeaveFiles(self2, { request: q.id }), 'another employee looks at the papers'); await no(LF.ACT.myLeaveFileLink(self2, { file: a1.id }), 'another employee opens the paper'); }
  await no(LF.ACT.myLeaveFileUrl(self2, { request: q.id, type: 'application/pdf', bytes: 10 }), 'another employee attaches to it');
  await no(LF.ACT.leaveFiles(far, { request: q.id }), 'the office of another site'); await no(LF.ACT.leaveFileLink(far, { file: a1.id }), 'the office of another site opens it');
  await no(LF.ACT.leaveFiles(self, { request: q.id }), 'the office\'s action by "My HR"');
  // the HR office of the site
  const o1 = await LF.ACT.leaveFiles(adm, { request: q.id }); ok(o1.files.length === 1 && o1.files[0].canRemove === true, 'the HR office of the site sees it');
  const a2 = await send(adm, 'leaveFile', 'image/png', Buffer.from('png ' + tag)); ok(a2.ok, 'the HR office attaches one too');
  await no(LF.ACT.myLeaveFileRemove(self, { file: a2.id }), 'the person removes the office\'s paper');
  for (let i = 0; i < 3; i++) await send(self, 'myLeaveFile', 'image/jpeg', Buffer.from('jpg ' + i + tag));
  await no(LF.ACT.myLeaveFileUrl(self, { request: q.id, type: 'application/pdf', bytes: 10 }), 'a sixth paper');
  await LF.ACT.myLeaveFileRemove(self, { file: a1.id }); const l2 = await LF.ACT.myLeaveFiles(self, { request: q.id }); ok(l2.files.length === 4 && !l2.files.some(f => f.id === a1.id), 'he removes his own: 4 left');
  const kept = (await db('GET', 'hr_leave_files?select=id,removed_by,removed_at&id=eq.' + a1.id))[0]; ok(kept && kept.removed_by === emp.email && kept.removed_at, 'the removed paper stays in the record with who and when');
  await no(LF.ACT.myLeaveFileLink(self, { file: a1.id }), 'opening a removed paper');
  // decided: the person adds (afterwards is allowed) but removes no more; the office removes
  await db('PATCH', 'hr_leave_requests?id=eq.' + q.id, { status: 'refused', decided_at: new Date().toISOString() }, 'return=minimal');
  const mineLeft = l2.files.find(f => f.added_by === emp.email); await no(LF.ACT.myLeaveFileRemove(self, { file: mineLeft.id }), 'removing after the decision');
  await LF.ACT.leaveFileRemove(adm, { file: mineLeft.id }); const a3 = await send(self, 'myLeaveFile', 'application/pdf', Buffer.from('%PDF late ' + tag)); ok(a3.ok, 'a paper can be attached after the decision too');
  // taken back: nothing more
  await db('PATCH', 'hr_leave_requests?id=eq.' + q.id, { status: 'cancelled' }, 'return=minimal');
  await no(LF.ACT.myLeaveFileUrl(self, { request: q.id, type: 'application/pdf', bytes: 10 }), 'attaching to a request taken back');
  const c = await LF.counts([q.id, 999999999]); ok(c[q.id] === 4 && !c[999999999], 'the count: ' + c[q.id]);
  console.log(n - bad + ' of ' + n + ' pass'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('STOPPED', e && e.stack || e); process.exit(1); });
