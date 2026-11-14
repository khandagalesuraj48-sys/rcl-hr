// RIG ONLY – a work place of another site for one person, in a browser against the local viewer on :3062 (never the live site).
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const { chromium } = require('playwright'), { db } = require('../../lib/db');
(async () => { let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const A = 'DEMOBKTX2', B = 'TCTIR04', emp = ((await db('GET', 'hr_employees?select=id,code,name&site=eq.' + A + '&status=neq.left&order=code&limit=1')) || [])[0];
  const pB = ((await db('GET', 'hr_places?select=id,name&site=eq.' + B + '&removed_at=is.null&order=name')) || []), rows = async () => ((await db('GET', 'hr_place_people?select=place_id&employee_id=eq.' + emp.id + '&place_id=in.(' + pB.map(p => p.id).join(',') + ')')) || []).length;
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 950 } }), errs = []; p.on('pageerror', e => errs.push(e.message));
  try {
    await p.goto('http://localhost:3062/#page=places'); await p.waitForSelector('#pv_person', { timeout: 20000 }); await p.click('#pv_person'); await p.waitForSelector('.pm-change', { timeout: 15000 });
    const row = p.locator('#p_att tbody tr', { hasText: emp.code }).first(); await row.locator('.pm-change').click(); await p.waitForSelector('.pm-guest', { timeout: 10000 });
    ok(/ANOTHER SITE/.test(await p.locator('.pm-guest').innerText()) && /No work place of another site/.test(await p.locator('.pm-guest').innerText()), 'his row offers work places of another site; he has none yet');
    await p.selectOption('.pm-gsite', B); await p.waitForTimeout(300); const boxes = p.locator('.pm-guest label input[type=checkbox]'); ok(await boxes.count() === pB.length, 'the other site chosen: its ' + pB.length + ' work places to tick');
    await boxes.nth(0).check(); await p.click('.pm-gsave'); await p.waitForTimeout(900); ok(await p.locator('#toast.bad:not([hidden])').count() === 1 && await rows() === 0, 'no reason: it asks for it, nothing is kept');
    await p.fill('.pm-gwhy', 'page test – at the other site this week'); await p.click('.pm-gsave'); await p.waitForSelector('.pm-gchip', { timeout: 15000 });
    ok(await rows() === 1 && (await p.locator('#p_att tbody tr', { hasText: emp.code }).first().locator('.pm-gchip').innerText()).indexOf(pB[0].name) > -1, 'saved: his line shows the other site\'s place');
    await p.screenshot({ path: (process.env.SHOTS || require('os').tmpdir()) + '/PLACE_guest.png' });
    await p.locator('#p_att tbody tr', { hasText: emp.code }).first().locator('.pm-change').click(); await p.waitForSelector('.pm-guest'); await p.locator('.pm-guest .st.s-active').first().click(); await p.fill('.pm-gwhy', 'page test – back'); await p.click('.pm-gsave'); await p.waitForTimeout(1500);
    ok(await rows() === 0 && await p.locator('.pm-gchip').count() === 0, 'taken back with one press on its chip and Save');
    ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, 'no sideways scroll');
  } finally { await db('DELETE', 'hr_place_people?employee_id=eq.' + emp.id + '&place_id=in.(' + pB.map(x => x.id).join(',') + ')', undefined, 'return=minimal'); await b.close(); }
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); process.exit(bad || errs.length ? 1 : 0);
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
