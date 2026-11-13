// HR – Phase 1a: the Portal's ticket is checked (signature, issuer, module, time), used ONCE, and HR's own sign-in starts.
// No real database and no network: the Portal's key is made here; "fetch" is answered here by a small stand-in of the database.
'use strict';
const test = require('node:test'), assert = require('node:assert'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const PORTAL = 'https://portal.test/portal', DBURL = 'https://db.test';
process.env.PORTAL_URL = PORTAL; process.env.PUBLIC_URL = 'https://main.test/hr'; process.env.SUPABASE_URL = DBURL; process.env.SUPABASE_SECRET_KEY = 'test-key-not-a-real-one';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'ES256', use: 'sig' });
// the stand-in database: tables of rows, with each table's key (a second row with the same key is refused, as Postgres does)
const DB = { hr_tickets: [], hr_sessions: [], hr_people: [], hr_audit: [] }, KEY = { hr_tickets: ['jti'], hr_sessions: ['id_hash'], hr_people: ['site', 'email'], hr_audit: ['id'] };
let dbOff = false, auditId = 0;
const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body === undefined ? '' : JSON.stringify(body), json: async () => body });
global.fetch = async (u, opt) => {
  u = String(u); opt = opt || {};
  if (u === PORTAL + '/api/jwks') return answer(200, { keys: [jwk] });
  assert.ok(u.startsWith(DBURL + '/rest/v1/'), 'only the Portal\'s keys and the HR database are asked: ' + u);
  assert.strictEqual(opt.headers.apikey, 'test-key-not-a-real-one');
  const url = new URL(u), table = url.pathname.split('/').pop(), rows = DB[table];
  if (dbOff || !rows) return answer(404, { code: 'PGRST205', message: 'Could not find the table' });
  const match = r => [...url.searchParams].every(([k, v]) => k === 'select' || k === 'on_conflict' || (v.startsWith('eq.') ? String(r[k]) === v.slice(3) : v.startsWith('lt.') ? String(r[k]) < v.slice(3) : true));
  if (opt.method === 'GET') return answer(200, rows.filter(match));
  if (opt.method === 'DELETE') { DB[table] = rows.filter(r => !match(r)); return answer(204); }
  if (opt.method === 'POST') {
    for (const r of JSON.parse(opt.body)) {
      if (table === 'hr_audit') r.id = ++auditId;
      const i = rows.findIndex(x => KEY[table].every(k => x[k] === r[k]));
      if (i > -1 && /merge-duplicates/.test(String(opt.headers.Prefer || ''))) rows[i] = Object.assign({}, rows[i], r);
      else if (i > -1) return answer(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
      else rows.push(r);
    }
    return answer(201);
  }
  return answer(405);
};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function ticket(over, key, head) {
  const now = Math.floor(Date.now() / 1000);
  const c = Object.assign({ iss: PORTAL, aud: 'hr', sub: 'a@b.test', name: 'A Person', site: 'S1', siteName: 'Site One', role: 'user', iat: now, exp: now + 60, jti: crypto.randomBytes(16).toString('hex'), mods: [{ key: 'hr', name: 'HR', url: 'https://main.test/hr' }], sites: [{ code: 'S1', name: 'Site One' }] }, over || {});
  const h = b64(head || { alg: 'ES256', kid: 'k1', typ: 'JWT' }), b = b64(c);
  return h + '.' + b + '.' + crypto.sign('sha256', Buffer.from(h + '.' + b), { key: key || privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
const portal = require('../lib/portal');

test('the Portal\'s ticket: accepted only with its signature, made by this Portal, for "hr", in its minute', async () => {
  const c = await portal.verify(ticket());
  assert.deepStrictEqual([c.email, c.name, c.site, c.siteName, c.role], ['a@b.test', 'A Person', 'S1', 'Site One', 'user']);
  assert.strictEqual((await portal.verify(ticket({ super: true, role: 'admin' }))).role, 'super');
  assert.strictEqual(portal.AUD, 'hr');
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const no = async (t, re) => { await assert.rejects(() => portal.verify(t), e => { assert.strictEqual(e.status, 401); assert.match(e.message, re); return true; }); };
  await no(ticket({}, other), /signature does not match/);
  await no(ticket({ aud: 'purchase' }), /made for another module/);
  await no(ticket({ aud: 'store' }), /made for another module/);
  await no(ticket({ iss: 'https://evil.test/portal' }), /made by another Portal/);
  const now = Math.floor(Date.now() / 1000);
  await no(ticket({ iat: now - 300, exp: now - 240 }), /ran out/);
  await no(ticket({ iat: now, exp: now + 3600 }), /no proper time/);
  await no(ticket({ sub: 'not-an-email' }), /no proper email/);
  await no(ticket({ site: 'bad site' }), /no proper site/);
  await no(ticket({ role: 'owner' }), /no proper role/);
  await no(ticket({ jti: 'x' }), /no ticket number/);
  await no(ticket({}, privateKey, { alg: 'none', kid: 'k1' }), /not a ticket of the Portal/);
  await no(ticket({}, privateKey, { alg: 'ES256', kid: 'unknown' }), /unknown key/);
  await no('abc', /not a ticket/);
  const t = ticket().split('.'); t[1] = b64({ iss: PORTAL, aud: 'hr', sub: 'x@y.test', site: 'S1', role: 'admin', super: true });
  await no(t.join('.'), /signature does not match/);      // (a changed ticket)
});

const call = async (file, method, headers, body) => { const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, end(b) { this.body = JSON.parse(b); } }; await require('../api/' + file)({ method, headers: headers || {}, body }, res); return res; };
const PAGE = { 'x-rcl': '1', host: 'rcl-hr.test', 'x-forwarded-proto': 'https' };
const cookieOf = r => String(r.h['Set-Cookie'] || '').split(';')[0];

test('POST /api/sso: a ticket is used ONCE; HR\'s own sign-in starts (a fingerprint only in the database); who signed in is written down', async () => {
  const t = ticket({ name: 'B Person', role: 'admin' });
  let r = await call('sso', 'POST', PAGE, { ticket: t });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual([r.body.ok, r.body.user, r.body.site, r.body.siteName, r.body.portal], [true, { email: 'a@b.test', name: 'B Person', role: 'admin' }, 'S1', 'Site One', PORTAL]);
  const ck = cookieOf(r); assert.match(String(r.h['Set-Cookie']), /^rcl_hr=[A-Za-z0-9_-]{30,}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=900; Secure$/);
  assert.strictEqual(DB.hr_sessions.length, 1); const token = decodeURIComponent(ck.split('=')[1]);
  assert.strictEqual(DB.hr_sessions[0].id_hash, crypto.createHash('sha256').update(token).digest('hex'), 'the database keeps the fingerprint');
  assert.ok(!JSON.stringify(DB).includes(token), 'never the sign-in itself');
  assert.deepStrictEqual(DB.hr_people.map(p => [p.site, p.email, p.name, p.role]), [['S1', 'a@b.test', 'B Person', 'admin']]);
  assert.deepStrictEqual(DB.hr_audit.map(a => [a.site, a.email, a.action]), [['S1', 'a@b.test', 'Sign-in']]);
  // the same ticket again: refused, no second sign-in
  r = await call('sso', 'POST', PAGE, { ticket: t });
  assert.strictEqual(r.statusCode, 401); assert.match(r.body.error, /this ticket was already used/); assert.strictEqual(DB.hr_sessions.length, 1);
  // who is signed in; another browser (no cookie): nobody
  r = await call('me', 'GET', Object.assign({ cookie: ck }, PAGE));
  assert.deepStrictEqual([r.body.signedIn, r.body.user.role, r.body.site, r.body.portal], [true, 'admin', 'S1', PORTAL]);
  assert.deepStrictEqual((await call('me', 'GET', PAGE)).body, { signedIn: false, portal: PORTAL });
  assert.strictEqual((await call('me', 'GET', Object.assign({ cookie: 'rcl_hr=' + 'x'.repeat(43) }, PAGE))).body.signedIn, false, 'a made-up cookie');
  // the open page's fresh ticket (renew): the sign-in is replaced, the person is not written down again
  r = await call('sso', 'POST', Object.assign({ cookie: ck }, PAGE), { ticket: ticket({ name: 'B Person', role: 'admin' }), renew: 1 });
  assert.strictEqual(r.statusCode, 200); const ck2 = cookieOf(r); assert.notStrictEqual(ck2, ck);
  assert.strictEqual(DB.hr_sessions.length, 1, 'the older sign-in is gone'); assert.strictEqual(DB.hr_audit.length, 1, 'not written again');
  assert.strictEqual((await call('me', 'GET', Object.assign({ cookie: ck }, PAGE))).body.signedIn, false, 'the older cookie opens nothing');
  // a sign-in older than its 15 minutes ends
  DB.hr_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual((await call('me', 'GET', Object.assign({ cookie: ck2 }, PAGE))).body.signedIn, false); assert.strictEqual(DB.hr_sessions.length, 0);
  // sign out
  r = await call('sso', 'POST', PAGE, { ticket: ticket() }); const ck3 = cookieOf(r);
  r = await call('logout', 'POST', Object.assign({ cookie: ck3 }, PAGE), {});
  assert.strictEqual(r.statusCode, 200); assert.match(String(r.h['Set-Cookie']), /^rcl_hr=; .*Max-Age=0/); assert.strictEqual(DB.hr_sessions.length, 0);
  // only from HR's own page; a wrong ticket starts nothing
  assert.strictEqual((await call('sso', 'GET', PAGE)).statusCode, 405);
  assert.strictEqual((await call('sso', 'POST', { host: 'rcl-hr.test' }, { ticket: ticket() })).statusCode, 403, 'without the page\'s own header');
  assert.strictEqual((await call('sso', 'POST', Object.assign({}, PAGE, { origin: 'https://evil.test' }), { ticket: ticket() })).statusCode, 403, 'from another web page');
  assert.strictEqual((await call('sso', 'POST', Object.assign({}, PAGE, { host: 'rcl-hr.vercel.app', origin: 'https://main.test' }), { ticket: ticket() })).statusCode, 200, 'the one address (PUBLIC_URL) is ours');
  const n = DB.hr_sessions.length; r = await call('sso', 'POST', PAGE, { ticket: ticket({ aud: 'store' }) });
  assert.strictEqual(r.statusCode, 401); assert.strictEqual(DB.hr_sessions.length, n);
});

test('before the SQL step is run: a clear message, no fault; nobody is signed in', async () => {
  dbOff = true;
  try {
    const r = await call('sso', 'POST', PAGE, { ticket: ticket() });
    assert.strictEqual(r.statusCode, 500); assert.match(r.body.error, /The HR database is not set up yet: the Super Admin runs sql\/hr_step1_base\.sql once in the rcl-hr Supabase/);
    assert.deepStrictEqual((await call('me', 'GET', Object.assign({ cookie: 'rcl_hr=' + 'y'.repeat(43) }, PAGE))).body, { signedIn: false, portal: PORTAL });
  } finally { dbOff = false; }
});

test('the SQL step: only adds, four tables, row level security on and nothing for anon / authenticated, no other database\'s table', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step1_base.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.deepStrictEqual((sql.match(/create table if not exists public\.(\w+)/g) || []).map(x => x.split('.')[1]), ['hr_people', 'hr_sessions', 'hr_tickets', 'hr_audit']);
  assert.ok(!/\b(drop|truncate|delete from|update |alter table (?!public\.%I enable row level security))/i.test(sql), 'nothing is changed or removed');
  assert.match(sql, /foreach t in array array\['hr_people', 'hr_sessions', 'hr_tickets', 'hr_audit'\] loop\s+execute format\('alter table public\.%I enable row level security', t\);\s+execute format\('revoke all on public\.%I from public, anon, authenticated', t\);/);
  assert.ok(!/\b(users|access|sites|modules|master|log_book|diesel|store_|eng_|pur_)\w*\b/i.test(sql.replace(/hr_\w+/g, '')), 'no table of the Portal or of another module');
});

test('the menu, the page and the hosting: one page, nothing of an employee, never listed by a search engine, Mumbai', async () => {
  const menu = require('../api/menu'); const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await menu({ method: 'GET', headers: {} }, res);
  assert.deepStrictEqual(res.body, { module: 'hr', name: 'HR', pages: [{ key: 'dashboard', name: 'Dashboard' }, { key: 'employees', name: 'Employees' }, { key: 'attendance', name: 'Attendance' }, { key: 'places', name: 'Work places' }, { key: 'muster', name: 'Muster' }, { key: 'requests', name: 'Requests' }, { key: 'phones', name: 'Phones' }, { key: 'rules', name: 'Shifts & rules' }, { key: 'leave', name: 'Leave' }, { key: 'month', name: 'Month verification' }, { key: 'payroll', name: 'Payroll' }, { key: 'lists', name: 'Lists' }, { key: 'departments', name: 'Departments' }, { key: 'designations', name: 'Designations' }] }, 'nobody signed in here yet: every page is listed');
  assert.ok(menu.mayOpen('all', 'user') && !menu.mayOpen('admin', 'user') && menu.mayOpen('admin', 'admin') && menu.mayOpen('admin', 'super'));
  const page = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  for (const m of page.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)) new Function(m[1]);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/, 'the ticket leaves the address bar');
  assert.match(page, /fetch\(BASE \+ path,/, 'relative: also under <main>/hr/'); assert.match(page, /\/api\/go\?module=hr&site=/);
  assert.deepStrictEqual(v.regions, ['bom1']);
  const all = v.headers.find(h => h.source === '/(.*)').headers, get = k => (all.find(h => h.key === k) || {}).value;
  assert.strictEqual(get('X-Robots-Tag'), 'noindex, nofollow'); assert.strictEqual(get('X-Frame-Options'), 'SAMEORIGIN');
  assert.match(get('Content-Security-Policy'), /frame-ancestors 'self'/);
});

test('the employee\'s details: four categories; mobile and e-mail made tidy; DOB and e-mail compulsory – without them INCOMPLETE; under 18 refused', () => {
  const R = require('../lib/rules'), now = Date.UTC(2026, 10, 12, 6);
  assert.deepStrictEqual(R.CATS, ['staff', 'operator', 'driver', 'labour']);
  assert.deepStrictEqual(['+91 98765-43210', '09876543210', '919876543210', '9876543210', '', '12345', '5876543210', 'abc'].map(R.mobile), ['9876543210', '9876543210', '9876543210', '9876543210', '', null, null, null]);
  assert.deepStrictEqual([' A@B.Co ', '', 'no-at', 'a@b'].map(R.email), ['a@b.co', '', null, null]);
  assert.deepStrictEqual(['05-03-1990', '5/3/1990', '1990-03-05', 32937, '', '31-02-2000', 'soon'].map(R.date), ['1990-03-05', '1990-03-05', '1990-03-05', '1990-03-05', '', null, null]);
  assert.strictEqual(R.today(Date.UTC(2026, 10, 11, 19, 0)), '2026-11-12', 'the day in India, not in UTC');
  assert.strictEqual(R.age('2008-11-13', now), 17); assert.strictEqual(R.age('2008-11-12', now), 18);
  let e = R.employee({ name: '  Test   Person ', category: 'Labor', mobile: '09876543210', email: 'T@X.in', dob: '12-11-2008', joined_on: '01-04-2026' }, now);
  assert.deepStrictEqual(e, { row: { name: 'Test Person', category: 'labour', gender: '', mobile: '9876543210', email: 't@x.in', dob: '2008-11-12', joined_on: '2026-04-01' }, errors: [], missing: [] });
  assert.strictEqual(R.statusOf(e.row, ''), 'pending', 'complete – never active by itself');
  assert.match(fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), /pending: 'Complete'/, '(13-11-2026) shown as "Complete" – not "Waiting for OTP"');
  e = R.employee({ name: 'Test Person', category: 'driver' }, now); assert.deepStrictEqual(e.errors, []); assert.deepStrictEqual(e.missing, ['Date of birth', 'Mobile or e-mail']); assert.strictEqual(R.statusOf(e.row, ''), 'incomplete');
  // (13-11-2026) he signs in with his e-mail OR his mobile number: one of them, with the date of birth, makes him complete
  for (const one of [{ mobile: '9876543210' }, { email: 'a@b.co' }]) { const c = R.employee(Object.assign({ name: 'Test Person', category: 'driver', dob: '01-01-1990' }, one), now); assert.deepStrictEqual([c.missing, R.statusOf(c.row, '')], [[], 'pending']); }
  assert.match(R.employee({ name: 'Test Person', category: 'staff', dob: '13-11-2008' }, now).errors.join(' '), /under 18/);
  assert.match(R.employee({ name: 'T', category: 'manager', mobile: '12', email: 'x', dob: 'y' }, now).errors.join(' '), /Name: .*Category: .*Mobile: .*E-mail: .*Date of birth: /);
  assert.strictEqual(R.statusOf(e.row, 'left'), 'left'); assert.strictEqual(R.statusOf(e.row, 'active'), 'active');
});

test('the pages\' script: the Excel / CSV columns are found by their usual names; a person\'s text is never put in as HTML', () => {
  const src = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  // (13-11-2026) the headings are matched with the columns of the employee sheet (lib/act_sheet.js) – also the names of a file of before
  const cols = require('../lib/act_sheet').colsOut();
  const m = win.HR._mapRows([['Sr', 'Employee Name', 'Category', 'Mobile No', 'E-mail ID', 'Date of Birth', 'DOJ', 'Dept', 'Designation'], [1, 'A One', 'Staff', '9876543210', 'a@b.co', '01-01-1990', 45000, 'Accounts', 'Clerk'], ['', '', '', '', '', '', '', '', '']], cols);
  assert.deepStrictEqual(m.rows, [{ _line: 2, name: 'A One', category: 'Staff', mobile: '9876543210', email: 'a@b.co', dob: '01-01-1990', joined_on: 45000, department: 'Accounts', designation: 'Clerk' }]);
  assert.deepStrictEqual(m.unknown, ['Sr']); assert.ok(m.hasName); assert.ok(!win.HR._mapRows([['Naam', 'Kind'], ['x', 'y']], cols).hasName);
  assert.deepStrictEqual(win.HR._csv('Name,Category\r\n"One, A","Staff"\n"Say ""hi""",Driver\n'), [['Name', 'Category'], ['One, A', 'Staff'], ['Say "hi"', 'Driver']]);
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(src), 'only textContent');
  const page = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), ids = [...new Set([...src.matchAll(/\$\('([a-z_0-9]+)'\)/g)].map(x => x[1]))];
  ids.forEach(i => assert.ok(page.includes('id="' + i + '"'), 'the page has #' + i));
});

test('the actions: every one asks the sign-in first; the Admin\'s ones are refused to an HR User; nothing deletes an employee', () => {
  const src = fs.readFileSync(path.join(root, 'api', 'hr.js'), 'utf8'), { ACT } = require('../api/hr');
  assert.deepStrictEqual(Object.keys(ACT), ['init', 'masterSave', 'empList', 'empGet', 'empPick', 'empSave', 'empTransfer', 'empExit', 'empDelete', 'empExport', 'privGet', 'privSave', 'docList', 'docUploadUrl', 'docAdd', 'docLink', 'empPhotos', 'docRemove', 'signinPeople', 'signinLinked', 'empImport',
    'placeList', 'projSave', 'placeSave', 'placeBulk', 'placeImport', 'placeRemove', 'placeMap', 'placePeople', 'placePerson', 'devList', 'devRelease', 'punchDay', 'punchSelfie', 'punchReview', 'myAttend', 'selfieUrl', 'punch',
    'attSetup', 'shiftSave', 'shiftRemove', 'holidaySave', 'holidayRemove', 'rulesSave', 'powerSet', 'muster', 'empAround', 'dayGet', 'daySet', 'regList', 'regDecide', 'myMonth', 'regAsk', 'myRegs', 'teamRegs', 'teamRegDecide', 'attDash', 'profGet', 'profSave', 'profRowSave', 'profRowRemove', 'listAll', 'listSave', 'profRequiredSave', 'myLeave', 'leaveAsk', 'leaveCancel', 'teamLeaves', 'teamLeaveDecide', 'leaveList', 'leaveDecide', 'leaveBalances', 'leaveAdjust', 'leavePolicy', 'leavePolicySave', 'monthList', 'monthVerify', 'monthReturn', 'monthApprove', 'monthReopen', 'monthSites', 'hoList', 'hoSet', 'salaryGet', 'salaryAsk', 'salaryWaiting', 'salaryDecide', 'payList', 'payFlags', 'payAdjust', 'payLock', 'paySettings', 'paySettingsSave', 'advList', 'advGive', 'advClose', 'mySlips', 'hrComing', 'paySlipOf', 'payBank', 'sheetCols', 'sheetImport', 'sheetExport', 'masterDelete', 'masterSeed', 'empPage',
    'rbList', 'rbSave', 'rbClose', 'rbDelete', 'rbDefault', 'rbAssign', 'rbPeople', 'rbOf', 'rbDayOff', 'askList', 'askDecide', 'extraFind', 'extraAsk', 'leaveOpening', 'leaveCreditAsk', 'leaveLedger', 'attImport', 'attImports', 'myLeaveFiles', 'myLeaveFileUrl', 'myLeaveFileAdd', 'myLeaveFileLink', 'myLeaveFileRemove', 'leaveFiles', 'leaveFileUrl', 'leaveFileAdd', 'leaveFileLink', 'leaveFileRemove', 'myHr', 'myDocs', 'myDocUploadUrl', 'myDocAdd', 'myDocLink']);
  assert.match(src, /const s = await ses\.need\(req\), att = [^\n]+\n[^\n]+\n[^\n]+\n  if \(s\.role === 'self' && SELF\.indexOf\(String\(x\.action\)\) < 0\) throw fail\(403, 'This is for the HR office only\.', 'role'\);\n  try \{ send\(res, 200, Object\.assign\(\{ ok: true \}, await fn\(s, x\)\)\); \}/);
  for (const a of ['masterSave', 'empTransfer', 'empExit', 'empDelete', 'docRemove']) assert.match(String(ACT[a]), /needAdmin\(s\)/, a);
  // (12-11-2026) ONE action deletes: empDelete – an employee added by mistake, after the check that nothing hangs on him, with the reason, written in the audit
  const dels = src.match(/db\('DELETE'/g) || [], del = String(ACT.empDelete); assert.strictEqual(dels.length, (del.match(/db\('DELETE'/g) || []).length, 'only empDelete deletes');
  assert.ok(del.indexOf('needAdmin(s)') < del.indexOf("db('DELETE'") && del.indexOf("'inuse'") < del.indexOf("db('DELETE'") && del.indexOf('Reason: write why he is deleted.') < del.indexOf("db('DELETE'"), 'the role, the reason and the check come before any delete');
  for (const t of ['hr_punches', 'hr_day_entries', 'hr_regularize', 'hr_devices', 'hr_device_tries', 'hr_employee_docs']) { assert.ok(del.indexOf("db('GET', '" + t + "?select=id&' + q)") > -1, t + ' is looked at first'); assert.ok(del.indexOf("'" + t + "'") < 0 || !new RegExp("DELETE[^;]*" + t).test(del), t + ' is never deleted'); }
  assert.match(del, /await audit\(s\.site, s\.email, 'Employee deleted'/);
});

test('SQL step 2: only adds; row level security; a mobile and an e-mail belong to one employee; no other database\'s table', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step2_employees.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.deepStrictEqual((sql.match(/create table if not exists public\.(\w+)/g) || []).map(x => x.split('.')[1]), ['hr_departments', 'hr_designations', 'hr_employees', 'hr_employment', 'hr_numbers']);
  assert.ok(!/\b(drop |truncate|delete from)/i.test(sql));
  assert.match(sql, /create unique index if not exists hr_employees_mobile on public\.hr_employees \(mobile\) where mobile <> ''/); assert.match(sql, /create unique index if not exists hr_employees_email on public\.hr_employees \(email\) where email <> ''/);
  assert.match(sql, /check \(category in \('staff', 'operator', 'driver', 'labour'\)\)/); assert.match(sql, /check \(status in \('incomplete', 'pending', 'active', 'left'\)\)/);
  assert.match(sql, /foreach t in array array\['hr_departments', 'hr_designations', 'hr_employees', 'hr_employment', 'hr_numbers'\] loop\s+execute format\('alter table public\.%I enable row level security', t\);\s+execute format\('revoke all on public\.%I from public, anon, authenticated', t\);/);
  assert.match(sql, /revoke all on function public\.hr_next_no\(text, int\) from public, anon, authenticated;/);
});

test('his own details and papers: Aadhaar with its check digit, masked; PAN; the kinds of papers; a driver needs his licence', () => {
  const R = require('../lib/rules'); let ok = ''; for (let i = 0; i < 10; i++) if (R.aadhaar('99990000111' + i)) ok = '99990000111' + i;      // a made-up number, not a person's
  assert.match(ok, /^\d{12}$/); assert.strictEqual(R.aadhaar(ok.replace(/(\d{4})(\d{4})/, '$1 $2 ')), ok); assert.strictEqual(R.aadhaarMask(ok), 'XXXX XXXX ' + ok.slice(-4)); assert.strictEqual(R.aadhaarMask(''), '');
  for (let i = 0; i < 10; i++) if (String(i) !== ok[11]) assert.strictEqual(R.aadhaar(ok.slice(0, 11) + i), null, 'a wrong last digit is caught');
  assert.deepStrictEqual(['', '12345', '099900001119', 'abcd'].map(R.aadhaar), ['', null, null, null]);
  assert.deepStrictEqual(['abcde1234f', ' ABCDE1234F ', '', 'ABCDE12345', 'abc'].map(R.pan), ['ABCDE1234F', 'ABCDE1234F', '', null, null]);
  const p = R.personal({ aadhaar: ok, pan: 'abcde1234f', mobile2: '+91 9876543210', family_name: ' A  Parent ', family_relation: 'Father', family_mobile: '09876543211', address_current: ' Camp ', address_permanent: '' });
  assert.deepStrictEqual(p, { row: { aadhaar: ok, pan: 'ABCDE1234F', mobile2: '9876543210', family_mobile: '9876543211', family_name: 'A Parent', family_relation: 'father', address_current: 'Camp', address_permanent: '' }, errors: [] });
  assert.deepStrictEqual(R.DOCS.map(d => d.key), ['photo', 'aadhaar', 'pan', 'education', 'licence', 'bank_passbook', 'salary_slip', 'experience', 'other']);
  assert.deepStrictEqual(R.DOCS.filter(d => d.pay).map(d => d.key), ['bank_passbook', 'salary_slip'], 'the pay papers: only the Admin opens them');
  assert.deepStrictEqual(R.docsMissing('driver', ['photo', 'aadhaar', 'pan', 'bank_passbook']), ['Driving licence']); assert.deepStrictEqual(R.docsMissing('labour', ['photo', 'aadhaar', 'pan', 'bank_passbook']), []);
  assert.deepStrictEqual(Object.keys(R.DOC_TYPES), ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']); assert.strictEqual(R.DOC_MAX, 10485760);
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step3_kyc_docs.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.deepStrictEqual((sql.match(/create table if not exists public\.(\w+)/g) || []).map(x => x.split('.')[1]), ['hr_employee_private', 'hr_employee_docs']); assert.ok(!/\b(drop |truncate|delete from)/i.test(sql));
  assert.match(sql, /values \('hr-docs', 'hr-docs', false, 10485760, array\['image\/jpeg', 'image\/png', 'image\/webp', 'application\/pdf'\]\)/, 'a PRIVATE bucket');
  assert.match(sql, /grant select, insert, update on public\.%I to service_role/, 'no delete: a paper is removed, never erased');
  R.DOCS.forEach(d => assert.ok(sql.includes("'" + d.key + "'"), d.key + ' in the table\'s check'));
  const src = fs.readFileSync(path.join(root, 'api', 'hr.js'), 'utf8');
  assert.match(src, /aadhaar: isAdmin\(s\) \? \(p\.aadhaar \|\| ''\) : ''/, 'an HR User never gets the whole Aadhaar');
  assert.match(src, /k === 'aadhaar' \|\| k === 'pan' \? \['…' \+ String\(o\)\.slice\(-4\), '…' \+ String\(c\.row\[k\]\)\.slice\(-4\)\]/, 'the record of changes holds only the last four');
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')); assert.match(v.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value, /connect-src 'self' https:\/\/\*\.supabase\.co;/, 'a file is sent straight to the private store');
  const win = {}; new Function('window', 'document', fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'))(win, { getElementById: () => null });
  assert.deepStrictEqual(['2026-11-12', '2026-11-11T20:00:00Z', '2026-11-11T10:00:00+00:00', ''].map(win.HR._dmy), ['12-11-2026', '12-11-2026', '11-11-2026', ''], 'a moment is shown as its day in India');
});

test('no secret and no code of another HR product in any file', () => {
  const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { if (f === '.git' || f === 'node_modules') continue; const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|json|html|md|sql)$/.test(f)) files.push(p); } })(root);
  assert.ok(files.length >= 8);
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}|eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|re_[A-Za-z0-9]{20,}/.test(t), path.relative(root, f) + ': a key');
    assert.ok(!/[a-z0-9]{12,}\.supabase\.co/.test(t), path.relative(root, f) + ': the database\'s address belongs in Vercel only');
  }
});

/* ───────────── step 4: attendance ───────────── */
test('where a person is: a circle, an area, along the road – inside or how many metres outside', () => {
  const G = require('../lib/geo'), c = { shape: 'circle', lat: 18.5, lng: 73.8, radius_m: 100 };
  assert.ok(Math.abs(G.dist(18.5, 73.8, 18.5009, 73.8) - 100.08) < 0.5);
  assert.deepStrictEqual(G.check(c, 18.5005, 73.8), { inside: true, distance: 0 }); const out = G.check(c, 18.502, 73.8); assert.ok(!out.inside && Math.abs(out.distance - 122) <= 1);
  const sq = { shape: 'polygon', points: [[18.5, 73.8], [18.5, 73.81], [18.51, 73.81], [18.51, 73.8]] };
  assert.ok(G.check(sq, 18.505, 73.805).inside); const o2 = G.check(sq, 18.505, 73.811); assert.ok(!o2.inside && Math.abs(o2.distance - 105) <= 2);
  const road = { shape: 'corridor', radius_m: 50, points: [[18.5, 73.8], [18.5, 73.9]] };
  assert.ok(G.check(road, 18.5003, 73.85).inside); assert.ok(!G.check(road, 18.501, 73.85).inside); assert.ok(!G.check(road, 18.5, 73.91).inside, 'past the end of the road');
  assert.strictEqual(G.points([[1, 2]], 2), null); assert.strictEqual(G.points([[1, 2], [91, 2]], 2), null); assert.deepStrictEqual(G.points([{ lat: '1', lng: 2 }, [3, 4]], 2), [[1, 2], [3, 4]]);
  assert.strictEqual(G.nearest([c, Object.assign({}, c, { lat: 19 })], 18.5001, 73.8).place, c);
});

test('a work place as typed; for whom it is; the moment of a punch sent later', () => {
  const A = require('../lib/attend');
  assert.match(A.place({ name: 'C', shape: 'circle', radius_m: 5 }).errors.join(' '), /Name.*Place it on the map.*Radius: 20 to 5000/);
  assert.match(A.place({ name: 'Area', shape: 'polygon', points: [[1, 1], [2, 2]] }).errors.join(' '), /at least 3 corners/);
  assert.match(A.place({ name: 'Camp', lat: 1, lng: 1, radius_m: 100, scope: 'category', scope_values: ['boss'] }).errors.join(' '), /at least one category/);
  const p = { id: 'p1', active: true, removed_at: null, valid_from: '2026-11-10', scope: 'category', scope_values: ['labour'] }, lab = { category: 'labour', department_id: 'd1' }, st = { category: 'staff', department_id: 'd1' };
  assert.deepStrictEqual([A.applies(p, lab, '2026-11-12'), A.applies(p, st, '2026-11-12'), A.applies(p, lab, '2026-11-09'), A.applies(Object.assign({}, p, { active: false }), lab, '2026-11-12'), A.applies(Object.assign({}, p, { removed_at: 'x' }), lab, '2026-11-12')], [true, false, false, false, false]);
  assert.deepStrictEqual([A.applies(Object.assign({}, p, { scope: 'people' }), st, '2026-11-12', { p1: 1 }), A.applies(Object.assign({}, p, { scope: 'people' }), st, '2026-11-12', {}), A.applies(Object.assign({}, p, { scope: 'department', scope_values: ['d1'] }), st, '2026-11-12')], [true, false, true]);
  const now = Date.UTC(2026, 10, 12, 6), base = { offline: true, anchor_server: now - 3600000, anchor_elapsed: 1000000, elapsed: 2800000, at_device: new Date(now - 1800000 + 5000).toISOString() };
  assert.deepStrictEqual(A.moment({}, now), { at: now, ok: true, why: [] }, 'online: the server\'s clock only');
  assert.deepStrictEqual([A.moment(base, now).ok, A.moment(base, now).at], [true, now - 1800000]);
  assert.match(A.moment(Object.assign({}, base, { elapsed: 5000 }), now).why.join(), /restarted/);
  assert.match(A.moment(Object.assign({}, base, { at_device: new Date(now).toISOString() }), now).why.join(), /does not agree/, 'the phone\'s clock was changed');
  assert.match(A.moment(Object.assign({}, base, { anchor_server: now - 80 * 3600000, at_device: new Date(now - 79.5 * 3600000).toISOString() }), now).why.join(), /older than 72 hours/);
  assert.strictEqual(A.moment({ offline: true }, now).ok, false);
});

test('attendance actions: the office\'s ones are closed to "My HR"; changes are the Admin\'s; a punch is never changed', () => {
  const { ACT, SELF } = require('../api/hr'), src = fs.readFileSync(path.join(root, 'lib', 'act_attend.js'), 'utf8');
  assert.deepStrictEqual(SELF, ['myAttend', 'selfieUrl', 'punch', 'myMonth', 'regAsk', 'myRegs', 'teamRegs', 'teamRegDecide', 'myLeave', 'leaveAsk', 'leaveCancel', 'teamLeaves', 'teamLeaveDecide', 'myHr', 'myDocs', 'myDocUploadUrl', 'myDocAdd', 'myDocLink', 'mySlips', 'myLeaveFiles', 'myLeaveFileUrl', 'myLeaveFileAdd', 'myLeaveFileLink', 'myLeaveFileRemove']);
  for (const [a, p] of [['projSave', 'places'], ['placeSave', 'places'], ['placeBulk', 'places'], ['placeImport', 'places'], ['placeRemove', 'places'], ['placePeople', 'places'], ['placePerson', 'places'], ['devRelease', 'phones'], ['punchReview', 'review'], ['shiftSave', 'shifts'], ['shiftRemove', 'shifts'], ['holidaySave', 'shifts'], ['holidayRemove', 'shifts'], ['rulesSave', 'shifts'], ['regDecide', 'regularize']]) assert.ok(String(ACT[a]).indexOf("await power.need(s, '" + p + "')") > -1, a + ': the power ' + p);
  assert.match(String(ACT.daySet), /await power\.need\(s, has \? 'correct' : 'manual'\)/); assert.match(String(ACT.powerSet), /s\.role !== 'super'/);
  for (const a of ['placeList', 'placeMap', 'devList', 'punchDay', 'punchSelfie', 'attSetup', 'muster', 'empAround', 'dayGet', 'daySet', 'regList', 'attDash']) assert.match(String(ACT[a]), /needOffice\(s\)/, a);
  for (const a of SELF) assert.match(String(ACT[a]), /const (emp|boss) = await me\(s\)/, a + ': only for the employee the sign-in is');
  assert.ok(!/db\('(PATCH|DELETE)', 'hr_punch/.test(src), 'no punch and no decision is changed or deleted');
  assert.deepStrictEqual(src.match(/db\('DELETE', '(\w+)/g), ["db('DELETE', 'hr_place_people"], 'only "for whom" of a place is taken back');
  const mus = fs.readFileSync(path.join(root, 'lib', 'act_muster.js'), 'utf8'); assert.deepStrictEqual(mus.match(/db\('DELETE', '(\w+)/g), ["db('DELETE', 'hr_shift_people"]); assert.ok(!/db\('PATCH', 'hr_(punch|day_entries|att_rules)/.test(mus), 'a punch, a day\'s entry and a rule version are never changed');
  const P = require('../lib/portal'); assert.deepStrictEqual([P.AUD, P.AUD_SELF], ['hr', 'hrme']);
});

test('SQL step 4: only adds; row level security; a punch can only be added; one phone a person', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step4_attendance.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.deepStrictEqual((sql.match(/create table if not exists public\.(\w+)/g) || []).map(x => x.split('.')[1]), ['hr_projects', 'hr_places', 'hr_place_people', 'hr_devices', 'hr_device_tries', 'hr_punches', 'hr_punch_reviews']);
  assert.ok(!/\b(drop table|drop column|truncate|delete from)/i.test(sql)); assert.deepStrictEqual((sql.match(/drop constraint (\w+)/g) || []), ['drop constraint hr_sessions_role_check', 'drop constraint hr_people_role_check'], 'only the two role lists are widened');
  assert.match(sql, /grant select, insert on public\.hr_device_tries, public\.hr_punches, public\.hr_punch_reviews to service_role;/);
  assert.match(sql, /foreach t in array array\['hr_projects', 'hr_places', 'hr_place_people', 'hr_devices', 'hr_device_tries', 'hr_punches', 'hr_punch_reviews'\] loop\s+execute format\('alter table public\.%I enable row level security', t\);\s+execute format\('revoke all on public\.%I from public, anon, authenticated', t\);/);
  assert.match(sql, /client_id text not null unique/); assert.match(sql, /values \('hr-selfies', 'hr-selfies', false, 1048576, array\['image\/jpeg'\]\)/);
  assert.ok(!/\b(portal_|users\b|access\b|vehicles|store_|eng_|pur_)/.test(sql.replace(/hr_\w+/g, '')), 'nothing of another database');
});

test('the attendance pages: the script runs; three pages; a person\'s text only as text; the menu lists them, not for "My HR"', () => {
  const src = fs.readFileSync(path.join(root, 'public', 'att.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  assert.deepStrictEqual(win.HRATT.pages.map(p => p[0]), ['attendance', 'places', 'phones']); assert.ok(win.HRATT.has('places') && !win.HRATT.has('employees'));
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|\b(alert|confirm|prompt)\(/.test(src), 'only textContent, no browser dialog');
  assert.strictEqual(win.HRATT._size({ shape: 'corridor', radius_m: 60 }), '60 m each side of the road');
  assert.strictEqual(win.HRATT._whom({ scope: 'category', scope_values: ['labour', 'driver'] }, { departments: [] }), 'Labour, Driver');
  // (13-11-2026) who marks where: where a person marked last, in words
  assert.strictEqual(win.HRATT._last({ last: { place_id: 'p1', day: '2026-11-13', time: '08:24', kind: 'in' } }, { today: '2026-11-13', places: [{ id: 'p1', name: 'Site office' }] }), 'Site office · today 08:24 IN');
  assert.strictEqual(win.HRATT._last({ last: null }, { today: '2026-11-13', places: [] }), '–');
  assert.match(src, /e\.code === 'scope' && !body\.convert/, 'a place for everybody is changed only after the Admin said yes');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'); for (const id of src.match(/\$\('([a-z_0-9]+)'\)/g).map(x => x.slice(3, -2))) assert.ok(html.indexOf('id="' + id + '"') > -1, 'the page has #' + id);
  const M = require('../api/menu'); assert.deepStrictEqual(M.PAGES.map(p => p.key), ['dashboard', 'employees', 'attendance', 'places', 'muster', 'requests', 'phones', 'rules', 'leave', 'month', 'payroll', 'lists', 'departments', 'designations']);
  assert.deepStrictEqual([M.mayOpen('all', 'user'), M.mayOpen('admin', 'user'), M.mayOpen('all', 'self'), M.mayOpen('admin', 'super')], [true, false, false, true]);
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(v, /img-src 'self' data: https:\/\/tile\.openstreetmap\.org https:\/\/\*\.supabase\.co https:\/\/i\.ibb\.co;/);      // (13-11-2026) the company's logo, the same picture as the ERP's assert.match(v, /script-src 'self' 'unsafe-inline';/);
  assert.match(fs.readFileSync(path.join(root, 'public', 'vendor', 'leaflet', 'LICENSE.txt'), 'utf8'), /BSD 2-Clause License/);
});

/* ───────────── step 5: the muster ───────────── */
test('one day: present / half / absent by the hours, late and early by the shift, weekly off, holiday, at work, IN without OUT; no rule = nothing applied', () => {
  const D = require('../lib/day'), day = '2026-11-10', today = '2026-11-12', t = h => D.at(day, h);
  assert.deepStrictEqual(D.status({ day, today, in: t('09:00'), out: t('18:00') }), { code: 'P', hours: 9, late_min: 0, early_min: 0 }, 'no rules: IN and OUT = present');
  const r = D.rules({ full_hours: 8, half_hours: '4', grace_min: 10, early_min: 0, late_to_half: 3, week_off: [0, '0', 9] }); assert.deepStrictEqual(r.errors, []); assert.deepStrictEqual(r.rules.week_off, [0]);
  const sh = { start_time: '09:00', end_time: '18:00', break_min: 60 };
  assert.deepStrictEqual(D.status({ day, today, in: t('09:11'), out: t('18:00'), rules: r.rules, shift: sh }), { code: 'HD', hours: 7.82, late_min: 11, early_min: 0 });
  assert.strictEqual(D.status({ day, today, in: t('09:10'), out: t('18:10'), rules: r.rules, shift: sh }).code, 'P'); assert.strictEqual(D.status({ day, today, in: t('09:00'), out: t('12:00'), rules: r.rules, shift: sh }).code, 'A');
  assert.strictEqual(D.status({ day, today, in: t('09:00'), out: t('17:30'), rules: r.rules, shift: sh }).early_min, 30);
  assert.deepStrictEqual(['2026-11-10', '2026-11-08'].map(d => D.status({ day: d, today, in: null, rules: r.rules }).code), ['A', 'WO']); assert.strictEqual(D.status({ day: '2026-11-08', today, in: t('09:00'), out: t('18:00'), rules: r.rules }).code, 'WOP');
  assert.deepStrictEqual([D.status({ day, today, in: null, holiday: 'Festival' }).code, D.status({ day, today, in: t('09:00'), out: t('18:00'), holiday: 'Festival' }).code], ['H', 'HP']);
  assert.deepStrictEqual([D.status({ day: today, today, in: null }).code, D.status({ day: today, today, in: 1 }).code, D.status({ day, today, in: t('09:00') }).code, D.status({ day: '2026-11-13', today, in: null }).code], ['', 'IN', 'MIS', '']);
  assert.deepStrictEqual(D.status({ day, today, in: t('20:05'), out: D.at('2026-11-11', '05:00'), rules: { grace_min: 10, early_min: 15 }, shift: { start_time: '20:00', end_time: '06:00' } }), { code: 'P', hours: 8.92, late_min: 0, early_min: 60 }, 'a night shift ends the next morning');
  assert.match(D.rules({ full_hours: 4, half_hours: 6 }).errors.join(), /less than/); assert.match(D.rules({ grace_min: 5.5 }).errors.join(), /Grace minutes/);
  assert.deepStrictEqual(D.shift({ name: 'General', start_time: '9:00', end_time: '18:00' }).row, { name: 'General', start_time: '09:00', end_time: '18:00', auto_out: null, break_min: 0 }); assert.match(D.shift({ name: 'G', start_time: '9', end_time: '25:00' }).errors.join(' '), /Name.*Starts at.*Ends at/);
});

test('the version of the day; a person\'s most exact shift; a month\'s count', () => {
  const D = require('../lib/day'), day = '2026-11-10';
  assert.strictEqual(D.validOn([{ valid_from: '2026-01-01', n: 1 }, { valid_from: '2026-11-11', n: 2 }], day).n, 1, 'a day is measured with the version of that day'); assert.strictEqual(D.validOn([{ valid_from: '2026-11-11' }], day), null);
  assert.strictEqual(D.validOn([{ valid_from: '2026-01-01', created_at: '2026-01-01T00:00:00Z', n: 1 }, { valid_from: '2026-01-01', created_at: '2026-02-01T00:00:00Z', n: 2 }], day).n, 2, 'the same date twice: the one made later');
  const S = [{ id: 'a', scope: 'all', valid_from: '2026-01-01', active: true }, { id: 'c', scope: 'category', scope_values: ['labour'], valid_from: '2026-01-01', active: true }, { id: 'p', scope: 'people', valid_from: '2026-01-01', active: true }, { id: 'x', scope: 'all', valid_from: '2026-12-01', active: true }, { id: 'o', scope: 'department', scope_values: ['d1'], valid_from: '2026-01-01', active: false }];
  assert.deepStrictEqual([D.shiftOf(S, { category: 'labour' }, day, {}).id, D.shiftOf(S, { category: 'staff', department_id: 'd1' }, day, {}).id, D.shiftOf(S, { category: 'labour' }, day, { p: 1 }).id, D.shiftOf([], {}, day, {})], ['c', 'a', 'p', null]);
  assert.deepStrictEqual(D.total([{ code: 'P', late_min: 5 }, { code: 'P', late_min: 5 }, { code: 'HD', late_min: 9 }, { code: 'A' }, { code: 'WO' }, { code: 'H' }, { code: 'WOP' }, { code: 'MIS' }, { code: '' }], { late_to_half: 3 }), { P: 3, HD: 1, A: 1, WO: 1, H: 1, MIS: 1, late: 3, paid: 5, late_half: 1 });
  assert.strictEqual(D.total([{ code: 'P', late_min: 5 }], {}).paid, 1, 'no rule for late coming: nothing taken off');
});

test('SQL step 5: only adds; row level security; a rule version and a day\'s entry can only be added; the powers; the pages', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step5_muster.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.deepStrictEqual((sql.match(/create table if not exists public\.(\w+)/g) || []).map(x => x.split('.')[1]), ['hr_shifts', 'hr_shift_people', 'hr_holidays', 'hr_att_rules', 'hr_regularize', 'hr_day_entries', 'hr_admin_powers']);
  assert.ok(!/\b(drop |truncate|delete from|alter table public\.hr_(?!shifts|shift_people|holidays|att_rules|regularize|day_entries|admin_powers))/i.test(sql), 'nothing of the steps before is touched');
  assert.match(sql, /grant select, insert on public\.hr_att_rules, public\.hr_day_entries to service_role;/); assert.match(sql, /create unique index if not exists hr_regularize_one_waiting on public\.hr_regularize \(employee_id, day\) where status = 'pending'/);
  assert.match(sql, /foreach t in array array\['hr_shifts', 'hr_shift_people', 'hr_holidays', 'hr_att_rules', 'hr_regularize', 'hr_day_entries', 'hr_admin_powers'\] loop\s+execute format\('alter table public\.%I enable row level security', t\);\s+execute format\('revoke all on public\.%I from public, anon, authenticated', t\);/);
  const P = require('../lib/powers'); assert.deepStrictEqual(P.KEYS, ['places', 'phones', 'review', 'shifts', 'manual', 'correct', 'regularize', 'month', 'salary', 'signin']); assert.ok(P.POWERS.find(p => p.key === 'signin').off, '(13-11-2026) a sign-in for everybody at once: off until the Super Admin gives it');
  const src = fs.readFileSync(path.join(root, 'public', 'mus.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  assert.deepStrictEqual(win.HRMUS.pages.map(p => p[0]), ['muster', 'requests', 'rules']); assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|\b(alert|confirm|prompt)\(/.test(src), 'only textContent, no browser dialog');
  assert.deepStrictEqual(Object.keys(win.HRMUS._code), ['P', 'HD', 'A', 'WO', 'H', 'WOP', 'HP', 'IN', 'MIS', 'L']);
});

test('the site is chosen in HR among the Portal\'s sites of the person; the form has the employee\'s site; his page shows his attendance', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), api = fs.readFileSync(path.join(root, 'api', 'hr.js'), 'utf8');
  for (const id of ['site_pick', 'f_site', 'd_att', 'd_att_lab']) assert.ok(html.indexOf('id="' + id + '"') > -1, '#' + id);
  assert.match(html, /function sitePick\(me\) \{[\s\S]+?sel\.hidden = list\.length < 2;[\s\S]+?ticketFor\(code, false\)[\s\S]+?api\('api\/sso', \{ ticket: x\.j\.ticket \}\)[\s\S]+?location\.reload\(\);/, 'another site = a new ticket of the Portal, then the page again');
  assert.ok(!/api\/(site|sites)\b/.test(html + js), 'HR makes no site – it only chooses');
  assert.match(js, /site: \$\('f_site'\)\.value,/); assert.match(js, /fs\.disabled = !!e\.id && !isAdmin\(\);/); assert.match(js, /api\('empPage', \{ id: id \}\)/); assert.match(js, /aroundDraw\(id, r\.around\)/);      // (13-11-2026) his attendance comes with the one reading of his page
  assert.match(api, /if \(sitesOf\(s\)\.indexOf\(site\) < 0\) throw fail\(403, 'Site: choose a site where you have HR\.', 'site'\);\n    if \(was && site !== was\.site\) needAdmin\(s\);/);
});

test('the attendance dashboard: the HR office only; it only reads; the page puts every text in as text; the muster\'s day opens in a panel', () => {
  const act = fs.readFileSync(path.join(root, 'lib', 'act_dash.js'), 'utf8'), { ACT, SELF } = require('../api/hr');
  assert.match(String(ACT.attDash), /^async attDash\(s\) \{\s+needOffice\(s\);/); assert.ok(SELF.indexOf('attDash') < 0, 'not for "My HR"');
  assert.ok(!/db\('(POST|PATCH|PUT|DELETE)'/.test(act) && !/audit\(/.test(act), 'attDash writes nothing');
  const src = fs.readFileSync(path.join(root, 'public', 'dash.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  assert.deepStrictEqual(win.HRDASH.pages, [['dashboard', 'Dashboard']]); assert.ok(win.HRDASH.has('dashboard') && !win.HRDASH.has('muster'));
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|\b(alert|confirm|prompt)\(/.test(src), 'only textContent, no browser dialog');
  assert.deepStrictEqual([win.HRDASH._initials('asha rig'), win.HRDASH._initials('Babu'), win.HRDASH._initials(''), win.HRDASH._minOf('09:15')], ['AR', 'B', '', 555]);
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), mus = fs.readFileSync(path.join(root, 'public', 'mus.js'), 'utf8');
  for (const id of src.match(/\$\('([a-z_0-9]+)'\)/g).map(x => x.slice(3, -2))) assert.ok(html.indexOf('id="' + id + '"') > -1, 'the page has #' + id);
  assert.ok(html.indexOf('<script src="dash.js"></script>') > -1 && html.indexOf('<script src="dash.js">') < html.indexOf('<script src="hr.js">'));
  assert.match(js, /go\(page \|\| \(window\.HRDASH \? 'dashboard' : 'employees'\)\);/); assert.match(js, /if \(dash\) window\.HRDASH\.open\(S\.me, go\);/);
  // the muster: the day's panel uses the same actions as before – a correction and a request's decision are the server's
  for (const a of ["api('dayGet', { id: w.id, day: d })", "api('daySet', Object.assign({ id: w.id, day: d, reason: why.value }, body))", "api('regDecide', { id: q.id, decision: dec, note: note.value })"]) assert.ok(mus.indexOf(a) > -1, a);
  assert.match(String(ACT.dayGet), /place: pl\[p\.place_id\] \|\| ''/);
});

test('the full profile (step 6): the checks of every kind of detail; nothing fixed – lists and what is compulsory; numbers masked; SQL only adds', () => {
  const P = require('../lib/act_profile'), { ACT, SELF } = require('../api/hr'), L = { prefix: { 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': { active: true }, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': { active: false } } };
  const g = P.GROUPS, A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  assert.deepStrictEqual(P.clean(g.secret.fields, { uan: '1234 5678 9012', bank_ifsc: 'sbin0001234', bank_account: '000123456789', pf_join: '01-04-2024', esic_no: '' }, {}, {}), { row: { uan: '123456789012', pf_join: '2024-04-01', bank_ifsc: 'SBIN0001234', bank_account: '000123456789' }, errors: [] });
  assert.deepStrictEqual(P.clean(g.secret.fields, { uan: '123', bank_ifsc: 'SBIN1001234', bank_account: '12ab' }, {}, {}).errors, ['UAN number: 12 digits.', 'Bank IFSC code: 11 letters and digits, the fifth is 0 (for example SBIN0001234).', 'Bank account number: 6 to 18 digits.']);
  assert.deepStrictEqual(P.clean(g.profile.fields, { prefix: A, official_email: 'A@B.co', cug: '+91 98765 43210', disability: '' }, L, {}).row, { prefix: A, official_email: 'a@b.co', cug: '9876543210' });
  assert.deepStrictEqual(P.clean(g.profile.fields, { prefix: B }, L, {}).errors, ['Prefix: choose a value of the list.'], 'a value switched off is not offered');
  assert.deepStrictEqual(P.clean(g.profile.fields, { prefix: B }, L, { prefix: B }).row, { prefix: B }, 'but it stays where it already is');
  assert.deepStrictEqual(P.clean(g.job.fields, { notice_days: '30', retirement_age: '20', overtime: 'yes', probation_end: 'x' }, {}, {}), { row: { notice_days: 30, overtime: true }, errors: ['Probation ends on: a date as DD-MM-YYYY.', 'Retirement age (years): a whole number, 40 to 80.'] });
  assert.deepStrictEqual(P.clean(P.ROWS.family.fields, { relation: '' }, {}, {}).errors, ['Name: needed.']);
  const e = { dob: '1990-01-01', mobile: '9', email: '', gender: '', joined_on: '', department_id: null, designation_id: null }, c = P.complete(e, { data: { prefix: A }, secret: { uan: '1' } }, { family: [{}], education: [], experience: [], skill: [] }, ['emp.email', 'secret.uan', 'rows.education']);
  assert.deepStrictEqual([c.filled, c.of, c.missing], [5, P.ITEMS.length, ['E-mail', 'Education (at least one)']]); assert.strictEqual(P.mask('000123456789'), 'XXXX6789');
  for (const a of ['profGet', 'profSave', 'profRowSave', 'profRowRemove', 'listAll']) assert.match(String(ACT[a]), /needOffice\(s\)/, a); for (const a of ['listSave', 'profRequiredSave']) assert.match(String(ACT[a]), /needAdmin\(s\)/, a);
  for (const a of Object.keys(P.ACT)) assert.ok(SELF.indexOf(a) < 0, a + ' is not for "My HR"');
  const act = fs.readFileSync(path.join(root, 'lib', 'act_profile.js'), 'utf8'); assert.ok(!/db\('DELETE'/.test(act), 'nothing of the profile is deleted'); assert.match(act, /diff\[k\] = col === 'secret' \? 'changed'/, 'the audit never holds a number');
  const q = fs.readFileSync(path.join(root, 'sql', 'hr_step6_profile.sql'), 'utf8').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\b(drop|truncate|delete\s+from|alter\s+table\s+public\.\w+\s+(drop|rename))\b/i.test(q), 'step 6 only adds'); assert.ok(!/update\s+public\./i.test(q));
  assert.match(q, /foreach t in array array\['hr_lists', 'hr_employee_profile', 'hr_employee_rows', 'hr_settings'\] loop\s+execute format\('alter table public\.%I enable row level security', t\);\s+execute format\('revoke all on public\.%I from public, anon, authenticated', t\);\s+execute format\('grant select, insert, update on public\.%I to service_role', t\);/);
  const src = fs.readFileSync(path.join(root, 'public', 'prof.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  assert.deepStrictEqual(win.HRPROF.pages, [['lists', 'Lists']]); assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|\b(alert|confirm|prompt)\(/.test(src), 'only textContent, no browser dialog');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'); for (const id of src.match(/\$\('([a-z_0-9]+)'\)/g).map(x => x.slice(3, -2))) assert.ok(html.indexOf('id="' + id + '"') > -1, 'the page has #' + id);
  assert.strictEqual(win.HRPROF._show({ type: 'list', list: 'prefix' }, 'x', { prefix: [{ id: 'x', name: 'Mr.' }] }), 'Mr.'); assert.strictEqual(win.HRPROF._show({ type: 'yesno' }, false, {}), 'No');
});

test('leave (step 7): the balance is walked day by day – monthly leaves, carry or lapse, an absent day takes one, an off day never; SQL only adds', () => {
  const L = require('../lib/leave'), { ACT, SELF } = require('../api/hr'), d = rows => rows.map(x => ({ day: x[0], code: x[1] }));
  const site = [{ id: 1, valid_from: '2026-11-01', per_month: 4, carry: true, auto_absent: true }];
  // a road site: no weekly off – a Sunday absent takes a leave like any day; five absences, four leaves: the fifth stays absent
  let w = L.walk(d([['2026-10-31', 'A'], ['2026-11-01', 'A'], ['2026-11-02', 'P'], ['2026-11-03', 'A'], ['2026-11-04', 'A'], ['2026-11-05', 'A'], ['2026-11-06', 'A']]), { policies: site, first: '2026-11-01' });
  assert.deepStrictEqual([w.balance, Object.keys(w.marks), w.months['2026-11']], [0, ['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-05'], { credit: 4, added: 0, used: 4 }]);
  // the Head Office: its Sunday is a weekly off – an approved leave over it takes nothing for that day; a day he came after all: nothing
  w = L.walk(d([['2026-11-07', 'A'], ['2026-11-08', 'WO'], ['2026-11-09', 'A'], ['2026-11-10', 'P'], ['2026-11-11', 'HD']]), { policies: [{ valid_from: '2026-11-01', per_month: 2, carry: true, auto_absent: false }], first: '2026-11-01', leave: { '2026-11-08': 1, '2026-11-09': 1, '2026-11-10': 1, '2026-11-11': 0.5 } });
  assert.deepStrictEqual([w.balance, w.marks], [0.5, { '2026-11-09': { days: 1, auto: false }, '2026-11-11': { days: 0.5, auto: false } }], 'auto_absent off: the absent 7th takes nothing');
  // unused leaves go on – or lapse; what the HR office added counts on its day; a new version from its date
  const two = d([['2026-11-30', 'P'], ['2026-12-01', 'P']]);
  assert.strictEqual(L.walk(two, { policies: site, first: '2026-11-01', adjust: { '2026-11-30': 1.5 } }).balance, 9.5);
  assert.strictEqual(L.walk(two, { policies: [{ valid_from: '2026-11-01', per_month: 4, carry: false, auto_absent: true }], first: '2026-11-01', adjust: { '2026-11-30': 1.5 } }).balance, 4);
  assert.strictEqual(L.walk(two, { policies: site.concat([{ id: 2, valid_from: '2026-12-01', per_month: 1, carry: true, auto_absent: true }]), first: '2026-11-01' }).balance, 5);
  assert.strictEqual(L.walk(two, { policies: site, first: '2026-12-01' }).balance, 4, 'a person who joined in December gets nothing of November');
  assert.strictEqual(L.walk(two, { policies: [], first: '2026-11-01' }).balance, 0);
  assert.deepStrictEqual(L.policy({ per_month: '4', carry: false }).row, { per_month: 4, carry: false, auto_absent: true, levels: 2 }); assert.deepStrictEqual(L.policy({ per_month: 'x', levels: 3 }).errors, ['Leaves a month: 0 to 31 (halves allowed).', 'Who approves: 1 or 2 levels.']);
  for (const a of ['leaveList', 'leaveBalances', 'leavePolicy']) assert.match(String(ACT[a]), /needOffice\(s\)/, a);
  for (const [a, p] of [['leaveDecide', 'regularize'], ['leaveAdjust', 'regularize'], ['leavePolicySave', 'shifts']]) assert.ok(String(ACT[a]).indexOf("await power.need(s, '" + p + "')") > -1, a);
  for (const a of ['myLeave', 'leaveAsk', 'leaveCancel', 'teamLeaves', 'teamLeaveDecide']) { assert.ok(SELF.indexOf(a) > -1, a); assert.match(String(ACT[a]), /await me\(s\)/, a + ': only for the employee the sign-in is'); }
  const act = fs.readFileSync(path.join(root, 'lib', 'act_leave.js'), 'utf8'); assert.ok(!/db\('DELETE'/.test(act)); assert.ok(!/db\('PATCH', 'hr_leave_(policy|adjust)/.test(act), 'a policy and an adjustment are only added');
  const q = fs.readFileSync(path.join(root, 'sql', 'hr_step7_leave.sql'), 'utf8').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\b(drop|truncate|delete\s+from|alter\s+table\s+public\.\w+\s+(drop|rename))\b/i.test(q) && !/update\s+public\./i.test(q), 'step 7 only adds');
  const lj = fs.readFileSync(path.join(root, 'public', 'leave.js'), 'utf8'), lw = {}; new Function('window', 'document', lj)(lw, { getElementById: () => null }); assert.deepStrictEqual(lw.HRLEAVE.pages, [['leave', 'Leave']]);
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|\b(alert|confirm|prompt)\(/.test(lj), 'only textContent, no browser dialog');
  assert.match(q, /grant select, insert on public\.hr_leave_policy, public\.hr_leave_adjust to service_role;/); assert.match(q, /grant select, insert, update on public\.hr_leave_requests to service_role;/);
});

test('(the app\'s "Me") a person\'s own record and papers: always the employee the sign-in is, never an id from the phone; numbers masked; he removes nothing', () => {
  const { ACT, SELF } = require('../api/hr'), src = fs.readFileSync(path.join(root, 'lib', 'act_self.js'), 'utf8');
  for (const a of ['myHr', 'myDocs', 'myDocUploadUrl', 'myDocAdd', 'myDocLink']) { assert.ok(SELF.indexOf(a) > -1, a); assert.match(String(ACT[a]), /const emp = await me\(s\)/, a); assert.ok(!/x\.id\b/.test(String(ACT[a])), a + ': no employee id is taken from the phone'); }
  assert.match(String(ACT.myDocUploadUrl), /Object\.assign\(\{\}, x, \{ id: emp\.id \}\)/); assert.match(String(ACT.myDocAdd), /Object\.assign\(\{\}, x, \{ id: emp\.id \}\)/);
  assert.match(String(ACT.myDocLink), /&employee_id=eq\.' \+ emp\.id/, 'only a paper of his own');
  assert.ok(!/docRemove|DELETE|PATCH|POST/.test(src), 'nothing is removed or changed here – a paper is attached through the office\'s own action');
  assert.match(src, /const MASKED = \['pf_no', 'uan', 'esic_no', 'bank_account'\];/); assert.match(src, /secret && MASKED\.indexOf\(d\.key\) > -1 \? P\.mask\(v\) : String\(v\)/);
  assert.ok(SELF.indexOf('docRemove') < 0 && SELF.indexOf('docList') < 0 && SELF.indexOf('profGet') < 0);
});

test('an employee\'s sign-in is asked of the Portal from the page; HR\'s server keeps no password; only the Admin sees the button', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8');
  for (const id of ['d_login', 'dlg_login', 'lg_title', 'lg_email', 'lg_mobile', 'lg_done', 'lg_pw', 'lg_err', 'lg_go', 'b_signin', 'dlg_signin', 'sg_go', 'sg_res']) assert.ok(html.indexOf('id="' + id + '"') > -1, '#' + id);
  assert.match(html, /window\.HRPORTAL = function \(path, body\) \{[\s\S]+?fetch\(PORTAL \+ '\/' \+ path, \{ method: 'POST', credentials: 'same-origin', headers: \{ 'Content-Type': 'application\/json', 'X-RCL': '1' \}/);
  assert.match(js, /\$\('d_login'\)\.hidden = left \|\| !isAdmin\(\);/); assert.match(js, /window\.HRPORTAL\('api\/hrlogin', \{ site: e\.site, email: e\.email \|\| '', mobile: e\.mobile \|\| '', name: e\.name, known: e\.portal_email \|\| '' \}\)/, '(13-11-2026) his e-mail, his mobile number, or both');
  assert.match(js, /\$\('b_signin'\)\.hidden = !S\.init\.signin;/, 'everybody at once: only who the server says'); assert.match(js, /window\.HRPORTAL\('api\/hrlogin', \{ site: site, people: part\.map\(/);
  assert.match(js, /if \(b\.dataset\.close === 'dlg_login'\) \{ \$\('lg_pw'\)\.textContent = ''; \$\('lg_done'\)\.hidden = true; \}/, 'the one-time password leaves the page with its box');
  assert.ok(!/localStorage|sessionStorage/.test(js.slice(js.indexOf('function loginGive'), js.indexOf('// ---------- add / change'))), 'kept nowhere');
  for (const f of fs.readdirSync(path.join(root, 'api')).concat(fs.readdirSync(path.join(root, 'lib')).map(x => '../lib/' + x))) assert.ok(!/password/i.test(fs.readFileSync(path.join(root, 'api', f), 'utf8').replace(/No secret, key, password[^\n]*/g, '')), f + ': HR\'s server has nothing to do with passwords');
});

test('an employee\'s page opens at once from the list; nothing of him is changed before the server\'s own answer; the readings of one action are asked together', () => {
  const js = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), api = fs.readFileSync(path.join(root, 'api', 'hr.js'), 'utf8');
  assert.match(js, /else if \(had\) \{ drawEmp\(\{ employee: had, history: \[\], boss: null \}, false\); show\('dlg_emp'\); \}/);
  assert.match(js, /if \(seq !== S\.seq \|\| \(\(had \|\| mem\) && \$\('dlg_emp'\)\.hidden\)\) return;/, 'closed or another opened meanwhile: the late answer is dropped');
  assert.match(js, /\['d_prof', 'd_kyc', 'd_docs', 'd_login', 'd_facebtn', 'd_salary', 'd_del', 'd_exit', 'd_tr', 'd_edit'\]\.forEach\(function \(b\) \{ \$\(b\)\.disabled = !full; \}\);/);
  assert.ok(!/localStorage|sessionStorage/.test(js.slice(js.indexOf('function openEmp'), js.indexOf('function login()'))), 'kept in the page\'s memory only');
  for (const a of ['empList', 'empGet', 'privGet']) { const i = api.indexOf('async ' + a + '('); assert.match(api.slice(i, i + 1400), /await Promise\.all\(\[db\('GET'/, a); }
});

test('(13-11-2026) the rules in words – for the attendance PDF: one line for each rule that is set, none for one that is not', () => {
  const D = require('../lib/day');
  assert.deepStrictEqual(D.ruleNotes({}, null), []); assert.deepStrictEqual(D.ruleNotes(null, null), []);
  assert.deepStrictEqual(D.ruleNotes({ full_hours: 9, half_hours: 4.5, grace_min: 15, half_after_min: 120, late_free: 3, late_to_half: 3, early_min: 30, once: true, week_off: [0], face: true }, { start_time: '08:30', end_time: '17:30', auto_out: '23:50' }), [
    'Full day: 9 working hours or more.', 'Half day: 4.5 working hours or more, but fewer than 9. Fewer than 4.5 hours: absent.', 'Late: IN more than 15 minutes after the shift starts.',
    'IN 120 minutes or more after the shift starts: the day counts as a half day.', 'The first 3 late days of a month are only marked; every late day after them counts as a half day.',
    'Every 3 late days of a month take half a day from the days for pay.', 'Early leaving: OUT more than 30 minutes before the shift ends.', 'One IN and one OUT a day.',
    'OUT not marked: the day is closed by itself at 23:50 and counts as absent.', 'Weekly off: Sunday.', 'Attendance is marked only with the registered face.']);
  assert.deepStrictEqual(D.ruleNotes({ full_hours: 8 }, { start_time: '08:30', end_time: '17:30' }), ['Full day: 8 working hours or more.', 'Fewer than 8 working hours: half day.']);
});

test('(12-11-2026) once a day; a forgotten OUT closed at the shift\'s own time = absent; 3 late days only marked, then a half day; very late = a half day; a night shift', () => {
  const D = require('../lib/day'), T = (day, hm) => D.at(day, hm), day = '2026-11-10', next = '2026-11-11', dayS = { start_time: '08:30', end_time: '18:00', auto_out: '23:50' }, night = { start_time: '20:00', end_time: '06:00', auto_out: '11:50' };
  // the rules as typed
  assert.deepStrictEqual(D.rules({ once: 'yes', late_free: 3, half_after_min: 120, grace_min: 0 }).rules, { grace_min: 0, late_free: 3, half_after_min: 120, once: true });
  assert.match(D.rules({ grace_min: 30, half_after_min: 30 }).errors.join(), /more than the grace/); assert.deepStrictEqual(D.rules({}).rules, {}, 'nothing typed = nothing applied');
  assert.strictEqual(D.shift({ name: 'Day', start_time: '08:30', end_time: '18:00', auto_out: '23:50' }).row.auto_out, '23:50'); assert.match(D.shift({ name: 'Day', start_time: '08:30', end_time: '18:00', auto_out: '25:00' }).errors.join(), /Closed by itself/);
  // closed by itself: the day shift the same night, the night shift the next morning
  assert.strictEqual(D.autoOutAt(dayS, day), T(day, '23:50')); assert.strictEqual(D.autoOutAt(night, day), T(next, '11:50')); assert.strictEqual(D.autoOutAt({ start_time: '08:30', end_time: '18:00' }, day), null);
  const st = (x) => D.status(Object.assign({ day: day, today: next, in: T(day, '08:20'), out: null, holiday: '', rules: {}, shift: dayS }, x));
  assert.deepStrictEqual([st({ now: T(day, '23:49'), today: day }).code, st({ now: T(day, '23:50'), today: day }).code, st({ now: T(day, '23:50'), today: day }).auto], ['IN', 'A', true]);
  assert.deepStrictEqual([st({ now: T(next, '09:00'), shift: night, in: T(day, '20:05') }).code, st({ now: T(next, '11:50'), shift: night, in: T(day, '20:05') }).code], ['MIS', 'A'], 'a night shift is still open the next morning');
  assert.strictEqual(st({ now: T(next, '09:00'), shift: { start_time: '08:30', end_time: '18:00' } }).code, 'MIS', 'no closing time: as before');
  assert.strictEqual(st({ now: T(next, '09:00'), out: T(day, '18:05') }).code, 'P', 'with its OUT nothing is closed');
  assert.strictEqual(st({ now: T(next, '09:00'), in: T(day, '23:55') }).code, 'MIS', 'an IN after the closing time is not closed by it');
  // very late = a half day at once
  const late = D.status({ day: day, today: next, now: T(next, '09:00'), in: T(day, '10:45'), out: T(day, '19:00'), holiday: '', rules: { grace_min: 0, half_after_min: 120 }, shift: dayS });
  assert.deepStrictEqual([late.code, late.late_half, late.late_min], ['HD', true, 135]);
  assert.strictEqual(D.status({ day: day, today: next, now: T(next, '09:00'), in: T(day, '09:00'), out: T(day, '19:00'), holiday: '', rules: { grace_min: 0, half_after_min: 120 }, shift: dayS }).code, 'P');
  // the late days of a month: the first 3 only marked, the 4th and later a half day; a new month starts again; an absent day is not a late day
  const mk = list => list.map(x => ({ day: x[0], code: x[1], late_min: x[2] })), got = D.lateHalves(mk([['2026-11-02', 'P', 5], ['2026-11-03', 'P', 0], ['2026-11-04', 'P', 9], ['2026-11-05', 'A', 0], ['2026-11-06', 'P', 1], ['2026-11-07', 'P', 2], ['2026-11-09', 'HD', 3], ['2026-11-10', 'P', 4], ['2026-12-01', 'P', 7]]), () => ({ late_free: 3 }));
  assert.deepStrictEqual(got.map(d => d.code), ['P', 'P', 'P', 'A', 'P', 'HD', 'HD', 'HD', 'P']); assert.deepStrictEqual(got.filter(d => d.late_half).map(d => d.day), ['2026-11-07', '2026-11-10']);
  assert.deepStrictEqual(D.lateHalves(mk([['2026-11-02', 'P', 5], ['2026-11-03', 'P', 5]]), () => ({})).map(d => d.code), ['P', 'P'], 'no such rule: late days are only marked');
  assert.deepStrictEqual(D.lateHalves(mk([['2026-11-02', 'P', 5]]), () => ({ late_free: 0 })).map(d => d.code), ['HD'], '0 allowed: the first late day is a half day');
  // where his day stands: once a day; the OUT of a night shift the morning after; closed by itself
  const P = (kind, d, hm) => ({ kind: kind, day: d, at: new Date(T(d, hm)).toISOString() }), on = sh => () => sh, S = (list, now, r, sh) => { const x = D.stand(list, now, next, r, on(sh)); return [x.next, x.open ? x.open.day : '', x.closed ? 1 : 0, x.shown.length]; };
  assert.deepStrictEqual(S([], T(next, '08:00'), { once: true }, dayS), ['in', '', 0, 0]);
  assert.deepStrictEqual(S([P('in', next, '08:20')], T(next, '12:00'), { once: true }, dayS), ['out', next, 0, 1]);
  assert.deepStrictEqual(S([P('in', next, '08:20'), P('out', next, '18:00')], T(next, '18:05'), { once: true }, dayS), ['done', '', 0, 2], 'once a day: no second IN');
  assert.deepStrictEqual(S([P('in', next, '08:20'), P('out', next, '18:00')], T(next, '18:05'), {}, dayS), ['in', '', 0, 2], 'without the rule: as before');
  assert.deepStrictEqual(S([P('in', next, '08:20')], T(next, '23:51'), { once: true }, dayS), ['done', '', 1, 1], 'closed by itself: nothing more today');
  assert.deepStrictEqual(S([P('in', day, '20:05')], T(next, '06:10'), { once: true }, night), ['out', day, 0, 1], 'the night shift\'s OUT the morning after');
  assert.deepStrictEqual(S([P('in', day, '20:05'), P('out', next, '06:10')], T(next, '19:55'), { once: true }, night), ['in', '', 0, 1], 'and its IN the same evening');
  assert.deepStrictEqual(S([P('in', day, '20:05')], T(next, '12:00'), { once: true }, night), ['in', '', 0, 0], 'yesterday\'s night was closed by itself: today starts new');
  assert.deepStrictEqual(S([P('in', day, '08:20')], T(next, '08:00'), {}, { start_time: '08:30', end_time: '18:00' }), ['in', '', 0, 0], 'no closing time: yesterday\'s IN is open for 20 hours only');
  const src = fs.readFileSync(path.join(root, 'lib', 'act_attend.js'), 'utf8');
  assert.match(src, /if \(kind === 'in' && st\.next === 'done'\) throw fail\(409, 'Today\\'s attendance is done – one IN and one OUT a day\./); assert.ok(!/PATCH', 'hr_punches|DELETE', 'hr_punches/.test(src), 'a punch is never changed or deleted – a closed day is only read so');
});

test('(step 9) the face: the percentage from the model\'s distance, the site\'s rule, the nearest registered picture; no punch without the check; only himself; nothing deleted', () => {
  const F = require('../lib/face'), D = require('../lib/day');
  assert.deepStrictEqual([0, 0.3, 0.45, 0.5, 0.6, 0.7, 1].map(F.pct), [100, 99, 90, 81, 50, 19, 0], '0.45 reads 90 %, the model\'s own line 0.6 reads 50 %');
  assert.ok(Math.abs(F.distOf(90) - 0.45) < 1e-9); assert.ok(F.pct(F.distOf(80)) === 80 && F.distOf(80) > F.distOf(90), 'a lower percentage allows a wider distance');
  assert.deepStrictEqual([F.minOf({}), F.minOf({ face_min: 85 }), F.minOf({ face_min: 10 }), F.minOf(null)], [90, 85, 90, 90], '90 unless the site set its own');
  const a = new Array(128).fill(0), b = a.slice(); b[0] = 0.3; const c = a.slice(); c[0] = 0.8;
  assert.deepStrictEqual(F.nearest([c, b], a), { distance: 0.3, pct: 99 }, 'the nearest of the registered pictures counts'); assert.deepStrictEqual(F.nearest([], a), { distance: Infinity, pct: 0 });
  assert.deepStrictEqual(D.rules({ face: 'yes', face_min: 90 }).rules, { face_min: 90, face: true }); assert.match(D.rules({ face_min: 30 }).errors.join(), /Face: at least/); assert.deepStrictEqual(D.rules({ face: '' }).rules, {}, 'not asked unless switched on');
  const att = fs.readFileSync(path.join(root, 'lib', 'act_attend.js'), 'utf8'), face = fs.readFileSync(path.join(root, 'api', 'face.js'), 'utf8'), FA = require('../api/face');
  assert.match(att, /if \(st\.face\) \{\s+let seen; try \{ seen = \(await db\('GET', 'hr_face_tries\?select=id&employee_id=eq\.' \+ emp\.id \+ '&client_id=eq\.' \+ cid \+ '&kind=eq\.punch&result=eq\.ok&limit=1'\)\)/, 'this punch\'s own photo must have been found his');
  assert.ok(att.indexOf('if (st.face) {') < att.indexOf("await db('POST', 'hr_punches'"), 'checked before anything is saved');
  assert.deepStrictEqual(FA.SELF, ['faceState', 'faceEnrolUrls', 'faceEnrol', 'faceCheck']); for (const k of FA.SELF) { assert.match(String(FA.ACT[k]), /const emp = await me\(s\)/, k); assert.ok(!/x\.id\b/.test(String(FA.ACT[k])), k + ': no employee id from the phone'); }
  assert.match(String(FA.ACT.faceInfo), /needOffice\(s\)/); assert.match(String(FA.ACT.faceReset), /if \(!isAdmin\(s\)\) throw fail\(403/);
  assert.ok(!/'DELETE'/.test(face), 'a face is reset, never deleted'); assert.match(face, /if \(s\.role === 'self' && SELF\.indexOf\(String\(x\.action\)\) < 0\) throw fail\(403/);
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')); assert.ok(v.functions['api/face.js'].includeFiles.indexOf('face-api/model') > -1, 'the model goes with the endpoint');
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step9_faces.sql'), 'utf8'); assert.ok(!/drop table|delete from|truncate/i.test(sql.replace(/^--.*$/gm, '')), 'the step deletes nothing'); assert.match(sql, /grant select, insert on public\.hr_face_tries to service_role;/);
});

test('(step 10) the month: the counts of a person; verified = still the same; who may do what; an approved month is closed everywhere a day is changed; the step only adds', () => {
  const M = require('../lib/month'), MO = require('../lib/act_month'), root = path.join(__dirname, '..');
  const days = ['P', 'P', 'HD', 'A', 'L', 'WO', 'H', 'WOP', 'HP', 'MIS', '', 'P'].map((c, i) => ({ code: c, late_min: i === 1 || i === 2 ? 12 : 0 }));
  const c = M.counts(days, { paid: 6.04 });
  assert.deepStrictEqual(c, { present: 3, half: 1, absent: 1, leave: 1, week_off: 1, holiday: 1, extra: 2, late: 2, open: 1, paid: 6 });
  assert.strictEqual(M.same(c, Object.assign({}, c)), true); assert.strictEqual(M.same(c, Object.assign({}, c, { extra: 1 })), false); assert.strictEqual(M.same(null, c), false);
  assert.deepStrictEqual([M.lastDay('2026-02'), M.lastDay('2028-02'), M.lastDay('2026-10'), M.monthOk('2026-13'), M.monthOk('2026-11')], ['2026-02-28', '2028-02-29', '2026-10-31', false, true]);
  const A = MO.ACT;
  assert.match(String(A.monthVerify), /await power\.need\(s, 'month'\)/); assert.match(String(A.monthVerify), /await needOpen\(s\.site, month \+ '-01'\)/);
  for (const k of ['monthReturn', 'monthApprove', 'monthSites']) assert.match(String(A[k]), /needOffice\(s\); await needHo\(s\)/, k);
  for (const k of ['monthReopen', 'hoList', 'hoSet']) assert.match(String(A[k]), /if \(s\.role !== 'super'\) throw fail\(403/, k);
  assert.match(String(A.monthList), /^async monthList\(s, x\) \{\s+needOffice\(s\)/);
  const src = f => fs.readFileSync(path.join(root, 'lib', f), 'utf8');
  assert.ok(!/'DELETE'/.test(src('act_month.js')), 'nothing is deleted'); assert.ok(!/hr_punches|hr_day_entries'/.test(src('act_month.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'attendance itself is not written here');
  // closed: a day set by hand, a request asked and approved, a doubtful punch decided, a leave decided
  assert.strictEqual((src('act_muster.js').match(/require\('\.\/act_month'\)\.needOpen\(/g) || []).length, 3); assert.match(src('act_attend.js'), /needOpen\(s\.site, R\.today\(Date\.parse\(p\.at\)\)\)/); assert.match(src('act_leave.js'), /needOpen\(s\.site, q\.from_day\)/);
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step10_month.sql'), 'utf8').replace(/^--.*$/gm, '');
  assert.ok(!/drop |delete from|truncate|alter table public\.hr_(?!ho_hr|month)/i.test(sql), 'the step only adds its own three tables'); assert.match(sql, /unique \(site, month, employee_id\)/); assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select, insert, update on public\.hr_ho_hr, public\.hr_month_people, public\.hr_months to service_role;/);
  const page = fs.readFileSync(path.join(root, 'public', 'month.js'), 'utf8'); assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(page), 'a person\'s text only as text');
  assert.match(fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), /<section id="p_month" hidden><\/section>[\s\S]*<script src="month\.js"><\/script>/);
});

test('(step 11) a salary: the amount as typed; the one that counts on a day; never for an HR User or "My HR"; the step only adds', () => {
  const P = require('../lib/act_pay'), root = path.join(__dirname, '..');
  assert.deepStrictEqual(['18000', '18,000.50', '₹ 700', '0', '-1', '1.234', '', 'x', '9999999', '10000000'].map(P.amountOf), [18000, 18000.5, 700, null, null, null, null, null, 9999999, null]);
  const rows = [{ id: 1, status: 'approved', valid_from: '2026-01-01' }, { id: 2, status: 'approved', valid_from: '2026-06-01' }, { id: 3, status: 'pending', valid_from: '2026-07-01' }, { id: 4, status: 'returned', valid_from: '2026-02-01' }, { id: 5, status: 'approved', valid_from: '2026-06-01' }];
  assert.deepStrictEqual(['2025-12-31', '2026-03-01', '2026-06-01', '2026-12-01'].map(d => (P.current(rows, d) || {}).id), [undefined, 1, 5, 5]);
  assert.match(String(P.ACT.salaryAsk), /await power\.need\(s, 'salary'\)/); assert.match(String(P.ACT.salaryGet), /await maySee\(s\)/);
  for (const k of ['salaryWaiting', 'salaryDecide']) assert.match(String(P.ACT[k]), /needOffice\(s\); if \(!\(await isHo\(s\)\)\) throw fail\(403/, k);
  const H = require('../api/hr'); for (const k of Object.keys(P.ACT)) assert.ok(H.SELF.indexOf(k) < 0, k + ' is not for "My HR"');
  const src = fs.readFileSync(path.join(root, 'lib', 'act_pay.js'), 'utf8'); assert.ok(!/'DELETE'/.test(src)); assert.ok(!/audit\([^;]*amount/.test(src), 'the amount is not written into the audit');
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step11_salary.sql'), 'utf8').replace(/^--.*$/gm, '');
  assert.ok(!/drop |delete from|truncate|alter table public\.hr_(?!salaries)/i.test(sql)); assert.match(sql, /enable row level security/); assert.match(sql, /grant select, insert, update on public\.hr_salaries to service_role;/); assert.match(sql, /where status = 'pending'/);
  const page = fs.readFileSync(path.join(root, 'public', 'pay.js'), 'utf8'); assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(page));
  assert.match(fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), /id="d_salary"[^>]*hidden>Salary…<\/button>[\s\S]*<script src="pay\.js"><\/script>/);
});

test('(step 12) the pay of a person: a month\'s salary ÷ the days of the month, a day\'s rate, an extra day = one day\'s pay; PF / ESIC / PT only when ticked and set; the advance never more than what is left; no number of a law in the code', () => {
  const P = require('../lib/pay'), root = path.join(__dirname, '..');
  const c = { present: 20, half: 2, absent: 3, leave: 1, week_off: 4, holiday: 1, extra: 2, late: 0, open: 0, paid: 29 };
  // a month's salary: 31 000 in a month of 31 days = 1 000 a day
  let s = P.slip({ salary: { pay_type: 'monthly', amount: 31000 }, counts: c, month_days: 31, flags: {}, settings: {}, adjust: {} });
  assert.deepStrictEqual([s.day, s.pay_days, s.earned, s.extra, s.gross, s.pf, s.esic, s.pt, s.advance, s.net, s.problem], [1000, 29, 29000, 2000, 31000, 0, 0, 0, 0, 31000, '']);
  assert.strictEqual(P.slip({ salary: { pay_type: 'monthly', amount: 30000 }, counts: c, month_days: 30, flags: {}, settings: {} }).earned, 29000, 'the days of THAT month');
  // a day's rate: the days worked, half days as a half, leave; no pay for a weekly off not worked
  s = P.slip({ salary: { pay_type: 'daily', amount: 600 }, counts: c, month_days: 31, flags: {}, settings: {} });
  assert.deepStrictEqual([s.pay_days, s.earned, s.extra, s.net], [22, 13200, 1200, 14400]);
  // the settings: only when ticked AND set
  const set = { pf_pct: 12, pf_cap: 15000, esic_pct: 0.75, esic_limit: 21000, pt_slabs: [{ from: 7500, amount: 175 }, { from: 10000, amount: 200 }] };
  s = P.slip({ salary: { pay_type: 'monthly', amount: 31000 }, counts: c, month_days: 31, flags: { pf: true, esic: true, pt: true }, settings: set, adjust: { other_earn: 500, other_ded: 100 }, advance: { id: 1, left: 3000, monthly: 2000 } });
  assert.deepStrictEqual([s.gross, s.pf, s.esic, s.pt, s.advance, s.other_ded, s.deductions, s.net], [31500, 1800, 0, 200, 2000, 100, 4100, 27400], 'PF on the cap; no ESIC above the limit; the highest slab reached');
  assert.deepStrictEqual([P.slip({ salary: { pay_type: 'monthly', amount: 31000 }, counts: c, month_days: 31, flags: { pf: true, esic: true, pt: true }, settings: {} }).deductions, P.slip({ salary: { pay_type: 'monthly', amount: 31000 }, counts: c, month_days: 31, flags: {}, settings: set }).deductions], [0, 0]);
  s = P.slip({ salary: { pay_type: 'daily', amount: 500 }, counts: { present: 1 }, month_days: 30, flags: { esic: true, pt: true }, settings: set }); assert.deepStrictEqual([s.esic, s.pt, s.net], [4, 0, 496], 'ESIC rounded up; below the first slab no tax');
  // the advance: what is left, what he said for this month, never more than the pay
  const adv = a => P.slip({ salary: { pay_type: 'daily', amount: 500 }, counts: { present: 2 }, month_days: 30, flags: {}, settings: {}, adjust: a.adjust, advance: a.advance }).advance;
  assert.deepStrictEqual([adv({ advance: { left: 300, monthly: 2000 } }), adv({ advance: { left: 5000, monthly: 2000 } }), adv({ advance: { left: 5000, monthly: 2000 }, adjust: { advance: 0 } }), adv({ advance: { left: 5000, monthly: 2000 }, adjust: { advance: 250 } }), adv({})], [300, 1000, 0, 250, 0]);
  assert.match(P.slip({ salary: null, counts: c, month_days: 31 }).problem, /No approved salary/);
  assert.match(P.slip({ salary: { pay_type: 'daily', amount: 100 }, counts: { present: 1 }, month_days: 30, adjust: { other_ded: 500 } }).problem, /deductions are more than the pay/);
  assert.deepStrictEqual(P.totals([{ gross: 10, net: 8, pf: 2 }, { gross: 5.5, net: 5 }]).gross, 15.5);
  // the settings as typed
  assert.deepStrictEqual(P.settings({ pf_pct: '12', pf_cap: '15,000', esic_pct: '', pt_slabs: [{ from: '10000', amount: '200' }, { from: '7500', amount: '175' }, { from: '', amount: '' }] }), { errors: [], settings: { pf_pct: 12, pf_cap: 15000, pt_slabs: [{ from: 7500, amount: 175 }, { from: 10000, amount: 200 }] } });
  assert.strictEqual(P.settings({ pf_pct: '120' }).errors.length, 1); assert.strictEqual(P.settings({ pt_slabs: [{ from: 'x', amount: '1' }] }).errors.length, 1); assert.strictEqual(P.settings({ pt_slabs: [{ from: '1', amount: '1' }, { from: '1', amount: '2' }] }).errors.length, 1);
  const code = fs.readFileSync(path.join(root, 'lib', 'pay.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\b(0\.75|3\.25|15000|21000|200|175|2500)\b/.test(code), 'no rate, limit or slab of a law is written into the code');
  const R = require('../lib/act_payroll'); for (const k of Object.keys(R.ACT)) if (k !== 'mySlips') assert.match(String(R.ACT[k]), /await needHo\(s\)/, k + ': the HO HR only');
  assert.match(String(R.ACT.mySlips), /const emp = await me\(s\)/); assert.ok(!/x\b/.test(String(R.ACT.mySlips).split('{')[0].replace('mySlips(s)', '')), 'nothing is taken from the phone');
  const src = fs.readFileSync(path.join(root, 'lib', 'act_payroll.js'), 'utf8'); assert.ok(!/'DELETE'/.test(src)); assert.ok(!/'PATCH', 'hr_pay(slips|_runs)/.test(src), 'a locked month is never changed');
  const sql = fs.readFileSync(path.join(root, 'sql', 'hr_step12_payroll.sql'), 'utf8').replace(/^--.*$/gm, '');
  assert.ok(!/drop |delete from|truncate|alter table public\.hr_(?!pay_|advances)/i.test(sql)); assert.match(sql, /grant select, insert on public\.hr_pay_settings, public\.hr_pay_runs, public\.hr_payslips to service_role;/); assert.match(sql, /unique \(site, month\)/); assert.match(sql, /security invoker/);
  const M = require('../api/menu'); assert.deepStrictEqual([M.mayOpen('ho', 'super'), M.mayOpen('ho', 'admin'), M.mayOpen('ho', 'user', true), M.mayOpen('ho', 'self', true)], [true, false, true, false]);
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(fs.readFileSync(path.join(root, 'public', 'payroll.js'), 'utf8')));
});

test('(what comes up) a paper\'s date within 30 days or run out; a birthday and the years at work – also 29 February; who may take the bank list', () => {
  const C = require('../lib/coming'), root = path.join(__dirname, '..');
  assert.deepStrictEqual([C.paper('2026-12-12', '2026-11-12', 30), C.paper('2026-12-13', '2026-11-12', 30), C.paper('2026-11-12', '2026-11-12', 30), C.paper('2026-11-01', '2026-11-12', 30), C.paper('', '2026-11-12', 30), C.paper('x', '2026-11-12', 30)], [{ left: 30 }, null, { left: 0 }, { left: -11 }, null, null]);
  assert.deepStrictEqual(C.yearly('1990-11-12', '2026-11-12', 7), { in: 0, years: 36, day: '2026-11-12' }); assert.deepStrictEqual(C.yearly('1990-11-19', '2026-11-12', 7), { in: 7, years: 36, day: '2026-11-19' });
  assert.strictEqual(C.yearly('1990-11-20', '2026-11-12', 7), null); assert.strictEqual(C.yearly('1990-11-11', '2026-11-12', 7), null, 'yesterday\'s is next year');
  assert.deepStrictEqual(C.yearly('1990-01-02', '2026-12-30', 7), { in: 3, years: 37, day: '2027-01-02' }, 'over the year\'s end');
  assert.deepStrictEqual(C.yearly('1992-02-29', '2026-02-27', 7), { in: 1, years: 34, day: '2026-02-28' }); assert.deepStrictEqual(C.yearly('1992-02-29', '2028-02-27', 7), { in: 2, years: 36, day: '2028-02-29' });
  assert.strictEqual(C.yearly('2026-11-12', '2026-11-12', 7), null, 'the day he joined is not a year yet'); assert.strictEqual(C.yearly('', '2026-11-12', 7), null);
  const M = require('../lib/act_more');
  for (const k of ['paySlipOf', 'payBank']) assert.match(String(M.ACT[k]), /await needHo\(s\)/, k + ': the HO HR only'); assert.match(String(M.ACT.hrComing), /needOffice\(s\)/);
  assert.match(String(M.ACT.payBank), /await audit\(s\.site, s\.email, 'Bank list taken'/); assert.ok(!/audit\([^;]*(account|ifsc)/.test(String(M.ACT.payBank)), 'no number in the audit');
  const H = require('../api/hr'); for (const k of Object.keys(M.ACT)) assert.ok(H.SELF.indexOf(k) < 0, k + ' is not for "My HR"');
  const s = M.slipView('2026-10', 1260, { pay_type: 'monthly', rate: 31000, month_days: 31, pay_days: 2, extra_days: 0, earned: 2000, extra: 0, other_earn: 100, adjust: { earn_note: 'arrear' }, gross: 2100, pf: 240, esic: 0, pt: 200, advance: 400, other_ded: 0, deductions: 840 });
  assert.deepStrictEqual([s.net, s.earnings.map(l => l.label + ' ' + l.amount), s.deductions.map(l => l.label + ' ' + l.amount), s.total_deductions], [1260, ['Earned pay 2000', 'arrear 100'], ['PF 240', 'Profession Tax 200', 'Advance 400'], 840]);
  for (const f of ['payroll.js', 'dash.js']) assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(fs.readFileSync(path.join(root, 'public', f), 'utf8')), f + ': a person\'s text only as text');
});

test('(13-11-2026) the employee sheet: the company\'s 29 columns as they are, then ours; no Category column; headings found whatever their case; a company\'s sheet read as it is', () => {
  const SH = require('../lib/act_sheet'), P = require('../lib/act_profile'), heads = SH.COLS.map(c => c.head);
  assert.deepStrictEqual(heads.slice(0, 29), ['Name of Company', 'Branch Name', 'Current Project Name', 'UAN No.', 'Employee Name', 'Employee Code', 'Auto Monthly CTC', 'Date of Joining', 'Employee Status', 'Employee Retained', 'Sign In', 'Sign Out', 'PAN', 'Deduct PF',
    'Probation Period In Days', 'ESIC Contribution Rate', 'Deduct ESIC', 'ESIC Type', 'ESIC Deduction Rate', 'Deduct PT', 'TDS Type', 'Attach', 'Basic', 'Check Time', 'Annual Bonus', 'Deduct Income Tax', 'Annual Medical Reimbursement', 'Annual LTA', 'Totals']);
  for (const h of ['Mobile', 'E-mail', 'Date of Birth', 'Designation', 'Department', 'Aadhaar', 'Bank', 'Bank IFSC Code', 'Bank Account Number', 'Name as on Bank', 'PF Number', 'ESIC Number', 'Family Mobile', 'Current Address']) assert.ok(heads.indexOf(h) > 28, h);
  assert.ok(heads.indexOf('Category') === -1, 'no Category column in the sheet'); assert.strictEqual(new Set(heads).size, heads.length, 'no heading twice');
  const out = SH.colsOut(), names = [].concat(...out.map(c => c.names)); assert.strictEqual(new Set(names).size, names.length, 'a heading belongs to one column');
  assert.ok(out.find(c => c.key === 'category').old, 'a file of before with a Category column is still read');
  assert.deepStrictEqual(out.filter(c => c.fill).map(c => c.key), ['company', 'branch'], 'the company and the branch stand once for a group of rows – carried down');
  // every detail of the profile, the statutory & bank and the pay details has its column
  for (const g of Object.keys(P.GROUPS)) for (const d of P.GROUPS[g].fields) assert.ok(SH.COLS.some(c => c.kind === 'prof' && c.group === g && c.field === d.key), g + '.' + d.key);
  assert.deepStrictEqual([SH.yn('Yes'), SH.yn('no'), SH.yn('Y'), SH.yn(true), SH.yn('0'), SH.yn('maybe')], [true, false, true, true, false, null]);
  // the page: the company's sheet – merged cells (company / branch once), text numbers, a total's row
  const src = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  const m = win.HR._mapRows([['Name of Company', 'Branch Name', 'Current Project Name', 'UAN No.', 'Employee Name', 'Employee Code', 'Auto Monthly CTC', 'Date of Joining', 'Deduct PF', 'Totals'],
    ['Test Company Limited', 'Branch One', 'Site A', '', 'Person One', 'RCL101', '25000', '2024-04-01 00:00:00', 'Yes', '1'], ['', '', 'Site A', '', 'Person Two', 'M007', '0', '2025-01-15 00:00:00', 'No', '1'],
    ['', 'Branch Two', 'Site B', '', 'Person Three', '123', '18000', '2026-02-01 00:00:00', '', '1'], ['', '', '', '', '', '', '', '', '', '3']], out);
  assert.deepStrictEqual(m.rows.map(r => [r._line, r.company, r.branch, r.project, r.code, r.ctc, r.pf]), [[2, 'Test Company Limited', 'Branch One', 'Site A', 'RCL101', '25000', 'Yes'], [3, 'Test Company Limited', 'Branch One', 'Site A', 'M007', '0', 'No'], [4, 'Test Company Limited', 'Branch Two', 'Site B', '123', '18000', '']]);
  assert.ok(m.hasProject && !m.unknown.length);
  // the pay details: the Admin's only; the new kinds of detail are checked
  assert.ok(P.GROUPS.pay.adminOnly && P.GROUPS.pay.secret); assert.ok(P.ADMIN_KEYS.indexOf('ctc_monthly') > -1 && P.ADMIN_KEYS.indexOf('uan') === -1);
  const c = P.clean(P.GROUPS.pay.fields.concat(P.GROUPS.job.fields), { ctc_monthly: '25,000.50', basic: '-5', deduct_income_tax: false, sign_in: '9:05:00', sign_out: '25:00', probation_days: '180' }, {}, {});
  assert.deepStrictEqual(c.row, { ctc_monthly: 25000.5, deduct_income_tax: false, sign_in: '09:05', probation_days: 180 }); assert.match(c.errors.join(' '), /Basic: a number, 0 or more.*Sign out \(time\): a time as HH:MM\./);
});

test('the new look (13-11-2026): the menu on the left with every page as before, and Ctrl K – it opens only what the person has; every text as text', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), src = fs.readFileSync(path.join(root, 'public', 'find.js'), 'utf8'), dash = fs.readFileSync(path.join(root, 'public', 'dash.js'), 'utf8');
  // the frame: the menu, the search, the site – and the page's ids the scripts use
  assert.match(html, /<aside class="sd" id="side">[\s\S]*<nav id="tabs"[\s\S]*<div class="mn">[\s\S]*id="find_open"[\s\S]*id="site_pick"[\s\S]*id="who2"[\s\S]*<section id="p_emp">/);
  assert.match(html, /<script src="find\.js"><\/script>/); for (const id of src.match(/\$\('([a-z_0-9]+)'\)/g).map(x => x.slice(3, -2))) assert.ok(html.indexOf('id="' + id + '"') > -1, 'the page has #' + id);
  // every page of before has its group; the pages a person may not open are not in the menu – nor in the search (the same list)
  const G = new Function('return ' + /var GROUP = (\{[^}]+\})/.exec(js)[1])();
  assert.deepStrictEqual(Object.keys(G).sort(), ['approvals', 'attendance', 'departments', 'employees', 'leave', 'lists', 'month', 'muster', 'payroll', 'phones', 'places', 'requests', 'rulebook', 'rules']);      // (step 13) the Rule Book
  assert.match(js, /\.filter\(function \(p\) \{ return p\[2\]; \}\);/); assert.match(js, /pages: function \(\) \{ return S\.init \? pages\(\) : \[\]; \}/);
  // Ctrl K: the words typed must all be there; what starts with them comes first; an employee is asked from the server's own list
  const win = {}; new Function('window', 'document', 'navigator', src)(win, { getElementById: () => null, readyState: 'complete' }, {});
  const m = win.HRFIND._match; assert.deepStrictEqual([m('Payroll Leave & pay', 'pay'), m('Month verification', 'ver mon'), m('Muster', 'pay'), m('Add employee new person join', 'new')], [2, 1, 0, 1]);
  assert.strictEqual(win.HRFIND._norm('  Shifts   &  RULES '), 'shifts & rules');
  assert.match(src, /action: 'empList', q: q, status: '', category: ''/); assert.match(src, /if \(n !== F\.seq\) return;/); assert.match(src, /var b = \$\(a\[2\]\); return b && !b\.hidden/);
  for (const s of [src, dash]) assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|\b(alert|confirm|prompt)\(/.test(s), 'only textContent, no browser dialog');
  // the dashboard asks nothing new: the same one reading action
  assert.deepStrictEqual([...new Set([...dash.matchAll(/api\('([a-zA-Z]+)'/g)].map(x => x[1]))].sort(), ['attDash', 'punchSelfie']); assert.match(dash, /action: 'hrComing'/);
});

test('the new look, the rest (13-11-2026): the counts of the pages are counted from what the page has; the Sign-in column only asks the Portal to read; switches; the map beside the list', () => {
  const rd = f => fs.readFileSync(path.join(root, 'public', f), 'utf8'), html = rd('index.html'), js = rd('hr.js'), att = rd('att.js'), lv = rd('leave.js'), roll = rd('payroll.js'), mus = rd('mus.js'), dash = rd('dash.js'), act = fs.readFileSync(path.join(root, 'lib', 'act_dash.js'), 'utf8');
  // the dashboard: leave and absent of today come with attDash – inside "none"; still only reading
  assert.match(act, /leave: 0, absent: 0, absent_yesterday: 0/); assert.match(act, /d\.code === 'L' \? 'leave' : d\.code === 'A' \|\| d\.code === 'MIS' \? 'absent' : ''/); assert.ok(!/db\('(POST|PATCH|PUT|DELETE)'/.test(act));
  assert.match(dash, /open = Math\.max\(0, c\.none - lv - ab\)/); assert.match(dash, /cards: cards,/);
  // no page asks the server anything new for its cards
  for (const [name, src, actions] of [['att.js', att, ['punchDay', 'devList']], ['leave.js', lv, ['leaveList']], ['payroll.js', roll, ['payList']]]) { assert.match(src, /window\.HRDASH\.cards\(/, name); for (const a of actions) assert.match(src, new RegExp("api\\('" + a + "'"), name + ' ' + a); }
  // the Sign-in column: the Portal's "check" (read only), the admins only, hidden until it answers; the e-mail, the number and the kept ID – nothing else is sent
  assert.match(html, /<th id="th_signin" hidden>Sign-in<\/th><th>Status<\/th>/);
  assert.match(js, /if \(!isAdmin\(\) \|\| !window\.HRPORTAL\) return;/); assert.match(js, /window\.HRPORTAL\('api\/hrlogin', \{ site: S\.init\.site, check: ask\.map\(function \(e\) \{ return \{ email: e\.email \|\| '', mobile: e\.mobile \|\| '', known: e\.portal_email \|\| '' \}; \}\) \}\)/);
  assert.match(js, /r\.signins\.length !== ask\.length\) return;/);
  // the HR Admin's powers: the same checkbox and the same action, shown as a switch
  assert.match(mus, /el\('label', 'ck sw'\), cb = inp\('checkbox'\); cb\.setAttribute\('role', 'switch'\);[^\n]*api\('powerSet', \{ power: p\.key, allowed: cb\.checked \}\)/);
  // Work places: one map of the places of the list; a place on the map opens the same form as its row
  assert.match(att, /split\.appendChild\(t\.box\); split\.appendChild\(mb\); root\.appendChild\(split\); allMap\(mb, rows\);/); assert.match(att, /l\.on\('click', function \(\) \{ place\(o\); \}\)/);
  for (const s of [att, lv, roll, js]) assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(s));
});

test('an employee is ONE full page (13-11-2026): his head, Overview and the tabs of his full profile in it; no window on a window; the same actions as before', () => {
  const rd = f => fs.readFileSync(path.join(root, 'public', f), 'utf8'), html = rd('index.html'), js = rd('hr.js'), prof = rd('prof.js');
  assert.match(html, /<div class="dlg pg" id="dlg_emp" hidden>[\s\S]*class="ep-back" type="button" data-close="dlg_emp"[\s\S]*id="d_tabs"[\s\S]*<div id="d_over">[\s\S]*id="d_todo_body"[\s\S]*<div id="d_pbody" hidden><\/div>/);
  assert.match(html, /<div class="dlg pg" id="dlg_form" hidden>/); assert.match(html, /body\.in \.dlg\.pg\{display:block;background:#F3F6FC/);
  for (const id of ['d_edit', 'd_tr', 'd_login', 'd_salary', 'd_facebtn', 'd_exit', 'd_del', 'd_kyc', 'd_docs', 'd_prof']) assert.strictEqual(html.split('id="' + id + '"').length, 2, 'one button #' + id);
  // the profile is drawn INTO the page (the same actions of the server); the window of before still works without `into`
  assert.match(prof, /function profile\(id, done, into\) \{/); assert.match(prof, /if \(into\) all\.unshift\(\{ key: 'overview', name: 'Overview' \}\);/); assert.match(prof, /if \(into && into\.live && !into\.live\(\)\) return;/);
  assert.deepStrictEqual([...new Set([...prof.matchAll(/api\('(prof[A-Za-z]+)'/g)].map(x => x[1]))].sort(), ['profGet', 'profRequiredSave', 'profRowRemove', 'profRowSave', 'profSave']);
  assert.match(js, /S\.prof = window\.HRPROF\.profile\(id, null, \{ tabs: \$\('d_tabs'\), body: \$\('d_pbody'\)/);
  // a window closed without saving goes back to his page; a change saved too; another page of the menu leaves it
  assert.match(js, /function back\(d\) \{ if \(\{ dlg_form: 1, dlg_tr: 1, dlg_exit: 1, dlg_del: 1 \}\[d\] && S\.open && S\.open\.employee/); assert.match(js, /\['dlg_emp', 'dlg_form'\]\.forEach\(function \(d\) \{ if \(\$\(d\) && !\$\(d\)\.hidden\) hide\(d\); \}\);/);
  assert.match(js, /if \(\$\('f_id'\)\.value && !\(r\.site && r\.site !== S\.me\.site\)\) openEmp\(\$\('f_id'\)\.value\);/);
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(prof));
});

test('a save is seen at once (13-11-2026): "Saving…" on the button, a window when the server HAS saved, nothing said saved on an error; the saved tab is answered without a second reading', () => {
  const prof = fs.readFileSync(path.join(root, 'public', 'prof.js'), 'utf8'), js = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), act = fs.readFileSync(path.join(root, 'lib', 'act_profile.js'), 'utf8');
  assert.match(prof, /function saving\(b, run\) \{ var was = b\.textContent; b\.disabled = true; b\.textContent = 'Saving…';/);
  assert.match(prof, /api\('profSave', \{ id: e\.id, group: cur\.key, data: f\.get\(\) \}\)\.then\(function \(n\) \{ draw\(n\); saved\('Saved', [^}]+\}, function \(x\) \{ back\(\); err\(x\); \}\);/);
  assert.match(prof, /api\('profRowSave', [^\n]{0,120}?\.then\(function \(n\) \{ draw\(n\); saved\('Saved', [^}]+\}, function \(x\) \{ back\(\); err\(x\); \}\);/);
  assert.match(prof, /s\.setAttribute\('role', 'alertdialog'\)/); assert.match(js, /window\.HRPROF\.saved\('Saved', r\.code/);
  assert.match(act, /L\.p = Object\.assign\(\{\}, L\.p, \{ \[col\]: next \}\); return out\(s, L\);/);
});

test('13-11-2026: the two masters on one page with delete and the usual list; an employee\'s page in one reading; "Not available"; the sign in / out times only in the sheet', () => {
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8'), js = rd('public/hr.js'), prof = rd('public/prof.js'), html = rd('public/index.html'), lib = rd('lib/act_masters.js'), api = rd('api/hr.js');
  const M = require('../lib/act_masters'), P = require('../lib/act_profile'), { ACT } = require('../api/hr');
  // masters: delete only what nobody has (employees AND their history are asked), written down; the list only adds
  const del = String(ACT.masterDelete), seed = String(ACT.masterSeed);
  assert.match(del, /H\.needAdmin\(s\)/); assert.match(del, /'hr_employees\?select=id&' \+ COL\[x\.kind\][\s\S]*'hr_employment\?select=id&' \+ COL\[x\.kind\][\s\S]*if \(n \|\| h\) throw fail\(409,[\s\S]*await db\('DELETE', t \+ '\?id=eq\.' \+ id[\s\S]*await audit\(/);
  assert.match(seed, /H\.needAdmin\(s\)/); assert.ok(!/db\('(PATCH|DELETE|PUT)'/.test(seed), 'the list only adds'); assert.strictEqual((lib.match(/db\('DELETE'/g) || []).length, 1);
  assert.ok(M.there(['account', 'highway'], 'Accounts') && M.there(['hr'], 'HR') && !M.there(['hr'], 'Highway') && !M.there(['account'], 'Administration'));
  assert.ok(M.DEPARTMENTS.length >= 15 && Object.keys(M.DESIGNATIONS).join() === 'staff,operator,driver,labour'); const all = [].concat(...Object.values(M.DESIGNATIONS)); assert.strictEqual(new Set(all.map(M.low)).size, all.length, 'no designation twice');
  assert.match(js, /\[\['departments', 'Departments & designations', isAdmin\(\)\]\]/); assert.match(js, /if \(page === 'designations'\) page = 'departments';/); assert.match(html, /<section id="p_mast" hidden><div id="m_two"><\/div><\/section>/);
  assert.match(js, /if \(M\.del !== key\) \{ M\.del = key;/, 'Delete is pressed twice');
  // an employee's page: one reading; a part the person may not see comes back empty; nothing is written
  const pg = String(ACT.empPage); assert.match(pg, /const emp = await H\.ACT\.empGet\(s, \{ id: x\.id \}\);/); assert.match(pg, /Promise\.all\(\[part\('empAround'\), part\('privGet'\), part\('profGet'\)\]\)/); assert.ok(!/db\(/.test(pg));
  assert.match(js, /\(S\.pages \|\| \(S\.pages = \{\}\)\)\[id\] = \{ at: Date\.now\(\), r: r \};/); assert.ok(!/localStorage|sessionStorage/.test(js.slice(js.indexOf('function openEmp'), js.indexOf('function profIn'))));
  // "Not available": only a name, a number or a date; it counts as filled; never for an amount, Yes / No, a time or a list
  const F = [{ key: 'cug', label: 'CUG', type: 'digits', min: 10, max: 10 }, { key: 'ifsc', label: 'IFSC', type: 'ifsc' }, { key: 'd', label: 'D', type: 'date' }, { key: 'amt', label: 'Amt', type: 'num' }, { key: 'yn', label: 'YN', type: 'yesno' }, { key: 'must', label: 'Must', type: 'text', need: true }];
  let c = P.clean(F, { cug: 'na', ifsc: 'Not Available', d: 'N/A', amt: 'NA', yn: 'NA', must: 'NA' }, {}, {}); assert.deepStrictEqual(c.row, { cug: 'NA', ifsc: 'NA', d: 'NA', must: 'NA' }); assert.strictEqual(c.errors.length, 2, c.errors.join(' | '));
  assert.ok(P.isNa(' n.a. ') && !P.isNa('Nagpur') && !P.isNa('')); assert.match(prof, /return \{ box: w, get: function \(\) \{ return nc\.checked \? 'NA' : i\.value; \} \};/);
  // the sign in / out times: in the Excel sheet as before; not on the page, not in the count, and a save of the Job tab leaves them alone
  assert.deepStrictEqual(P.GROUPS.job.fields.filter(d => d.sheet).map(d => d.key), ['sign_in', 'sign_out']); assert.ok(!P.ITEMS.some(i => /sign_(in|out)/.test(i.key))); assert.deepStrictEqual(P.seen(P.GROUPS.job.fields).filter(d => /sign_/.test(d.key)), []);
  assert.match(rd('lib/act_profile.js'), /const keys = seen\(GROUPS\[g\]\.fields\)\.map\(d => d\.key\)/); assert.match(rd('lib/act_sheet.js'), /pf\('sign_in', 'Sign In', 'job'\), pf\('sign_out', 'Sign Out', 'job'\)/);
});

test('(13-11-2026) HR opened by itself has the way back to the Portal and Log out; inside Mechanical\'s screen they are not shown', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /id="go_portal" type="button"[^>]*hidden>‹ Portal<\/button><button class="top-b out" id="log_out" type="button"[^>]*hidden>Log out<\/button>/); assert.match(html, /\.embed \.top-b\{display:none\}/);
  assert.match(html, /gp\.hidden = lo\.hidden = EMBED \|\| !PORTAL;/); assert.match(html, /gp\.onclick = function \(\) \{ location\.href = PORTAL \+ '\/'; \};/);
  // Log out: HR's sign-in first, then the Portal's own logout, then the Portal's page – whatever answers
  assert.match(html, /api\('api\/logout', \{\}\)\.catch\(function \(\) \{[^}]*\}\)\.then\(portalOut\)\.then\(away, away\);/); assert.match(html, /fetch\(PORTAL \+ '\/api\/auth', \{ method: 'POST', credentials: 'same-origin', headers: \{ 'Content-Type': 'application\/json', 'X-RCL': '1' \}, body: JSON\.stringify\(\{ action: 'logout' \}\) \}\)/);
});

test('(13-11-2026) one look wherever HR is opened from: shown by the ERP it takes the whole window – never while the ERP only loads it ahead, out of sight; "‹ ERP" goes back', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /var shown = function \(\) \{ try \{ return !!FE && !FE\.hidden && FE\.getClientRects\(\)\.length > 0; \} catch \(e\) \{ return false; \} \};/);
  assert.match(html, /if \(shown\(\)\) takeWindow\(\); else if \(FE\) var WT = setInterval\(function \(\) \{ if \(shown\(\)\) \{ clearInterval\(WT\); takeWindow\(\); \} \}, 250\);/);
  assert.match(html, /window\.top\.location\.assign\(BASE \+ \(location\.hash \|\| ''\)\); OUT = true;/, 'the site, the page and the person go along; Back returns to the ERP');
  assert.match(html, /if \(!OUT\) start\(\);/); assert.match(html, /id="go_erp" type="button"[^>]*hidden>‹ ERP<\/button>/);
  assert.match(html, /main = \/\\\/hr\\\/\$\/\.test\(BASE\) \? BASE\.replace\(\/hr\\\/\$\/, ''\) : ''; if \(ge\) \{ ge\.hidden = EMBED \|\| !main;/);
});

test('(13-11-2026) the RCL look: the logo\'s red in balance, the white menu with the logo, the three lines open and close it, a page picked closes it', () => {
  const rd = f => fs.readFileSync(path.join(root, 'public', f), 'utf8'), html = rd('index.html'), js = rd('hr.js'), dash = rd('dash.js');
  // the logo: the company's own picture (the same as the ERP's), the mark kept here when it cannot be loaded
  assert.match(html, /<img class="sd-logo" id="sd_logo" src="https:\/\/i\.ibb\.co\/CpSfBqXX\/RCL-LOGO-PDF\.png" alt="Rachana Construction Limited">/); assert.match(html, /lg\.onerror = function \(\) \{ lg\.onerror = null; lg\.src = 'rcl-mark\.png'; lg\.classList\.add\('mark'\); \};/);
  assert.ok(fs.statSync(path.join(root, 'public', 'rcl-mark.png')).size > 2000);
  // the three lines; a page picked closes the menu; a narrow screen starts closed; motion is not forced on who asked for less
  assert.match(html, /<button class="nav-tog" id="nav_tog" type="button" aria-label="Menu" aria-controls="side" aria-expanded="true"><i><\/i><i><\/i><i><\/i><\/button>/);
  assert.match(html, /tg\.onclick = function \(\) \{ set\(!isOpen\(\)\); \};/); assert.match(html, /if \(!wide\(\)\) document\.body\.classList\.add\('nav-off'\);/); assert.match(js, /b\.onclick = function \(\) \{ go\(p\[0\]\); if \(window\.HRNAV\) window\.HRNAV\.picked\(\); \};/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{html:not\(\.embed\) body\.in #app,html:not\(\.embed\) \.sd,/);
  // the menu of the picture: the same pages, their groups, a sign for each
  const G = new Function('return ' + /var GROUP = (\{[^}]+\})/.exec(js)[1])(), R = new Function('return ' + /var RANK = (\[[^\]]+\])/.exec(js)[1])(), I = new Function('return ' + /var ICON = (\{[\s\S]*?\});\n/.exec(js)[1])();
  assert.deepStrictEqual([...new Set(Object.values(G))], ['HR Management', 'Organization', 'Payroll']); for (const k of R) assert.ok(I[k], 'a sign for ' + k); for (const k of Object.keys(G)) assert.ok(R.indexOf(k) > -1, k + ' has its place');
  // red in balance: no blue of before is left in the page's styles; the dashboard still asks nothing new
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')); for (const c of ['#1E63E9', '#1570EF', '#1857D0']) assert.ok(css.indexOf(c) === -1, c);
  assert.deepStrictEqual([...new Set([...dash.matchAll(/api\('([a-zA-Z]+)'/g)].map(x => x[1]))].sort(), ['attDash', 'punchSelfie']); assert.match(dash, /function hello\(now\)/);
});

/* ───────────── step 13 (13-11-2026): THE RULE BOOK – lib/rulebook.js, pure ───────────── */
test('rule book: what each kind of policy may say – only what is filled is kept, a wrong number is refused', () => {
  const B = require('../lib/rulebook');
  assert.deepStrictEqual(B.KINDS, ['attendance', 'late', 'weekoff', 'leave', 'compoff', 'overtime']);
  assert.deepStrictEqual(B.body('attendance', { full_hours: '8', half_hours: 4, once: 'yes' }), { body: { full_hours: 8, half_hours: 4, once: true }, errors: [] });
  assert.strictEqual(B.body('attendance', { full_hours: 4, half_hours: 4 }).errors.length, 1);
  assert.deepStrictEqual(B.body('late', {}).body, {}, 'nothing filled = nothing applied');
  assert.deepStrictEqual(B.body('late', { grace_min: 15, early_min: 15, free: 3, half_after_min: 120, half_before_min: 120 }).errors, []);
  assert.strictEqual(B.body('late', { grace_min: 30, half_after_min: 20 }).errors.length, 1);
  // a weekly off: Sunday, and the 2nd and 4th Saturday; all five Saturdays = every Saturday
  assert.deepStrictEqual(B.body('weekoff', { days: [0], nth: { 6: [4, 2, 2] } }).body, { days: [0], nth: { 6: [2, 4] } });
  assert.deepStrictEqual(B.body('weekoff', { days: [0], nth: { 6: [1, 2, 3, 4, 5] } }).body, { days: [0, 6] });
  assert.deepStrictEqual(B.body('weekoff', {}).body, { days: [] }, 'a road site: no weekly off');
  // leave: earned by the month (Head Office) or by a Sunday worked (a site)
  assert.deepStrictEqual(B.body('leave', { earn: 'sunday', per_month: 4 }).body, { earn: 'sunday', per_month: 4, carry: true, auto_absent: false });
  assert.deepStrictEqual(B.body('leave', { earn: 'month', per_month: 1, carry: true, exit: 'pay', exit_max: 30 }).body, { earn: 'month', per_month: 1, carry: true, auto_absent: false, exit: 'pay', exit_max: 30 });
  assert.ok(B.body('leave', { per_month: 1 }).errors.length && B.body('leave', { earn: 'sunday', per_month: 1.5 }).errors.length && B.body('leave', { earn: 'month' }).errors.length);
  assert.deepStrictEqual(B.body('compoff', { result: 'leave' }).body, { result: 'leave', full_shift: true });
  assert.deepStrictEqual(B.body('overtime', { after_min: 30, round_min: 30, result: 'pay', rate: 1 }).body, { after_min: 30, round_min: 30, result: 'pay', rate: 1 });
  assert.ok(B.body('overtime', {}).errors.length && B.body('nothing', {}).errors.length);
});

test('rule book: who verifies and who approves – by role or by name with a stand-in; verify may be left out; the steps of a request', () => {
  const B = require('../lib/rulebook');
  const a = B.auth({ verify: [{ role: 'site_hr' }], approve: [{ role: 'ho_hr' }, { email: 'Boss@X.test', stand_in: 'second@x.test' }] });
  assert.deepStrictEqual(a, { auth: { verify: [{ role: 'site_hr' }], approve: [{ role: 'ho_hr' }, { email: 'boss@x.test', stand_in: 'second@x.test' }] }, errors: [] });
  assert.ok(B.auth({ verify: [{ role: 'site_hr' }] }).errors.length, 'somebody must approve');
  assert.ok(B.auth({ approve: [{ role: 'king' }] }).errors.length && B.auth({ approve: [{ email: 'not a mail' }] }).errors.length);
  assert.strictEqual(B.firstStage(a.auth), 'verify'); assert.strictEqual(B.firstStage({ verify: [], approve: [{ role: 'ho_hr' }] }), 'approve');
  const siteHr = { email: 'hr@site.test', roles: { site_hr: true } }, hoHr = { email: 'ho@x.test', roles: { ho_hr: true } }, sub = { email: 'second@x.test', roles: {} }, sup = { email: 's@x.test', roles: { super: true } };
  assert.ok(B.mayDo(a.auth.verify, siteHr) && !B.mayDo(a.auth.approve, siteHr) && B.mayDo(a.auth.approve, hoHr) && B.mayDo(a.auth.approve, sub) && B.mayDo([], sup));
  assert.ok(B.mayDo([{ role: 'reporting' }], { email: 'b@x.test', roles: {}, reports: true }) && !B.mayDo([{ role: 'reporting' }], { email: 'b@x.test', roles: {} }));
  let ask = { status: 'pending', stage: 'verify', auth: a.auth, steps: [] };
  assert.ok(B.decide(ask, true, hoHr, 'T1').error, 'the HO HR cannot verify what waits for the site HR');
  const v = B.decide(ask, true, siteHr, 'T1'); assert.deepStrictEqual([v.status, v.stage, v.done, v.steps.length], ['pending', 'approve', false, 1]);
  ask = Object.assign({}, ask, v); assert.ok(B.decide(ask, true, siteHr, 'T2').error);
  const ok = B.decide(ask, true, hoHr, 'T2'); assert.deepStrictEqual([ok.status, ok.done, ok.steps.length, ok.steps[1].by], ['approved', true, 2, 'ho@x.test']);
  assert.strictEqual(B.decide(ask, false, hoHr, 'T2').status, 'refused'); assert.ok(B.decide(Object.assign({}, ask, ok), true, sup, 'T3').error, 'decided once');
});

test('rule book: a person has his own policy from a date, else his site\'s, else none; a day is measured with the version of that day', () => {
  const B = require('../lib/rulebook');
  const versions = { 1: [{ id: 10, valid_from: '2026-01-01', body: { grace_min: 15 } }, { id: 11, valid_from: '2026-12-01', body: { grace_min: 10 } }], 2: [{ id: 20, valid_from: '2026-06-01', body: { grace_min: 5 } }] };
  const site = [{ id: 1, policy_id: 1, valid_from: '2026-01-01' }];
  assert.strictEqual(B.policyOn({ assign: [], defaults: [], versions: versions }, '2026-11-13'), null, 'no policy of the Rule Book: the rules of before');
  assert.deepStrictEqual(B.policyOn({ assign: [], defaults: site, versions: versions }, '2026-11-13'), { policy_id: 1, from: 'site', body: { grace_min: 15 }, auth: {}, version_id: 10 });
  assert.strictEqual(B.policyOn({ assign: [], defaults: site, versions: versions }, '2026-12-05').body.grace_min, 10, 'the new version counts from its date – the days before keep the old one');
  const own = [{ id: 5, policy_id: 2, valid_from: '2026-11-10' }];
  assert.strictEqual(B.policyOn({ assign: own, defaults: site, versions: versions }, '2026-11-09').from, 'site'); assert.deepStrictEqual([B.policyOn({ assign: own, defaults: site, versions: versions }, '2026-11-10').from, B.policyOn({ assign: own, defaults: site, versions: versions }, '2026-11-10').body.grace_min], ['person', 5]);
  // taken back from a date: an empty row = the site's own again
  assert.strictEqual(B.policyOn({ assign: own.concat([{ id: 6, policy_id: null, valid_from: '2026-11-20' }]), defaults: site, versions: versions }, '2026-11-21').from, 'site');
  assert.strictEqual(B.policyOn({ assign: [{ id: 7, policy_id: 2, valid_from: '2026-03-01' }], defaults: [], versions: versions }, '2026-03-02'), null, 'the policy says nothing before its first version');
});

test('rule book: weekly off – the 2nd and 4th Saturday, the HR office\'s word on a fifth Saturday; the rules of a day from the policies', () => {
  const B = require('../lib/rulebook');
  const ho = { days: [0], nth: { 6: [2, 4] } };      // November 2026: Saturdays 7, 14, 21, 28; Sundays 1, 8, 15, 22, 29
  assert.deepStrictEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28', '2026-11-15', '2026-11-16'].map(d => B.isOff(ho, d)), [false, true, false, true, true, false]);
  assert.strictEqual(B.nthOf('2026-10-31'), 5); assert.strictEqual(B.isOff({ days: [0], nth: { 6: [5] } }, '2026-10-31'), true);
  assert.strictEqual(B.isOff({ days: [0], nth: { 6: [5] } }, '2026-10-31', false), false, 'the HR office said: this fifth Saturday is a working day');
  assert.strictEqual(B.isOff({ days: [] }, '2026-11-15'), false, 'a road site works on a Sunday');
  const siteRules = { full_hours: 8, grace_min: 30, late_free: 5, week_off: [0], face: true };
  assert.deepStrictEqual(B.dayRules(siteRules, null, '2026-11-15'), siteRules, 'no policy: the site\'s own rules, untouched');
  const r = B.dayRules(siteRules, { late: { grace_min: 15, free: 3, half_before_min: 120 }, weekoff: { days: [] } }, '2026-11-15');
  assert.deepStrictEqual(r, { full_hours: 8, face: true, grace_min: 15, half_before_min: 120, late_free: 3, early_counts: true, week_off: [] });
  assert.deepStrictEqual(B.dayRules(siteRules, { weekoff: ho }, '2026-11-14').week_off, [6]); assert.deepStrictEqual(B.dayRules(siteRules, null, '2026-11-15', false).week_off, []);
});

test('rule book: overtime in steps, overtime as leave, comp-off for a whole shift, a bulk correction only in the person\'s favour', () => {
  const B = require('../lib/rulebook');
  const ot = { after_min: 30, round_min: 30 }, end = Date.parse('2026-11-13T12:30:00Z');
  assert.deepStrictEqual([10, 29, 30, 50, 70, 125].map(m => B.overtimeMin(ot, end + m * 60000, end)), [0, 0, 30, 30, 60, 120]);
  assert.strictEqual(B.overtimeMin(null, end + 3600000, end), 0); assert.strictEqual(B.overtimeMin(ot, null, end), 0);
  assert.deepStrictEqual([B.overtimeDays(540, 9), B.overtimeDays(270, 9), B.overtimeDays(200, 9), B.overtimeDays(60, 0)], [1, 0.5, 0, 0]);
  const co = { result: 'leave', full_shift: true };
  assert.deepStrictEqual([B.compoffDays(co, 'WOP', 9, 9), B.compoffDays(co, 'HP', 8.5, 9), B.compoffDays(co, 'P', 9, 9), B.compoffDays({ result: 'none' }, 'WOP', 9, 9), B.compoffDays({ result: 'pay', full_shift: false }, 'HP', 2, 9)], [1, 0, 0, 0, 1]);
  assert.deepStrictEqual(B.importChange('A', 'P'), { to: 'P' }); assert.deepStrictEqual(B.importChange('A', 'hd'), { to: 'HD' }); assert.deepStrictEqual(B.importChange('MIS', 'L'), { to: 'L' });
  assert.deepStrictEqual(B.importChange('A', 'A'), { skip: true }); assert.deepStrictEqual(B.importChange('P', ''), { skip: true });
  assert.ok(B.importChange('P', 'A').error && B.importChange('P', 'HD').error && B.importChange('A', 'X').error && B.importChange('WO', 'P').error, 'never against the person, never a day off');
  assert.deepStrictEqual(B.importChange('HD', 'P'), { to: 'P' }); assert.deepStrictEqual(B.importChange('L', 'P'), { to: 'P' }); assert.deepStrictEqual(B.importChange('L', 'L'), { skip: true });
});

test('rule book: leave – a Sunday worked earns one (at most 4 a month), two balances, a leave only while the balance has it, the ledger says where each day came from', () => {
  const L = require('../lib/leave');
  // November 2026: Sundays 1, 8, 15, 22, 29. A road site: every day is a working day.
  const site = { earn: 'sunday', per_month: 4, carry: true, auto_absent: false, strict: true }, day = n => '2026-11-' + String(n).padStart(2, '0');
  const days = []; for (let i = 1; i <= 30; i++) days.push({ day: day(i), code: i === 8 ? 'A' : i === 15 ? 'HD' : 'P' });
  let k = L.walk2(days, { polOn: () => site });
  assert.deepStrictEqual([k.paid, k.comp], [3.5, 0], 'Sundays 1, 22, 29 worked = 3, the 15th half = 0.5, the 8th absent = 0');
  assert.deepStrictEqual(k.ledger.map(x => [x.day.slice(8), x.days, x.source]), [['01', 1, 'sunday'], ['15', 0.5, 'sunday'], ['22', 1, 'sunday'], ['29', 1, 'sunday']]);
  assert.deepStrictEqual(k.absent, { [day(8)]: 'none' }, 'absent without a request: nothing is taken, the day is marked');
  // five Sundays all worked: still 4
  k = L.walk2(days.map(d => ({ day: d.day, code: 'P' })), { polOn: () => site }); assert.strictEqual(k.paid, 4);
  // a leave of 3 days with a balance of 1: one day is leave, the others stay absent; a refused request is marked
  const d2 = []; for (let i = 1; i <= 12; i++) d2.push({ day: day(i), code: i >= 3 && i <= 5 ? 'A' : i === 10 ? 'A' : 'P' });
  k = L.walk2(d2, { polOn: () => site, leave: { [day(3)]: { days: 1, bucket: 'paid' }, [day(4)]: { days: 1, bucket: 'paid' }, [day(5)]: { days: 1, bucket: 'paid' } }, refused: { [day(10)]: true } });
  assert.deepStrictEqual(Object.keys(k.marks), [day(3)]); assert.deepStrictEqual(k.absent, { [day(4)]: 'nobalance', [day(5)]: 'nobalance', [day(10)]: 'refused' }); assert.strictEqual(k.paid, 1, '1 (Sunday the 1st) − 1 (leave) + 1 (Sunday the 8th)');
  // (his correction) ONE leave for the person: the Comp-off days are used first, then the Paid leave – he never chooses; the ledger says from which
  k = L.walk2(d2, { polOn: () => site, credits: { [day(1)]: [{ bucket: 'paid', days: 6, source: 'opening', reason: 'Opening balance' }], [day(2)]: [{ bucket: 'comp', days: 1.5, source: 'compoff', reason: 'Worked on a holiday' }] }, leave: { [day(3)]: { days: 1 }, [day(4)]: { days: 1 }, [day(5)]: { days: 1 } } });
  assert.deepStrictEqual([k.marks[day(3)].bucket, k.marks[day(4)].bucket, k.marks[day(5)].bucket], ['comp', 'both', 'paid'], 'the 3rd from Comp-off, the 4th half and half, the 5th from Paid leave');
  assert.deepStrictEqual([k.paid, k.comp], [6.5, 0], 'paid: 1 (Sunday) + 6 − 0.5 − 1 + 1 (Sunday the 8th); comp-off used up'); assert.deepStrictEqual(k.absent, { [day(10)]: 'none' });
  assert.ok(k.ledger.some(x => x.source === 'opening' && x.days === 6) && k.ledger.filter(x => x.source === 'leave').map(x => x.bucket + x.days).join(',') === 'comp-1,comp-0.5,paid-0.5,paid-1');
  // nothing in either balance: the day stays absent
  k = L.walk2(d2.slice(1, 6), { polOn: () => site, leave: { [day(3)]: { days: 1 } } }); assert.deepStrictEqual([Object.keys(k.marks), k.absent[day(3)]], [[], 'nobalance']);
  // the Head Office: 1 at the start of every month, carried on; a weekly off or a day at work never takes a leave
  const ho = { earn: 'month', per_month: 1, carry: true, auto_absent: false, strict: true }, two = [{ day: '2026-10-01', code: 'P' }, { day: '2026-10-02', code: 'P' }, { day: '2026-11-01', code: 'WO' }, { day: '2026-11-02', code: 'A' }, { day: '2026-11-03', code: 'P' }];
  k = L.walk2(two, { polOn: () => ho, leave: { '2026-11-01': { days: 1, bucket: 'paid' }, '2026-11-02': { days: 1, bucket: 'paid' }, '2026-11-03': { days: 1, bucket: 'paid' } } });
  assert.deepStrictEqual([k.paid, Object.keys(k.marks)], [1, ['2026-11-02']], 'October\'s leave is carried on: 2, one taken');
  // no policy of the Rule Book on a day: nothing is earned and nothing is taken there
  assert.deepStrictEqual(L.walk2(two, { polOn: () => null }).ledger, []);
  // a policy of before read through the same walk gives the same balance as the old walk (not strict: a leave is taken as asked)
  const old = { per_month: 4, carry: true, auto_absent: true, valid_from: '2026-11-01' }, od = [{ day: '2026-11-01', code: 'A' }, { day: '2026-11-02', code: 'P' }, { day: '2026-11-03', code: 'A' }];
  assert.strictEqual(L.walk2(od, { polOn: () => ({ earn: 'month', per_month: 4, carry: true, auto_absent: true, strict: false }) }).paid, L.walk(od, { policies: [old] }).balance);
});

test('the Rule Book in the pay: approved overtime and comp-off "for pay" – and nothing changes without them', () => {
  const P = require('../lib/pay'), c = { present: 24, half: 0, leave: 0, week_off: 4, holiday: 0, extra: 2, paid: 30 }, base = { salary: { pay_type: 'monthly', amount: 30000 }, counts: c, month_days: 30, flags: { pf: true }, settings: { pf_pct: 12 }, adjust: {} };
  const a = P.slip(base); assert.deepStrictEqual([a.day, a.earned, a.extra_days, a.extra, a.gross, a.pf], [1000, 30000, 2, 2000, 32000, 3600]); assert.ok(!('overtime' in a) && !('ot_hours' in a), 'no overtime: the slip has no such line');
  assert.deepStrictEqual(P.slip(Object.assign({}, base, { extra_days: undefined, overtime: [] })), a, 'nothing of the Rule Book: the very same slip');
  // a comp-off policy: of the 2 days worked on a day off only the one approved "for pay" is paid
  const b = P.slip(Object.assign({}, base, { extra_days: 1 })); assert.deepStrictEqual([b.extra_days, b.extra, b.gross], [1, 1000, 31000]); assert.strictEqual(P.slip(Object.assign({}, base, { extra_days: 0 })).extra, 0, 'none approved for pay: no extra day');
  // overtime: 90 + 30 minutes with an 8-hour shift, plain hourly rate: 1000 / 8 × 2 h = 250; at 1.5 ×: 375; PF stays on the earned pay
  const o = P.slip(Object.assign({}, base, { overtime: [{ minutes: 90, shift_hours: 8, rate: 1 }, { minutes: 30, shift_hours: 8 }] })); assert.deepStrictEqual([o.ot_hours, o.overtime, o.gross, o.pf], [2, 250, 32250, 3600]);
  assert.strictEqual(P.slip(Object.assign({}, base, { overtime: [{ minutes: 120, shift_hours: 8, rate: 1.5 }] })).overtime, 375);
  assert.strictEqual(P.slip(Object.assign({}, base, { overtime: [{ minutes: 120, shift_hours: 0, rate: 1 }] })).overtime, 0, 'no shift hours known: nothing is made up');
  // a day's rate: the day's pay is the rate itself
  assert.strictEqual(P.slip({ salary: { pay_type: 'daily', amount: 800 }, counts: c, month_days: 30, flags: {}, settings: {}, overtime: [{ minutes: 60, shift_hours: 8, rate: 1 }] }).overtime, 100);
  // the totals carry overtime only in a month that has any
  assert.ok(!('overtime' in P.totals([a, b]))); assert.strictEqual(P.totals([a, o]).overtime, 250); assert.strictEqual(P.totals([a, o]).gross, 64250);
  const src = fs.readFileSync(path.join(root, 'lib', 'act_payroll.js'), 'utf8'); assert.match(src, /status=eq\.approved&kind=in\.\(overtime,compoff\)/, 'only approved requests count'); assert.match(src, /\(q\.body \|\| \{\}\)\.result === 'pay'/, 'only the ones "for pay"');
});
