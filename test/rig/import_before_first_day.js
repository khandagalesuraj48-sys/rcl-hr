// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 120 node test/rig/import_before_first_day.js
// A bulk correction fills the EMPTY days of before attendance began at a site – for a person who was an employee then; the look at
// the file says from which day the site's attendance then begins. A test site of its own is made here and taken away again.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const { execSync } = require('child_process'), sql = q => execSync('timeout 20 su postgres -c "psql -d rig_hr -tA -q"', { input: q }).toString().trim();
const IM = require('../../lib/act_import'), M = require('../../lib/act_muster'), B = require('../../lib/rulebook'), R = require('../../lib/rules');
const site = 'B4' + Date.now().toString(36).toUpperCase().slice(-6), month = R.today().slice(0, 7), dd = n => month + '-' + String(n).padStart(2, '0'), today = +R.today().slice(8);
const tidy = () => { try { sql("begin; delete from hr_att_import_rows where import_id in (select id from hr_att_imports where site = '" + site + "'); delete from hr_att_imports where site = '" + site + "'; delete from hr_leave_requests where site = '" + site + "'; delete from hr_day_entries where site = '" + site + "'; delete from hr_audit where site = '" + site + "'; delete from hr_employees where site = '" + site + "'; commit;"); } catch (e) { console.log('(the rig could not be put back: ' + e.message + ')'); } };
process.on('exit', tidy);
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } };
  if (today < 6) { console.log('(the month is too young for this test – run it after the 6th)'); return; }
  // a new site: A was there from before the month, B joined on the 3rd, C left on the 2nd; nothing is recorded at the site yet
  sql("insert into hr_employees (code, name, category, site, joined_on, left_on, status, dob, mobile, email) values ('" + site + "A', 'Rig Before A', 'staff', '" + site + "', '2026-01-01', null, 'active', '1990-01-01', '9000000001', 'a." + site.toLowerCase() + "@rig.test'), ('" + site + "B', 'Rig Before B', 'staff', '" + site + "', '" + dd(3) + "', null, 'active', '1990-01-01', '9000000002', 'b." + site.toLowerCase() + "@rig.test'), ('" + site + "C', 'Rig Before C', 'staff', '" + site + "', '2026-01-01', '" + dd(2) + "', 'left', '1990-01-01', '9000000003', 'c." + site.toLowerCase() + "@rig.test');");
  const sup = { role: 'super', site, email: 'rig.super@rig.test' }, mus = async () => (await M.ACT.muster(sup, { month })).rows, of = (rows, c) => rows.find(w => w.code === site + c);
  const a0 = await mus(); ok(a0.length >= 2 && a0.every(w => w.codes.every(c => c === '')), 'a site where nothing is recorded yet: every day is empty');
  ok(B.importChange('', 'P').error && B.importChange('', 'P', false).error && B.importChange('', 'P', true).to === 'P' && B.importChange('', 'x', true).error, 'an empty day is filled only when it is of before attendance began – and only with P, HD or L');
  const rows = [{ code: site + 'A', day: dd(1), to: 'P' }, { code: site + 'A', day: dd(2), to: 'HD' }, { code: site + 'A', day: dd(4), to: 'P', reason: 'from the register' },
    { code: site + 'B', day: dd(2), to: 'P' }, { code: site + 'B', day: dd(4), to: 'P' }, { code: site + 'C', day: dd(1), to: 'P' }, { code: site + 'C', day: dd(4), to: 'P' }, { code: site + 'A', day: dd(5), to: 'A' }];
  const dry = await IM.ACT.attImport(sup, { month, rows, dry: true });
  ok(dry.changes.length === 5, 'looked at: 5 empty days can be filled (A: 1, 2, 4 · B: 4 · C: 1) – ' + dry.changes.map(c => c.code.slice(-1) + c.day.slice(8)).join(' '));
  ok(dry.changes.every(c => c.was === ''), 'each of them was empty');
  const why = dry.refused.map(r => r.code.slice(-1) + r.day.slice(8) + ': ' + r.why);
  ok(dry.refused.length === 3 && /B02: He joined on 03-/.test(why.join(' | ')) && /C04: He had left by then/.test(why.join(' | ')) && /A05: Nothing counts on this day yet\. Only P, HD or L/.test(why.join(' | ')), 'refused with why: ' + why.join(' | '));
  ok(dry.begins && dry.begins.days === 5 && dry.begins.from === dd(1) && dry.begins.was === '', 'the look says: attendance will begin on the 1st – ' + JSON.stringify(dry.begins));
  ok(JSON.stringify(await mus()) === JSON.stringify(a0), 'looking changes nothing');
  const done = await IM.ACT.attImport(sup, { month, rows, reason: 'attendance of before HR began', file_name: 'before.xlsx' });
  ok(done.waits === false && done.changed === 5, 'saved: ' + JSON.stringify({ waits: done.waits, changed: done.changed }));
  const b = await mus(), A = of(b, 'A').codes, Bc = of(b, 'B').codes, C = of(b, 'C') ? of(b, 'C').codes : null;
  ok(A[0] === 'P' && (A[1] === 'HD' || A[1] === 'P') && A[3] === 'P', 'A: the 1st present, the 2nd counted (a half day where the site has its hours rule – this new site has none, so it reads P), the 4th present – ' + A.slice(0, 5).join(','));
  ok(Bc[1] === '' && Bc[3] === 'P', 'B (joined on the 3rd): the 2nd stays empty, the 4th present – ' + Bc.slice(0, 5).join(','));
  ok(!C || (C[0] === 'P' && C[3] === ''), 'C (left on the 2nd): the 1st present, the 4th empty');
  // the site's attendance now begins on the 1st: a working day without attendance is no longer empty – for everybody
  const work = [2, 4].filter(i => A[i] !== 'WO' && A[i] !== 'H');      // the 3rd and the 5th (unless a day off)
  ok(work.every(i => A[i] !== '') && Bc[2] !== '' , 'from the 1st on a day without attendance counts: A ' + A.slice(0, 5).join(',') + ' · B ' + Bc.slice(0, 5).join(','));
  const ent = sql("select count(*), count(*) filter (where source = 'manual'), count(*) filter (where reason like '%bulk correction #%') from hr_day_entries where site = '" + site + "'");
  ok(ent === '5|5|5', 'five new entries, each "manual" with the reason and the import\'s number: ' + ent);
  const again = await IM.ACT.attImport(sup, { month, rows: [{ code: site + 'A', day: dd(3), to: 'P' }], dry: true });
  ok(again.changes.length === (A[2] === 'A' ? 1 : 0) && !again.begins, 'a day after the first one is an ordinary correction again (no "begins")');
  console.log((n - bad) + ' passed, ' + bad + ' failed'); process.exitCode = bad ? 1 : 0;
})().catch(e => { console.log('ERR', e.stack || e.message); process.exitCode = 1; });
