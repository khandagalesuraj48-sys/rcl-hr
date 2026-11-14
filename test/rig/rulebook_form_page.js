// RIG ONLY – the Rule Book's simpler form (suggestions, numbers chosen from lists, sites ticked, "in plain words"), in a browser
// against the local viewer on :3062 (never the live site). The policy made here is deleted again at the end.
//   node test/rig/rulebook_form_page.js [folder for the pictures]
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 1000 } }), errs = []; p.on('pageerror', e => errs.push(e.message)); let n = 0, bad = 0;
  const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL ' + t); } }, shots = process.argv[2] || '', tag = 'RigForm' + Date.now().toString().slice(-6), D = '.dlg:not([id]) .sheet';
  const api = (action, x) => p.evaluate(a => fetch('api/hr', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify(a) }).then(r => r.json()), Object.assign({ action }, x || {}));
  await p.goto('http://localhost:3062/'); await p.evaluate(() => localStorage.removeItem('rcl_hr_lang')); await p.goto('http://localhost:3062/#page=rulebook'); await p.waitForSelector('.rb-k', { timeout: 20000 }); await p.waitForTimeout(800);
  // LATE: a suggestion fills the form
  await p.click('.rb-k:nth-child(2)'); await p.waitForTimeout(300); await p.click('text=+ New policy'); await p.waitForSelector(D + ' .rb-idea select');
  ok(await p.locator(D + ' input[type=number]:visible').count() === 0, 'no number has to be typed: every one is a list');
  ok(/Nothing is chosen yet/.test(await p.locator(D + ' .rb-plain').innerText()), 'in plain words: nothing chosen yet');
  const val = k => p.evaluate(i => document.querySelectorAll('.dlg:not([id]) .sheet .rb-num select')[i].value, k);
  await p.selectOption(D + ' .rb-idea select', '0'); await p.waitForTimeout(200);
  ok(await val(0) === '15' && await val(1) === '15' && await val(2) === '3' && await val(3) === '', 'the suggestion filled: late after 15, early 15, 3 days; the half-day rules not applied');
  ok(await p.inputValue(D + ' input[maxlength="60"]') === 'Usual', 'and a name');
  let plain = await p.locator(D + ' .rb-plain').innerText();
  ok(/IN more than 15 min after the shift starts/.test(plain) && /3 late \/ early days are only marked/.test(plain), 'in plain words: what it will do');
  // a value of his own: "Other" – then it is typed
  await p.selectOption(D + ' .rb-num >> nth=0 >> select', 'other'); await p.fill(D + ' .rb-num >> nth=0 >> input', '12'); await p.waitForTimeout(150);
  ok(/IN more than 12 min after the shift starts/.test(await p.locator(D + ' .rb-plain').innerText()), '"Other": 12 typed – the words follow');
  await p.selectOption(D + ' .rb-num >> nth=2 >> select', ''); await p.waitForTimeout(150);
  ok(!/late \/ early days are only marked/.test(await p.locator(D + ' .rb-plain').innerText()), '"Not applied": the rule is left out');
  await p.fill(D + ' input[maxlength="60"]', tag);
  // the sites are ticked
  await p.selectOption(D + ' .rb-sites select', 'some'); ok(await p.locator(D + ' .rb-sitelist label').count() >= 2, 'the sites to tick are listed');
  await p.selectOption(D + ' .rb-step:nth-child(2) select', 'ho_hr'); await p.click(D + ' .acts .pri'); await p.waitForTimeout(400);
  ok(/Tick at least one site/.test(await p.locator(D + ' .err').innerText()), 'no site ticked: told so, nothing saved');
  await p.click(D + ' .rb-sitelist label:nth-child(1) input'); if (shots) await p.screenshot({ path: shots + '/RB_simple_form.png' });
  await p.click(D + ' .acts .pri'); await p.waitForTimeout(2000);
  const all = await api('rbList'), made = (all.policies || []).filter(x => x.name === tag)[0];
  ok(!!made && made.kind === 'late', 'saved as a policy'); const bd = made ? (made.body || (made.versions[0] || {}).body || {}) : {};
  ok(bd.grace_min === 12 && bd.early_min === 15 && bd.free === undefined && bd.half_after_min === undefined, 'what was chosen is what is kept: ' + JSON.stringify(bd));
  ok(made && made.sites.length === 1, 'for the one site ticked: ' + JSON.stringify(made && made.sites));
  // changing it: the form shows what it has – also a value that is not in the list
  if (made) { const card = p.locator('.rb-card', { hasText: tag }); await card.locator('button', { hasText: /Change/ }).first().click(); await p.waitForSelector(D + ' .rb-num');
    ok(await val(0) === 'other' && await p.inputValue(D + ' .rb-num >> nth=0 >> input') === '12' && await val(1) === '15', 'the saved values are shown – 12 under "Other"');
    ok(await p.locator(D + ' .rb-idea').count() === 0, 'no suggestion when a policy is changed');
    ok(await p.inputValue(D + ' .rb-sites select') === 'some' && await p.locator(D + ' .rb-sitelist input:checked').count() === 1, 'its site is ticked');
    await p.click(D + ' .acts .sec'); }
  // WEEKLY OFF: a suggestion ticks the weeks
  await p.click('.rb-k:nth-child(3)'); await p.waitForTimeout(300); await p.click('text=+ New policy'); await p.waitForSelector(D + ' .rb-idea select'); await p.selectOption(D + ' .rb-idea select', '1'); await p.waitForTimeout(200);
  ok(await p.locator(D + ' .rb-wo div:nth-child(1) input:checked').count() === 5 && await p.locator(D + ' .rb-wo div:nth-child(7) input:checked').count() === 2, 'Sunday every week, Saturday the 2nd and 4th');
  ok(/every Sunday, the 2nd and 4th Saturday/.test(await p.locator(D + ' .rb-plain').innerText()), 'in plain words');
  if (shots) await p.screenshot({ path: shots + '/RB_simple_weekoff.png' }); await p.click(D + ' .acts .sec');
  // LEAVE: needs "Leaves a month"
  await p.click('.rb-k:nth-child(4)'); await p.waitForTimeout(300); await p.click('text=+ New policy'); await p.waitForSelector(D + ' .rb-idea select');
  ok(/Leaves a month/.test(await p.locator(D + ' .rb-plain').innerText()), 'leave: told what is needed'); await p.selectOption(D + ' .rb-idea select', '0'); await p.waitForTimeout(200);
  ok(/1\.5 leave\(s\) at the start of every month/.test(await p.locator(D + ' .rb-plain').innerText()), 'the suggestion: 1.5 a month'); await p.click(D + ' .acts .sec');
  if (made) { const del = await api('rbDelete', { id: made.id }); ok(del && !del.error, 'the test policy is deleted again: ' + JSON.stringify(del).slice(0, 120)); }
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); await b.close(); process.exit(bad || errs.length ? 1 : 0); })().catch(e => { console.log('ERR', e.message.slice(0, 600)); process.exit(1); });
