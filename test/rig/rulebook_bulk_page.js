// RIG ONLY – the bulk attendance correction in a browser against the local viewer on :3062 (never the live site).
const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  await p.route('**/vendor/xlsx-0.18.5.full.min.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('/home/claude/rclerp/public/vendor/xlsx-0.18.5.full.min.js') }));      // on live the ERP's own address serves it
  const tag = 'BP' + Date.now().toString().slice(-6), month = '2026-11';
  await p.goto('http://localhost:3062/#page=approvals'); await p.waitForSelector('.rb-tabs button', { timeout: 20000 }); await p.click('.rb-tabs button:nth-child(3)'); await p.waitForSelector('#p_book input[type=month]'); await p.fill('#p_book input[type=month]', month); await p.waitForTimeout(900);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('text=Export the month (Excel)')]); ok(/Attendance_2026-11_for_correction\.xlsx/.test(dl.suggestedFilename()), 'the month is exported: ' + dl.suggestedFilename());
  const file = await dl.path(), size = fs.statSync(file).size; ok(size > 3000, 'the file has the sheet (' + size + ' bytes)');
  // the exported sheet changed as HR would: one absent day → P, one present day → A (refused), in the browser's own Excel library
  const made = await p.evaluate(async ({ month, tag }) => {
    const r = await window.HRAPI('api/hr', { action: 'muster', month: month }); let abs = null, pres = null; r.rows.forEach(w => w.codes.forEach((c, i) => { if (!abs && (c === 'A' || c === 'L')) abs = { row: w.code, i: i, was: c }; if (!pres && c === 'P') pres = { row: w.code, i: i }; }));
    if (!abs || !pres) return null; const heads = ['Code', 'Name', 'Category'].concat(r.days.map(d => +String(d).slice(8, 10))).concat(['Reason (for the days changed in this row)']);
    const rows = [heads].concat(r.rows.map(w => { const c = w.codes.slice(); let why = ''; if (w.code === abs.row) { c[abs.i] = 'P'; why = 'page ' + tag; } if (w.code === pres.row) c[pres.i] = 'A'; return [w.code, w.name, w.category].concat(c).concat([why]); }));
    const ws = window.XLSX.utils.aoa_to_sheet(rows), wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, month); return { abs: abs, bytes: Array.from(new Uint8Array(window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' }))) };
  }, { month, tag });
  if (!made) { console.log('(no absent day left on this rig to test the import with)'); await b.close(); return; }
  await p.setInputFiles('#p_book input[type=file]', { name: 'corrected.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(made.bytes) }); await p.waitForSelector('#p_book .rb-site .st-btn.red', { timeout: 20000 }); await p.waitForTimeout(400);
  const sum = await p.locator('#p_book .rb-site').nth(1).innerText(); ok(/1 day can be set right · 1 refused/.test(sum), 'looked at first: ' + sum.replace(/\n/g, ' | ').slice(0, 120));
  ok(await p.locator('#p_book tbody tr').count() === 2 && /Refused: A/.test(await p.locator('#p_book tbody').innerText()), 'the change and the refused line are listed with why'); await p.screenshot({ path: (process.env.SHOTS || '/tmp') + '/RB_bulk.png' });
  await p.click('#p_book .rb-site .st-btn.red'); await p.waitForTimeout(1200); ok(await p.locator('#p_book .rb-site .st-btn.red').count() === 1, 'without a reason it is not taken');
  await p.fill('#p_book .rb-site input[type=text]', 'November corrected ' + tag); await p.click('#p_book .rb-site .st-btn.red'); await p.waitForTimeout(2500);
  const now = await p.evaluate(async ({ month, abs }) => { const r = await window.HRAPI('api/hr', { action: 'muster', month: month }); return r.rows.find(w => w.code === abs.row).codes[abs.i]; }, { month, abs: made.abs }); ok(now === 'P', 'the day is present now: ' + made.abs.was + ' → ' + now);
  ok(/November corrected/.test(await p.locator('#p_book').innerText()), 'the correction is in the list of this site');
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); await b.close(); })().catch(e => { console.log('ERR', e.message); process.exit(1); });
