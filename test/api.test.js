// HR – the actions on a REAL database (the LOCAL TEST RIG only – never a live one): PostgreSQL + PostgREST with the SQL steps of
// sql/ applied to a scratch database, behind the rig's door at HR_RIG_URL (default http://127.0.0.1:3140).
//   timeout 120 node --test test/api.test.js          Made-up people only: no real name, number or e-mail.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const RIG = process.env.HR_RIG_URL || 'http://127.0.0.1:3140';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(RIG)) throw new Error('The API test runs only on this computer\'s rig.');
process.env.SUPABASE_URL = RIG; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const { db } = require('../lib/db'), { ACT } = require('../api/hr');
const tag = 'T' + Date.now().toString(36).toUpperCase().slice(-6), SITE = tag, SITE2 = tag + 'B';
const ses = (role, site) => ({ site: site || SITE, email: role + '@rig.test', name: 'Rig ' + role, role: role, info: { sites: [{ code: SITE, name: 'Rig one' }, { code: SITE2, name: 'Rig two' }] } });
const admin = ses('admin'), user = ses('user'), sup = ses('super');
let n = 0; const mob = () => '9' + String(Date.now()).slice(-6) + String(100 + (n++)).slice(-3), mail = k => (k + '.' + tag + '@rig.test').toLowerCase();
const no = async (p, re, status) => { await assert.rejects(p, e => { assert.match(e.message, re); if (status) assert.strictEqual(e.status, status); return true; }); };

test('masters: the HR Admin adds and renames; the same name twice is refused; an HR User cannot', async () => {
  await no(ACT.masterSave(user, { kind: 'department', name: 'Dept ' + tag }), /Only the HR Admin/, 403);
  let m = await ACT.masterSave(admin, { kind: 'department', name: 'Dept ' + tag });
  const d = m.departments.find(x => x.name === 'Dept ' + tag); assert.ok(d && d.active);
  await no(ACT.masterSave(admin, { kind: 'department', name: 'dept ' + tag.toLowerCase() }), /already in the list/, 409);
  m = await ACT.masterSave(admin, { kind: 'department', id: d.id, name: 'Dept ' + tag + ' 2', active: false });
  assert.deepStrictEqual(m.departments.find(x => x.id === d.id), { id: d.id, name: 'Dept ' + tag + ' 2', active: false });
  m = await ACT.masterSave(admin, { kind: 'designation', name: 'Desig ' + tag }); assert.ok(m.designations.some(x => x.name === 'Desig ' + tag));
  const i = await ACT.init(user); assert.deepStrictEqual(i.categories.map(c => c.name), ['Staff', 'Operator', 'Driver', 'Labour']);
});

test('an employee: added with his code; incomplete without DOB / e-mail; a mobile or e-mail of another is refused; changes are written down', async () => {
  const m = await ACT.init(admin), dep = m.departments[0].id, des = m.designations.find(x => x.name === 'Desig ' + tag).id;
  await no(ACT.empSave(user, { name: 'X', category: 'boss' }), /Name: at least 2 letters\. Category: Staff, Operator, Driver or Labour\./, 400);
  await no(ACT.empSave(user, { name: 'Young One', category: 'labour', dob: '2015-01-01' }), /under 18/);
  const m1 = mob(), a = await ACT.empSave(user, { name: 'Asha Rig', category: 'staff', mobile: '+91 ' + m1, email: mail('ASHA'), dob: '05-03-1990', joined_on: '2024-04-01', department_id: dep, designation_id: des });
  assert.match(a.code, /^E\d{5}$/); assert.strictEqual(a.status, 'pending'); assert.deepStrictEqual(a.missing, []);
  const b = await ACT.empSave(user, { name: 'Babu Rig', category: 'Labour', mobile: mob() });
  assert.strictEqual(b.status, 'incomplete'); assert.deepStrictEqual(b.missing, ['Date of birth', 'E-mail']); assert.notStrictEqual(b.code, a.code);
  await no(ACT.empSave(user, { name: 'Copy Rig', category: 'driver', mobile: m1 }), new RegExp('mobile number already belongs to employee ' + a.code), 409);
  await no(ACT.empSave(user, { name: 'Copy Rig', category: 'driver', email: mail('asha') }), new RegExp('e-mail already belongs to employee ' + a.code), 409);
  // completing him: pending; reporting to Asha; the history gets a new row; the audit has old and new
  const b2 = await ACT.empSave(user, { id: b.id, name: 'Babu Rig', category: 'labour', mobile: (await ACT.empGet(user, { id: b.id })).employee.mobile, email: mail('babu'), dob: '1985-12-31', reports_to: a.id });
  assert.strictEqual(b2.status, 'pending'); assert.strictEqual(b2.code, b.code);
  await no(ACT.empSave(user, { id: b.id, name: 'Babu Rig', category: 'labour', reports_to: b.id }), /cannot report to himself/);
  const g = await ACT.empGet(user, { id: b.id });
  assert.strictEqual(g.boss.code, a.code); assert.strictEqual(g.history.length, 2); assert.ok(g.history[1].valid_to && !g.history[0].valid_to);
  const au = await db('GET', 'hr_audit?select=action,target,detail&site=eq.' + SITE + '&target=eq.' + b.code + '&order=id');
  assert.deepStrictEqual(au.map(x => x.action), ['Employee added', 'Employee changed']); assert.deepStrictEqual(au[1].detail.dob, [null, '1985-12-31']); assert.deepStrictEqual(au[1].detail.status, ['incomplete', 'pending']);
  // the list: this site only; search by name, code, mobile; the counts
  let l = await ACT.empList(user, {}); assert.deepStrictEqual(l.rows.map(r => r.name), ['Asha Rig', 'Babu Rig']); assert.deepStrictEqual(l.counts, { incomplete: 0, pending: 2, active: 0, left: 0 });
  assert.deepStrictEqual((await ACT.empList(user, { q: m1.slice(2) })).rows.map(r => r.code), [a.code]);
  assert.deepStrictEqual((await ACT.empList(user, { q: 'babu', category: 'labour' })).rows.map(r => r.code), [b.code]);
  assert.strictEqual((await ACT.empList(ses('user', SITE2), {})).rows.length, 0, 'another site sees nothing of this one');
  await no(ACT.empGet(ses('user', SITE2), { id: a.id }), /not found on this site/, 404);
  assert.deepStrictEqual((await ACT.empPick(user, { q: 'ash' })).rows.map(r => r.code), [a.code]);
});

test('transfer and exit: only the HR Admin; only to a site of his sign-in; the history and the audit keep everything; nothing is deleted', async () => {
  const l = await ACT.empList(admin, {}), a = l.rows[0], b = l.rows[1];
  await no(ACT.empTransfer(user, { id: b.id, site: SITE2 }), /Only the HR Admin/, 403);
  await no(ACT.empTransfer(admin, { id: b.id, site: 'OTHER9' }), /only to a site where you have HR/, 403);
  await no(ACT.empTransfer(admin, { id: b.id, site: SITE2, from: '01-01-2020' }), /before his present posting began/);
  const day = require('../lib/rules').today();
  await ACT.empTransfer(admin, { id: b.id, site: SITE2, from: day, note: 'To site two' });
  assert.strictEqual((await ACT.empList(admin, {})).rows.length, 1); const there = (await ACT.empList(ses('admin', SITE2), {})).rows; assert.deepStrictEqual(there.map(r => r.code), [b.code]);
  const h = (await ACT.empGet(ses('admin', SITE2), { id: b.id })).history; assert.deepStrictEqual([h[0].site, h[0].valid_from, h[0].note, h[0].valid_to], [SITE2, day, 'To site two', null]);
  await no(ACT.empExit(user, { id: a.id, on: day, reason: 'Resigned' }), /Only the HR Admin/, 403);
  await no(ACT.empExit(admin, { id: a.id, on: '2020-01-01', reason: 'Resigned' }), /before the joining date/);
  await no(ACT.empExit(admin, { id: a.id, on: day, reason: '' }), /write the reason/);
  await ACT.empExit(admin, { id: a.id, on: day, reason: 'Resigned' });
  const g = await ACT.empGet(admin, { id: a.id }); assert.deepStrictEqual([g.employee.status, g.employee.left_on, g.employee.left_reason], ['left', day, 'Resigned']);
  assert.strictEqual((await ACT.empList(admin, {})).rows.length, 0, 'not in the usual list'); assert.deepStrictEqual((await ACT.empList(admin, { status: 'left' })).rows.map(r => r.code), [a.code]);
  await no(ACT.empSave(admin, { id: a.id, name: 'Asha Rig', category: 'staff' }), /has left/);
  assert.strictEqual((await db('GET', 'hr_employees?select=id&id=in.(' + a.id + ',' + b.id + ')')).length, 2, 'both rows are still there');
});

test('import: faults come back with their line and are not saved; missing DOB / e-mail = incomplete; doubles are refused; masters are made', async () => {
  const s = ses('user', tag + 'I'), m = [mob(), mob(), mob()];
  const rows = [
    { name: 'Imp One', category: 'Operator', mobile: m[0], email: mail('imp1'), dob: '01/02/1988', joined_on: 45000, department: 'ImpDept ' + tag, designation: 'ImpDes ' + tag },
    { name: 'Imp Two', category: 'driver', mobile: m[1] },
    { name: 'Imp Bad', category: 'pilot', mobile: '123' },
    { name: 'Imp Double', category: 'labour', mobile: m[0] },
    { name: 'Imp Three', category: 'Labor', mobile: m[2], email: mail('imp3'), dob: '1979-07-15', department: 'impdept ' + tag.toLowerCase() },
  ];
  const c = await ACT.empImport(s, { rows: rows, check: 1 });
  assert.deepStrictEqual([c.checked, c.saved, c.rows, c.faults, c.toSave, c.incomplete], [true, 0, 5, 2, 3, 1]);
  assert.deepStrictEqual(c.lines.map(x => x.line), [4, 5]); assert.match(c.lines[0].why, /Category: .* Mobile: a 10-digit/); assert.match(c.lines[1].why, /twice in the file \(line 2\)/);
  assert.strictEqual((await ACT.empList(s, {})).rows.length, 0, 'a check saves nothing');
  const r = await ACT.empImport(s, { rows: rows });
  assert.deepStrictEqual([r.saved, r.faults, r.incomplete], [3, 2, 1]); assert.deepStrictEqual(r.made, ['department: ImpDept ' + tag, 'designation: ImpDes ' + tag], 'a master is made once, whatever the letters\' case');
  const l = await ACT.empList(s, {}); assert.deepStrictEqual(l.rows.map(x => [x.name, x.category, x.status]), [['Imp One', 'operator', 'pending'], ['Imp Three', 'labour', 'pending'], ['Imp Two', 'driver', 'incomplete']]);
  assert.strictEqual(l.rows[0].joined_on, '2023-03-15'); assert.strictEqual(l.rows[0].department_id, l.rows[1].department_id);
  const codes = l.rows.map(x => +x.code.slice(1)).sort((a, b) => a - b); assert.deepStrictEqual(codes, [codes[0], codes[0] + 1, codes[0] + 2], 'codes in a row, none twice');
  const again = await ACT.empImport(s, { rows: rows }); assert.strictEqual(again.saved, 0, 'the same file again adds nobody'); assert.strictEqual(again.faults, 5);
  await no(ACT.empImport(s, { rows: [] }), /no rows/); await no(ACT.empImport(s, { rows: new Array(1001).fill({ name: 'x' }) }), /At most 1000/);
});
