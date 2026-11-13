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
  assert.match(a.code, /^RCL\d{3,}$/); assert.strictEqual(a.status, 'pending'); assert.deepStrictEqual(a.missing, []);
  const b = await ACT.empSave(user, { name: 'Babu Rig', category: 'Labour', mobile: mob() });
  assert.strictEqual(b.status, 'incomplete'); assert.deepStrictEqual(b.missing, ['Date of birth']); assert.notStrictEqual(b.code, a.code);
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
  await no(ACT.empExit(admin, { id: a.id, on: '2020-01-01', reason: 'Resigned' }), /before the date he is active from/);
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
  // (13-11-2026, "konta user konte location war … konte location sathi konte user … ek employee aso ki bulk") who marks where;
  // single people to / from a place – a place for everybody only after the Admin said yes (it becomes "Chosen people")
  let w = await ACT.placeMap(user); const p1 = w.people.find(e => e.id === E1.id);
  assert.ok(p1.places.indexOf(placeId) > -1 && p1.last === null); assert.strictEqual(w.places.find(p => p.id === placeId).count, w.people.length);
  await no(ACT.placeMap(self(mail1)), /HR office only/, 403);
  await no(ACT.placePeople(user, { place_id: camp, add: [E1.id] }), /Only the HR Admin/, 403); await no(ACT.placePeople(admin, { place_id: camp }), /at least one employee/);
  await no(ACT.placePeople(admin, { place_id: camp, remove: [E1.id] }), /is for everybody of the site \(\d+ people now\) – it holds no single people/, 409);
  assert.strictEqual((await ACT.placeMap(user)).places.find(p => p.id === camp).scope, 'all', 'nothing changed by the refusal');
  w = await ACT.placePeople(admin, { place_id: camp, remove: [E1.id], convert: true });
  assert.ok(w.people.find(e => e.id === E1.id).places.indexOf(camp) < 0 && w.people.find(e => e.id === E2.id).places.indexOf(camp) > -1); assert.strictEqual(w.places.find(p => p.id === camp).scope, 'people');
  w = await ACT.placePeople(admin, { place_id: camp, add: [E1.id] }); assert.ok(w.people.find(e => e.id === E1.id).places.indexOf(camp) > -1); assert.strictEqual(w.people_now, w.places.find(p => p.id === camp).count);
  await no(ACT.placePeople(ses('admin', SITE2), { place_id: camp, add: [E1.id] }), /not found on this site/, 404);
  // (13-11-2026, "employee ch location change krta yeil … multiple location access") one person's places set to exactly the chosen
  await no(ACT.placePerson(user, { employee_id: E1.id, places: [camp] }), /Only the HR Admin/, 403);
  await no(ACT.placePerson(admin, { employee_id: E1.id, places: [camp] }), /is for everybody of the site \(\d+ people now\).* – such a place holds no single people/, 409);
  w = await ACT.placePerson(admin, { employee_id: E1.id, places: [camp, placeId], convert: true }); const mine = () => w.people.find(e => e.id === E1.id).places.slice().sort();
  assert.deepStrictEqual(mine(), [camp, placeId].sort(), 'two places for him; the other places for everybody were taken from him only');
  assert.ok(w.people.find(e => e.id === E2.id).places.indexOf(road) > -1, 'the others keep what they had'); assert.strictEqual(w.places.find(p => p.id === placeId).scope, 'all', 'a place that did not change for him is left alone');
  w = await ACT.placePerson(admin, { employee_id: E1.id, places: [placeId] }); assert.deepStrictEqual(mine(), [placeId]);
  w = await ACT.placePerson(admin, { employee_id: E1.id, places: [placeId, camp] }); assert.deepStrictEqual(mine(), [camp, placeId].sort()); assert.strictEqual(w.changed, 1);
  await no(ACT.placePerson(admin, { employee_id: E1.id, places: ['00000000-0000-4000-8000-000000000000'] }), /not found on this site/, 404);
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
  // (13-11-2026) the day's work place – where its first IN was marked – and the site's rules in words (none set yet: no line)
  assert.strictEqual(mo.days[0].place, 'Office ' + tag); assert.ok(Array.isArray(mo.rules));
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

/* ───────────── step 5: shifts, holidays, rules, the muster, a day set by hand, requests ───────────── */
const D = require('../lib/day'), RU = require('../lib/rules');
const TODAY = RU.today(), ago = n => D.addDays(TODAY, -n), OFF = (D.weekday(TODAY) + 1) % 7;      // the weekly off: tomorrow's weekday – none of the last five days

test('shifts, holidays and the rules with their date: only who has the power; a new version, the old days keep theirs', async () => {
  let a = await ACT.attSetup(user); assert.deepStrictEqual([a.shifts.length, a.rules, Object.keys(a.powers).filter(k => a.powers[k] !== true), a.power_list.length], [0, {}, ['signin'], 10]);      // (13-11-2026) "a sign-in for everybody at once" is off until the Super Admin gives it
  await no(ACT.attSetup(self(mail1)), /HR office only/, 403); await no(ACT.shiftSave(user, { name: 'G' }), /Only the HR Admin/, 403);
  await no(ACT.shiftSave(admin, { name: 'G', start_time: '9', end_time: '9:00' }), /Name: at least 2 letters\. Starts at: a time as HH:MM\./);
  a = await ACT.shiftSave(admin, { name: 'General ' + tag, start_time: '9:00', end_time: '18:00', valid_from: '2026-01-01' }); const sh = a.shifts[0];
  assert.deepStrictEqual([sh.start_time, sh.end_time, sh.break_min, sh.scope], ['09:00', '18:00', 0, 'all']);
  await no(ACT.shiftSave(admin, { name: 'general ' + tag.toLowerCase(), start_time: '10:00', end_time: '19:00' }), /already there/, 409);
  a = await ACT.shiftSave(admin, { name: 'Night ' + tag, start_time: '20:00', end_time: '06:00', scope: 'people', people: [E2.id], valid_from: ago(-5) }); const night = a.shifts.find(x => /^Night/.test(x.name)); assert.deepStrictEqual(night.people, [E2.id]);
  await no(ACT.shiftRemove(admin, { id: night.id, reason: '' }), /write why/); a = await ACT.shiftRemove(admin, { id: night.id, reason: 'Not used' }); assert.strictEqual(a.shifts.length, 1);
  await no(ACT.holidaySave(admin, { day: '32-01-2026', name: 'X' }), /Day: a date.*Name: at least 2 letters/);
  a = await ACT.holidaySave(admin, { day: ago(40), name: 'Festival ' + tag }); assert.strictEqual(a.holidays.length, 1);
  a = await ACT.holidaySave(admin, { rows: [{ day: ago(41), name: 'One' }, { day: ago(40), name: 'Twice' }] }); assert.deepStrictEqual([a.saved, a.lines.map(l => l.line)], [0, [2]], 'all or none');
  a = await ACT.holidaySave(admin, { rows: [{ day: ago(41), name: 'One' }, { day: ago(42), name: 'Two' }] }); assert.deepStrictEqual([a.saved, a.holidays.length], [2, 3]);
  a = await ACT.holidayRemove(admin, { id: a.holidays.find(h => h.name === 'Two').id }); assert.strictEqual(a.holidays.length, 2);
  await no(ACT.rulesSave(admin, { full_hours: 4, half_hours: 6 }), /less than/);
  await no(ACT.rulesSave(admin, { valid_from: '2026-01-01', full_hours: 8 }), /only by the Super Admin/, 403);
  a = await ACT.rulesSave(sup, { valid_from: '2026-01-01', full_hours: 8, half_hours: 4, grace_min: 10, week_off: [OFF] });
  assert.deepStrictEqual([a.rules, a.rules_from, a.versions.length], [{ full_hours: 8, half_hours: 4, grace_min: 10, week_off: [OFF] }, '2026-01-01', 1]);
  assert.strictEqual((await db('GET', 'hr_audit?select=detail&site=eq.' + SITE + '&action=eq.Attendance rules set&order=id.desc&limit=1'))[0].detail.new.full_hours, 8);
});

test('the muster: today\'s punches; a day entered by hand, corrected, set aside – each a new row with the old and the new; the Admin\'s powers', async () => {
  const month = TODAY.slice(0, 7), y = ago(1), back = y.slice(0, 7) === month;
  let m = await ACT.muster(user, { month }); const r1 = m.rows.find(r => r.id === E1.id), r2 = m.rows.find(r => r.id === E2.id), i = m.days.indexOf(TODAY);
  assert.ok(r1 && r2 && i > -1); assert.strictEqual(r1.codes[i], 'IN', 'IN – OUT – IN again: at work'); assert.strictEqual(r2.codes[i], 'IN', 'his accepted OUT was before his IN: at work');
  assert.ok(m.rows.length >= 2 && m.rows.every(r => r.codes.length === m.days.length)); assert.deepStrictEqual(m.week_off, [OFF]);
  await no(ACT.muster(self(mail1), { month }), /HR office only/, 403);
  // by hand: a day with no punch
  await no(ACT.daySet(user, { id: E2.id, day: y, in_time: '09:00', out_time: '18:00', reason: 'No phone' }), /Only the HR Admin/, 403);
  await no(ACT.daySet(admin, { id: E2.id, day: ago(-1), in_time: '09:00', reason: 'xxx' }), /still to come/); await no(ACT.daySet(admin, { id: E2.id, day: y, in_time: '18:00', out_time: '09:00', reason: 'xxx' }), /OUT must be after IN/);
  await no(ACT.daySet(admin, { id: E2.id, day: y, in_time: '09:00', out_time: '18:00', reason: '' }), /Reason: write why/); await no(ACT.daySet(admin, { id: E2.id, day: y, none: true, reason: 'xxx' }), /no attendance to set aside/);
  await no(ACT.daySet(admin, { id: E2.id, day: ago(90), in_time: '09:00', out_time: '18:00', reason: 'Old one' }), /only by the Super Admin/, 403);
  await no(ACT.daySet(ses('admin', SITE2), { id: E2.id, day: y, in_time: '09:00', out_time: '18:00', reason: 'xxx' }), /not found on this site/, 404);
  let d = await ACT.daySet(admin, { id: E2.id, day: y, in_time: '9:00', out_time: '18:00', reason: 'No phone – seen at site' });
  assert.deepStrictEqual([d.day.code, d.day.in, d.day.out, d.day.hours, d.day.src, d.entries.length, d.entries[0].source, d.entries[0].old_in], ['P', '09:00', '18:00', 9, 'manual', 1, 'manual', '']);
  // corrected: the old times stay in the new row
  d = await ACT.daySet(admin, { id: E2.id, day: y, in_time: '09:00', out_time: '13:00', reason: 'He left at one' });
  assert.deepStrictEqual([d.day.code, d.day.hours, d.day.src, d.entries.length, d.entries[0].source, d.entries[0].old_out, d.entries[0].by], ['HD', 4, 'correction', 2, 'correction', '18:00', 'admin@rig.test']);
  d = await ACT.daySet(admin, { id: E2.id, day: y, none: true, reason: 'Entered for the wrong man' }); assert.deepStrictEqual([d.day.code, d.day.in, d.entries.length], ['A', '', 3]);
  if (back) { m = await ACT.muster(user, { month }); const w = m.rows.find(r => r.id === E2.id); assert.deepStrictEqual([w.codes[m.days.indexOf(y)], w.fix[m.days.indexOf(y)]], ['A', 1]); }
  // a night: OUT the next morning
  d = await ACT.daySet(admin, { id: E2.id, day: ago(2), in_time: '20:00', out_time: '05:30', out_next_day: true, reason: 'Night work' }); assert.deepStrictEqual([d.day.hours, d.day.next_day, d.day.late_min > 0], [9.5, true, true]);
  // the database: an entry is never changed
  await no(db('PATCH', 'hr_day_entries?employee_id=eq.' + E2.id, { reason: 'changed' }), /Database|refused/);
  // the Super Admin takes a power from the HR Admin, and gives it back
  await no(ACT.powerSet(admin, { power: 'manual', allowed: false }), /Only the Super Admin/, 403); await no(ACT.powerSet(sup, { power: 'fly', allowed: true }), /Unknown power/);
  let p = await ACT.powerSet(sup, { power: 'manual', allowed: false }); assert.strictEqual(p.powers.manual, false);
  await no(ACT.daySet(admin, { id: E1.id, day: ago(3), in_time: '09:00', out_time: '18:00', reason: 'By hand' }), /has not given the HR Admin this power.*Manual entry/, 403);
  d = await ACT.daySet(admin, { id: E2.id, day: ago(2), in_time: '20:00', out_time: '06:00', out_next_day: true, reason: 'Still his to correct' }); assert.strictEqual(d.day.hours, 10, 'a correction is another power');
  d = await ACT.daySet(sup, { id: E1.id, day: ago(3), in_time: '09:00', out_time: '18:00', reason: 'By hand' }); assert.strictEqual(d.day.src, 'manual');
  p = await ACT.powerSet(sup, { power: 'manual', allowed: true }); assert.strictEqual(p.powers.manual, true);
  p = await ACT.powerSet(sup, { power: 'places', allowed: false }); await no(ACT.projSave(admin, { name: 'No power ' + tag }), /has not given the HR Admin this power/, 403); await ACT.powerSet(sup, { power: 'places', allowed: true });
});

test('a request to set an old day right: himself, a day gone, one waiting a day; the HR office decides – or first the reporting person', async () => {
  const s1 = self(mail1), s2 = self(mail2), day = ago(2);
  await no(ACT.regAsk(s1, { day: TODAY, in_time: '09:00', reason: 'Forgot it' }), /a day already gone/); await no(ACT.regAsk(s1, { day: ago(61), in_time: '09:00', out_time: '18:00', reason: 'Forgot it' }), /only 60 days back/);
  await no(ACT.regAsk(s1, { day, in_time: '09:20', out_time: '18:05', reason: 'x' }), /what happened/); await no(ACT.regAsk(s1, { day, out_time: '18:05', reason: 'Forgot OUT' }), /no IN: give the IN time too/);
  let r = await ACT.regAsk(s1, { day, in_time: '09:20', out_time: '18:05', reason: 'Phone was dead' }); assert.deepStrictEqual([r.rows[0].status, r.rows[0].level, r.rows[0].in_time, r.rows[0].out_time], ['pending', 2, '09:20', '18:05']);
  await no(ACT.regAsk(s1, { day, in_time: '09:00', out_time: '18:00', reason: 'Once more' }), /already waiting/, 409);
  let l = await ACT.regList(user, {}); const q = l.rows.find(x => x.code === E1.code); assert.ok(q && l.can === false);
  await no(ACT.regDecide(user, { id: q.id, decision: 'approved' }), /Only the HR Admin/, 403); await no(ACT.regDecide(admin, { id: q.id, decision: 'refused' }), /write why it is refused/);
  await no(ACT.regDecide(ses('admin', SITE2), { id: q.id, decision: 'approved' }), /not found on this site/, 404);
  l = await ACT.regDecide(admin, { id: q.id, decision: 'approved', note: 'Seen by the supervisor' }); assert.ok(!l.rows.some(x => x.id === q.id)); await no(ACT.regDecide(admin, { id: q.id, decision: 'approved' }), /already decided/, 409);
  const d = await ACT.dayGet(user, { id: E1.id, day }); assert.deepStrictEqual([d.day.code, d.day.in, d.day.out, d.day.late_min, d.day.src, d.entries[0].source, d.requests[0].status, d.requests[0].steps[0].by], ['P', '09:20', '18:05', 20, 'regularized', 'regularized', 'approved', 'admin@rig.test']);
  const mo = await ACT.myMonth(s1, { month: day.slice(0, 7) }), md = mo.all.find(x => x.day === day); assert.deepStrictEqual([md.code, md.late_min, mo.total.late >= 1, mo.all.length >= 28], ['P', 20, true, true]);
  // two levels: the reporting person first
  await ACT.rulesSave(sup, { valid_from: TODAY, full_hours: 8, half_hours: 4, grace_min: 10, week_off: [OFF], reg_levels: 2 });
  const e2 = (await ACT.empGet(user, { id: E2.id })).employee; await ACT.empSave(user, { id: E2.id, name: e2.name, category: e2.category, mobile: e2.mobile, email: e2.email, dob: e2.dob, reports_to: E1.id });
  r = await ACT.regAsk(s2, { day: ago(4), in_time: '08:55', out_time: '17:10', reason: 'No network all day' }); assert.strictEqual(r.rows[0].level, 1);
  const w = r.rows[0]; await no(ACT.regDecide(admin, { id: w.id, decision: 'approved' }), /still waits for the reporting person/, 403);
  let t = await ACT.teamRegs(s1); assert.deepStrictEqual([t.team, t.rows.map(x => x.id)], [1, [w.id]]); assert.deepStrictEqual((await ACT.teamRegs(s2)).rows, []);
  await no(ACT.teamRegDecide(s2, { id: w.id, decision: 'approved' }), /does not report to you/, 403);
  t = await ACT.teamRegDecide(s1, { id: w.id, decision: 'approved', note: 'He was on site' }); assert.deepStrictEqual(t.rows, []); await no(ACT.teamRegDecide(s1, { id: w.id, decision: 'approved' }), /does not wait for you any more/, 409);
  assert.deepStrictEqual([(await ACT.dayGet(user, { id: E2.id, day: ago(4) })).day.in, (await ACT.dayGet(user, { id: E2.id, day: ago(4) })).day.src], ['', ''], 'not counted until the HR office approved too');
  assert.strictEqual((await ACT.dayGet(user, { id: E2.id, day: ago(20) })).day.code, '', 'before the site\'s first recorded day nobody is absent');
  l = await ACT.regDecide(admin, { id: w.id, decision: 'approved' }); const dd = await ACT.dayGet(user, { id: E2.id, day: ago(4) });
  assert.deepStrictEqual([dd.day.code, dd.day.hours, dd.requests[0].steps.map(x => x.level + ':' + x.decision)], ['P', 8.25, ['1:approved', '2:approved']]);
  // refused by the reporting person: it ends there
  r = await ACT.regAsk(s2, { day: ago(5), in_time: '09:00', out_time: '18:00', reason: 'Forgot the phone' }); await no(ACT.teamRegDecide(s1, { id: r.rows[0].id, decision: 'refused' }), /write why/);
  await ACT.teamRegDecide(s1, { id: r.rows[0].id, decision: 'refused', note: 'He was not there' }); assert.strictEqual((await ACT.myRegs(s2)).rows[0].status, 'refused'); assert.strictEqual((await ACT.dayGet(user, { id: E2.id, day: ago(5) })).day.src, '');
});

/* ───────────── the employee's site in his form; everything of attendance on his page ───────────── */
test('an employee\'s site: a new one is put on a site of the sign-in; another site for an employee of today = a transfer from today (HR Admin)', async () => {
  await no(ACT.empSave(user, { name: 'Site Pick', category: 'staff', mobile: mob(), email: mail('sp'), dob: '1990-03-03', site: 'NOWHERE' }), /choose a site where you have HR/, 403);
  const n = await ACT.empSave(user, { name: 'Site Pick', category: 'staff', mobile: mob(), email: mail('sp'), dob: '1990-03-03', site: SITE2.toLowerCase() }); assert.strictEqual(n.site, SITE2);
  await no(ACT.empGet(user, { id: n.id }), /not found on this site/, 404); const there = await ACT.empGet(ses('user', SITE2), { id: n.id });
  assert.deepStrictEqual([there.employee.site, there.history.length, there.history[0].site, there.history[0].note], [SITE2, 1, SITE2, 'Joined']);
  // an employee of today: the HR User cannot move him; the HR Admin does – from today, the history keeps the old site
  const e = there.employee, same = { id: e.id, name: e.name, category: e.category, mobile: e.mobile, email: e.email, dob: e.dob };
  await no(ACT.empSave(ses('user', SITE2), Object.assign({ site: SITE }, same)), /Only the HR Admin/, 403);
  const kept = await ACT.empSave(ses('user', SITE2), same); assert.strictEqual(kept.site, SITE2, 'no site sent: he stays');
  const mv = await ACT.empSave(ses('admin', SITE2), Object.assign({ site: SITE }, same)); assert.strictEqual(mv.site, SITE);
  const here = await ACT.empGet(user, { id: e.id }); assert.deepStrictEqual([here.employee.site, here.history.map(h => h.site + ':' + h.note + ':' + (h.valid_to ? 'closed' : 'open'))], [SITE, [SITE + ':Transfer:open', SITE2 + ':Joined:closed']]);
});

test('the employee\'s page: his work places, shift, phone, today, this month, what waits', async () => {
  const a = await ACT.empAround(user, { id: E1.id });
  assert.ok(a.places.some(p => p.name === 'Office ' + tag) && !a.places.some(p => /^Yard/.test(p.name))); assert.strictEqual(a.shift, 'General ' + tag);
  assert.deepStrictEqual([a.phone.model, a.today.code, a.month, a.total.P >= 1, a.total.late >= 1, a.requests_waiting], ['Other Phone', 'IN', TODAY.slice(0, 7), true, true, 0]);
  await no(ACT.empAround(self(mail1), { id: E1.id }), /HR office only/, 403); await no(ACT.empAround(ses('user', SITE2), { id: E1.id }), /not found on this site/, 404);
});

// (asked 12-11-2026: "RCL001 RCL002" and "EMPLOYEE CODE CHANGE EDIT KRTA YAWET … FIX NASAWET")
test('the employee code: made by itself as RCL…, or typed; changed by the HR office; never the code of another; a typed code is passed over by the counter', async () => {
  const typed = 'RC-' + tag;
  const a = await ACT.empSave(user, { name: 'Code One', category: 'staff', code: ' ' + typed.toLowerCase() + ' ' }); assert.strictEqual(a.code, typed, 'typed at once – kept in capitals');
  const b = await ACT.empSave(user, { name: 'Code Two', category: 'staff' }); assert.match(b.code, /^RCL\d{3,}$/, 'not typed: made by itself');
  await no(ACT.empSave(user, { name: 'Code Three', category: 'staff', code: typed }), /already belongs to another employee/, 409);
  await no(ACT.empSave(user, { name: 'Code Three', category: 'staff', code: 'a b?c' }), /Employee code: 2 to 20/, 400);
  // changed: the same employee, his new code; his punches / papers hang on him, not on the code
  const neu = 'RN-' + tag, c = await ACT.empSave(user, { id: b.id, name: 'Code Two', category: 'staff', code: neu }); assert.deepStrictEqual([c.id, c.code], [b.id, neu]);
  const g = await ACT.empGet(admin, { id: b.id }); assert.strictEqual((g.employee || g.emp || g).code, neu);
  const au = await db('GET', 'hr_audit?select=action,detail&site=eq.' + SITE + '&action=eq.Employee%20changed&order=id.desc&limit=1'); assert.deepStrictEqual(au[0].detail.code, [b.code, neu], 'written down: the old and the new');
  await no(ACT.empSave(user, { id: b.id, name: 'Code Two', category: 'staff', code: typed }), /already belongs to another employee/, 409);
  const same = await ACT.empSave(user, { id: b.id, name: 'Code Two B', category: 'staff', code: neu }); assert.strictEqual(same.code, neu, 'the same code again: nothing to refuse');
  const kept = await ACT.empSave(user, { id: b.id, name: 'Code Two C', category: 'staff' }); assert.strictEqual(kept.code, neu, 'no code sent (an older page): his code stays');
  // a code typed by hand that the counter would reach next: the counter passes over it
  const next = Number(await db('POST', 'rpc/hr_next_no', { p_kind: 'emp', p_count: 1 })) + 1, hand = 'RCL' + String(next).padStart(3, '0');
  const h = await ACT.empSave(user, { name: 'Code Hand', category: 'staff', code: hand }); assert.strictEqual(h.code, hand);
  const auto = await ACT.empSave(user, { name: 'Code Auto', category: 'staff' }); assert.match(auto.code, /^RCL\d{3,}$/); assert.notStrictEqual(auto.code, hand);
});

test('the attendance dashboard: the HR office only; today counted like the muster; only its own site; the day\'s punches carry their place', async () => {
  await no(ACT.attDash(self(mail1)), /HR office only/, 403);
  const d = await ACT.attDash(user), c = d.count, m = await ACT.muster(user, { month: TODAY.slice(0, 7) }), i = m.days.indexOf(TODAY);
  assert.strictEqual(d.today, TODAY); assert.match(d.now, /^\d\d:\d\d$/); assert.strictEqual(c.total, d.who.length); assert.strictEqual(c.on + c.out + c.off + c.none, c.total);
  // (13-11-2026) on leave / absent today: inside "not marked", never beside it; each person says which
  assert.ok(Number.isInteger(c.leave) && Number.isInteger(c.absent) && c.leave + c.absent <= c.none); assert.strictEqual(d.who.filter(w => w.mark === 'leave').length, c.leave); assert.strictEqual(d.who.filter(w => w.mark === 'absent').length, c.absent); assert.ok(d.who.every(w => w.state === 'none' || w.mark === ''));
  for (const e of [E1, E2]) { const w = d.who.find(x => x.id === e.id), code = m.rows.find(r => r.id === e.id).codes[i]; assert.ok(w, e.code); assert.strictEqual(w.state, code === 'IN' ? 'on' : 'out', e.code + ' as in the muster'); assert.match(w.in, /^\d\d:\d\d$/); assert.match(w.punch, /^[0-9a-f-]{36}$/); }
  assert.strictEqual(d.who.find(x => x.id === E1.id).place, 'Office ' + tag); assert.ok(d.places.some(p => p.name === 'Office ' + tag && p.on >= 1));
  assert.strictEqual(c.on, d.who.filter(w => w.state === 'on').length); assert.strictEqual(d.arc.slots.length, 32); assert.strictEqual(d.arc.slots.reduce((a, b) => a + b, 0), c.present); assert.match(c.first_in, /^\d\d:\d\d$/);
  assert.deepStrictEqual(d.week.map(w => w.day), [6, 5, 4, 3, 2, 1, 0].map(ago)); assert.ok(d.week[6].P >= c.on);
  for (const k of ['requests', 'review', 'phones', 'no_phone']) assert.ok(Number.isInteger(d.needs[k]) && d.needs[k] >= 0, k);
  assert.strictEqual(d.needs.requests, (await ACT.regList(user, { status: 'pending' })).rows.length);
  const other = await ACT.attDash(ses('user', SITE2)); assert.ok(!other.who.some(w => w.id === E1.id || w.id === E2.id), 'another site sees nothing of this one');
  const day = await ACT.dayGet(user, { id: E1.id, day: TODAY }); assert.ok(day.punches.length && day.punches.every(p => typeof p.place === 'string')); assert.ok(day.punches.some(p => p.place === 'Office ' + tag)); assert.strictEqual(day.employee.category, 'staff');
});

test('delete: only an employee added by mistake (HR Admin, with the reason); one with attendance is refused – he is relieved; the list as a file', async () => {
  const x = await ACT.empSave(user, { name: 'Wrong Entry', category: 'driver', mobile: mob(), joined_on: '2026-02-01' });
  await no(ACT.empDelete(user, { id: x.id, reason: 'added twice' }), /Only the HR Admin/, 403); await no(ACT.empDelete(admin, { id: x.id, reason: '' }), /Reason: write why he is deleted/);
  await no(ACT.empDelete(ses('admin', SITE2), { id: x.id, reason: 'added twice' }), /not found on this site/, 404);
  await no(ACT.empDelete(admin, { id: E1.id, reason: 'try' }), /has attendance.*cannot be deleted\. Relieve him/, 409);      // E1 has punches and a phone
  const boss = await ACT.empSave(user, { name: 'Wrong Boss', category: 'staff', mobile: mob() }); await ACT.empSave(user, { id: x.id, name: 'Wrong Entry', category: 'driver', mobile: (await ACT.empGet(user, { id: x.id })).employee.mobile, joined_on: '2026-02-01', reports_to: boss.id });
  await no(ACT.empDelete(admin, { id: boss.id, reason: 'try' }), /people reporting to him/, 409);
  const ex = await ACT.empExport(user, { q: 'Wrong Entry' }); assert.deepStrictEqual(ex.rows.map(r => [r.code, r.name, r.category, r.joined_on, r.left_on, r.status]), [[x.code, 'Wrong Entry', 'driver', '2026-02-01', '', 'incomplete']]);
  const d = await ACT.empDelete(admin, { id: x.id, reason: 'added twice' }); assert.deepStrictEqual(d, { ok: true, code: x.code });
  await no(ACT.empGet(user, { id: x.id }), /not found on this site/, 404); assert.strictEqual(((await db('GET', 'hr_employment?select=id&employee_id=eq.' + x.id)) || []).length, 0);
  const a = (await db('GET', 'hr_audit?select=action,target,detail&site=eq.' + SITE + '&action=eq.Employee%20deleted&order=id.desc&limit=1'))[0]; assert.ok(a && a.detail.reason === 'added twice' && a.detail.old.code === x.code && a.detail.old.name === 'Wrong Entry');
  await ACT.empDelete(admin, { id: boss.id, reason: 'made for a test' });      // nobody reports to him any more
  assert.ok((await ACT.empGet(user, { id: E1.id })).employee.id === E1.id, 'the others are untouched');
  const next = await ACT.empSave(user, { name: 'After Delete', category: 'staff', mobile: mob() }); assert.notStrictEqual(next.code, x.code, 'a deleted code is not given again by the counter');
  await no(ACT.empExit(admin, { id: next.id, on: '', reason: 'x' }), /Relieving date: a date/);
});

test('the full profile: lists are the office\'s (add, rename, switch off); details saved by group; numbers masked for an HR User; rows added, changed, removed; what is compulsory', async () => {
  await no(ACT.listSave(user, { kind: 'branch', name: 'B ' + tag }), /Only the HR Admin/, 403); await no(ACT.listSave(admin, { kind: 'nope', name: 'x' }), /Unknown list/);
  let l = await ACT.listSave(admin, { kind: 'branch', name: 'Branch ' + tag }); const br = l.lists.branch.find(x => x.name === 'Branch ' + tag); assert.ok(br && br.active);
  await no(ACT.listSave(admin, { kind: 'branch', name: 'branch ' + tag.toLowerCase() }), /already in the list/, 409);
  l = await ACT.listSave(admin, { kind: 'branch', id: br.id, name: 'Branch ' + tag + ' 2', active: true }); assert.ok(l.lists.branch.some(x => x.id === br.id && x.name === 'Branch ' + tag + ' 2'));
  l = await ACT.listSave(admin, { kind: 'qualification', name: 'Diploma ' + tag }); const ql = l.lists.qualification.find(x => x.name === 'Diploma ' + tag);
  const e = await ACT.empSave(user, { name: 'Profile Rig', category: 'staff', mobile: mob(), email: mail('prof'), dob: '1990-05-05' });
  let p = await ACT.profGet(user, { id: e.id }); assert.deepStrictEqual([p.data, p.secret, p.masked, p.complete.missing], [{}, {}, true, []]); assert.ok(p.defs.groups.length === 3 && p.defs.rows.length === 4 && p.lists.blood.length >= 8);
  await no(ACT.profGet(self(mail1), { id: e.id }), /HR office only/, 403); await no(ACT.profGet(ses('user', SITE2), { id: e.id }), /not found on this site/, 404);
  await no(ACT.profSave(user, { id: e.id, group: 'job', data: { branch: E1.id } }), /Branch: choose a value of the list/);
  p = await ACT.profSave(user, { id: e.id, group: 'job', data: { branch: br.id, notice_days: '30', overtime: 'no', confirmation_date: '01-06-2026' } }); assert.deepStrictEqual(p.data, { branch: br.id, notice_days: 30, overtime: false, confirmation_date: '2026-06-01' });
  p = await ACT.profSave(user, { id: e.id, group: 'profile', data: { father_name: 'Senior Rig', cug: '9876500000' } }); assert.deepStrictEqual(p.data, { branch: br.id, notice_days: 30, overtime: false, confirmation_date: '2026-06-01', father_name: 'Senior Rig', cug: '9876500000' }, 'a group leaves the other groups alone');
  p = await ACT.profSave(admin, { id: e.id, group: 'secret', data: { uan: '123456789012', bank_account: '000123456789', bank_ifsc: 'SBIN0001234', bank_name: 'Rig Bank' } }); assert.strictEqual(p.secret.bank_account, '000123456789');
  p = await ACT.profGet(user, { id: e.id }); assert.deepStrictEqual([p.secret.uan, p.secret.bank_account, p.secret.bank_ifsc], ['XXXX9012', 'XXXX6789', 'SBIN0001234'], 'an HR User sees the numbers masked');
  p = await ACT.profSave(user, { id: e.id, group: 'secret', data: Object.assign({}, p.secret, { bank_holder: 'Profile Rig' }) }); assert.strictEqual((await ACT.profGet(admin, { id: e.id })).secret.bank_account, '000123456789', 'a masked box left as it is keeps its number');
  const au = (await db('GET', 'hr_audit?select=detail&site=eq.' + SITE + '&action=eq.' + encodeURIComponent('Profile changed (Statutory & bank)') + '&order=id.desc&limit=5')) || []; assert.ok(au.length >= 2 && !JSON.stringify(au).includes('123456789'), 'the audit holds no number');
  // switched off: not offered, but it stays where it is
  await ACT.listSave(admin, { kind: 'branch', id: br.id, name: 'Branch ' + tag + ' 2', active: false });
  p = await ACT.profSave(user, { id: e.id, group: 'job', data: { branch: br.id, notice_days: 45 } }); assert.deepStrictEqual([p.data.branch, p.data.notice_days, p.data.overtime], [br.id, 45, undefined]);
  const e2 = await ACT.empSave(user, { name: 'Profile Two', category: 'labour', mobile: mob() }); await no(ACT.profSave(user, { id: e2.id, group: 'job', data: { branch: br.id } }), /choose a value of the list/);
  // rows
  await no(ACT.profRowSave(user, { id: e.id, kind: 'family', data: { relation: '' } }), /Name: needed/);
  p = await ACT.profRowSave(user, { id: e.id, kind: 'family', data: { name: 'Mother Rig', nominee: 'yes', mobile: '9876511111' } }); const fr = p.rows.family[0]; assert.deepStrictEqual(fr.data, { name: 'Mother Rig', mobile: '9876511111', nominee: true });
  p = await ACT.profRowSave(user, { id: e.id, kind: 'family', row: fr.id, data: { name: 'Mother Rig', nominee: 'no' } }); assert.deepStrictEqual(p.rows.family, [{ id: fr.id, data: { name: 'Mother Rig', nominee: false } }]);
  p = await ACT.profRowSave(user, { id: e.id, kind: 'education', data: { qualification: ql.id, year: '2010' } }); assert.strictEqual(p.rows.education.length, 1);
  await no(ACT.profRowSave(user, { id: e.id, kind: 'experience', data: { company: 'Old Co', from: '2020-01-01', to: '2019-01-01' } }), /To: it is before From/);
  await no(ACT.profRowRemove(user, { row: fr.id, reason: '' }), /Reason: write why/); p = await ACT.profRowRemove(user, { row: fr.id, reason: 'entered twice' }); assert.strictEqual(p.rows.family.length, 0);
  assert.strictEqual(((await db('GET', 'hr_employee_rows?select=removed_reason&id=eq.' + fr.id)) || [])[0].removed_reason, 'entered twice', 'removed = kept with who and why');
  // what is compulsory – the site's own setting
  await no(ACT.profRequiredSave(user, { keys: ['emp.dob'] }), /Only the HR Admin/, 403);
  const st = await ACT.profRequiredSave(admin, { keys: ['secret.pf_no', 'rows.family', 'profile.blood', 'made.up'] }); assert.deepStrictEqual(st.required, ['secret.pf_no', 'rows.family', 'profile.blood']);
  p = await ACT.profGet(user, { id: e.id }); assert.deepStrictEqual(p.complete.missing, ['Blood group', 'PF number', 'Family (at least one)']); assert.ok(p.complete.pct > 20 && p.complete.pct < 100);
  assert.deepStrictEqual((await ACT.listAll(ses('user', SITE2))).required, [], 'another site has its own');
  await ACT.profRequiredSave(admin, { keys: [] });
  await no(ACT.empDelete(admin, { id: e.id, reason: 'try' }), /personal details \(KYC \/ profile\)/, 409);
});

test('leave: the policy with its date; the balance counted; asked – refused beyond the balance; the reporting person then the HR office; the muster reads L', async () => {
  const site = tag + 'L', A = ses('admin', site), U = ses('user', site), S = ses('super', site), month = TODAY.slice(0, 7), first = month + '-01';
  const sf = m => ({ site: site, email: m, name: 'Self', role: 'self', info: {} });
  const mb = mail('lvboss'), mw = mail('lvwork'), boss = await ACT.empSave(U, { name: 'Leave Boss', category: 'staff', mobile: mob(), email: mb, dob: '1980-01-01', joined_on: '2026-01-01' });
  const w = await ACT.empSave(U, { name: 'Leave Worker', category: 'labour', mobile: mob(), email: mw, dob: '1990-01-01', joined_on: '2026-01-01', reports_to: boss.id });
  await no(ACT.leaveAsk(sf(mw), { from: TODAY, reason: 'Family function' }), /No leave policy is set/);
  await no(ACT.leavePolicySave(U, { per_month: 4 }), /Only the HR Admin/, 403); await no(ACT.leavePolicySave(A, { per_month: 40 }), /0 to 31/);
  await no(ACT.leavePolicySave(A, { per_month: 4, valid_from: ago(40) }), /only by the Super Admin/, 403);
  let p = await ACT.leavePolicySave(S, { per_month: 4, valid_from: first }); assert.deepStrictEqual(p.policy, { valid_from: first, per_month: 4, carry: true, auto_absent: true, levels: 2 });
  let me1 = await ACT.myLeave(sf(mw)); assert.deepStrictEqual([me1.balance, me1.available, me1.month.credit, me1.requests.length], [4, 4, 4, 0], 'no attendance at this site yet: nobody is absent');
  await no(ACT.myLeave(U), /not in the Employee Master/, 403);
  // the HR office adds to one balance – a new row with the reason
  await no(ACT.leaveAdjust(U, { id: w.id, days: 2, reason: 'opening balance' }), /Only the HR Admin/, 403); await no(ACT.leaveAdjust(A, { id: w.id, days: 0, reason: 'x y z' }), /not 0/); await no(ACT.leaveAdjust(A, { id: w.id, days: 1, reason: '' }), /Reason/);
  let bal = await ACT.leaveAdjust(A, { id: w.id, days: 1.5, reason: 'opening balance' }); assert.strictEqual(bal.rows.find(r => r.id === w.id).balance, 5.5); assert.strictEqual(bal.rows.find(r => r.id === boss.id).balance, 4);
  // asking
  await no(ACT.leaveAsk(sf(mw), { from: ago(1), reason: 'Family function' }), /today or a day to come/); await no(ACT.leaveAsk(sf(mw), { from: ago(-3), to: ago(-5), part: 'first', reason: 'abc' }), /half day is for one day/);
  await no(ACT.leaveAsk(sf(mw), { from: ago(-3), to: ago(-9), reason: 'long' }), /Not enough leave: you ask 7, the balance is 5\.5/);
  me1 = await ACT.leaveAsk(sf(mw), { from: ago(-3), to: ago(-4), reason: 'Family function' }); const rq = me1.requests[0];
  assert.deepStrictEqual([rq.from, rq.to, rq.days, rq.status, rq.level, me1.pending, me1.available], [ago(-3), ago(-4), 2, 'pending', 1, 2, 3.5]);
  await no(ACT.leaveAsk(sf(mw), { from: ago(-4), reason: 'again' }), /already there/, 409);
  // level 1: the reporting person; then the HR office
  await no(ACT.leaveDecide(A, { id: rq.id, decision: 'approved' }), /still waits for the reporting person/, 403);
  let t = await ACT.teamLeaves(sf(mb)); assert.deepStrictEqual([t.team, t.rows.map(r => r.id)], [1, [rq.id]]); await no(ACT.teamLeaveDecide(sf(mw), { id: rq.id, decision: 'approved' }), /does not report to you/, 403);
  t = await ACT.teamLeaveDecide(sf(mb), { id: rq.id, decision: 'approved' }); assert.strictEqual(t.rows.length, 0);
  await no(ACT.leaveDecide(U, { id: rq.id, decision: 'approved' }), /Only the HR Admin/, 403); await no(ACT.leaveDecide(ses('admin'), { id: rq.id, decision: 'approved' }), /not found on this site/, 404);
  let l = await ACT.leaveList(U, { status: 'pending' }); assert.deepStrictEqual(l.rows.map(r => [r.id, r.level, r.name]), [[rq.id, 2, 'Leave Worker']]);
  await ACT.leaveDecide(A, { id: rq.id, decision: 'approved', note: 'ok' }); await no(ACT.leaveDecide(A, { id: rq.id, decision: 'refused', note: 'late' }), /already decided/, 409);
  me1 = await ACT.myLeave(sf(mw)); assert.deepStrictEqual([me1.balance, me1.booked, me1.pending, me1.available, me1.requests[0].status], [5.5, 2, 0, 3.5, 'approved']);
  // a half day; refused with the reason; taken back by himself
  me1 = await ACT.leaveAsk(sf(mw), { from: ago(-10), part: 'second', reason: 'Bank work' }); const h = me1.requests[0]; assert.deepStrictEqual([h.days, h.part], [0.5, 'second']);
  await ACT.teamLeaveDecide(sf(mb), { id: h.id, decision: 'approved' }); await no(ACT.leaveDecide(A, { id: h.id, decision: 'refused', note: '' }), /write why it is refused/);
  await ACT.leaveDecide(A, { id: h.id, decision: 'refused', note: 'work at the plant' }); me1 = await ACT.myLeave(sf(mw)); assert.deepStrictEqual([me1.requests[0].status, me1.requests[0].note, me1.available], ['refused', 'work at the plant', 3.5]);
  me1 = await ACT.leaveAsk(sf(mw), { from: ago(-20), reason: 'Village fair' }); const c = me1.requests[0]; await no(ACT.leaveCancel(sf(mb), { id: c.id }), /still waits/, 409);
  me1 = await ACT.leaveCancel(sf(mw), { id: c.id }); assert.deepStrictEqual([me1.requests[0].status, me1.pending], ['cancelled', 0]);
  // the boss has nobody above him: his own request goes straight to the HR office
  const b1 = await ACT.leaveAsk(sf(mb), { from: ago(-2), reason: 'Personal work' }); assert.strictEqual(b1.requests[0].level, 2);
  // the muster and his month read L on an approved leave day that is in this month
  if (ago(-3).slice(0, 7) === month) {
    const m = await ACT.muster(U, { month }), row = m.rows.find(r => r.id === w.id), i = m.days.indexOf(ago(-3)); assert.strictEqual(row.codes[i], 'L'); assert.ok(row.total.L >= 1);
    const mm = await ACT.myMonth(sf(mw), { month }); assert.strictEqual(mm.all.find(d => d.day === ago(-3)).code, 'L');
  }
  assert.deepStrictEqual((await ACT.leavePolicy(ses('user', SITE2))).versions, [], 'another site has its own policy'); await no(ACT.empDelete(A, { id: w.id, reason: 'try' }), /leave/, 409);
});

test('(the app\'s "Me") my record and my papers: his own only – the id the phone sends is not used; numbers masked; he attaches and opens his own paper, never another person\'s', async () => {
  const s1 = self(mail1), s2 = self(mail2), A = ses('admin');
  await no(ACT.myHr(self(mail('nobody'))), /not in the Employee Master/, 403);
  let h = await ACT.myHr(s1); assert.strictEqual(h.employee.code, E1.code); assert.strictEqual(h.details[0].name, 'Employee'); assert.ok(h.details[0].rows.some(r => r.label === 'Date of birth' && r.value === '01-01-1991'));
  assert.ok(h.complete === null || (h.complete.pct >= 0 && h.complete.pct <= 100)); assert.ok(h.docs.missing.indexOf('PAN card') > -1); assert.strictEqual(typeof h.phone.bound, 'boolean');
  { await ACT.profSave(A, { id: E1.id, group: 'secret', data: { bank_account: '123456789012', bank_ifsc: 'SBIN0001234' } }); h = await ACT.myHr(s1); const bank = h.details.find(g => g.name === 'Statutory & bank');
    assert.deepStrictEqual(bank.rows.map(r => r.value).sort(), ['SBIN0001234', 'XXXX9012'], 'his account number is masked for him too'); }
  const body = Buffer.from('%PDF-1.4 rig mine'), u = await ACT.myDocUploadUrl(s1, { id: E2.id, kind: 'pan', type: 'application/pdf', bytes: body.length });
  assert.match(u.path, new RegExp('^' + E1.id + '/[0-9a-f]{24}\\.pdf$'), 'his own folder – not the id the phone sent');
  const r = await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body }); assert.ok(r.ok);
  await no(ACT.myDocAdd(s2, { kind: 'pan', path: u.path, bytes: body.length }), /does not belong to this employee/);
  const made = await ACT.myDocAdd(s1, { id: E2.id, kind: 'pan', path: u.path, bytes: body.length, number: 'abcde1234f' }); assert.ok(made.id);
  const l = await ACT.myDocs(s1); assert.ok(l.docs.some(d => d.id === made.id && d.kind === 'pan' && d.number === 'ABCDE1234F')); assert.ok(l.docsMissing.indexOf('PAN card') < 0);
  assert.ok(!(await ACT.myDocs(s2)).docs.some(d => d.id === made.id), 'another person does not see it');
  const k = await ACT.myDocLink(s1, { doc: made.id }); assert.match((await (await fetch(k.url)).text()), /rig mine/);
  await no(ACT.myDocLink(s2, { doc: made.id }), /not found/, 404); await no(ACT.myDocLink(s1, { doc: 'x' }), /not found/, 404);
  assert.ok((await ACT.docList(A, { id: E1.id })).docs.some(d => d.id === made.id), 'the HR office sees the paper he attached');
});

test('the profile picture: the newest paper "Photo" that is a picture – he sets it himself; the office sees the faces of its own site only; a PDF is not a face', async () => {
  const s1 = self(mail1), A = ses('admin'), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  assert.strictEqual((await ACT.myHr(s1)).photo, '', 'none yet'); assert.deepStrictEqual((await ACT.empPhotos(A, { ids: [E1.id] })).photos, {});
  const u = await ACT.myDocUploadUrl(s1, { kind: 'photo', type: 'image/png', bytes: png.length }); assert.ok((await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' }, body: png })).ok);
  await ACT.myDocAdd(s1, { kind: 'photo', path: u.path, bytes: png.length });
  const h = await ACT.myHr(s1); assert.match(h.photo, /^http/); assert.strictEqual(Buffer.from(await (await fetch(h.photo)).arrayBuffer()).length, png.length);
  const f = await ACT.empPhotos(A, { ids: [E1.id, E2.id, 'x'] }); assert.deepStrictEqual(Object.keys(f.photos), [E1.id]); assert.ok((await fetch(f.photos[E1.id])).ok);
  assert.deepStrictEqual((await ACT.empPhotos(ses('admin', SITE2), { ids: [E1.id] })).photos, {}, 'another site does not get his face');
  await no(ACT.empPhotos(s1, { ids: [E1.id] }), /HR office only/, 403);
});

test('(12-11-2026) the late rule of a month, very late, a forgotten OUT closed at the shift\'s time; once a day – on the days as the muster reads them and for the phone', async () => {
  const S2 = ses('super', SITE2), now = new Date(Date.now() + 19800000), lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7), d = n => lm + '-' + String(n).padStart(2, '0');
  const w = await ACT.empSave(S2, { name: 'Late Rule', category: 'staff', mobile: mob(), email: mail('late'), dob: '1990-01-01', joined_on: lm + '-01' });
  let a = await ACT.shiftSave(S2, { name: 'Day ' + tag, start_time: '08:30', end_time: '18:00', auto_out: '23:50', valid_from: lm + '-01' }); assert.strictEqual(a.shifts.find(x => x.name === 'Day ' + tag).auto_out, '23:50');
  await no(ACT.shiftSave(S2, { name: 'Bad ' + tag, start_time: '08:30', end_time: '18:00', auto_out: '08:30' }), /not the time the shift starts/);
  a = await ACT.rulesSave(S2, { valid_from: lm + '-01', grace_min: 0, late_free: 3, half_after_min: 120, once: 'yes' }); assert.deepStrictEqual([a.rules.late_free, a.rules.half_after_min, a.rules.once], [3, 120, true]);
  // days 10–13: a little late each; 14: on time; 15: late again (the 5th); 16: three hours late; 17: IN only – he forgot OUT
  for (const [n, i, o] of [[10, '08:40', '18:00'], [11, '08:41', '18:00'], [12, '08:42', '18:00'], [13, '08:43', '18:00'], [14, '08:30', '18:00'], [15, '08:45', '18:00'], [16, '11:30', '19:00'], [17, '08:20', '']]) await ACT.daySet(S2, { id: w.id, day: d(n), in_time: i, out_time: o, reason: 'Rig – the late rule' });
  const m = await ACT.muster(S2, { month: lm }), row = m.rows.find(r => r.id === w.id), at = n => row.codes[m.days.indexOf(d(n))];
  assert.deepStrictEqual([10, 11, 12, 13, 14, 15, 16, 17].map(at), ['P', 'P', 'P', 'HD', 'P', 'HD', 'HD', 'A'], 'three late days only marked; the 4th and 5th a half day; very late a half day; no OUT = closed by itself, absent');
  const one = await ACT.dayGet(S2, { id: w.id, day: d(17) }), four = await ACT.dayGet(S2, { id: w.id, day: d(13) });
  assert.strictEqual(one.day.auto, true); assert.strictEqual(four.day.late_half, true);
  // a week in the middle of the month is read with the month's own count (the late days before it are counted)
  const mm = await ACT.myMonth(self(mail('late'), SITE2), { month: lm }); assert.strictEqual(mm.all.find(x => x.day === d(13)).code, 'HD'); assert.strictEqual(mm.all.find(x => x.day === d(17)).auto, true);
  // the phone: what the server says of today – and "once a day" at the first site, where he was IN and OUT today already
  const me1 = await ACT.myAttend(self(mail('late'), SITE2), {}); assert.deepStrictEqual([me1.next, me1.once, me1.shift.name, me1.shift.auto_out], ['in', true, 'Day ' + tag, '23:50']);
  await ACT.rulesSave(ses('super'), Object.assign({}, (await ACT.attSetup(ses('admin'))).rules, { once: 'yes' }));
  const s1 = self(mail1), st = await ACT.myAttend(s1, { device_id: 'rig-phone-' + tag + '-1' });
  if (st.punches.some(p => p.kind === 'in') && st.next !== 'out') { assert.strictEqual(st.next, 'done'); await no(ACT.punch(s1, P({ client_id: cid() })), /attendance is done – one IN and one OUT a day/, 409); }
  else assert.ok(['in', 'out'].indexOf(st.next) > -1);
});

test('(step 9) the face: registered once from five pictures of ONE person; a punch\'s photo must be his – another person\'s is refused and nothing is saved; reset by the HR Admin', { timeout: 150000 }, async () => {
  const FA = require('../api/face').ACT, F = require('../lib/face'), jpeg = require('jpeg-js'), fsx = require('fs'), px = require('path');
  // pictures of single faces, cut out of the sample pictures that come with the face library (nobody of ours)
  const m = await F.load(), raw = jpeg.decode(fsx.readFileSync(px.join(px.dirname(require.resolve('@vladmandic/face-api/package.json')), 'demo', 'sample1.jpg')), { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 512 });
  const img = m.tf.tensor3d(raw.data, [raw.height, raw.width, 3], 'int32'), found = (await m.api.detectAllFaces(img, new m.api.SsdMobilenetv1Options({ minConfidence: 0.6 }))).sort((a, b) => a.box.x - b.box.x); img.dispose(); assert.ok(found.length >= 2);
  const cut = (f, light, q) => { const b = f.box, pad = Math.round(b.width * 0.5), x0 = Math.max(0, Math.round(b.x) - pad), y0 = Math.max(0, Math.round(b.y) - pad), w = Math.min(raw.width - x0, Math.round(b.width) + 2 * pad), h = Math.min(raw.height - y0, Math.round(b.height) + 2 * pad), o = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y0 + y) * raw.width + x0 + x) * 3, d = (y * w + x) * 4; for (let k = 0; k < 3; k++) o[d + k] = Math.min(255, raw.data[s + k] * light); o[d + 3] = 255; }
    return jpeg.encode({ data: o, width: w, height: h }, q).data; };
  const A = found[0], B = found[1], s1 = self(mail1), admin = ses('admin'), sup = ses('super');
  const put = async (url, body) => assert.ok((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body })).ok);
  // before: not asked, not registered
  let st = await FA.faceState(s1); assert.deepStrictEqual([st.required, st.enrolled, st.min], [false, false, 90]);
  await no(FA.faceCheck(s1, { client_id: cid() }), /not registered yet/, 409); await no(FA.faceInfo(s1, { id: E1.id }), /HR office only/, 403);
  // five pictures: one of them of another person – refused, nothing registered
  let u = await FA.faceEnrolUrls(s1); assert.deepStrictEqual(u.pictures.map(p => p.pose), ['front', 'left', 'right', 'up', 'down']);
  for (const p of u.pictures) await put(p.url, cut(p.pose === 'up' ? B : A, 1, 90));
  await no(FA.faceEnrol(s1, { token: u.token }), /Up: this is not the same face/); assert.strictEqual((await FA.faceState(s1)).enrolled, false);
  await no(FA.faceEnrol(s1, { token: 'a'.repeat(24) }), /Front: the picture did not arrive/);
  // five pictures of himself (lighter, darker, another quality): registered – once
  u = await FA.faceEnrolUrls(s1); const looks = { front: [1, 92], left: [0.85, 80], right: [1.1, 85], up: [0.75, 70], down: [0.95, 60] };
  for (const p of u.pictures) await put(p.url, cut(A, looks[p.pose][0], looks[p.pose][1]));
  assert.deepStrictEqual(await FA.faceEnrol(s1, { token: u.token, device: { id: 'rig-phone-' + tag + '-1', model: 'Rig Phone' } }), { enrolled: true });
  await no(FA.faceEnrolUrls(s1), /registered already/, 409); assert.strictEqual((await FA.faceState(s1)).enrolled, true);
  // a punch's photo: his own matches (at least 90 %), another person's does not – noted, refused
  const shot = async (who, light) => { const c = cid(), su = await ACT.selfieUrl(s1, { client_id: c }); await put(su.url, cut(who, light, 75)); return c; };
  const mine = await shot(A, 0.9), ok = await FA.faceCheck(s1, { client_id: mine }); assert.strictEqual(ok.match, true); assert.ok(ok.pct >= 90, 'his own face: ' + ok.pct + ' %');
  const other = await shot(B, 1); await no(FA.faceCheck(s1, { client_id: other }), /the face does not match the registered face of .* at least 90 % is needed\)\. Nothing is saved\./, 403);
  await no(FA.faceCheck(s1, { client_id: cid() }), /did not arrive/);
  // the rule on: a punch whose photo was not found his is not taken; one that was passes this check
  const was = (await ACT.attSetup(admin)).rules; await ACT.rulesSave(sup, Object.assign({}, was, { face: 'yes', face_min: 90 })); assert.strictEqual((await ACT.myAttend(s1, {})).face, true);
  // (the punch itself: the server's check of "this punch's photo was found his" is read in the unit test – here his phone was released in an earlier test)
  // the HR office: what is registered, the checks with how far they matched; reset with the reason – then he registers again
  const info = await FA.faceInfo(admin, { id: E1.id }); assert.strictEqual(info.enrolled, true); assert.strictEqual(info.pictures.length, 5); assert.ok(info.tries.some(t => t.result === 'nomatch' && t.kind === 'punch' && t.match_pct < 90) && info.tries.some(t => t.result === 'ok' && t.kind === 'punch'));
  assert.strictEqual((await FA.faceInfo(ses('user'), { id: E1.id })).pictures.length, 0, 'the pictures: HR Admin / Super Admin only');
  await no(FA.faceReset(ses('user'), { id: E1.id, reason: 'try' }), /Only the HR Admin/, 403); await no(FA.faceReset(admin, { id: E1.id, reason: '' }), /Reason/); await no(FA.faceInfo(ses('admin', SITE2), { id: E1.id }), /not found on this site/, 404);
  assert.deepStrictEqual(await FA.faceReset(admin, { id: E1.id, reason: 'Registered in bad light' }), { reset: true }); st = await FA.faceState(s1); assert.strictEqual(st.enrolled, false);
  assert.strictEqual((await FA.faceInfo(admin, { id: E1.id })).resets.length, 1); await ACT.rulesSave(sup, was);
});

test('(step 10) the month: the site\'s HR verifies people after the month ended – not one with something waiting; the HO HR sends back or approves; an approved month is closed; the Super Admin opens it again', async () => {
  const SM = tag + 'M', aM = ses('admin', SM), uM = ses('user', SM), sM = ses('super', SM), D = require('../lib/day'), MO = require('../lib/month');
  const today = require('../lib/rules').today(), month = D.addDays(today.slice(0, 8) + '01', -1).slice(0, 7), d5 = month + '-05', d6 = month + '-06', nDays = +MO.lastDay(month).slice(8);
  const A = await ACT.empSave(aM, { name: 'Month One', category: 'staff', mobile: mob(), email: mail('m1'), dob: '1990-02-02', joined_on: '2024-01-01' });
  const B = await ACT.empSave(aM, { name: 'Month Two', category: 'labour', mobile: mob(), email: mail('m2'), dob: '1990-03-03', joined_on: '2024-01-01' });
  await ACT.daySet(sM, { id: A.id, day: d5, in_time: '09:00', out_time: '18:00', reason: 'rig month' });
  await db('POST', 'hr_regularize', [{ employee_id: B.id, site: SM, day: d6, in_time: '09:00', out_time: '18:00', reason: 'rig waiting', level: 2, asked_by: 'x@rig.test' }], 'return=minimal');
  // the month as it stands: nobody verified; the counts; who waits is said
  let m = await ACT.monthList(uM, { month });
  const a = () => m.rows.find(r => r.id === A.id), b = () => m.rows.find(r => r.id === B.id);
  assert.deepStrictEqual([m.ended, m.approved, m.sum, m.can], [true, null, { people: 2, verified: 0, changed: 0, returned: 0, open: 2 }, { verify: false, ho: false, reopen: false }]);
  assert.deepStrictEqual([a().counts.present, a().counts.absent, a().counts.paid, a().state, a().blocked], [1, nDays - 5, 1, 'open', '']);
  assert.deepStrictEqual([b().counts.present, b().counts.absent, b().waiting], [0, nDays - 4, 1]); assert.match(b().blocked, /1 request\(s\) \/ doubtful punch\(es\) still wait/);
  // who may verify: the HR Admin with the power – not an HR User, not a running month
  await no(ACT.monthVerify(uM, { month, ids: [A.id] }), /Only the HR Admin or the Super Admin/, 403);
  await no(ACT.monthVerify(aM, { month: today.slice(0, 7), ids: [A.id] }), /verified after its last day/, 400);
  await no(ACT.monthVerify(aM, { month, ids: [] }), /Choose at least one person/, 400);
  await ACT.powerSet(sM, { power: 'month', allowed: false }); await no(ACT.monthVerify(aM, { month, ids: [A.id] }), /has not given the HR Admin this power/, 403); await ACT.powerSet(sM, { power: 'month', allowed: true });
  m = await ACT.monthVerify(aM, { month, ids: [A.id, B.id] });
  assert.deepStrictEqual([m.saved, m.skipped.length, m.skipped[0].code, a().state, b().state, a().verified.by, a().verified.counts.present, m.can.verify], [1, 1, B.code, 'verified', 'open', 'admin@rig.test', 1, true]);
  await db('PATCH', 'hr_regularize?employee_id=eq.' + B.id + '&status=eq.pending', { status: 'refused' }, 'return=minimal');
  m = await ACT.monthVerify(aM, { month, ids: [B.id] }); assert.deepStrictEqual([m.saved, m.sum.verified], [1, 2]);
  // the HO HR: only whom the Super Admin gave it
  await no(ACT.monthApprove(aM, { month }), /Only the HO HR or the Super Admin/, 403); await no(ACT.monthSites(uM, { month }), /Only the HO HR/, 403);
  await no(ACT.hoSet(aM, { email: 'user@rig.test', on: true }), /Only the Super Admin/, 403); await no(ACT.hoSet(sM, { email: 'nobody', on: true }), /E-mail/, 400);
  const h = await ACT.hoSet(sM, { email: 'User@Rig.Test', on: true }); assert.ok(h.rows.some(r => r.email === 'user@rig.test' && r.active));
  m = await ACT.monthList(uM, { month }); assert.strictEqual(m.can.ho, true);
  const st = (await ACT.monthSites(uM, { month })).sites.find(x => x.code === SM); assert.deepStrictEqual([st.people, st.verified, st.returned, st.approved], [2, 2, 0, null]);
  // a day changed after the verification: said, and the month is not approved with it
  await ACT.daySet(sM, { id: A.id, day: d6, in_time: '09:00', out_time: '18:00', reason: 'rig month 2' });
  m = await ACT.monthList(uM, { month }); assert.deepStrictEqual([a().state, a().counts.present, a().verified.counts.present], ['changed', 2, 1]);
  await no(ACT.monthApprove(uM, { month }), new RegExp('1 of 2 people are not verified.*' + A.code), 400);
  await no(ACT.monthReturn(uM, { month, ids: [B.id], reason: '' }), /Reason/, 400);
  m = await ACT.monthReturn(uM, { month, ids: [B.id], reason: 'check the absent days' }); assert.deepStrictEqual([b().state, b().returned.reason, b().returned.by], ['returned', 'check the absent days', 'user@rig.test']);
  m = await ACT.monthVerify(aM, { month, ids: [A.id, B.id] }); assert.deepStrictEqual([m.saved, a().state, b().state, b().returned], [2, 'verified', 'verified', null]);
  m = await ACT.monthApprove(uM, { month, note: 'ok' }); assert.deepStrictEqual([m.approved.by, m.approved.people, m.approved.note, m.can.verify], ['user@rig.test', 2, 'ok', false]);
  // approved: closed for everybody
  await no(ACT.daySet(sM, { id: A.id, day: d5, none: true, reason: 'after approval' }), /approved by the HO HR – no day of that month is changed/, 409);
  await no(ACT.monthVerify(aM, { month, ids: [A.id] }), /approved by the HO HR/, 409); await no(ACT.monthReturn(uM, { month, ids: [A.id], reason: 'late' }), /approved by the HO HR/, 409);
  assert.strictEqual((await ACT.monthSites(uM, { month })).sites.find(x => x.code === SM).approved.by, 'user@rig.test');
  await no(ACT.monthReopen(aM, { month, reason: 'x y z' }), /Only the Super Admin/, 403); await no(ACT.monthReopen(sM, { month, reason: '' }), /Reason/, 400);
  m = await ACT.monthReopen(sM, { month, reason: 'one day was wrong' }); assert.deepStrictEqual([m.approved, m.reopened.reason, m.can.verify, a().state], [null, 'one day was wrong', true, 'verified']);
  await ACT.hoSet(sM, { email: 'user@rig.test', on: false }); assert.strictEqual((await ACT.monthList(uM, { month })).can.ho, false);
  const log = (await db('GET', 'hr_audit?select=action&site=eq.' + SM + '&order=id')).map(r => r.action);
  for (const k of ['Month verified', 'Month sent back to the site\'s HR', 'Month approved (HO HR)', 'Approved month opened again', 'HO HR given', 'HO HR taken']) assert.ok(log.indexOf(k) > -1, k);
});

test('(step 11) a salary: proposed by the HR Admin (not an HR User), one waiting a person; approved by the HO HR – never by who proposed it; sent back with the reason; the newest approved one counts; the amount is not in the audit', async () => {
  const SP = tag + 'P', aP = ses('admin', SP), uP = ses('user', SP), sP = ses('super', SP), today = require('../lib/rules').today();
  aP.info = uP.info = sP.info = { sites: [{ code: SP, name: 'Rig pay' }] };
  const E = await ACT.empSave(aP, { name: 'Pay One', category: 'operator', mobile: mob(), email: mail('pay1'), dob: '1992-04-04', joined_on: '2026-01-10' });
  await no(ACT.salaryGet(uP, { id: E.id }), /seen only by the HR Admin of the site, the HO HR and the Super Admin/, 403);
  await no(ACT.salaryAsk(uP, { id: E.id, pay_type: 'monthly', amount: '18000' }), /Only the HR Admin or the Super Admin/, 403);
  let g = await ACT.salaryGet(aP, { id: E.id }); assert.deepStrictEqual([g.current, g.waiting, g.history, g.can], [null, null, [], { ask: true, decide: false }]);
  await no(ACT.salaryAsk(aP, { id: E.id, pay_type: 'weekly', amount: '18000' }), /Salary type/, 400);
  for (const bad of ['', '0', '-5', '12.345', 'abc', '100000000']) await no(ACT.salaryAsk(aP, { id: E.id, pay_type: 'monthly', amount: bad }), /Amount: a number above 0/, 400);
  await ACT.powerSet(sP, { power: 'salary', allowed: false }); await no(ACT.salaryAsk(aP, { id: E.id, pay_type: 'monthly', amount: '18000' }), /has not given the HR Admin this power/, 403); await ACT.powerSet(sP, { power: 'salary', allowed: true });
  g = await ACT.salaryAsk(aP, { id: E.id, pay_type: 'monthly', amount: '18,000.50', note: 'joining' });
  assert.deepStrictEqual([g.current, g.waiting.amount, g.waiting.pay_type, g.waiting.valid_from, g.waiting.asked_by, g.can.ask], [null, 18000.5, 'monthly', '2026-01-10', 'admin@rig.test', false]);
  await no(ACT.salaryAsk(aP, { id: E.id, pay_type: 'daily', amount: '700' }), /already waits for the HO HR/, 409);
  // the HO HR only; never his own proposal
  await no(ACT.salaryWaiting(aP), /Only the HO HR/, 403); await no(ACT.salaryDecide(aP, { id: g.waiting.id, decision: 'approved' }), /Only the HO HR/, 403);
  await ACT.hoSet(sP, { email: 'user@rig.test', on: true }); await ACT.hoSet(sP, { email: 'admin@rig.test', on: true });
  await no(ACT.salaryDecide(aP, { id: g.waiting.id, decision: 'approved' }), /another person than the one who proposed it/, 403);
  let w = await ACT.salaryWaiting(uP); const row = w.rows.find(r => r.id === g.waiting.id);
  assert.deepStrictEqual([row.code, row.name, row.is_new, row.now, row.amount, row.site, row.mine], [E.code, 'Pay One', true, null, 18000.5, SP, false]);
  assert.strictEqual((await ACT.salaryWaiting(aP)).rows.find(r => r.id === g.waiting.id).mine, true);
  await no(ACT.salaryDecide(ses('user', SITE), { id: g.waiting.id, decision: 'approved' }), /not found on your sites/, 404);
  await no(ACT.salaryDecide(uP, { id: g.waiting.id, decision: 'returned', note: '' }), /Reason/, 400);
  await ACT.salaryDecide(uP, { id: g.waiting.id, decision: 'returned', note: 'too high' });
  g = await ACT.salaryGet(aP, { id: E.id }); assert.deepStrictEqual([g.current, g.waiting, g.history[0].status, g.history[0].decide_note, g.can.ask], [null, null, 'returned', 'too high', true]);
  g = await ACT.salaryAsk(aP, { id: E.id, pay_type: 'monthly', amount: '17000' }); await ACT.salaryDecide(uP, { id: g.waiting.id, decision: 'approved' });
  await no(ACT.salaryDecide(uP, { id: g.waiting.id, decision: 'approved' }), /already decided/, 409);
  g = await ACT.salaryGet(aP, { id: E.id }); assert.deepStrictEqual([g.current.amount, g.current.decided_by, g.waiting, g.history.length], [17000, 'user@rig.test', null, 2]);
  // a later salary: it counts from its date – until then the old one
  const next = require('../lib/day').addDays(today, 30); g = await ACT.salaryAsk(aP, { id: E.id, pay_type: 'daily', amount: '800', valid_from: next });
  w = await ACT.salaryWaiting(uP); assert.deepStrictEqual([w.rows.find(r => r.id === g.waiting.id).is_new, w.rows.find(r => r.id === g.waiting.id).now], [false, { pay_type: 'monthly', amount: 17000 }]);
  await ACT.salaryDecide(sP, { id: g.waiting.id, decision: 'approved' }); g = await ACT.salaryGet(sP, { id: E.id }); assert.deepStrictEqual([g.current.amount, g.history.length, g.history[0].status], [17000, 3, 'approved']);
  await ACT.hoSet(sP, { email: 'user@rig.test', on: false }); await ACT.hoSet(sP, { email: 'admin@rig.test', on: false });
  const log = await db('GET', 'hr_audit?select=action,detail&site=eq.' + SP + '&action=like.Salary*'); assert.ok(log.length >= 5); assert.ok(!/17000|18000|800/.test(JSON.stringify(log)), 'no amount in the audit');
  await no(db('DELETE', 'hr_salaries?employee_id=eq.' + E.id), /Database|refused|permission/);
});

test('(step 12) payroll: only the HO HR; only after the month is approved; counted from the verified days and the approved salary; PF / ESIC / PT as set and ticked; the advance; locked in one piece – never changed again; his own payslip', async () => {
  const SQ = tag + 'Q', aQ = ses('admin', SQ), uQ = ses('user', SQ), sQ = ses('super', SQ), D = require('../lib/day'), MO = require('../lib/month');
  aQ.info = uQ.info = sQ.info = { sites: [{ code: SQ, name: 'Rig roll' }] };
  const today = require('../lib/rules').today(), month = D.addDays(today.slice(0, 8) + '01', -1).slice(0, 7), nDays = +MO.lastDay(month).slice(8), d5 = month + '-05', d6 = month + '-06';
  const mk = async (name, cat, k) => ACT.empSave(aQ, { name, category: cat, mobile: mob(), email: mail(k), dob: '1990-05-05', joined_on: '2024-01-01' });
  const A = await mk('Roll One', 'staff', 'roll1'), B = await mk('Roll Two', 'labour', 'roll2'), C = await mk('Roll Three', 'driver', 'roll3');
  for (const [e, d] of [[A, d5], [A, d6], [B, d5], [C, d5]]) await ACT.daySet(sQ, { id: e.id, day: d, in_time: '09:00', out_time: '18:00', reason: 'rig roll' });
  await ACT.hoSet(sQ, { email: 'user@rig.test', on: true });
  for (const [e, t, amt] of [[A, 'monthly', nDays * 1000], [B, 'daily', 500]]) { const g = await ACT.salaryAsk(aQ, { id: e.id, pay_type: t, amount: String(amt) }); await ACT.salaryDecide(uQ, { id: g.waiting.id, decision: 'approved' }); }
  // only the HO HR; only after the month's attendance is approved
  await no(ACT.payList(aQ, { month }), /only for the HO HR and the Super Admin/, 403); for (const k of ['paySettings', 'advList']) await no(ACT[k](aQ, {}), /only for the HO HR/, 403);
  let p = await ACT.payList(uQ, { month }); assert.strictEqual(p.ready, false); assert.match(p.reason, /not approved by the HO HR yet/); await no(ACT.payLock(uQ, { month }), /not approved by the HO HR yet/, 400);
  await ACT.monthVerify(aQ, { month, ids: [A.id, B.id, C.id] }); await ACT.monthApprove(uQ, { month });
  // the settings (made-up numbers of the test), the ticks, an advance, an addition
  await no(ACT.paySettingsSave(uQ, { pf_pct: 'twelve' }), /PF %: a number/, 400);
  const st = await ACT.paySettingsSave(uQ, { valid_from: month + '-01', pf_pct: '12', pf_cap: '15000', esic_pct: '0.75', esic_limit: '21000', pt_slabs: [{ from: '1000', amount: '200' }] }); assert.ok(st.versions.length >= 1);
  await ACT.payFlags(uQ, { id: A.id, pf: true, esic: true, pt: true }); await ACT.payFlags(uQ, { id: B.id, esic: true, pt: true });
  await no(ACT.advGive(uQ, { id: A.id, amount: '1000', monthly: '5000' }), /not more than the advance/, 400);
  let ad = await ACT.advGive(uQ, { id: A.id, amount: '1000', monthly: '400', given_on: d5 }); assert.deepStrictEqual([ad.rows[0].left, ad.rows[0].status, ad.rows[0].code], [1000, 'active', A.code]);
  await no(ACT.advGive(uQ, { id: A.id, amount: '500', monthly: '100' }), /one advance at a time/, 409);
  await no(ACT.payAdjust(uQ, { month, id: A.id, other_earn: '100' }), /Another earning: write what it is for/, 400);
  p = await ACT.payAdjust(uQ, { month, id: A.id, other_earn: '100', earn_note: 'arrear of last month' });
  const row = e => p.rows.find(r => r.id === e.id);
  assert.deepStrictEqual([p.ready, p.locked, p.rows.length, p.problems], [true, null, 3, 1]);
  assert.deepStrictEqual([row(A).day, row(A).pay_days, row(A).earned, row(A).gross, row(A).pf, row(A).esic, row(A).pt, row(A).advance, row(A).net], [1000, 2, 2000, 2100, 240, 0, 200, 400, 1260]);
  assert.deepStrictEqual([row(B).pay_type, row(B).pay_days, row(B).earned, row(B).pf, row(B).esic, row(B).pt, row(B).net], ['daily', 1, 500, 0, 4, 0, 496]);
  assert.match(row(C).problem, /No approved salary/); assert.deepStrictEqual([p.totals.gross, p.totals.net], [2600, 1756]);
  // the lock: said who cannot be paid; then without him – everything in one piece
  await no(ACT.payLock(uQ, { month }), new RegExp('1 people cannot be paid.*' + C.code), 400); await no(ACT.payLock(aQ, { month, without: true }), /only for the HO HR/, 403);
  p = await ACT.payLock(uQ, { month, without: true }); assert.deepStrictEqual([p.locked.by, p.locked.people, p.rows.length, p.totals.net, row(A).net, row(A).advance_left_before], ['user@rig.test', 2, 2, 1756, 1260, 1000]);
  await no(ACT.payLock(uQ, { month, without: true }), /already locked/, 409); await no(ACT.payAdjust(uQ, { month, id: A.id, other_ded: '50', ded_note: 'late fine' }), /is locked – nothing of it is changed/, 409);
  ad = await ACT.advList(uQ); assert.deepStrictEqual([ad.rows[0].recovered, ad.rows[0].left, ad.rows[0].status], [400, 600, 'active']);
  await no(ACT.advClose(uQ, { id: ad.rows[0].id, reason: '' }), /Reason/, 400); ad = await ACT.advClose(uQ, { id: ad.rows[0].id, reason: 'paid back in cash' }); assert.deepStrictEqual([ad.rows[0].status, ad.rows[0].recovered], ['closed', 400]);
  // a changed setting does not touch the locked month; the database refuses a change of a payslip
  await ACT.paySettingsSave(uQ, { valid_from: month + '-01', pf_pct: '50' }); assert.strictEqual((await ACT.payList(uQ, { month })).rows.find(r => r.id === A.id).pf, 240);
  await no(db('PATCH', 'hr_payslips?employee_id=eq.' + A.id, { net: 1 }), /Database|refused|permission/); await no(db('DELETE', 'hr_pay_runs?site=eq.' + SQ), /Database|refused|permission/);
  // (12-11-2026) the locked month: one person's payslip to print, and the bank list – the HO HR only; an unlocked month has neither
  await no(ACT.payBank(aQ, { month }), /only for the HO HR/, 403); await no(ACT.paySlipOf(aQ, { month, id: A.id }), /only for the HO HR/, 403);
  await no(ACT.payBank(uQ, { month: today.slice(0, 7) }), /not locked yet/, 400);
  await db('POST', 'hr_employee_profile?on_conflict=employee_id', [{ employee_id: A.id, data: {}, secret: { bank_name: 'Rig Bank', bank_ifsc: 'RIGB0000001', bank_account: '000111222333', bank_holder: 'Roll One' }, updated_by: 'rig' }], 'resolution=merge-duplicates,return=minimal');
  const bk = await ACT.payBank(uQ, { month }), bA = bk.rows.find(r => r.code === A.code), bB = bk.rows.find(r => r.code === B.code);
  assert.deepStrictEqual([bk.rows.length, bk.total, bk.missing, bA.bank, bA.ifsc, bA.account, bA.net, bA.missing, bB.account, bB.missing, bB.net], [2, 1756, 1, 'Rig Bank', 'RIGB0000001', '000111222333', 1260, false, '', true, 496]);
  const ps = await ACT.paySlipOf(uQ, { month, id: A.id }); assert.deepStrictEqual([ps.employee.code, ps.employee.name, ps.slip.net, ps.slip.gross, ps.slip.deductions.map(l => l.label), ps.locked.by], [A.code, 'Roll One', 1260, 2100, ['PF', 'Profession Tax', 'Advance'], 'user@rig.test']);
  await no(ACT.paySlipOf(uQ, { month, id: C.id }), /no payslip in that month/, 404);
  const bLog = JSON.stringify(await db('GET', 'hr_audit?select=action,detail&site=eq.' + SQ + '&action=eq.Bank%20list%20taken')); assert.ok(/Bank list taken/.test(bLog) && !/000111222333|RIGB0000001/.test(bLog), 'that the list was taken is written – never a number');
  // his own payslip – only his
  const mine = await ACT.mySlips({ site: SQ, email: mail('roll1'), name: 'x', role: 'self', info: {} });
  assert.deepStrictEqual([mine.slips.length, mine.slips[0].month, mine.slips[0].net, mine.slips[0].gross, mine.slips[0].earnings.map(l => l.label), mine.slips[0].deductions.map(l => l.label + ' ' + l.amount)], [1, month, 1260, 2100, ['Earned pay', 'arrear of last month'], ['PF 240', 'Profession Tax 200', 'Advance 400']]);
  assert.strictEqual((await ACT.mySlips({ site: SQ, email: mail('roll3'), name: 'x', role: 'self', info: {} })).slips.length, 0);
  await ACT.paySettingsSave(uQ, { valid_from: month + '-01' }); await ACT.hoSet(sQ, { email: 'user@rig.test', on: false });
  const log = JSON.stringify(await db('GET', 'hr_audit?select=action,detail&site=eq.' + SQ + '&action=like.*dvance*')); assert.ok(!/"1000"|:1000\b|400\b/.test(log), 'no amount of an advance in the audit');
});

test('(the phone\'s reminders) my attendance says the free days of the coming week: the weekly offs of the rules and the holidays – nothing else of the office', async () => {
  const SR = tag + 'R', aR = ses('admin', SR), D = require('../lib/day'), today = require('../lib/rules').today();
  const E = await ACT.empSave(aR, { name: 'Remind One', category: 'staff', mobile: mob(), email: mail('rem1'), dob: '1990-06-06', joined_on: '2024-01-01' });
  const me = { site: SR, email: mail('rem1'), name: 'x', role: 'self', info: {} };
  let a = await ACT.myAttend(me, { device_id: 'rig-rem-1' }); assert.deepStrictEqual([a.week_off, a.days_off, a.shift], [[], [], null]);
  await ACT.rulesSave(aR, { week_off: [0, 6] }); await ACT.holidaySave(aR, { day: D.addDays(today, 3), name: 'Rig day' }); await ACT.holidaySave(aR, { day: D.addDays(today, 20), name: 'Far day' });
  await ACT.shiftSave(aR, { name: 'General ' + SR, start_time: '08:30', end_time: '17:30', auto_out: '23:50', valid_from: '2026-01-01' });
  a = await ACT.myAttend(me, { device_id: 'rig-rem-1' });
  assert.deepStrictEqual([a.week_off, a.days_off, a.shift.start, a.shift.end, a.shift.auto_out], [[0, 6], [D.addDays(today, 3)], '08:30', '17:30', '23:50']);
});

test('(what comes up) the office\'s list: papers running out within 30 days or run out, birthdays and years at work of the coming week; a person sees his own', async () => {
  const SC = tag + 'C', aC = ses('admin', SC), D = require('../lib/day'), today = require('../lib/rules').today(), y = +today.slice(0, 4);
  const born = (y - 30) + D.addDays(today, 3).slice(4), joined = (y - 5) + today.slice(4);
  const E = await ACT.empSave(aC, { name: 'Coming One', category: 'driver', mobile: mob(), email: mail('com1'), dob: born, joined_on: joined });
  const F = await ACT.empSave(aC, { name: 'Coming Two', category: 'staff', mobile: mob(), email: mail('com2'), dob: (y - 40) + D.addDays(today, 60).slice(4), joined_on: '2024-01-01' });
  await db('POST', 'hr_employee_docs', [{ employee_id: E.id, kind: 'licence', title: '', number: 'RIG1', expires_on: D.addDays(today, 10), path: 'rig/' + tag + 'a.pdf', mime: 'application/pdf', bytes: 10, created_by: 'rig' },
    { employee_id: E.id, kind: 'other', title: 'Medical', number: '', expires_on: D.addDays(today, -2), path: 'rig/' + tag + 'b.pdf', mime: 'application/pdf', bytes: 10, created_by: 'rig' },
    { employee_id: F.id, kind: 'other', title: 'Far paper', number: '', expires_on: D.addDays(today, 90), path: 'rig/' + tag + 'c.pdf', mime: 'application/pdf', bytes: 10, created_by: 'rig' }], 'return=minimal');
  const c = await ACT.hrComing(aC);
  assert.deepStrictEqual(c.papers.map(p => [p.code, p.left]), [[E.code, -2], [E.code, 10]]); assert.match(c.papers[1].paper, /licen/i);
  assert.deepStrictEqual(c.days.map(d => [d.code, d.what, d.in, d.years || 0]), [[E.code, 'work', 0, 5], [E.code, 'birthday', 3, 0]]);
  await no(ACT.hrComing({ site: SC, email: mail('com1'), name: 'x', role: 'self', info: {} }), /HR office only/, 403);
  const me = await ACT.myHr({ site: SC, email: mail('com1'), name: 'x', role: 'self', info: {} });
  assert.deepStrictEqual([me.coming.papers.map(p => p.left), me.coming.birthday, me.coming.work_years], [[-2, 10], false, 5]);
});

test('(13-11-2026) the employee sheet: the company\'s sheet adds people with ITS codes; a new one needs a mobile or an e-mail; the same code again CHANGES only the filled cells; pay only from the Admin, a salary only from the HO HR; the same columns come out', async () => {
  const SH = require('../lib/act_sheet'), c1 = 'RCL' + (((await db('GET', 'hr_numbers?select=next_no&kind=eq.emp')) || [{ next_no: 1 }])[0].next_no + 500 + Math.floor(Math.random() * 400)), c2 = 'M' + tag.slice(-4), c3 = '7' + String(Date.now()).slice(-5), m1 = mob(), m2 = mob(), m3 = mob(), des = 'Sheet Driver ' + tag;
  const pn = String(1000 + (Date.now() % 9000)), pan = k => 'ABCP' + k + pn + 'Z', uan = '1' + String(Date.now()).slice(-11), uan2 = '2' + String(Date.now()).slice(-11);
  // a designation says its category (the sheet has no Category column) – the HR Admin sets it; an HR User cannot
  let m = await ACT.masterSave(admin, { kind: 'designation', name: des, category: 'Driver' }); const d = m.designations.find(x => x.name === des); assert.strictEqual(d.category, 'driver');
  assert.strictEqual(m.designations.find(x => x.name === 'Desig ' + tag).category, 'staff', 'none set = Staff');
  await no(ACT.masterSave(admin, { kind: 'designation', id: d.id, name: des, category: 'boss' }), /Category: Staff, Operator, Driver or Labour/);
  const rows = [
    { _line: 2, company: 'Test Company Limited', branch: 'Branch ' + tag, project: 'Site A', uan: uan, name: 'Sheet One', code: c1.toLowerCase(), ctc: '25000', joined_on: '2024-04-01 00:00:00', employment_type: 'Permanent ' + tag, retained: '', sign_in: '00:00:00', sign_out: '00:00:00',
      pan: pan('A'), pf: 'Yes', probation_days: '0', esic_contribution_rate: '0', esic: 'No', esic_type: '', esic_deduction_rate: '0', pt: 'Yes', tds_type: 'NTDS', attach: '0', basic: '12000', pay_period: 'Monthly', annual_bonus: '0', deduct_income_tax: 'No', annual_medical: '0', annual_lta: '0', totals: '1',
      mobile: m1, email: '', designation: des, bank_name: 'Rig Bank', bank_ifsc: 'RIGB0001234', bank_account: '123456789012', bank_holder: 'Sheet One' },
    { _line: 3, company: 'Test Company Limited', branch: 'Branch ' + tag, project: 'Site A', name: 'Sheet Two', code: c2, ctc: '0', joined_on: '2025-01-15 00:00:00', pan: pan('B'), pf: 'No', esic: 'No', pt: 'No', email: mail('sheet2'), totals: '1' },
    { _line: 4, name: 'Sheet Nobody', code: c3, ctc: '18000', joined_on: '2026-02-01', pan: pan('C') },      // neither a mobile nor an e-mail
    { _line: 5, name: 'Sheet Bad', code: 'x', mobile: m1, pan: 'WRONG', pf: 'maybe', bank_ifsc: 'ABC', sign_in: '99:00' },
    { _line: 6, name: 'Sheet Twice', code: c2, mobile: m3 },
  ];
  // only looked at: nothing is saved
  let r = await ACT.sheetImport(sup, { rows: rows, check: 1 });
  assert.deepStrictEqual([r.checked, r.saved, r.rows, r.toAdd, r.toChange, r.faults], [true, 0, 5, 2, 0, 3]);
  const why = l => r.lines.find(x => x.line === l).why;
  assert.match(why(4), /Mobile or E-mail: a new employee needs one of them/);
  assert.match(why(5), /Employee Code: 2 to 20.*PAN: 10 letters.*Sign In: a time as HH:MM.*Bank IFSC Code: 11 letters.*Deduct PF: Yes or No.*Mobile is twice in the file \(line 2\)/);
  assert.match(why(6), /Employee Code is twice in the file \(line 3\)/);
  assert.ok(r.willMake.some(x => x === 'branch: Branch ' + tag) && r.willMake.some(x => x === 'employment_type: Permanent ' + tag)); assert.match(r.notes.join(' '), /monthly CTC of 1 employees becomes their approved salary/);
  assert.strictEqual(((await db('GET', 'hr_employees?select=id&code=in.("' + c1 + '","' + c2 + '")')) || []).length, 0);
  // saved by the Super Admin (he is the HO HR too): the codes of the sheet, the category of the designation, everything in its place
  r = await ACT.sheetImport(sup, { rows: rows });
  assert.deepStrictEqual([r.checked, r.added, r.changed, r.faults, r.salaries], [false, 2, 0, 3, 1]);
  const got = async code => ((await db('GET', 'hr_employees?select=*&code=eq.' + code)) || [])[0], e1 = await got(c1), e2 = await got(c2);
  assert.deepStrictEqual([e1.site, e1.name, e1.category, e1.mobile, e1.joined_on, e1.designation_id, e1.status], [SITE, 'Sheet One', 'driver', m1, '2024-04-01', d.id, 'incomplete']);
  assert.deepStrictEqual([e2.category, e2.email, e2.mobile, e2.joined_on], ['staff', mail('sheet2'), '', '2025-01-15']);
  const pr = ((await db('GET', 'hr_employee_profile?select=data,secret&employee_id=eq.' + e1.id)) || [])[0], lists = (await ACT.listAll(admin)).lists;
  assert.deepStrictEqual([pr.data.company, pr.data.project, pr.data.sign_in, pr.data.probation_days, lists.branch.find(v => v.id === pr.data.branch).name, lists.employment_type.find(v => v.id === pr.data.employment_type).name], ['Test Company Limited', 'Site A', '00:00', 0, 'Branch ' + tag, 'Permanent ' + tag]);
  assert.deepStrictEqual([pr.secret.uan, pr.secret.bank_ifsc, pr.secret.bank_account, pr.secret.ctc_monthly, pr.secret.basic, pr.secret.tds_type, pr.secret.deduct_income_tax, pr.secret.pay_period], [uan, 'RIGB0001234', '123456789012', 25000, 12000, 'NTDS', false, 'Monthly']);
  assert.strictEqual(((await db('GET', 'hr_employee_private?select=pan&employee_id=eq.' + e1.id)) || [])[0].pan, pan('A'));
  assert.deepStrictEqual(((await db('GET', 'hr_pay_emp?select=pf,esic,pt&employee_id=eq.' + e1.id)) || [])[0], { pf: true, esic: false, pt: true });
  const sal = (await db('GET', 'hr_salaries?select=pay_type,amount,valid_from,status,decided_by&employee_id=eq.' + e1.id)) || [];
  assert.deepStrictEqual(sal.map(v => [v.pay_type, +v.amount, v.valid_from, v.status, v.decided_by]), [['monthly', 25000, '2024-04-01', 'approved', sup.email]], 'the month\'s CTC is his approved salary');
  assert.strictEqual(((await db('GET', 'hr_salaries?select=id&employee_id=eq.' + e2.id)) || []).length, 0, 'a CTC of 0 is no salary');
  // the counter of the codes made by themselves went past the sheet's RCL… code
  const next = await ACT.empSave(admin, { name: 'After Sheet', category: 'staff', mobile: mob() }); assert.ok(+/^RCL(\d+)$/.exec(next.code)[1] > +/^RCL(\d+)$/.exec(c1)[1], next.code);
  // the same code again CHANGES him: only the filled cells; an empty cell changes nothing; nothing is added a second time
  r = await ACT.sheetImport(sup, { rows: [{ _line: 2, code: c1, name: '', email: mail('sheet1'), dob: '05-03-1990', bank_holder: 'S One', ctc: '25000', pf: '' }, { _line: 3, code: c2, name: 'Sheet Two B', mobile: m2, uan: uan2 }] });
  assert.deepStrictEqual([r.added, r.changed, r.faults, r.salaries], [0, 2, 0, 0], 'the same salary is not set twice');
  const e1b = await got(c1), e2b = await got(c2), prb = ((await db('GET', 'hr_employee_profile?select=data,secret&employee_id=eq.' + e1.id)) || [])[0];
  assert.deepStrictEqual([e1b.id, e1b.name, e1b.mobile, e1b.email, e1b.dob, e1b.status, e1b.category, e1b.designation_id], [e1.id, 'Sheet One', m1, mail('sheet1'), '1990-03-05', 'pending', 'driver', d.id]);
  assert.deepStrictEqual([e2b.name, e2b.mobile, e2b.email], ['Sheet Two B', m2, mail('sheet2')]);
  assert.deepStrictEqual([prb.secret.bank_holder, prb.secret.bank_account, prb.secret.uan, prb.data.company], ['S One', '123456789012', uan, 'Test Company Limited']);
  assert.deepStrictEqual(((await db('GET', 'hr_pay_emp?select=pf,esic,pt&employee_id=eq.' + e1.id)) || [])[0], { pf: true, esic: false, pt: true }, 'an empty Deduct PF keeps the tick');
  // a mobile / PAN of another employee, an employee of another site, a person who left: refused with the line
  r = await ACT.sheetImport(sup, { rows: [{ _line: 2, code: c2, mobile: m1 }, { _line: 3, name: 'Sheet New', code: '', mobile: mob(), pan: pan('A') }], check: 1 });
  assert.match(r.lines.find(x => x.line === 2).why, new RegExp('Mobile already belongs to employee ' + c1)); assert.match(r.lines.find(x => x.line === 3).why, /PAN already belongs to another employee/);
  r = await ACT.sheetImport(ses('super', SITE2), { rows: [{ _line: 2, code: c1, name: 'Elsewhere' }], check: 1 }); assert.match(r.lines[0].why, new RegExp('is an employee of the site ' + SITE));
  // an HR User: the people yes, the pay columns no – and he is told; the HR Admin (not the HO HR): pay details kept, no salary
  const c4 = 'U' + tag.slice(-4), c5 = 'A' + tag.slice(-4);
  r = await ACT.sheetImport(user, { rows: [{ _line: 2, name: 'Sheet User', code: c4, mobile: mob(), ctc: '30000', pf: 'Yes', basic: '15000', uan: '3' + String(Date.now()).slice(-11) }] });
  assert.strictEqual(r.added, 1); assert.match(r.notes.join(' '), /pay columns .* were not read: only the HR Admin or the Super Admin/);
  const e4 = await got(c4), p4 = ((await db('GET', 'hr_employee_profile?select=secret&employee_id=eq.' + e4.id)) || [])[0];
  assert.ok(p4.secret.uan && p4.secret.ctc_monthly === undefined && p4.secret.basic === undefined); assert.strictEqual(((await db('GET', 'hr_pay_emp?select=pf&employee_id=eq.' + e4.id)) || []).length, 0);
  r = await ACT.sheetImport(admin, { rows: [{ _line: 2, name: 'Sheet Admin', code: c5, mobile: mob(), ctc: '30000', pf: 'Yes' }] });
  assert.deepStrictEqual([r.added, r.salaries], [1, 0]); assert.match(r.notes.join(' '), /kept as a detail only/);
  const e5 = await got(c5); assert.strictEqual(((await db('GET', 'hr_employee_profile?select=secret&employee_id=eq.' + e5.id)) || [])[0].secret.ctc_monthly, 30000); assert.strictEqual(((await db('GET', 'hr_salaries?select=id&employee_id=eq.' + e5.id)) || []).length, 0);
  // the pay details on his page: the Admin sees and saves them, an HR User is not told that they exist
  const pa = await ACT.profGet(admin, { id: e1.id }), pu = await ACT.profGet(user, { id: e1.id });
  assert.ok(pa.defs.groups.some(g => g.key === 'pay') && pa.secret.ctc_monthly === 25000); assert.ok(!pu.defs.groups.some(g => g.key === 'pay') && pu.secret.ctc_monthly === undefined && /^XXXX/.test(pu.secret.uan));
  await no(ACT.profSave(user, { id: e1.id, group: 'pay', data: { basic: 1 } }), /Only the HR Admin/, 403);
  assert.strictEqual((await ACT.profSave(admin, { id: e1.id, group: 'pay', data: Object.assign({}, pa.secret, { basic: '13000', deduct_income_tax: 'yes' }) })).secret.basic, 13000);
  assert.strictEqual(((await db('GET', 'hr_employee_profile?select=secret&employee_id=eq.' + e1.id)) || [])[0].secret.bank_account, '123456789012', 'the bank details stay beside the pay details');
  // OUT: the same columns; Yes / No as words; the salary that counts; for an HR User no pay and no secret number
  const out = await ACT.sheetExport(sup, { q: 'Sheet One' }), H = out.heads, cell = (row, h) => row[H.indexOf(h)], o1 = out.rows.find(x => cell(x, 'Employee Code') === c1);
  assert.deepStrictEqual(H, SH.COLS.map(c => c.head));
  assert.deepStrictEqual(['Name of Company', 'Branch Name', 'Current Project Name', 'UAN No.', 'Employee Name', 'Auto Monthly CTC', 'Date of Joining', 'Employee Status', 'Sign In', 'PAN', 'Deduct PF', 'Deduct ESIC', 'Deduct PT', 'TDS Type', 'Basic', 'Deduct Income Tax', 'Totals', 'Mobile', 'E-mail', 'Date of Birth', 'Designation', 'Bank IFSC Code', 'Bank Account Number'].map(h => cell(o1, h)),
    ['Test Company Limited', 'Branch ' + tag, 'Site A', uan, 'Sheet One', 25000, '01-04-2024', 'Permanent ' + tag, '00:00', pan('A'), 'Yes', 'No', 'Yes', 'NTDS', 13000, 'Yes', 1, m1, mail('sheet1'), '05-03-1990', des, 'RIGB0001234', '123456789012']);
  const ou = await ACT.sheetExport(user, { q: 'Sheet One' }), u1 = ou.rows[0];
  assert.deepStrictEqual(['Employee Name', 'Auto Monthly CTC', 'Basic', 'Deduct PF', 'UAN No.', 'Bank Account Number', 'Bank IFSC Code', 'PAN'].map(h => cell(u1, h)), ['Sheet One', '', '', '', '', '', 'RIGB0001234', pan('A')]); assert.strictEqual(ou.full, false);
  // what came out goes in again without a fault and changes nothing
  const keys = SH.COLS.map(c => c.key), back = out.rows.map((row, i) => { const o = { _line: i + 2 }; keys.forEach((k, j) => { o[k] = row[j]; }); return o; });
  r = await ACT.sheetImport(sup, { rows: back, check: 1 }); assert.deepStrictEqual([r.faults, r.toAdd, r.toChange], [0, 0, back.length], JSON.stringify(r.lines));
  r = await ACT.sheetImport(sup, { rows: back }); assert.deepStrictEqual([r.added, r.changed, r.salaries], [0, back.length, 0]); assert.deepStrictEqual((await got(c1)).updated_at, e1b.updated_at, 'nothing changed: he is not written again');
  // the format: the headings, no row; the audit holds no number
  const f = await ACT.sheetExport(user, { template: 1 }); assert.deepStrictEqual([f.heads.length, f.rows.length], [SH.COLS.length, 0]);
  const au = JSON.stringify((await db('GET', 'hr_audit?select=action,detail&site=eq.' + SITE + '&action=like.Employee sheet*')) || []);
  assert.ok(au.includes('Employee sheet imported') && au.includes('Employee sheet exported')); for (const n of [uan, pan('A'), '123456789012', '25000', m1]) assert.ok(!au.includes(n), 'not in the audit: ' + n);
  await no(ACT.sheetImport(ses('self'), { rows: back }), /HR office only/, 403);
});

test('(13-11-2026) a sign-in for everybody at once: the Super Admin, or an HR Admin he gave the power (off until then); the people with an e-mail or a mobile number; the user ID of a mobile-only employee is kept and "My HR" finds him by it', async () => {
  const S3 = tag + 'S', s = r => ses(r, S3), m1 = mob(), m2 = mob();
  const a = await ACT.empSave(s('admin'), { name: 'Signin Mobile', category: 'driver', mobile: m1 }), b = await ACT.empSave(s('admin'), { name: 'Signin Mail', category: 'staff', email: mail('signin.b'), dob: '01-01-1990' }), c = await ACT.empSave(s('admin'), { name: 'Signin Nothing', category: 'labour' });
  assert.deepStrictEqual([a.status, a.missing, b.status, c.missing], ['incomplete', ['Date of birth'], 'pending', ['Date of birth', 'Mobile or e-mail']], 'an e-mail OR a mobile number is enough');
  // who may: the power is OFF for an HR Admin until the Super Admin gives it; an HR User never
  assert.strictEqual((await ACT.init(s('admin'))).signin, false); assert.strictEqual((await ACT.init(s('super'))).signin, true);
  await no(ACT.signinPeople(s('admin')), /has not given the HR Admin this power on this site \(Give a sign-in to every employee at once\)/, 403); await no(ACT.signinPeople(s('user')), /Only the HR Admin or the Super Admin/, 403);
  await ACT.powerSet(s('super'), { power: 'signin', allowed: true }); assert.strictEqual((await ACT.init(s('admin'))).signin, true);
  const p = await ACT.signinPeople(s('admin'));
  assert.deepStrictEqual([p.people.map(x => [x.code, x.email, x.mobile, x.known]), p.without], [[[a.code, '', m1, ''], [b.code, mail('signin.b'), '', '']].sort((x, y) => (x[0] < y[0] ? -1 : 1)), 1]);
  // what the Portal answered: only a user ID made of a mobile number is kept, for an employee of this site, one employee a user
  let r = await ACT.signinLinked(s('admin'), { rows: [{ id: a.id, portal: m1 + '@mobile.id' }, { id: b.id, portal: mail('signin.b') }, { id: c.id, portal: 'someone@else.example' }, { id: b.id, portal: m1 + '@mobile.id' }] });
  assert.strictEqual(r.linked, 1); assert.strictEqual((await ACT.empGet(s('admin'), { id: a.id })).employee.portal_email, m1 + '@mobile.id'); assert.strictEqual((await ACT.empGet(s('admin'), { id: b.id })).employee.portal_email, '');
  await no(ACT.signinLinked(s('user'), { rows: [{ id: a.id, portal: m1 + '@mobile.id' }] }), /Only the HR Admin/, 403);
  assert.strictEqual((await ACT.signinPeople(s('super'))).people.find(x => x.code === a.code).known, m1 + '@mobile.id');
  // "My HR": the sign-in whose user ID is his number IS this employee – also after HR changed his number
  const self = { site: S3, email: m1 + '@mobile.id', name: 'Signin Mobile', role: 'self', info: { sites: [] } };
  assert.strictEqual((await ACT.myHr(self, {})).employee.code, a.code);
  await ACT.empSave(s('admin'), { id: a.id, name: 'Signin Mobile', category: 'driver', mobile: m2 }); assert.strictEqual((await ACT.myHr(self, {})).employee.code, a.code);
  await no(ACT.myHr({ site: S3, email: m2 + '@mobile.id', name: 'X', role: 'self', info: { sites: [] } }, {}), /is not in the Employee Master/, 403);
});

test('(13-11-2026) masters: one not in use is deleted (written down), one in use is refused; the usual list only adds what is missing; an employee\'s page in one reading; "Not available"; the sheet-only times survive a save', async () => {
  // delete: an HR User cannot; in use → 409; not in use → gone
  let m = await ACT.masterSave(admin, { kind: 'department', name: 'Del ' + tag }); const d = m.departments.find(x => x.name === 'Del ' + tag);
  m = await ACT.masterSave(admin, { kind: 'designation', name: 'DelG ' + tag, category: 'driver' }); const g = m.designations.find(x => x.name === 'DelG ' + tag); assert.strictEqual(g.category, 'driver');
  await no(ACT.masterDelete(user, { kind: 'department', id: d.id }), /Only the HR Admin/, 403);
  const e = await ACT.empSave(admin, { name: 'Master User', category: 'staff', mobile: mob(), department_id: d.id });
  await no(ACT.masterDelete(admin, { kind: 'department', id: d.id }), /is in use \(1 employee.*Switch it off/, 409);
  await ACT.empSave(admin, { id: e.id, name: 'Master User', category: 'staff', mobile: e.mobile || (await ACT.empGet(admin, { id: e.id })).employee.mobile, department_id: '' });
  const still = await ACT.masterDelete(admin, { kind: 'department', id: d.id }).then(() => 'gone', x => x.message);      // his history may still name it – then it stays, switched off by hand
  assert.ok(still === 'gone' || /in the history/.test(still), still);
  m = await ACT.masterDelete(admin, { kind: 'designation', id: g.id }); assert.strictEqual(m.deleted, 'DelG ' + tag); assert.ok(!m.designations.some(x => x.id === g.id));
  assert.ok(((await db('GET', 'hr_audit?select=action&action=eq.Master%20deleted&target=eq.' + encodeURIComponent('designation DelG ' + tag))) || []).length === 1, 'written down');
  await no(ACT.masterDelete(admin, { kind: 'designation', id: g.id }), /Not found/, 404); await no(ACT.masterDelete(admin, { kind: 'nothing', id: g.id }), /Unknown list/);
  // the usual list: adds; a second time adds nothing; nothing of before is changed
  await no(ACT.masterSeed(user, {}), /Only the HR Admin/, 403);
  const before = await ACT.init(admin), s1 = await ACT.masterSeed(admin, {}), s2 = await ACT.masterSeed(admin, {});
  assert.deepStrictEqual(s2.added, { departments: 0, designations: 0 }); assert.strictEqual(s1.departments.length, before.departments.length + s1.added.departments); assert.strictEqual(s1.designations.length, before.designations.length + s1.added.designations);
  for (const x of before.designations) assert.deepStrictEqual(s2.designations.find(y => y.id === x.id), x, 'as it was');
  const tip = s2.designations.find(x => x.name === 'Tipper Driver'), exc = s2.designations.find(x => x.name === 'Grader Operator'); assert.ok(tip && tip.category === 'driver' && exc && exc.category === 'operator');
  // an employee's page: the four readings in one; an HR User gets what he may see; another site's person is refused as before
  const pg = await ACT.empPage(user, { id: E1.id }); assert.strictEqual(pg.emp.employee.id, E1.id); assert.ok(Array.isArray(pg.emp.history) && pg.around && Array.isArray(pg.around.places) && pg.prof && pg.prof.complete && pg.prof.defs.groups.length >= 3);
  assert.deepStrictEqual(pg.emp, await ACT.empGet(user, { id: E1.id })); assert.deepStrictEqual(pg.prof.complete, (await ACT.profGet(user, { id: E1.id })).complete);
  await assert.rejects(ACT.empPage(ses('user', SITE2), { id: E1.id }));
  // "Not available": kept as NA, counts as filled; an amount or a list refuses it; the page is told which boxes may have the tick
  const job = pg.prof.defs.groups.find(x => x.key === 'job'), prf = pg.prof.defs.groups.find(x => x.key === 'profile');
  assert.ok(!job.fields.some(f => /^sign_(in|out)$/.test(f.key)), 'the times are not on the page'); assert.ok(prf.fields.find(f => f.key === 'cug').na && !job.fields.find(f => f.key === 'notice_days').na);
  const was = pg.prof.complete.filled; let p = await ACT.profSave(admin, { id: E1.id, group: 'profile', data: Object.assign({}, pg.prof.data, { cug: 'Not available', official_email: 'NA' }) });
  assert.strictEqual(p.data.cug, 'NA'); assert.strictEqual(p.data.official_email, 'NA'); assert.ok(p.complete.filled >= was + (pg.prof.data.cug ? 0 : 1));
  await no(ACT.profSave(admin, { id: E1.id, group: 'job', data: { notice_days: 'NA' } }), /Notice period/);
  // the times of the Excel sheet are kept when the Job tab is saved from the page (which does not send them)
  await db('PATCH', 'hr_employee_profile?employee_id=eq.' + E1.id, { data: Object.assign({}, p.data, { sign_in: '09:05', sign_out: '18:00' }) }, 'return=minimal');
  p = await ACT.profSave(admin, { id: E1.id, group: 'job', data: { notice_days: '15' } }); assert.deepStrictEqual([p.data.sign_in, p.data.sign_out, p.data.notice_days], ['09:05', '18:00', 15]);
  const out = await ACT.sheetExport(admin, {}).catch(x => ({ err: x.message })); assert.ok(!out.err, out.err);      // the export still works with "NA" and the times in a profile
});
