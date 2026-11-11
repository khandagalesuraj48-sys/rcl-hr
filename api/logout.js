/* POST /api/logout – this HR sign-in ends (the page then signs out of the Portal too). */
'use strict';
const { handler, send, sameSite } = require('../lib/http');
const ses = require('../lib/session');
const portal = require('../lib/portal');
module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  try { await ses.end(req); } catch (e) { /* the cookie ends anyway */ }
  send(res, 200, { ok: true, portal: portal.url() }, { 'Set-Cookie': ses.clearCookie(req) });
});
