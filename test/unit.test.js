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
  assert.deepStrictEqual(res.body, { module: 'hr', name: 'HR', pages: [{ key: 'home', name: 'Home' }] });
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

test('no secret and no code of another HR product in any file', () => {
  const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { if (f === '.git' || f === 'node_modules') continue; const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|json|html|md|sql)$/.test(f)) files.push(p); } })(root);
  assert.ok(files.length >= 8);
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}|eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|re_[A-Za-z0-9]{20,}/.test(t), path.relative(root, f) + ': a key');
    assert.ok(!/supabase\.co/.test(t), path.relative(root, f) + ': the database\'s address belongs in Vercel only');
  }
});
