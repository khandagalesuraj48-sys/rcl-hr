/* POST /api/sso { ticket } – the Portal sent the person here: the ticket is checked (lib/portal.js), used ONCE (its number is
 * written into hr_tickets), the person is noted on the site's list of people, and a HR sign-in for that site starts.
 * { ticket, renew: 1 } (23-10-2026): the open page's fresh ticket every 10 minutes – the sign-in it had is replaced (its row goes);
 * the same person on the same site with the same role is not written in the list of people or the activity record again. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const portal = require('../lib/portal');
const { db } = require('../lib/db');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const { band } = require('../lib/preview');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const x = await readBody(req), c = await portal.verify(x.ticket);
  try { await db('POST', 'hr_tickets', [{ jti: c.jti, expires_at: new Date((c.exp + 300) * 1000).toISOString() }], 'return=minimal'); }
  catch (e) {
    if (e && e.code === 'duplicate') throw fail(401, 'The Portal sign-in could not be accepted (this ticket was already used) – open HR again from the Portal.', 'ticket');
    throw e;
  }
  if (Math.random() < 0.05) { const old = new Date(Date.now() - 86400000).toISOString(); db('DELETE', 'hr_tickets?expires_at=lt.' + old, undefined, 'return=minimal').catch(() => {}); db('DELETE', 'hr_sessions?expires_at=lt.' + old, undefined, 'return=minimal').catch(() => {}); }
  let old = null; try { old = await ses.read(req); } catch (e) { old = null; }
  const again = !!x.renew && !!old && old.site === c.site && String(old.email).toLowerCase() === String(c.email).toLowerCase() && old.role === c.role;
  // the people of the site: who signed in (name and role as the Portal says them now)
  if (!again) {
    const now = new Date().toISOString();
    const had = ((await db('GET', 'hr_people?select=email,first_seen&site=eq.' + encodeURIComponent(c.site) + '&email=eq.' + encodeURIComponent(c.email))) || [])[0];
    await db('POST', 'hr_people?on_conflict=site,email', [{ site: c.site, email: c.email, name: c.name, role: c.role, first_seen: (had && had.first_seen) || now, last_seen: now }], 'resolution=merge-duplicates,return=minimal');
  }
  const cookie = await ses.create(req, c);
  if (old) { try { await db('DELETE', 'hr_sessions?id_hash=eq.' + encodeURIComponent(old.idHash), undefined, 'return=minimal'); } catch (e) { /* it ends by itself in 15 minutes */ } }
  if (!again) await audit(c.site, c.email, 'Sign-in', c.site, { role: c.role });
  send(res, 200, { ok: true, ...band(), user: { email: c.email, name: c.name, role: c.role }, site: c.site, siteName: c.siteName, mods: c.mods, sites: c.sites, portal: portal.url() }, { 'Set-Cookie': cookie });
});
