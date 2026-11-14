/* SIGN-INS of HR – one per site (a person on two sites opens each through the Portal). The browser keeps a random
 * sign-in in a cookie page scripts cannot read (HttpOnly, SameSite=Lax); the database keeps only its fingerprint (SHA-256) with
 * who, his site and his role as the Portal said (super / admin / user). It ends at "Sign out", or 15 MINUTES after its ticket
 *: the open page asks the Portal for a fresh
 * ticket every 10 minutes and signs in again with it (api/sso, renew). Whom the Super Admin removed in the Portal – or gave
 * another role – gets no ticket, or the new role: he is out of HR within 15 minutes. Nothing is typed for it. */
'use strict';
const crypto = require('crypto');
const { db, enc } = require('./db');
const { fail } = require('./http');
const COOKIE = 'rcl_hr', MAX_MS = 15 * 60 * 1000;
const fp = t => crypto.createHash('sha256').update(String(t)).digest('hex');
function cookieOf(req) {
  const c = String(req.headers.cookie || ''); const m = c.split(/;\s*/).map(x => x.split('=')).find(x => x[0] === COOKIE);
  return m ? decodeURIComponent(m.slice(1).join('=')) : '';
}
const secure = req => String(req.headers['x-forwarded-proto'] || '') === 'https' || !!process.env.VERCEL;
const setCookie = (req, v, maxAgeS) => COOKIE + '=' + encodeURIComponent(v) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeS + (secure(req) ? '; Secure' : '');
const clearCookie = req => setCookie(req, '', 0);

async function create(req, x) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db('POST', 'hr_sessions', [{ id_hash: fp(token), site: x.site, email: x.email, name: x.name, role: x.role, expires_at: new Date(Date.now() + MAX_MS).toISOString(), info: { mods: x.mods, sites: x.sites, siteName: x.siteName } }], 'return=minimal');
  return setCookie(req, token, Math.floor(MAX_MS / 1000));
}
async function read(req) {
  const v = cookieOf(req);
  if (!/^[A-Za-z0-9_-]{30,}$/.test(v)) return null;
  let s = null;
  try { s = ((await db('GET', 'hr_sessions?select=id_hash,site,email,name,role,expires_at,info&id_hash=eq.' + fp(v))) || [])[0]; }
  catch (e) { if (e && e.code === 'notinstalled') return null; throw e; }
  if (!s) return null;
  if (Date.parse(s.expires_at) <= Date.now()) { await db('DELETE', 'hr_sessions?id_hash=eq.' + enc(s.id_hash), undefined, 'return=minimal'); return null; }
  const info = s.info || {};
  return { site: s.site, idHash: s.id_hash, email: s.email, name: s.name, role: s.role, info: info };
}
/* (14-11-2026, asked: "ek option banaw ki all site saglech ekdam sagle disel … hr admin tithunch badal pn kru shaktil") THE SAME
 * SIGN-IN ON ANOTHER OF HIS SITES: "All sites" shows every site of the person at once; each request then names the site it is for.
 * It is honoured only for a site the PORTAL wrote into his ticket with his role there (Admin / User; the Super Admin everywhere) –
 * exactly what he could do by switching to that site. The action itself runs as always: on that one site, with that role.
 * "My HR" (an employee for himself) never. */
function as(s, code) {
  const c = String(code || '').toUpperCase(); if (!c || c === s.site) return s;
  if (s.role === 'self' || !/^[A-Z0-9]{1,12}$/.test(c)) throw fail(403, 'This site cannot be opened from here.', 'site');
  const it = ((s.info && s.info.sites) || []).filter(v => v && v.code === c)[0];
  if (!it || ['super', 'admin', 'user'].indexOf(it.role) < 0 || (it.role === 'super') !== (s.role === 'super')) throw fail(403, 'You do not have HR on this site – or the page is older than this change: open HR again from the Portal.', 'site');
  return Object.assign({}, s, { site: it.code, role: it.role, info: Object.assign({}, s.info, { siteName: it.name || it.code }) });
}
async function need(req) { const s = await read(req); if (!s) throw fail(401, 'SESSION_EXPIRED', 'session'); return s; }
async function end(req) { const s = await read(req); if (s) await db('DELETE', 'hr_sessions?id_hash=eq.' + enc(s.idHash), undefined, 'return=minimal'); }
module.exports = { create, read, need, end, clearCookie, as };
