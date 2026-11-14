// RIG ONLY – the language of the HR web, in a browser against the local viewer on :3062 (never the live site).
//   node test/rig/web_language_page.js [folder for the pictures]
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }), errs = []; p.on('pageerror', e => errs.push(e.message)); let n = 0, bad = 0;
  const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL ' + t); } }, shots = process.argv[2] || '';
  const open = async () => { await p.goto('http://localhost:3062/#page=dashboard'); await p.waitForSelector('#tabs .tab', { timeout: 20000 }); await p.waitForTimeout(1500); };
  const txt = sel => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel), deva = /[ऀ-ॿ]/;
  const choose = async v => { await Promise.all([p.waitForNavigation({ timeout: 20000 }).catch(() => {}), p.selectOption('#lang_pick', v)]); await p.waitForSelector('#tabs .tab', { timeout: 20000 }); await p.waitForTimeout(1800); };
  await p.goto('http://localhost:3062/'); await p.evaluate(() => localStorage.removeItem('rcl_hr_lang')); await open();
  if (await p.inputValue('#lang_pick') !== 'en') await choose('en');
  // ENGLISH – until the person chooses
  ok(await p.inputValue('#lang_pick') === 'en' && await p.locator('#lang_pick:not([hidden])').count() === 1, 'the picker is on top, on English');
  const all = () => p.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), out = []; let x; while ((x = w.nextNode())) { const e = x.parentElement; if (!e || e.closest('script,style,[data-noi18n],[hidden]')) continue; const t = x.nodeValue.trim(); if (t) out.push(t); } return out; });
  let seen = await all();
  ok(!seen.some(t => deva.test(t)), 'English: no Marathi word on the Dashboard – ' + seen.filter(t => deva.test(t)).slice(0, 3).join(' | '));
  ok(seen.indexOf('Present') > -1 && seen.indexOf('Dashboard') > -1, 'English: "Present", "Dashboard"');
  if (shots) await p.screenshot({ path: shots + '/HR_lang_english.png' });
  // MARATHI – chosen on top: kept with the person, the page opens again in it
  await choose('mr'); seen = await all();
  ok(await p.inputValue('#lang_pick') === 'mr', 'the picker shows मराठी after the page opened again');
  ok(seen.indexOf('हजर') > -1 && seen.indexOf('डॅशबोर्ड') > -1 && seen.indexOf('कर्मचारी') > -1, 'Marathi: हजर, डॅशबोर्ड, कर्मचारी');
  ok(seen.indexOf('Present') < 0 && seen.indexOf('Employees') < 0, 'Marathi: the English words of the menu and the counts are gone');
  const left = seen.filter(t => /[A-Za-z]{3}/.test(t) && !deva.test(t)); console.log('Marathi Dashboard: ' + seen.length + ' texts, still English: ' + left.length + ' – ' + left.slice(0, 25).join(' | '));
  if (shots) await p.screenshot({ path: shots + '/HR_lang_marathi.png' });
  ok((await p.evaluate(() => fetch('api/me').then(r => r.json()))).lang === 'mr', 'the sign-in carries it (the same on another computer)');
  await p.click('#tabs .tab[data-page="employees"]'); await p.waitForTimeout(1500);
  ok(/कर्मचारी/.test(await txt('#p_head h2') || await txt('h2')), 'another page: its heading in Marathi');
  const row = await p.evaluate(() => { const r = document.querySelector('#emp_rows tr'); return r ? [...r.cells].map(c => c.textContent.trim()) : []; }); console.log('a row of the list: ' + row.join(' | '));
  ok(row.some(t => /RCL[0-9]+/.test(t)), 'an employee\'s code is as it was typed');
  if (shots) await p.screenshot({ path: shots + '/HR_lang_marathi_employees.png' });
  // HINDI
  await p.click('#tabs .tab[data-page="dashboard"]'); await p.waitForTimeout(800); await choose('hi'); seen = await all();
  ok(await p.inputValue('#lang_pick') === 'hi' && seen.indexOf('उपस्थित') > -1 && seen.indexOf('डैशबोर्ड') > -1, 'Hindi: उपस्थित, डैशबोर्ड');
  // BACK TO ENGLISH
  await choose('en'); seen = await all();
  ok(await p.inputValue('#lang_pick') === 'en' && !seen.some(t => deva.test(t)) && seen.indexOf('Present') > -1, 'English again: nothing in another language is left');
  ok((await p.evaluate(() => fetch('api/me').then(r => r.json()))).lang === '', 'the sign-in says English again');
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); await b.close(); process.exit(bad || errs.length ? 1 : 0); })().catch(e => { console.log('ERR', e.message); process.exit(1); });
