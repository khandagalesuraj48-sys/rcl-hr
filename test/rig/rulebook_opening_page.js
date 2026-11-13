// RIG ONLY – the opening leave balance from a sheet, in a browser against the local viewer on :3062 (never the live site).
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const { chromium } = require('playwright'), { db } = require('../../lib/db'), fs = require('fs'), os = require('os'), path = require('path'), { execSync } = require('child_process');
const sql = q => execSync('timeout 20 su postgres -c "psql -d rig_hr -tA -q"', { input: q }).toString().trim();      // the rig's own database only: to put it back as it was
(async () => { let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const site = 'DEMOBKTX2', tag = 'OP' + Date.now().toString().slice(-6), has = {}; ((await db('GET', 'hr_leave_credits?select=employee_id&site=eq.' + site + '&source=eq.opening&limit=5000')) || []).forEach(c => { has[c.employee_id] = 1; });
  const emp = ((await db('GET', 'hr_employees?select=id,code&site=eq.' + site + '&status=neq.left&order=code')) || []).filter(e => !has[e.id])[0];
  const file = path.join(os.tmpdir(), 'opening-' + tag + '.csv'); fs.writeFileSync(file, 'Code,Name,Category,Paid leave,Comp-off\n' + emp.code + ',,,4,1.5\nNOSUCH99,,,2,\n');
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true }), p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message)); let askId = 0;
  await p.route('**/vendor/xlsx-0.18.5.full.min.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('/home/claude/rclerp/public/vendor/xlsx-0.18.5.full.min.js') }));      // on live the ERP's own address serves it
  try {
    await p.goto('http://localhost:3062/#page=approvals'); await p.waitForSelector('.rb-tabs button', { timeout: 20000 }); ok(await p.locator('.rb-tabs button').count() === 4, 'Approvals has the tab "Opening leave balance"');
    await p.click('.rb-tabs button:nth-child(4)'); await p.waitForSelector('#p_book input[type=date]');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('text=Download the sheet (Excel)')]); ok(dl.suggestedFilename() === 'Opening_leave_balance.xlsx' && fs.statSync(await dl.path()).size > 2000, 'the sheet of the site\'s people is downloaded');
    await p.locator('#p_book input[type=file]').setInputFiles(file); await p.waitForSelector('#p_book .st.s-active', { timeout: 15000 });
    const sum = await p.locator('#p_book .rb-site').nth(1).innerText(); ok(/1 person · Paid leave 4 · Comp-off 1\.5 · 1 refused/.test(sum), 'looked at first: ' + sum.replace(/\n/g, ' | '));
    ok(/not on this site/.test(await p.locator('#p_book .box').innerText()), 'the refused line says why');
    await p.screenshot({ path: (process.env.SHOTS || os.tmpdir()) + '/RB_opening.png' });
    await p.click('#p_book .st-btn.red'); await p.waitForTimeout(900); ok(await p.locator('#toast.bad:not([hidden])').count() === 1 && /Reason/.test(await p.locator('#toast').innerText()), 'no reason: it asks for it');
    await p.fill('#p_book input[maxlength="200"]', 'page opening ' + tag); await p.click('#p_book .st-btn.red');
    const row = p.locator('#p_book tbody tr', { hasText: 'page opening ' + tag }); await row.waitFor({ timeout: 15000 }); ok(/Opening balance of 1 person · Paid leave 4 · Comp-off 1\.5/.test(await row.innerText()), 'ONE request waits in Approvals');
    askId = +((await db('GET', 'hr_asks?select=id&site=eq.' + site + '&kind=eq.leave_credit&status=eq.pending&order=id.desc&limit=1'))[0] || {}).id;
    ok(((await db('GET', 'hr_leave_credits?select=id&ask_id=eq.' + askId)) || []).length === 0, 'nothing added before the approval');
    for (let i = 0; i < 2 && await row.count(); i++) { await row.locator('.mz-ok').click(); await p.waitForTimeout(1600); }
    ok(await row.count() === 0 && ((await db('GET', 'hr_leave_credits?select=id&ask_id=eq.' + askId + '&employee_id=eq.' + emp.id)) || []).length === 2, 'approved: his two lines (paid, comp-off) are added');
    ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0, 'no sideways scroll');
  } finally { if (askId) sql('delete from hr_leave_credits where ask_id=' + askId + '; delete from hr_asks where id=' + askId + ';'); await b.close(); try { fs.unlinkSync(file); } catch (e) { } }
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); process.exit(bad || errs.length ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
