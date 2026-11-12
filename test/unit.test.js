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
  assert.deepStrictEqual(res.body, { module: 'hr', name: 'HR', pages: [{ key: 'employees', name: 'Employees' }, { key: 'attendance', name: 'Attendance' }, { key: 'places', name: 'Work places' }, { key: 'muster', name: 'Muster' }, { key: 'requests', name: 'Requests' }, { key: 'phones', name: 'Phones' }, { key: 'rules', name: 'Shifts & rules' }, { key: 'departments', name: 'Departments' }, { key: 'designations', name: 'Designations' }] }, 'nobody signed in here yet: every page is listed');
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
  assert.deepStrictEqual(Object.keys(ACT), ['init', 'masterSave', 'empList', 'empGet', 'empPick', 'empSave', 'empTransfer', 'empExit', 'privGet', 'privSave', 'docList', 'docUploadUrl', 'docAdd', 'docLink', 'docRemove', 'empImport',
    'placeList', 'projSave', 'placeSave', 'placeBulk', 'placeImport', 'placeRemove', 'devList', 'devRelease', 'punchDay', 'punchSelfie', 'punchReview', 'myAttend', 'selfieUrl', 'punch',
    'attSetup', 'shiftSave', 'shiftRemove', 'holidaySave', 'holidayRemove', 'rulesSave', 'powerSet', 'muster', 'dayGet', 'daySet', 'regList', 'regDecide', 'myMonth', 'regAsk', 'myRegs', 'teamRegs', 'teamRegDecide']);
  assert.match(src, /const s = await ses\.need\(req\), att = [^\n]+\n[^\n]+\n[^\n]+\n  if \(s\.role === 'self' && SELF\.indexOf\(String\(x\.action\)\) < 0\) throw fail\(403, 'This is for the HR office only\.', 'role'\);\n  try \{ send\(res, 200, Object\.assign\(\{ ok: true \}, await fn\(s, x\)\)\); \}/);
  for (const a of ['masterSave', 'empTransfer', 'empExit', 'docRemove']) assert.match(String(ACT[a]), /needAdmin\(s\)/, a);
  assert.ok(!/db\('DELETE'/.test(src), 'no row is ever deleted by an action');
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
  assert.deepStrictEqual(SELF, ['myAttend', 'selfieUrl', 'punch', 'myMonth', 'regAsk', 'myRegs', 'teamRegs', 'teamRegDecide']);
  for (const [a, p] of [['projSave', 'places'], ['placeSave', 'places'], ['placeBulk', 'places'], ['placeImport', 'places'], ['placeRemove', 'places'], ['devRelease', 'phones'], ['punchReview', 'review'], ['shiftSave', 'shifts'], ['shiftRemove', 'shifts'], ['holidaySave', 'shifts'], ['holidayRemove', 'shifts'], ['rulesSave', 'shifts'], ['regDecide', 'regularize']]) assert.ok(String(ACT[a]).indexOf("await power.need(s, '" + p + "')") > -1, a + ': the power ' + p);
  assert.match(String(ACT.daySet), /await power\.need\(s, has \? 'correct' : 'manual'\)/); assert.match(String(ACT.powerSet), /s\.role !== 'super'/);
  for (const a of ['placeList', 'devList', 'punchDay', 'punchSelfie', 'attSetup', 'muster', 'dayGet', 'daySet', 'regList']) assert.match(String(ACT[a]), /needOffice\(s\)/, a);
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
  const M = require('../api/menu'); assert.deepStrictEqual(M.PAGES.map(p => p.key), ['employees', 'attendance', 'places', 'muster', 'requests', 'phones', 'rules', 'departments', 'designations']);
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
  assert.deepStrictEqual(D.shift({ name: 'General', start_time: '9:00', end_time: '18:00' }).row, { name: 'General', start_time: '09:00', end_time: '18:00', break_min: 0 }); assert.match(D.shift({ name: 'G', start_time: '9', end_time: '25:00' }).errors.join(' '), /Name.*Starts at.*Ends at/);
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
  const P = require('../lib/powers'); assert.deepStrictEqual(P.KEYS, ['places', 'phones', 'review', 'shifts', 'manual', 'correct', 'regularize']);
  const src = fs.readFileSync(path.join(root, 'public', 'mus.js'), 'utf8'), win = {}; new Function('window', 'document', src)(win, { getElementById: () => null });
  assert.deepStrictEqual(win.HRMUS.pages.map(p => p[0]), ['muster', 'requests', 'rules']); assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|\b(alert|confirm|prompt)\(/.test(src), 'only textContent, no browser dialog');
  assert.deepStrictEqual(Object.keys(win.HRMUS._code), ['P', 'HD', 'A', 'WO', 'H', 'WOP', 'HP', 'IN', 'MIS']);
});
