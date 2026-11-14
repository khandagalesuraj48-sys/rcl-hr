/* GET /api/me – who is signed in here (and the Portal's address, also when nobody is: the page then goes there). */
'use strict';
const { handler, send } = require('../lib/http');
const portal = require('../lib/portal');
const ses = require('../lib/session');
const { band } = require('../lib/preview');
const lang = require('../lib/lang');
module.exports = handler(async (req, res) => {
  let s = await ses.read(req);
  if (!s) return send(res, 200, { signedIn: false, portal: portal.url(), ...band() });
  // (14-11-2026) "All sites": the page of ONE of his other sites asks who he is there (GET /api/me?as=<site>)
  const as = new URL(req.url, 'http://x').searchParams.get('as'); if (as) s = ses.as(s, as);
  send(res, 200, { signedIn: true, ...band(), user: { email: s.email, name: s.name, role: s.role }, site: s.site, siteName: s.info.siteName || s.site, mods: s.info.mods || [], sites: s.info.sites || [], portal: portal.url(), lang: await lang.of(s.email) });      // (14-11-2026) lang: the person's language of the web ('' = English)
});
