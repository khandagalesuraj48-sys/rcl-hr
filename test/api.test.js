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

// a made-up Aadhaar-like number with a right check digit (not a real person's): tried until the rule accepts it
const R2 = require('../lib/rules'); const fakeAadhaar = seed => { for (let i = 0; i < 10; i++) { const a = String(seed) + i; if (R2.aadhaar(a)) return a; } throw new Error('no check digit'); };

test('his own details: Aadhaar checked and shown whole only to the Admin; one Aadhaar / PAN = one employee; the record never holds the number', async () => {
  const s = ses('user', tag + 'K'), sa = ses('admin', tag + 'K');
  const a = await ACT.empSave(s, { name: 'Kyc One', category: 'driver', mobile: mob() }), b = await ACT.empSave(s, { name: 'Kyc Two', category: 'staff', mobile: mob() });
  const aad = fakeAadhaar('9' + String(Date.now()).slice(-10)), panNo = 'ABCDE' + String(Date.now()).slice(-4) + 'F';
  await no(ACT.privSave(s, { id: a.id, aadhaar: aad.slice(0, 11) + ((+aad[11] + 1) % 10), pan: 'bad', mobile2: '12', family_mobile: '13' }), /Aadhaar: 12 digits.*PAN: 10 letters.*Second mobile.*Family member's mobile/, 400);
  await ACT.privSave(s, { id: a.id, aadhaar: aad.replace(/(\d{4})(\d{4})/, '$1 $2 '), pan: panNo.toLowerCase(), mobile2: mob(), family_name: 'Kyc Parent', family_relation: 'Father', family_mobile: mob(), address_current: 'Camp, Rig Road', address_permanent: 'Village Rig' });
  let g = await ACT.privGet(s, { id: a.id });
  assert.deepStrictEqual([g.personal.aadhaar, g.personal.aadhaar_mask, g.personal.pan, g.personal.family_relation, g.personal.address_current], ['', 'XXXX XXXX ' + aad.slice(-4), panNo, 'father', 'Camp, Rig Road'], 'an HR User sees the Aadhaar only as a mask');
  assert.strictEqual((await ACT.privGet(sa, { id: a.id })).personal.aadhaar, aad, 'the HR Admin sees it whole');
  assert.deepStrictEqual(g.docsMissing, ['Photo', 'Aadhaar card', 'PAN card', 'Driving licence', 'Bank passbook / cancelled cheque'], 'a driver: the licence is expected');
  // the User changes the address and leaves the Aadhaar box as it was: the number is kept
  await ACT.privSave(s, { id: a.id, aadhaar: 'XXXX XXXX ' + aad.slice(-4), pan: panNo, address_current: 'New camp' });
  assert.strictEqual((await ACT.privGet(sa, { id: a.id })).personal.aadhaar, aad);
  await no(ACT.privSave(s, { id: b.id, aadhaar: aad }), new RegExp('This Aadhaar already belongs to employee ' + a.code), 409);
  await no(ACT.privSave(s, { id: b.id, pan: panNo }), new RegExp('This PAN already belongs to employee ' + a.code), 409);
  const au = await db('GET', 'hr_audit?select=action,detail&site=eq.' + s.site + '&action=eq.Employee%20details%20changed&order=id');
  assert.strictEqual(au.length, 2); assert.deepStrictEqual(au[0].detail.aadhaar, ['…', '…' + aad.slice(-4)]); assert.ok(!JSON.stringify(au).includes(aad) && !JSON.stringify(au).includes(panNo), 'never the whole number');
  assert.ok(!JSON.stringify((await ACT.empList(s, {})).rows).includes(aad), 'not in the list');
  await no(ACT.privGet(ses('admin', tag + 'Z'), { id: a.id }), /not found on this site/, 404);
});

test('his papers: sent to the private store, opened by a short link; pay papers only by the Admin; removed = kept with who and why', async () => {
  const s = ses('user', tag + 'K'), sa = ses('admin', tag + 'K'), a = (await ACT.empList(s, { q: 'Kyc One' })).rows[0];
  await no(ACT.docUploadUrl(s, { id: a.id, kind: 'licence', type: 'application/zip', bytes: 10 }), /Only a photo .* or a PDF/); await no(ACT.docUploadUrl(s, { id: a.id, kind: 'licence', type: 'application/pdf', bytes: 11 * 1048576 }), /at most 10 MB/);
  await no(ACT.docUploadUrl(s, { id: a.id, kind: 'passport', type: 'application/pdf', bytes: 10 }), /what kind of paper/);
  const put = async (kind, extra) => { const body = Buffer.from('%PDF-1.4 rig ' + kind), u = await ACT.docUploadUrl(s, { id: a.id, kind: kind, type: 'application/pdf', bytes: body.length });
    assert.match(u.path, new RegExp('^' + a.id + '/[0-9a-f]{24}\\.pdf$')); const r = await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body }); assert.ok(r.ok, 'the file is taken: ' + r.status);
    return ACT.docAdd(s, Object.assign({ id: a.id, kind: kind, path: u.path, bytes: body.length }, extra || {})); };
  const lic = await put('licence', { number: 'mh12 2020 0001234', expires_on: '31-12-2030', title: 'Heavy vehicle' }), slip = await put('salary_slip');
  await no(ACT.docAdd(s, { id: a.id, kind: 'pan', path: a.id + '/' + 'a'.repeat(24) + '.pdf', bytes: 10 }), /did not arrive/); await no(ACT.docAdd(s, { id: a.id, kind: 'pan', path: 'other/' + 'a'.repeat(24) + '.pdf', bytes: 10 }), /does not belong to this employee/);
  let l = await ACT.docList(s, { id: a.id });
  assert.deepStrictEqual(l.docs.map(d => [d.kind, d.number, d.expires_on, d.canOpen]).sort(), [['licence', 'MH12 2020 0001234', '2030-12-31', true], ['salary_slip', '', null, false]]);
  assert.ok(l.docsMissing.indexOf('Driving licence') < 0 && l.docsMissing.indexOf('PAN card') > -1);
  const link = await ACT.docLink(s, { doc: lic.id }); assert.strictEqual(await (await fetch(link.url)).text(), '%PDF-1.4 rig licence', 'the link gives the file');
  await no(ACT.docLink(s, { doc: slip.id }), /Only the HR Admin or the Super Admin opens the pay papers/, 403); assert.ok((await ACT.docLink(sa, { doc: slip.id })).url);
  await no(ACT.docLink(ses('admin', tag + 'Z'), { doc: lic.id }), /not found on this site/, 404);
  await no(ACT.docRemove(s, { doc: lic.id, reason: 'Wrong file' }), /Only the HR Admin/, 403); await no(ACT.docRemove(sa, { doc: lic.id, reason: '' }), /write why/);
  await ACT.docRemove(sa, { doc: lic.id, reason: 'Wrong file' }); await no(ACT.docLink(sa, { doc: lic.id }), /not found/, 404);
  l = await ACT.docList(sa, { id: a.id }); const gone = l.docs.find(d => d.id === lic.id);
  assert.deepStrictEqual([gone.active, gone.removed_by, gone.removed_reason, gone.canOpen], [false, 'admin@rig.test', 'Wrong file', false], 'the row stays'); assert.ok(l.docsMissing.indexOf('Driving licence') > -1);
  assert.deepStrictEqual((await db('GET', 'hr_audit?select=action&site=eq.' + s.site + '&action=like.Paper*&order=id')).map(x => x.action), ['Paper attached', 'Paper attached', 'Paper opened', 'Paper opened', 'Paper removed']);
});

/* ───────────── step 4: attendance (made-up people and places) ───────────── */
const HQ = { lat: 18.5204, lng: 73.8567 };      // a point of a map – nobody's place
const self = (email, site) => ({ site: site || SITE, email: email, name: 'Rig self', role: 'self', info: { sites: [] } });
const cid = () => require('crypto').randomBytes(12).toString('hex');
const selfie = async (s, c) => { const u = await ACT.selfieUrl(s, { client_id: c }); if (u.there) throw new Error('the photo is there already'); const r = await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) }); assert.ok(r.ok, 'the photo is taken: ' + r.status); return c; };
const P = (over) => Object.assign({ kind: 'in', lat: HQ.lat, lng: HQ.lng, accuracy_m: 12, device: { id: 'rig-phone-' + tag + '-1', model: 'Rig Phone', os: 'Android 15' } }, over);
let E1, E2, mail1, mail2, placeId;

test('work places: only the HR Admin; a circle, an area, along the road; for whom; many at once; a removed place stays for its punches', async () => {
  mail1 = mail('p1'); mail2 = mail('p2');
  E1 = await ACT.empSave(user, { name: 'Punch One', category: 'staff', mobile: mob(), email: mail1, dob: '1991-01-01' });
  E2 = await ACT.empSave(user, { name: 'Punch Two', category: 'labour', mobile: mob(), email: mail2, dob: '1992-02-02' });
  await no(ACT.placeSave(user, { name: 'X' }), /Only the HR Admin/, 403); await no(ACT.placeList(self(mail1)), /HR office only/, 403);
  await no(ACT.placeSave(admin, { name: 'O', radius_m: 5 }), /Name: at least 2 letters\. Place it on the map.*Radius: 20 to 5000 metres\./, 400);
  let l = await ACT.projSave(admin, { name: 'Project ' + tag }); const proj = l.projects[0]; await no(ACT.projSave(admin, { name: 'project ' + tag.toLowerCase() }), /already in the list/, 409);
  l = await ACT.placeSave(admin, { name: 'Office ' + tag, kind: 'office', lat: HQ.lat, lng: HQ.lng, radius_m: 150, project_id: proj.id, valid_from: '2026-01-01' }); placeId = l.id;
  assert.deepStrictEqual([l.places.length, l.places[0].scope, l.places[0].radius_m, l.places[0].project_id], [1, 'all', 150, proj.id]);
  await no(ACT.placeSave(admin, { name: 'office ' + tag.toLowerCase(), lat: 1, lng: 1, radius_m: 100 }), /already there/, 409);
  await no(ACT.placeSave(admin, { name: 'Camp ' + tag, lat: 18.6, lng: 73.9, radius_m: 100, scope: 'people', people: [] }), /choose at least one employee/);
  l = await ACT.placeSave(admin, { name: 'Camp ' + tag, kind: 'camp', lat: 18.6, lng: 73.9, radius_m: 100, scope: 'people', people: [E2.id], valid_from: '2026-01-01' }); const camp = l.id;
  assert.deepStrictEqual(l.places.find(p => p.id === camp).people, [E2.id]);
  l = await ACT.placeSave(admin, { name: 'Road ' + tag, shape: 'corridor', points: [[18.70, 73.80], [18.70, 73.90]], radius_m: 60, scope: 'category', scope_values: ['labour'], valid_from: '2026-01-01' }); const road = l.id;
  l = await ACT.placeSave(admin, { name: 'Yard ' + tag, shape: 'polygon', points: [[18.80, 73.80], [18.80, 73.81], [18.81, 73.81], [18.81, 73.80]], valid_from: '2026-01-01' }); const yard = l.id;
  // many at once
  await no(ACT.placeBulk(admin, { ids: [placeId, yard], radius_m: 300 }), /cannot be set for an area drawn/);
  await no(ACT.placeBulk(admin, { ids: [placeId, camp] }), /Nothing to change/);
  l = await ACT.placeBulk(admin, { ids: [camp, road], radius_m: 250, scope: 'all' }); assert.strictEqual(l.changed, 2);
  assert.deepStrictEqual(l.places.filter(p => p.id === camp || p.id === road).map(p => [p.radius_m, p.scope, p.people.length]), [[250, 'all', 0], [250, 'all', 0]]);
  l = await ACT.placeImport(admin, { rows: [{ name: 'Gate A ' + tag, lat: 18.9, lng: 73.9, radius_m: 80 }, { name: 'Gate A ' + tag, lat: 18.9, lng: 73.9, radius_m: 80 }, { name: 'Gate C ' + tag, lat: 99, lng: 73.9, radius_m: 80 }] });
  assert.deepStrictEqual([l.saved, l.lines.map(x => x.line)], [0, [2, 3]], 'all or none');
  l = await ACT.placeImport(admin, { rows: [{ name: 'Gate A ' + tag, lat: 18.9, lng: 73.9, radius_m: 80 }, { name: 'Gate B ' + tag, lat: 18.91, lng: 73.9, radius_m: 80 }] }); assert.strictEqual(l.saved, 2);
  await no(ACT.placeRemove(admin, { id: yard, reason: '' }), /write why/); l = await ACT.placeRemove(admin, { id: yard, reason: 'Work over' });
  assert.ok(!l.places.some(p => p.id === yard)); assert.strictEqual((await db('GET', 'hr_places?select=removed_by,active&id=eq.' + yard))[0].removed_by, 'admin@rig.test', 'the row stays');
  await no(ACT.placeSave(ses('admin', SITE2), { id: placeId, name: 'Stolen', lat: 1, lng: 1, radius_m: 100 }), /not found on this site/, 404);
});

test('a punch: himself only, inside only, with a photo, IN then OUT, sent twice kept once; Developer Options / made-up location refused', async () => {
  const s1 = self(mail1);
  await no(ACT.myAttend(self(mail('nobody'))), /not in the Employee Master/, 403);
  let a = await ACT.myAttend(s1, { device_id: P().device.id });
  assert.deepStrictEqual([a.employee.code, a.may, a.phone, a.next, a.punches.length, a.day], [E1.code, true, 'none', 'in', 0, require('../lib/rules').today()]); assert.ok(a.places.some(p => p.id === placeId) && !a.places.some(p => /Yard/.test(p.name)));
  const c1 = cid();
  await no(ACT.punch(s1, P({ client_id: 'short' })), /Bad punch/);
  await no(ACT.punch(s1, P({ client_id: c1, dev_options: true })), /Developer Options are ON/, 403);
  await no(ACT.punch(s1, P({ client_id: c1, mock: true })), /made-up location/, 403);
  await no(ACT.punch(s1, P({ client_id: c1, accuracy_m: 400 })), /not exact enough yet \(400 m\)/);
  await no(ACT.punch(s1, P({ client_id: c1, lat: undefined })), /location was not received/);
  await no(ACT.punch(s1, P({ client_id: c1, lat: HQ.lat + 0.01 })), /outside your work place/, 403);
  await no(ACT.punch(s1, P({ client_id: c1 })), /photo of this punch did not arrive/);
  assert.strictEqual((await db('GET', 'hr_punches?select=id&employee_id=eq.' + E1.id)).length, 0, 'nothing was saved by a refused punch'); assert.strictEqual((await db('GET', 'hr_devices?select=id&employee_id=eq.' + E1.id)).length, 0, 'and no phone tied');
  await selfie(s1, c1); await no(selfie(s1, c1), /there already/);      // a photo is never replaced
  let r = await ACT.punch(s1, P({ client_id: c1, kind: 'out' })).catch(e => e); assert.match(r.message, /Mark IN first/);
  r = await ACT.punch(s1, P({ client_id: c1 })); assert.deepStrictEqual([r.again, r.punch.kind, r.punch.status, r.next, r.place], [false, 'in', 'ok', 'out', 'Office ' + tag]);
  const again = await ACT.punch(s1, P({ client_id: c1 })); assert.deepStrictEqual([again.again, again.punch.id, again.punches.length], [true, r.punch.id, 1], 'sent twice, kept once');
  await no(ACT.punch(self(mail2), P({ client_id: c1, device: { id: 'rig-phone-' + tag + '-2' } })), /Bad punch number/, 409);
  await no(ACT.punch(s1, P({ client_id: await selfie(s1, cid()) })), /already IN since \d\d:\d\d/, 409);
  r = await ACT.punch(s1, P({ client_id: await selfie(s1, cid()), kind: 'out' })); assert.deepStrictEqual([r.punch.kind, r.next, r.punches.length], ['out', 'in', 2]);
  a = await ACT.myAttend(s1, { device_id: P().device.id }); assert.deepStrictEqual([a.phone, a.punches.map(p => p.kind)], ['this', ['in', 'out']]);
  const mo = await ACT.myMonth(s1, {}); assert.deepStrictEqual([mo.days.length, mo.days[0].punches, /^\d\d:\d\d$/.test(mo.days[0].in), /^\d\d:\d\d$/.test(mo.days[0].out)], [1, 2, true, true]);
  // the database itself: a punch is never changed or deleted
  await no(db('PATCH', 'hr_punches?id=eq.' + r.punch.id, { kind: 'in' }), /Database|refused/); await no(db('DELETE', 'hr_punches?id=eq.' + r.punch.id), /Database|refused/);
});

test('one phone a person: another phone and another person\'s phone are refused and noted; the HR Admin releases it', async () => {
  const s1 = self(mail1), s2 = self(mail2), other = { id: 'rig-phone-' + tag + '-9', model: 'Other Phone' };
  await no(ACT.punch(s1, P({ client_id: await selfie(s1, cid()), device: other })), /tied to another phone/, 403);
  await no(ACT.punch(s2, P({ client_id: await selfie(s2, cid()) })), /already tied to another employee/, 403);      // E2 on E1's phone
  let d = await ACT.devList(user); const mine = d.devices.find(x => x.code === E1.code);
  assert.deepStrictEqual([mine.active, mine.model, mine.device_id, mine.mark.length], [true, 'Rig Phone', undefined, 6]); assert.deepStrictEqual(d.tries.map(t => t.why).sort(), ['another phone', 'phone of another person']);
  await no(ACT.devRelease(user, { id: mine.id, reason: 'New phone' }), /Only the HR Admin/, 403); await no(ACT.devRelease(admin, { id: mine.id, reason: '' }), /write why/);
  await no(ACT.devRelease(ses('admin', SITE2), { id: mine.id, reason: 'New phone' }), /not found on this site/, 404);
  d = await ACT.devRelease(admin, { id: mine.id, reason: 'New phone' }); assert.deepStrictEqual([d.devices.find(x => x.id === mine.id).active, d.devices.find(x => x.id === mine.id).released_by], [false, 'admin@rig.test']);
  await no(ACT.devRelease(admin, { id: mine.id, reason: 'Again' }), /already released/);
  const r = await ACT.punch(s1, P({ client_id: await selfie(s1, cid()), device: other })); assert.strictEqual(r.punch.kind, 'in');
  assert.strictEqual((await ACT.myAttend(s1, { device_id: other.id })).phone, 'this');
});

test('no network: the punch counts for its own moment when the phone\'s clock is in order; anything doubtful waits for the HR Admin', async () => {
  const s2 = self(mail2), dev = { id: 'rig-phone-' + tag + '-2', model: 'Second Phone' }, now = Date.now(), back = 20 * 60000;
  const off = (over) => P(Object.assign({ device: dev, offline: true, anchor_server: now - 3600000, anchor_elapsed: 5000000, elapsed: 5000000 + 3600000 - back, at_device: new Date(now - back + 3000).toISOString() }, over));
  let r = await ACT.punch(s2, off({ client_id: await selfie(s2, cid()) })); assert.deepStrictEqual([r.punch.status, r.punch.offline], ['ok', true]); assert.ok(Math.abs(Date.parse(r.punch.at) - (now - back)) < 2000, 'its own moment, not the moment it arrived');
  await no(ACT.punch(s2, off({ client_id: await selfie(s2, cid()), kind: 'out', lat: HQ.lat + 0.02 })), /outside your work place/, 403);      // outside: never, offline too
  r = await ACT.punch(s2, off({ client_id: await selfie(s2, cid()), kind: 'out', elapsed: 1000, at_device: new Date(now - 60000).toISOString() }));      // the phone was restarted in between
  assert.strictEqual(r.punch.status, 'review');
  await no(ACT.punchDay(self(mail2), {}), /HR office only/, 403);
  let d = await ACT.punchDay(user, { review: 1 }); const w = d.punches.find(p => p.id === r.punch.id); assert.ok(w && w.code === E2.code && /restarted/.test(w.why.join()));
  const day = await ACT.punchDay(user, {}); assert.ok(day.punches.length >= 5 && day.punches.every(p => p.place === 'Office ' + tag));
  assert.match((await ACT.punchSelfie(user, { id: w.id })).url, /\/storage\/v1\/object\/sign\/hr-selfies\//); await no(ACT.punchSelfie(ses('user', SITE2), { id: w.id }), /not found on this site/, 404);
  await no(ACT.punchReview(user, { id: w.id, decision: 'accepted' }), /Only the HR Admin/, 403); await no(ACT.punchReview(admin, { id: w.id, decision: 'refused' }), /write why it is refused/);
  await no(ACT.punchReview(admin, { id: day.punches.find(p => p.status === 'ok').id, decision: 'accepted' }), /needs no decision/);
  d = await ACT.punchReview(admin, { id: w.id, decision: 'accepted', note: 'Phone was restarted, seen at site' }); assert.ok(!d.punches.some(p => p.id === w.id));
  await no(ACT.punchReview(admin, { id: w.id, decision: 'refused', note: 'again' }), /already decided/, 409);
  assert.deepStrictEqual((await db('GET', 'hr_punches?select=status&id=eq.' + w.id))[0], { status: 'review' }, 'the punch itself stays as it came');
});
