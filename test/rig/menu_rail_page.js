// RIG ONLY – the menu's rail of icons on a wide screen, in a browser against the local viewer on :3062 (never the live site).
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }), errs = []; p.on('pageerror', e => errs.push(e.message)); let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  const shots = process.env.SHOTS || require('os').tmpdir(), sw = () => p.evaluate(() => Math.round(document.getElementById('side').getBoundingClientRect().width)), mainLeft = () => p.evaluate(() => Math.round(document.querySelector('.mn').getBoundingClientRect().left));
  await p.goto('http://localhost:3062/#page=dashboard'); await p.waitForSelector('#tabs .tab', { timeout: 20000 }); await p.waitForTimeout(900);
  ok(await sw() === 244, 'a wide screen starts with the whole menu'); await p.mouse.move(900, 500);
  await p.click('#tabs .tab[data-page="muster"]'); await p.mouse.move(900, 500); await p.waitForTimeout(900);
  ok(await sw() === 64 && await mainLeft() === 64, 'a page picked: the menu is a rail of icons, 64 wide – not gone'); ok(await p.locator('#tabs .tab').first().isVisible() && await p.locator('#tabs .tab.on[data-page="muster"]').count() === 1, 'the icons are there, Muster\'s is marked');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#tabs .tab')).fontSize) === '0px' && await p.getAttribute('#tabs .tab[data-page="leave"]', 'title') === 'Leave', 'only icons – each says its name when pointed at');
  await p.screenshot({ path: shots + '/RAIL_closed.png' });
  await p.click('#tabs .tab[data-page="leave"]'); await p.mouse.move(900, 500); await p.waitForTimeout(900); ok(await p.evaluate(() => location.hash) === '#page=leave' && await sw() === 64, 'ONE press on an icon goes to the page – no three lines');
  await p.hover('#side'); await p.waitForTimeout(700); ok(await sw() === 244 && await mainLeft() === 64, 'the pointer over the rail opens the whole menu OVER the page – the page does not move'); await p.screenshot({ path: shots + '/RAIL_hover.png' });
  await p.click('#tabs .tab[data-page="employees"]'); await p.waitForTimeout(500); ok(await p.evaluate(() => location.hash) === '#page=employees', 'a page picked from the opened menu');
  await p.mouse.move(900, 500); await p.waitForTimeout(700); ok(await sw() === 64, 'the pointer away: the rail again');
  await p.click('#nav_tog'); await p.mouse.move(900, 500); await p.waitForTimeout(700); ok(await sw() === 244 && await mainLeft() === 244, 'the three lines open it for good');
  await p.setViewportSize({ width: 800, height: 900 }); await p.evaluate(() => location.reload()); await p.waitForSelector('#tabs .tab', { state: 'attached' }); await p.waitForTimeout(900);
  ok(await p.evaluate(() => { const r = document.getElementById('side').getBoundingClientRect(); return r.right <= 1; }), 'a narrow screen: the drawer is closed and out of sight, as before');
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorX + getComputedStyle(document.body).overscrollBehaviorX) === 'nonenone', 'two fingers sideways do not take the browser a page back');
  console.log((n - bad) + ' passed, ' + bad + ' failed; page errors:', errs.length ? errs : 'none'); await b.close(); process.exit(bad || errs.length ? 1 : 0); })().catch(e => { console.log('ERR', e.message); process.exit(1); });
