/* Small helpers every endpoint uses: read the body, answer in JSON, refuse requests from other web pages. */
'use strict';

class HttpError extends Error { constructor(status, message, code, extra) { super(message); this.status = status; this.code = code || ''; this.extra = extra || null; } }
const fail = (status, message, code, extra) => new HttpError(status, message, code, extra);

function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(String(req.body) || '{}')); } catch (e) { return Promise.reject(fail(400, 'Bad request.')); }
  }
  return new Promise((resolve, reject) => {
    let b = ''; req.setEncoding('utf8');
    req.on('data', d => { b += d; if (b.length > 3000000) { reject(fail(413, 'Too much data in one go.')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(fail(400, 'Bad request.')); } });
    req.on('error', reject);
  });
}
function send(res, status, obj, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(obj));
}
// a change may come only from this module's own page: our header is required (a form on another site cannot set it) and,
// when the browser names the page it came from, that must be this site
function sameSite(req) {
  if (String(req.headers['x-rcl'] || '') !== '1') throw fail(403, 'Refused: this request did not come from the HR page.');
  const origin = String(req.headers.origin || ''); if (!origin) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  let oh = ''; try { oh = new URL(origin).host; } catch (e) { oh = ''; }
  // (one address for every module: HR is also served as <PUBLIC_URL> – e.g. https://oneclicksolution.online/hr – through the main
  // project's rewrite; a page of that address is ours too)
  let pub = ''; try { pub = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).host : ''; } catch (e) { pub = ''; }
  if (oh !== host && !(pub && oh === pub)) throw fail(403, 'Refused: this request came from another web page.');
}
// one endpoint = one function; every error becomes a clear answer (the details of a fault go to the server's log only)
const handler = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof HttpError) return send(res, e.status, Object.assign({ error: e.message, code: e.code || undefined }, e.extra || {}));
    console.error('[hr] ' + String((e && e.stack) || e));
    send(res, 500, { error: 'The HR module hit a fault – please try again. If it stays, tell the Super Admin.' });
  }
};
module.exports = { HttpError, fail, readBody, send, sameSite, handler };
