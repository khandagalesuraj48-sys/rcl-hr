// RIG ONLY – the Approvals page and a person's leave card in a browser against the local viewer on :3062 (never the live site).
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const tag = 'UI' + Date.now().toString().slice(-6), D = '.dlg:not([id]) ';
  await p.goto('http://localhost:3062/#page=employees'); await p.waitForSelector('#emp_rows tr', { timeout: 20000 }); await p.waitForTimeout(800);
  ok(await p.locator('#tabs .tab[data-page="approvals"]').count() === 1, 'Approvals is in the menu');
  await p.click('#emp_rows tr:first-child'); await p.waitForSelector('#d_led:not([hidden]) .lg-top', { timeout: 15000 }); await p.waitForTimeout(500);
  const paid0 = +(await p.locator('#d_led .lg-top div:nth-child(1) b').innerText()); ok(await p.locator('#d_led .lg-top div').count() === 4, 'his leave card: four counts – paid ' + paid0);
  await p.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/RB_ledger.png' : '/tmp/RB_ledger.png', fullPage: true });
  await p.click('#d_led .ep-row .sec'); await p.waitForTimeout(300); await p.fill(D + 'input[type=number]', '1.5'); await p.fill(D + 'input[maxlength="200"]', 'page test ' + tag); await p.click(D + '.acts .pri'); await p.waitForTimeout(1800);
  ok(+(await p.locator('#d_led .lg-top div:nth-child(1) b').innerText()) === paid0, 'asked: nothing is added yet');
  await p.click('.ep-back'); await p.waitForTimeout(300); await p.evaluate(() => { location.hash = '#page=approvals'; location.reload(); }); await p.waitForSelector('#p_book .box', { timeout: 20000 }); await p.waitForTimeout(800);
  const row = p.locator('#p_book tbody tr', { hasText: 'page test ' + tag }); ok(await row.count() === 1, 'the request waits in Approvals'); await p.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/RB_approvals.png' : '/tmp/RB_approvals.png' });
  for (let i = 0; i < 2 && await row.count(); i++) { await row.locator('.mz-ok').click(); await p.waitForTimeout(1600); }      // verify (when the policy asks for it), then approve
  ok(await row.count() === 0, 'approved: it left the waiting list');
  await p.click('#p_book .tools button:nth-child(2)'); await p.waitForTimeout(1200); ok(await p.locator('#p_book tbody tr', { hasText: 'page test ' + tag }).count() === 1, 'it is in "Approved"');
  await p.click('.rb-tabs button:nth-child(2)'); await p.waitForTimeout(1500); ok(await p.locator('#p_book input[type=month]').count() === 1, 'the month\'s overtime and comp-off opens');
  await p.evaluate(() => { location.hash = '#page=employees'; location.reload(); }); await p.waitForSelector('#emp_rows tr'); await p.waitForTimeout(600); await p.click('#emp_rows tr:first-child'); await p.waitForSelector('#d_led:not([hidden]) .lg-top'); await p.waitForTimeout(600);
  ok(+(await p.locator('#d_led .lg-top div:nth-child(1) b').innerText()) === paid0 + 1.5, 'his balance grew by 1.5'); ok(/page test/.test(await p.locator('#d_led .lg-list').innerText()), 'and his ledger says why');
  // taken back, so the rig stays as it was
  await p.click('#d_led .ep-row .sec'); await p.waitForTimeout(300); await p.fill(D + 'input[type=number]', '-1.5'); await p.fill(D + 'input[maxlength="200"]', 'page test back ' + tag); await p.click(D + '.acts .pri'); await p.waitForTimeout(1500);
  await p.click('.ep-back'); await p.evaluate(() => { location.hash = '#page=approvals'; location.reload(); }); await p.waitForSelector('#p_book .box'); await p.waitForTimeout(800);
  const back = p.locator('#p_book tbody tr', { hasText: 'page test back ' + tag }); for (let i = 0; i < 2 && await back.count(); i++) { await back.locator('.mz-ok').click(); await p.waitForTimeout(1600); } ok(await back.count() === 0, 'taken back again');
  ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0, 'no sideways scroll');
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); await b.close(); })().catch(e => { console.log('ERR', e.message); process.exit(1); });
