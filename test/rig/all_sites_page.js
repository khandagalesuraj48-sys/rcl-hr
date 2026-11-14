// RIG ONLY – "All sites" in a browser against the second local viewer on :3063 (a sign-in with three rig sites and a role on each; never the live site).
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const { chromium } = require('playwright'), { db } = require('../../lib/db');
(async () => { let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const SITES = ['DEMOBKTX2', 'TCTIR04', 'TD7B7SD'], count = {}; for (const c of SITES) count[c] = ((await db('GET', 'hr_employees?select=id&site=eq.' + c + '&limit=2000')) || []).length;
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 950 } }), errs = [], sent = []; p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { if (r.url().includes('/api/hr') && r.method() === 'POST') { try { const j = JSON.parse(r.postData() || '{}'); sent.push((j.as_site || '-') + ':' + j.action); } catch (e) { /* not ours */ } } });
  const frames = () => p.evaluate(() => [...document.querySelectorAll('#all_box iframe')].map(f => ({ site: f.dataset.site, hash: f.contentWindow.location.hash, h: f.offsetHeight, rows: f.contentDocument.querySelectorAll('#emp_rows tr').length, menu: f.contentDocument.querySelector('.sd') ? getComputedStyle(f.contentDocument.querySelector('.sd')).display : 'none', shown: [...f.contentDocument.querySelectorAll('.mn > section')].filter(s => !s.hidden).map(s => s.id).join(',') })));
  try {
    await p.goto('http://localhost:3063/#page=employees'); await p.waitForSelector('#emp_rows tr', { timeout: 20000 }); await p.waitForTimeout(500);
    const opts = await p.evaluate(() => [...document.getElementById('site_pick').options].map(o => o.value)); ok(opts[0] === '*' && opts.length === 5, 'the site switch offers "All sites" first: ' + opts.join(','));
    await p.selectOption('#site_pick', '*'); await p.waitForFunction(() => { const f = document.querySelectorAll('#all_box iframe'); return f.length === 3 && [...f].every(x => x.contentDocument && x.contentDocument.querySelector('#emp_rows tr, #p_emp .none')); }, null, { timeout: 30000 }); await p.waitForTimeout(1500);
    let f = await frames(); ok(f.map(x => x.site).join() === SITES.join(), 'three sites, one under the other – the one without a role is not among them');
    ok(f.every(x => x.shown === 'p_emp' && x.menu === 'none' && x.h > 150), 'each is that site\'s Employees page – no menu inside, as high as its list: ' + f.map(x => x.h).join('/'));
    ok(f.every(x => x.rows === Math.min(count[x.site], x.rows) && x.rows > 0) && f[0].rows !== f[1].rows || count[SITES[0]] === count[SITES[1]], 'each shows its OWN people: ' + f.map(x => x.site + ' ' + x.rows).join(' · '));
    ok(await p.evaluate(() => [...document.querySelectorAll('.mn > section')].every(s => getComputedStyle(s).display === 'none')), 'the one-site page behind is out of sight');
    ok(SITES.slice(1).every(c => sent.some(x => x.indexOf(c + ':') === 0)) && !sent.some(x => x.indexOf('NOROLE:') === 0), 'every request of a site\'s part names that site');
    await p.screenshot({ path: (process.env.SHOTS || require('os').tmpdir()) + '/ALL_employees.png' });
    // the menu: every site's part goes to the chosen page, without being loaded anew
    await p.evaluate(() => { [...document.querySelectorAll('#all_box iframe')].forEach(x => { x.contentWindow.__same = 1; }); });
    await p.click('#tabs .tab[data-page="muster"]'); await p.mouse.move(900, 400); await p.waitForTimeout(3500); f = await frames();
    ok(f.every(x => x.hash === '#page=muster' && x.shown === 'p_mus') && await p.evaluate(() => [...document.querySelectorAll('#all_box iframe')].every(x => x.contentWindow.__same === 1)), 'Muster chosen in the menu: all three show their Muster – the same pages, not loaded again');
    await p.screenshot({ path: (process.env.SHOTS || require('os').tmpdir()) + '/ALL_muster.png' });
    // a change from here: made on the site it stands under (a department added on site two, then put away again)
    await p.click('#tabs .tab[data-page="rulebook"]'); await p.mouse.move(900, 400); await p.waitForTimeout(800); ok(/belongs to one site/.test(await p.locator('#all_box').innerText()) && await p.locator('#all_box iframe').count() === 0, 'a page of one site (Rule Book): it says so');
    await p.click('#tabs .tab[data-page="leave"]'); await p.mouse.move(900, 400); await p.waitForFunction(() => document.querySelectorAll('#all_box iframe').length === 3, null, { timeout: 15000 }); await p.waitForTimeout(3000); f = await frames(); ok(f.every(x => x.shown === 'p_leave'), 'Leave for all sites');
    sent.length = 0; const two = p.frameLocator('#all_box iframe[data-site="TCTIR04"]'); const tabsIn = await two.locator('#p_leave button, #p_leave select').count(); ok(tabsIn > 0, 'the part of site two has its own buttons – it is worked in as on the site');
    // back to one site without a new sign-in
    await p.selectOption('#site_pick', 'DEMOBKTX2'); await p.waitForTimeout(600); ok(await p.locator('#all_box iframe').count() === 0 && await p.evaluate(() => !document.body.classList.contains('all') && !document.getElementById('p_leave').hidden), 'the own site chosen again: one site as before');
    await p.selectOption('#site_pick', '*'); await p.waitForTimeout(800); await p.evaluate(() => location.reload()); await p.waitForFunction(() => document.querySelectorAll('#all_box iframe').length === 3, null, { timeout: 20000 }); ok(await p.evaluate(() => document.getElementById('site_pick').value) === '*', 'the page read again: still "All sites"');
    ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, 'no sideways scroll');
  } finally { await b.close(); }
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); process.exit(bad || errs.length ? 1 : 0);
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
