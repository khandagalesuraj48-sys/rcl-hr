/* SIGN-IN THROUGH THE PORTAL – the only way into HR (the Portal is the one sign-in and the one place access is given).
 * The Portal sends the browser here with a TICKET after "#sso=" (it never reaches a server log): who, which site, Admin or
 * User (or the Super Admin), his other modules on that site and every site where he has HR – SIGNED by the Portal (ES256),
 * valid 60 seconds. Checked here: the signature with the Portal's PUBLIC key (<PORTAL_URL>/api/jwks – kept 10 minutes, asked
 * again at most every 5 s for a key not known yet), who made it (iss = PORTAL_URL), for whom (aud = "hr"), its time
 * and its parts. That a ticket is used ONCE is checked in the database (hr_tickets – api/sso.js). */
'use strict';
const crypto = require('crypto');
const { fail } = require('./http');

// 'hr' = the HR office's people (HR Admin / HR User of the site); 'hrme' = "My HR": an employee who uses HR only for himself –
// his own attendance, leave and payslip (12-11-2026). The Portal lists both as modules; nothing of the Portal is changed for it.
const AUD = 'hr', AUD_SELF = 'hrme', EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function url() {
  const u = String(process.env.PORTAL_URL || '').trim().replace(/\/+$/, '');
  // (the Portal may also be served under a path of the one address, e.g. https://erp…/portal)
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u)) return u;
  return '';
}
const bad = why => fail(401, 'The Portal sign-in could not be accepted (' + why + ') – open HR again from the Portal.', 'ticket');

let KEYS = { at: 0, from: '', keys: [] };
async function keys(fresh) {
  const from = url();
  if (KEYS.from === from && KEYS.at && Date.now() - KEYS.at < (fresh ? 5000 : 600000)) return KEYS.keys;
  let j = null;
  try { const r = await fetch(from + '/api/jwks', { signal: AbortSignal.timeout(10000) }); if (r.ok) j = await r.json(); } catch (e) { j = null; }
  if (!j) { if (KEYS.from === from && KEYS.keys.length) return KEYS.keys; throw bad('the Portal could not be reached'); }
  KEYS = { at: Date.now(), from: from, keys: Array.isArray(j.keys) ? j.keys : [] };
  return KEYS.keys;
}
// a module's address as the Portal gives it (https only; http only for this computer, for tests); '' = none
const okUrl = u => { u = String(u || '').trim().replace(/\/+$/, ''); return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u) ? u : ''; };
const part = s => { try { return JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8')); } catch (e) { return null; } };

async function verify(ticket, now) {
  const from = url();
  if (!from) throw fail(500, 'HR is not linked to the Portal: add PORTAL_URL (https://oneclicksolution.online/portal) in Vercel → Environment Variables, then Redeploy.', 'setup');
  const t = String(ticket || '');
  if (t.length > 8000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) throw bad('not a ticket');
  const [h64, b64, s64] = t.split('.'), head = part(h64), c = part(b64);
  if (!head || !c || head.alg !== 'ES256' || !head.kid) throw bad('not a ticket of the Portal');
  let jwk = (await keys(false)).find(k => k.kid === head.kid);
  if (!jwk) jwk = (await keys(true)).find(k => k.kid === head.kid);
  if (!jwk) throw bad('unknown key');
  let ok = false;
  try { ok = crypto.verify('sha256', Buffer.from(h64 + '.' + b64), { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s64, 'base64url')); } catch (e) { ok = false; }
  if (!ok) throw bad('the signature does not match');
  const sec = Math.floor((now || Date.now()) / 1000);
  if (c.iss !== from) throw bad('made by another Portal');
  if (c.aud !== AUD && c.aud !== AUD_SELF) throw bad('made for another module');
  if (typeof c.exp !== 'number' || typeof c.iat !== 'number' || c.exp - c.iat > 120) throw bad('no proper time');
  if (c.exp < sec - 5) throw bad('it ran out – it is valid for one minute');
  if (c.iat > sec + 60) throw bad('made in the future – check the clock');
  const email = String(c.sub || '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 120) throw bad('no proper email');
  if (!/^[A-Z0-9]{1,12}$/.test(String(c.site || ''))) throw bad('no proper site');
  if (!/^[0-9a-f]{16,64}$/.test(String(c.jti || ''))) throw bad('no ticket number');
  if (['admin', 'user'].indexOf(c.role) === -1) throw bad('no proper role');
  const list = (a, f) => (Array.isArray(a) ? a : []).slice(0, 40).map(f).filter(Boolean);
  // the Super Admin (his ticket says so); a HR Admin or User of the site (the Portal: Users & Access)
  return { email: email, name: String(c.name || email).slice(0, 80), site: c.site, siteName: String(c.siteName || c.site).slice(0, 80),
    role: c.aud === AUD_SELF ? 'self' : c.super === true ? 'super' : c.role, jti: c.jti, exp: c.exp,
    mods: list(c.mods, m => m && /^[a-z]{2,20}$/.test(String(m.key)) ? { key: m.key, name: String(m.name || m.key).slice(0, 40), url: okUrl(m.url) } : null),
    sites: list(c.sites, s => s && /^[A-Z0-9]{1,12}$/.test(String(s.code)) ? { code: s.code, name: String(s.name || s.code).slice(0, 80) } : null) };
}
module.exports = { url, verify, AUD, AUD_SELF };
