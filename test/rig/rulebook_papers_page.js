// RIG ONLY – the papers of a leave request on the HR office's Leave page, in a browser against the local viewer on :3062 (never the live site).
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const { chromium } = require('playwright'), { db } = require('../../lib/db'), fs = require('fs'), os = require('os'), path = require('path');
(async () => { let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const site = 'DEMOBKTX2', tag = 'PP' + Date.now().toString().slice(-6), emp = ((await db('GET', 'hr_employees?select=id,email&site=eq.' + site + '&status=neq.left&order=code&limit=1')) || [])[0];
  const day = new Date(Date.now() + (400 + Math.floor(Math.random() * 300)) * 86400000).toISOString().slice(0, 10);
  const q = (await db('POST', 'hr_leave_requests', [{ employee_id: emp.id, site, from_day: day, to_day: day, part: 'full', days: 1, reason: 'papers page ' + tag, level: 2, asked_by: 'rig@rig.test' }], 'return=representation'))[0];
  const file = path.join(os.tmpdir(), 'note-' + tag + '.pdf'); fs.writeFileSync(file, '%PDF-1.4 rig page ' + tag);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 950 } }), errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  try {
    await p.goto('http://localhost:3062/#page=leave'); const row = p.locator('#p_leave tbody tr', { hasText: 'papers page ' + tag }); await row.waitFor({ timeout: 20000 });
    ok(await row.locator('button', { hasText: 'Attach paper' }).count() === 1, 'a request with no paper offers "Attach paper"');
    await row.locator('button', { hasText: 'Attach paper' }).click(); const D = p.locator('.dlg:not([id])'); await D.locator('.lf-add input[type=file]').waitFor({ timeout: 10000 });
    ok(/never needed/.test(await D.innerText()), 'it says a paper is never needed');
    await D.locator('.lf-add .pri').click(); await p.waitForTimeout(300); ok(/Choose the file first/.test(await D.innerText()), 'no file chosen: it says so');
    await D.locator('.lf-add input[type=file]').setInputFiles(file); await D.locator('.lf-add .pri').click(); await D.locator('.lf-row').waitFor({ timeout: 15000 });
    ok(await D.locator('.lf-row').count() === 1 && /note-/.test(await D.locator('.lf-row').innerText()), 'attached: it is in the list with its name');
    await p.screenshot({ path: (process.env.SHOTS || os.tmpdir()) + '/RB_papers.png' });
    ok((await db('GET', 'hr_leave_files?select=id&request_id=eq.' + q.id + '&removed_at=is.null')).length === 1, 'and in the record');
    await D.locator('.acts .sec').click(); await p.waitForTimeout(1500); ok(await row.locator('button', { hasText: 'Papers (1)' }).count() === 1, 'the list now says "Papers (1)"');
    await row.locator('button', { hasText: 'Papers (1)' }).click(); await D.locator('.lf-row').waitFor({ timeout: 10000 }); await D.locator('.lf-row button', { hasText: 'Remove' }).click(); await p.waitForTimeout(1500);
    ok(await D.locator('.lf-row').count() === 0, 'removed from the list'); ok((await db('GET', 'hr_leave_files?select=id,removed_at&request_id=eq.' + q.id)).filter(f => f.removed_at).length === 1, 'kept in the record as removed');
    ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0, 'no sideways scroll');
  } finally { await db('PATCH', 'hr_leave_requests?id=eq.' + q.id, { status: 'cancelled' }, 'return=minimal'); await b.close(); try { fs.unlinkSync(file); } catch (e) { } }
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); process.exit(bad || errs.length ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
