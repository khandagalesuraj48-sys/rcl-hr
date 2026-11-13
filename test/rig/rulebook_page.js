// RIG ONLY – the Rule Book page in a browser against the local viewer on :3062 (never the live site): NODE_PATH=… timeout 100 node test/rig/rulebook_page.js
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const tag = 'UI' + Date.now().toString().slice(-6);
  await p.goto('http://localhost:3062/#page=rulebook'); await p.waitForSelector('.rb-k', { timeout: 20000 }); await p.waitForTimeout(800);
  ok(await p.locator('.rb-k').count() === 6, 'six kinds on the left'); ok(await p.locator('#tabs .tab[data-page="rulebook"]').count() === 1, 'the Rule Book is in the menu');
  // a weekly-off policy: Sunday + the 2nd and 4th Saturday
  await p.click('.rb-k:nth-child(3)'); await p.waitForTimeout(300); await p.click('text=+ New policy'); await p.waitForTimeout(400);
  await p.fill('.dlg:not([id]) .sheet input[maxlength="60"]', 'HO 2nd 4th Sat ' + tag);
  for (const k of [1, 2, 3, 4, 5]) await p.click('.rb-wo div:nth-child(1) label:nth-of-type(' + k + ') input');
  await p.click('.rb-wo div:nth-child(7) label:nth-of-type(2) input'); await p.click('.rb-wo div:nth-child(7) label:nth-of-type(4) input');
  await p.click('.dlg:not([id]) .acts .pri'); await p.waitForTimeout(700); ok(await p.locator('.dlg:not([id]) .err:not([hidden])').count() === 1, 'refused: somebody must approve');
  await p.selectOption('.rb-step:nth-child(2) select', 'ho_hr'); await p.selectOption('.rb-step:nth-child(1) select', 'site_hr'); await p.screenshot({ path: (process.env.SHOTS || require('os').tmpdir()) + '/RB_form.png' });
  await p.click('.dlg:not([id]) .acts .pri'); await p.waitForTimeout(1800);
  const card = p.locator('.rb-card', { hasText: 'HO 2nd 4th Sat ' + tag }); ok(await card.count() === 1, 'the new policy is a card');
  const txt = await card.innerText(); ok(/every Sunday, the 2nd and 4th Saturday/.test(txt), 'in plain words: ' + txt.replace(/\n/g, ' | ').slice(0, 160)); ok(/Site HR Admin/.test(txt) && /HO HR/.test(txt), 'who verifies and approves');
  // the site's own, then two people their own
  await p.click('.rb-site .st-btn'); await p.waitForTimeout(300); await p.selectOption('.dlg:not([id]) select', { label: 'HO 2nd 4th Sat ' + tag }); await p.click('.dlg:not([id]) .acts .pri'); await p.waitForTimeout(1800);
  ok(/HO 2nd 4th Sat/.test(await p.locator('.rb-site').innerText()), 'the site gives it to everybody'); ok(await card.locator('.st.s-active').count() === 1, 'the card says: the site\'s own');
  await p.click('.rb-tabs button:nth-child(2)'); await p.waitForSelector('#p_book tbody tr'); await p.waitForTimeout(500);
  ok((await p.locator('#p_book tbody tr').count()) > 5 && /The site's/.test(await p.locator('#p_book tbody tr:first-child').innerText()), 'everybody has the site\'s');
  await p.click('#p_book tbody tr:nth-child(1) input[type=checkbox]'); await p.click('#p_book tbody tr:nth-child(2) input[type=checkbox]'); ok(/Give to 2 ticked/.test(await p.locator('#p_book .tools .pri').innerText()), 'two ticked');
  await p.screenshot({ path: (process.env.SHOTS || require('os').tmpdir()) + '/RB_people.png' });
  await p.click('.rb-tabs button:nth-child(1)'); await p.waitForTimeout(400); await p.screenshot({ path: (process.env.SHOTS || require('os').tmpdir()) + '/RB_policies.png', fullPage: true });
  // back to none, so the rig's days count as before
  await p.click('.rb-site .st-btn'); await p.waitForTimeout(300); await p.selectOption('.dlg:not([id]) select', ''); await p.click('.dlg:not([id]) .acts .pri'); await p.waitForTimeout(1500);
  ok(/rules of before/.test(await p.locator('.rb-site').innerText()), 'taken away again');
  ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0, 'no sideways scroll');
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); await b.close(); })().catch(e => { console.log('ERR', e.message); process.exit(1); });
