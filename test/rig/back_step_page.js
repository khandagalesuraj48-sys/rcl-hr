// RIG ONLY – one Back = one step, in a browser against the local viewer on :3062 (never the live site).
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }), errs = []; p.on('pageerror', e => errs.push(e.message)); let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const at = () => p.evaluate(() => location.hash), off = () => p.evaluate(() => document.getElementById('nav_back').disabled), pick = async k => { await p.click('#tabs .tab[data-page="' + k + '"]'); await p.mouse.move(900, 500); await p.waitForTimeout(700); };
  await p.goto('about:blank'); await p.goto('http://localhost:3062/#page=dashboard'); await p.waitForSelector('#tabs .tab', { timeout: 20000 }); await p.waitForTimeout(900);
  ok(await off(), 'the first page: nothing of HR to go back to – "Back" is off');
  await pick('muster'); await pick('leave'); await pick('employees'); ok(await at() === '#page=employees' && !(await off()), 'three pages chosen; "Back" is on');
  await p.click('#nav_back'); await p.waitForTimeout(700); ok(await at() === '#page=leave' && await p.locator('#p_leave:not([hidden])').count() === 1, 'Back: ONE step – Leave');
  await p.goBack(); await p.waitForTimeout(700); ok(await at() === '#page=muster' && await p.locator('#p_mus:not([hidden])').count() === 1, 'the browser\'s own Back: one step – Muster');
  await p.goForward(); await p.waitForTimeout(700); ok(await at() === '#page=leave', 'the browser\'s Forward: Leave again');
  await pick('employees'); await p.waitForSelector('#emp_rows tr'); await p.click('#emp_rows tr:first-child'); await p.waitForSelector('#dlg_emp:not([hidden])', { timeout: 15000 }); await p.waitForTimeout(600);
  await p.click('#nav_back', { force: true }).catch(() => {}); await p.waitForTimeout(600);
  if (await p.locator('#dlg_emp:not([hidden])').count()) { await p.goBack(); await p.waitForTimeout(700); }
  ok(await p.locator('#dlg_emp:not([hidden])').count() === 0 && await at() === '#page=employees', 'an employee\'s page open: one Back closes it – the list is still there');
  await p.click('#emp_rows tr:first-child'); await p.waitForSelector('#dlg_emp:not([hidden])'); await p.waitForTimeout(500); await p.goBack(); await p.waitForTimeout(800);
  ok(await p.locator('#dlg_emp:not([hidden])').count() === 0 && await at() === '#page=employees', 'the browser\'s Back with his page open: it closes, the page stays');
  await p.goBack(); await p.waitForTimeout(700); ok(await at() === '#page=leave', 'the next Back: the page of before (Leave)');
  await p.goBack(); await p.waitForTimeout(500); await p.goBack(); await p.waitForTimeout(700); ok(await at() === '#page=dashboard' && await off(), 'back at the first page: "Back" is off again');
  await p.evaluate(() => location.reload()); await p.waitForSelector('#tabs .tab'); await p.waitForTimeout(900); ok(await at() === '#page=dashboard', 'the page read again stays where it was');
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); await b.close(); process.exit(bad || errs.length ? 1 : 0); })().catch(e => { console.log('ERR', e.message); process.exit(1); });
