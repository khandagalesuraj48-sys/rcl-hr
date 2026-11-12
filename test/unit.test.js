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
  assert.strictEqual(R.statusOf(e.row, ''), 'pending', 'complete: waits for his own e-mail OTP – never active by itself');
  e = R.employee({ name: 'Test Person', category: 'driver' }, now); assert.deepStrictEqual(e.errors, []); assert.deepStrictEqual(e.missing, ['Date of birth', 'E-mail', 'Mobile']); assert.strictEqual(R.statusOf(e.row, ''), 'incomplete');
  assert.match(R.employee({ name: 'Test Person', category: 'staff', dob: '13-11-2008' }, now).errors.join(' '), /under 18/);
  assert.match(R.employee({ name: 'T', category: 'manager', mobile: '12', email: 'x', dob: 'y' }, now).errors.join(' '), /Name: .*Category: .*Mobile: .*E-mail: .*Date of birth: /);
  assert.strictEqual(R.statusOf(e.row, 'left'), 'left'); assert.strictEqual(R.statusOf(e.row, 'active'), 'active');
});

test('the pages\' script: the Excel / CSV columns are found by their usual names; a person\'s text is never put in as HTML', () => {
  const src = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  const m = win.HR._mapRows([['Sr', 'Employee Name', 'Category', 'Mobile No', 'E-mail ID', 'Date of Birth', 'DOJ', 'Dept', 'Designation'], [1, 'A One', 'Staff', '9876543210', 'a@b.co', '01-01-1990', 45000, 'Accounts', 'Clerk'], ['', '', '', '', '', '', '', '', '']]);
  assert.deepStrictEqual(m.rows, [{ name: 'A One', category: 'Staff', mobile: '9876543210', email: 'a@b.co', dob: '01-01-1990', joined_on: 45000, department: 'Accounts', designation: 'Clerk' }]);
  assert.ok(m.hasName && m.hasCat); assert.ok(!win.HR._mapRows([['Naam', 'Kind'], ['x', 'y']]).hasName);
  assert.deepStrictEqual(win.HR._csv('Name,Category\r\n"One, A","Staff"\n"Say ""hi""",Driver\n'), [['Name', 'Category'], ['One, A', 'Staff'], ['Say "hi"', 'Driver']]);
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(src), 'only textContent');
  const page = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), ids = [...new Set([...src.matchAll(/\$\('([a-z_0-9]+)'\)/g)].map(x => x[1]))];
  ids.forEach(i => assert.ok(page.includes('id="' + i + '"'), 'the page has #' + i));
});

test('the actions: every one asks the sign-in first; the Admin\'s ones are refused to an HR User; nothing deletes an employee', () => {
  const src = fs.readFileSync(path.join(root, 'api', 'hr.js'), 'utf8'), { ACT } = require('../api/hr');
  assert.deepStrictEqual(Object.keys(ACT), ['init', 'masterSave', 'empList', 'empGet', 'empPick', 'empSave', 'empTransfer', 'empExit', 'empDelete', 'empExport', 'privGet', 'privSave', 'docList', 'docUploadUrl', 'docAdd', 'docLink', 'empPhotos', 'docRemove', 'empImport',
    'placeList', 'projSave', 'placeSave', 'placeBulk', 'placeImport', 'placeRemove', 'devList', 'devRelease', 'punchDay', 'punchSelfie', 'punchReview', 'myAttend', 'selfieUrl', 'punch',
    'attSetup', 'shiftSave', 'shiftRemove', 'holidaySave', 'holidayRemove', 'rulesSave', 'powerSet', 'muster', 'empAround', 'dayGet', 'daySet', 'regList', 'regDecide', 'myMonth', 'regAsk', 'myRegs', 'teamRegs', 'teamRegDecide', 'attDash', 'profGet', 'profSave', 'profRowSave', 'profRowRemove', 'listAll', 'listSave', 'profRequiredSave', 'myLeave', 'leaveAsk', 'leaveCancel', 'teamLeaves', 'teamLeaveDecide', 'leaveList', 'leaveDecide', 'leaveBalances', 'leaveAdjust', 'leavePolicy', 'leavePolicySave', 'monthList', 'monthVerify', 'monthReturn', 'monthApprove', 'monthReopen', 'monthSites', 'hoList', 'hoSet', 'salaryGet', 'salaryAsk', 'salaryWaiting', 'salaryDecide', 'payList', 'payFlags', 'payAdjust', 'payLock', 'paySettings', 'paySettingsSave', 'advList', 'advGive', 'advClose', 'mySlips', 'myHr', 'myDocs', 'myDocUploadUrl', 'myDocAdd', 'myDocLink']);
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
  assert.deepStrictEqual(SELF, ['myAttend', 'selfieUrl', 'punch', 'myMonth', 'regAsk', 'myRegs', 'teamRegs', 'teamRegDecide', 'myLeave', 'leaveAsk', 'leaveCancel', 'teamLeaves', 'teamLeaveDecide', 'myHr', 'myDocs', 'myDocUploadUrl', 'myDocAdd', 'myDocLink', 'mySlips']);
  for (const [a, p] of [['projSave', 'places'], ['placeSave', 'places'], ['placeBulk', 'places'], ['placeImport', 'places'], ['placeRemove', 'places'], ['devRelease', 'phones'], ['punchReview', 'review'], ['shiftSave', 'shifts'], ['shiftRemove', 'shifts'], ['holidaySave', 'shifts'], ['holidayRemove', 'shifts'], ['rulesSave', 'shifts'], ['regDecide', 'regularize']]) assert.ok(String(ACT[a]).indexOf("await power.need(s, '" + p + "')") > -1, a + ': the power ' + p);
  assert.match(String(ACT.daySet), /await power\.need\(s, has \? 'correct' : 'manual'\)/); assert.match(String(ACT.powerSet), /s\.role !== 'super'/);
  for (const a of ['placeList', 'devList', 'punchDay', 'punchSelfie', 'attSetup', 'muster', 'empAround', 'dayGet', 'daySet', 'regList', 'attDash']) assert.match(String(ACT[a]), /needOffice\(s\)/, a);
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
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'); for (const id of src.match(/\$\('([a-z_0-9]+)'\)/g).map(x => x.slice(3, -2))) assert.ok(html.indexOf('id="' + id + '"') > -1, 'the page has #' + id);
  const M = require('../api/menu'); assert.deepStrictEqual(M.PAGES.map(p => p.key), ['dashboard', 'employees', 'attendance', 'places', 'muster', 'requests', 'phones', 'rules', 'leave', 'month', 'payroll', 'lists', 'departments', 'designations']);
  assert.deepStrictEqual([M.mayOpen('all', 'user'), M.mayOpen('admin', 'user'), M.mayOpen('all', 'self'), M.mayOpen('admin', 'super')], [true, false, false, true]);
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(v, /img-src 'self' data: https:\/\/tile\.openstreetmap\.org https:\/\/\*\.supabase\.co;/); assert.match(v, /script-src 'self' 'unsafe-inline';/);
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
  const P = require('../lib/powers'); assert.deepStrictEqual(P.KEYS, ['places', 'phones', 'review', 'shifts', 'manual', 'correct', 'regularize', 'month', 'salary']);
  const src = fs.readFileSync(path.join(root, 'public', 'mus.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  assert.deepStrictEqual(win.HRMUS.pages.map(p => p[0]), ['muster', 'requests', 'rules']); assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|\b(alert|confirm|prompt)\(/.test(src), 'only textContent, no browser dialog');
  assert.deepStrictEqual(Object.keys(win.HRMUS._code), ['P', 'HD', 'A', 'WO', 'H', 'WOP', 'HP', 'IN', 'MIS', 'L']);
});

test('the site is chosen in HR among the Portal\'s sites of the person; the form has the employee\'s site; his page shows his attendance', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), api = fs.readFileSync(path.join(root, 'api', 'hr.js'), 'utf8');
  for (const id of ['site_pick', 'f_site', 'd_att', 'd_att_lab']) assert.ok(html.indexOf('id="' + id + '"') > -1, '#' + id);
  assert.match(html, /function sitePick\(me\) \{[\s\S]+?sel\.hidden = list\.length < 2;[\s\S]+?ticketFor\(code, false\)[\s\S]+?api\('api\/sso', \{ ticket: x\.j\.ticket \}\)[\s\S]+?location\.reload\(\);/, 'another site = a new ticket of the Portal, then the page again');
  assert.ok(!/api\/(site|sites)\b/.test(html + js), 'HR makes no site – it only chooses');
  assert.match(js, /site: \$\('f_site'\)\.value,/); assert.match(js, /fs\.disabled = !!e\.id && !isAdmin\(\);/); assert.match(js, /api\('empAround', \{ id: id \}\)/);
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
  const act = fs.readFileSync(path.join(root, 'lib', 'act_profile.js'), 'utf8'); assert.ok(!/db\('DELETE'/.test(act), 'nothing of the profile is deleted'); assert.match(act, /diff\[k\] = g === 'secret' \? 'changed'/, 'the audit never holds a number');
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
  for (const id of ['d_login', 'dlg_login', 'lg_title', 'lg_email', 'lg_done', 'lg_pw', 'lg_err', 'lg_go']) assert.ok(html.indexOf('id="' + id + '"') > -1, '#' + id);
  assert.match(html, /window\.HRPORTAL = function \(path, body\) \{[\s\S]+?fetch\(PORTAL \+ '\/' \+ path, \{ method: 'POST', credentials: 'same-origin', headers: \{ 'Content-Type': 'application\/json', 'X-RCL': '1' \}/);
  assert.match(js, /\$\('d_login'\)\.hidden = left \|\| !isAdmin\(\);/); assert.match(js, /window\.HRPORTAL\('api\/hrlogin', \{ site: e\.site, email: e\.email, name: e\.name \}\)/);
  assert.match(js, /if \(b\.dataset\.close === 'dlg_login'\) \{ \$\('lg_pw'\)\.textContent = ''; \$\('lg_done'\)\.hidden = true; \}/, 'the one-time password leaves the page with its box');
  assert.ok(!/localStorage|sessionStorage/.test(js.slice(js.indexOf('function loginGive'), js.indexOf('// ---------- add / change'))), 'kept nowhere');
  for (const f of fs.readdirSync(path.join(root, 'api')).concat(fs.readdirSync(path.join(root, 'lib')).map(x => '../lib/' + x))) assert.ok(!/password/i.test(fs.readFileSync(path.join(root, 'api', f), 'utf8').replace(/No secret, key, password[^\n]*/g, '')), f + ': HR\'s server has nothing to do with passwords');
});

test('an employee\'s page opens at once from the list; nothing of him is changed before the server\'s own answer; the readings of one action are asked together', () => {
  const js = fs.readFileSync(path.join(root, 'public', 'hr.js'), 'utf8'), api = fs.readFileSync(path.join(root, 'api', 'hr.js'), 'utf8');
  assert.match(js, /if \(had\) \{ drawEmp\(\{ employee: had, history: \[\], boss: null \}, false\); show\('dlg_emp'\); \}/);
  assert.match(js, /if \(seq !== S\.seq \|\| \(had && \$\('dlg_emp'\)\.hidden\)\) return;/, 'closed or another opened meanwhile: the late answer is dropped');
  assert.match(js, /\['d_prof', 'd_kyc', 'd_docs', 'd_login', 'd_facebtn', 'd_salary', 'd_del', 'd_exit', 'd_tr', 'd_edit'\]\.forEach\(function \(b\) \{ \$\(b\)\.disabled = !full; \}\);/);
  assert.ok(!/localStorage|sessionStorage/.test(js.slice(js.indexOf('function openEmp'), js.indexOf('function login()'))), 'kept in the page\'s memory only');
  for (const a of ['empList', 'empGet', 'privGet']) { const i = api.indexOf('async ' + a + '('); assert.match(api.slice(i, i + 1400), /await Promise\.all\(\[db\('GET'/, a); }
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
