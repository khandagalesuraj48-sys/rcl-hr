// RIG ONLY – the Attendance page's period (today, yesterday, one day, this month, last month, a month, from – to), in a browser
// against the local viewer on :3062 (never the live site). Nothing is saved by this test.
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }), errs = []; p.on('pageerror', e => errs.push(e.message)); let n = 0, bad = 0;
  const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL ' + t); } }, shots = process.argv[2] || '';
  const api = x => p.evaluate(a => fetch('api/hr', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify(a) }).then(r => r.json()), x);
  await p.goto('http://localhost:3062/'); await p.evaluate(() => localStorage.removeItem('rcl_hr_lang')); await p.goto('http://localhost:3062/#page=attendance'); await p.waitForSelector('#p_att .tools select', { timeout: 20000 }); await p.waitForTimeout(1200);
  const sel = '#p_att .tools select', opts = await p.locator(sel + ' option').allInnerTexts(), today = new Date(Date.now() + 19800000).toISOString().slice(0, 10), m = today.slice(0, 7);
  ok(opts.join('|') === 'Today|Yesterday|One day…|This month|Last month|A month…|From – to…', 'the choices: ' + opts.join(' | '));
  ok(await p.inputValue(sel) === 'today' && await p.locator('#p_att .tools input').count() === 0, 'it opens on Today – no date to type');
  const one = await api({ action: 'punchDay', day: today }), mon = await api({ action: 'punchDay', from: m + '-01', to: today });
  ok(Array.isArray(mon.punches) && mon.from === m + '-01' && mon.to === today && mon.punches.length >= one.punches.length, 'the server: this month has ' + mon.punches.length + ' punches, today ' + one.punches.length);
  ok(mon.punches.every(x => x.day >= m + '-01' && x.day <= today) && mon.punches.every((x, i) => !i || mon.punches[i - 1].at >= x.at), 'only the days asked, the newest first');
  ok((await api({ action: 'punchDay', from: today, to: m + '-01' })).error || m + '-01' === today, 'from after to: refused'); ok(/three months/.test((await api({ action: 'punchDay', from: '2026-01-01', to: '2026-11-01' })).error || ''), 'more than three months: refused');
  const rows = () => p.locator('#p_att table tbody tr').count(), heads = () => p.locator('#p_att table thead th').allTextContents();
  ok(await rows() === one.punches.length && (await heads())[2] === 'Category', 'Today: the day\'s punches, as before');
  await p.selectOption(sel, 'thismonth'); await p.waitForTimeout(1500);
  ok(await rows() === mon.punches.length && (await heads())[2] === 'Day', 'This month: ' + mon.punches.length + ' punches, each with its day');
  ok(/Every punch from 01-/.test(await p.locator('#p_att').innerText()) && await p.locator('#p_att .tools button', { hasText: 'The period' }).count() === 1, 'the note and the button say it is a period');
  if (shots) await p.screenshot({ path: shots + '/ATT_period_month.png' });
  await p.selectOption(sel, 'yesterday'); await p.waitForTimeout(1200); ok((await heads())[2] === 'Category' && await p.locator('#p_att .tools input').count() === 0, 'Yesterday: one day');
  await p.selectOption(sel, 'day'); await p.waitForTimeout(900); ok(await p.locator('#p_att .tools input[type=date]').count() === 1, 'One day: its date is chosen');
  await p.selectOption(sel, 'month'); await p.waitForTimeout(1200); ok(await p.locator('#p_att .tools input[type=month]').count() === 1 && await rows() === mon.punches.length, 'A month: the month is chosen (this month first)');
  await p.selectOption(sel, 'lastmonth'); await p.waitForTimeout(1200); ok((await heads())[2] === 'Day', 'Last month: a period');
  await p.selectOption(sel, 'range'); await p.waitForTimeout(1200); ok(await p.locator('#p_att .tools input[type=date]').count() === 2, 'From – to: two dates');
  await p.fill('#p_att .tools input[aria-label="From"]', today); await p.waitForTimeout(1300); ok(await rows() === one.punches.length, 'from today to today: today\'s punches');
  if (shots) await p.screenshot({ path: shots + '/ATT_period_range.png' });
  await p.click('#p_att .tools button:has-text("To be looked at")'); await p.waitForTimeout(1000); ok((await heads())[2] === 'Day', '"To be looked at" still works');
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); await b.close(); process.exit(bad || errs.length ? 1 : 0); })().catch(e => { console.log('ERR', e.message.slice(0, 500)); process.exit(1); });
