// Local server for tests: the page from public/, the endpoints from api/ – the way Vercel serves them (with vercel.json's rewrite
// /menu.json → /api/menu). Needs PORTAL_URL in the environment (SUPABASE_URL and SUPABASE_SECRET_KEY from Phase 1) (never in a file here).
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const port = Number(process.env.PORT) || 3060;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.json': 'application/json' };
http.createServer((req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (p === '/menu.json') p = '/api/menu';
  const m = /^\/api\/([a-z][a-z-]*)$/.exec(p);
  if (m) { const f = path.join(__dirname, 'api', m[1] + '.js'); if (fs.existsSync(f)) return require(f)(req, res); res.statusCode = 404; return res.end('{"error":"Not found."}'); }
  const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('HR on http://127.0.0.1:' + port));
