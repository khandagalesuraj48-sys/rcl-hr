/* POST /api/sso { ticket } – the Portal sent the person here. THE FRAME ONLY (12-11-2026): the ticket is checked (lib/portal.js –
 * the Portal's signature, made for "hr", its time) and the page is told who the Portal sent. NO sign-in is started and NOTHING is
 * written: HR has no table yet. So a ticket opens nothing but the "being built" notice – also a ticket shown twice. From Phase 1
 * (its SQL, run by the owner in the HR Supabase): the ticket's number is written once (hr_tickets) and HR's own sign-in starts. */
'use strict';
const { handler, readBody, send, sameSite } = require('../lib/http');
const portal = require('../lib/portal');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const x = await readBody(req), c = await portal.verify(x.ticket);
  send(res, 200, { ok: true, built: false, user: { name: c.name, role: c.role }, site: c.site, siteName: c.siteName });
});
