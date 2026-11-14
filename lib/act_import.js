/* THE BULK CORRECTION OF A MONTH'S ATTENDANCE (api/hr.js sends it here) – step 13 (13-11-2026).
 * His words: "hr admin mg site aso ki ho bulk attendance correct krtil … hr ni attendance export karel jith a aahe tith p kare
 * nantr import karel mg tyach present hoil day wadhtil".   His decisions:
 *   · ONLY IN THE PERSON'S FAVOUR: an absent day (or "IN without OUT") → P, HD or L; a half day → P. Anything else in the file
 *     is refused, line by line, with why. A cell that says what the day already is, is simply skipped.
 *   · (14-11-2026, asked: "1 to 13 sagle blank hot mi te P kel excel madhe ani import kelel") A DAY OF BEFORE ATTENDANCE BEGAN at the
 *     site is empty in the muster (nobody is "absent" before the first recorded day). Such an empty day can be filled with P, HD or L
 *     too – for a person who was an employee on that day (not before his joining date, not after he left). The site's attendance
 *     then begins on the earliest day filled: from that day on a day without attendance is "absent" for EVERYBODY of the site –
 *     the look at the file says so before anything is saved.
 *   · One reason for the whole file is compulsory; a day may have its own.
 *   · A month the HO HR approved is closed: nothing of it is imported (a late correction is an arrear of the next month).
 *   · The punches are never touched: a corrected day is a NEW entry (hr_day_entries) with what counted before, the reason, who
 *     and when – exactly like one correction made by hand; a day set to L is an approved leave of that day (taken from his
 *     Paid-leave balance while it has it).
 *   · When the site's ATTENDANCE policy of the Rule Book says who verifies / approves, the file WAITS for them (Approvals);
 *     without such a policy it is applied at once – by whoever may correct a day today (the Super Admin's power "correct"). */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const B = require('./rulebook');
const power = require('./powers');
const { isHo } = require('./act_month');
const { siteBook, NOT_READY13 } = require('./act_rulebook');

const monthOf = v => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v))) throw fail(400, 'Month: choose the month.', 'month'); return String(v); };
const lastDay = m => m + '-' + String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate()).padStart(2, '0');
const iso = ms => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
const IST = 19800000;
/* the times a corrected day gets: a full day = the shift from its start to its end (09:00 – 18:00 when he has no shift); a
 * half day = from the start for the hours a half day needs (the rule's half_hours, else half the shift) */
function timesFor(to, d) {
  const start = d.sh_start !== null && d.sh_start !== undefined ? d.sh_start : Date.parse(d.day + 'T09:00:00.000Z') - IST, brk = (d.sh_break || 0) * 60000, r = d.rules || {};
  const fullH = Math.max(d.sh_hours || 9, r.full_hours || 0), halfH = r.half_hours !== undefined ? r.half_hours : Math.min(r.full_hours !== undefined ? r.full_hours - 0.5 : 99, Math.max(1, (d.sh_hours || 9) / 2));
  return { in: start, out: start + (to === 'HD' ? halfH : fullH) * 3600000 + brk };
}
/* what a file asks, checked against the month as it counts NOW.  rows: [{ code, day, to, reason }]
 * → { changes: [{ employee_id, code, name, day, was, to, reason }], refused: [{ code, day, to, why }], skipped } */
async function check(s, month, rows) {
  const M = require('./act_muster'), cur = await M.ACT.muster(s, { month: month }), today = R.today(), by = {}; cur.rows.forEach(w => { by[String(w.code).toUpperCase()] = w; });
  const changes = [], refused = [], seen = {}; let skipped = 0;
  // (14-11-2026) an empty day: why it is empty – before the site's first recorded day (it can be filled), before he joined, after he left
  const start = (await M.setup(s.site)).start || '', emp = {}; (await M.all('hr_employees?select=id,joined_on,left_on&site=eq.' + enc(s.site) + '&order=id')).forEach(e => { emp[e.id] = e; });
  const dmy = d => String(d).slice(0, 10).split('-').reverse().join('-'); let early = 0, first = '';
  for (const x of rows) {
    const code = R.str(x.code, 20).toUpperCase(), day = R.date(x.day), to = R.str(x.to, 8), w = by[code];
    if (!to) { skipped++; continue; }
    if (!w) { refused.push({ code: code, day: day || '', to: to, why: 'No employee with this code on this site.' }); continue; }
    if (!day || day.slice(0, 7) !== month) { refused.push({ code: code, day: day || '', to: to, why: 'The day is not of this month.' }); continue; }
    if (day > today) { refused.push({ code: code, day: day, to: to, why: 'A day that is still to come.' }); continue; }
    const was = w.codes[+day.slice(8, 10) - 1] || '', e = emp[w.id] || {};
    if (!was && e.joined_on && day < e.joined_on) { refused.push({ code: code, day: day, to: to, why: 'He joined on ' + dmy(e.joined_on) + ' – a day before it cannot be filled.' }); continue; }
    if (!was && e.left_on && day > e.left_on) { refused.push({ code: code, day: day, to: to, why: 'He had left by then (' + dmy(e.left_on) + ').' }); continue; }
    const before = !was && (!start || day < start), c = B.importChange(was, to, before);
    if (c.skip) { skipped++; continue; }
    if (c.error) { refused.push({ code: code, day: day, to: to, why: (was ? 'It is ' + was + ' now. ' : 'Nothing counts on this day yet. ') + c.error }); continue; }
    if (seen[code + day]) { refused.push({ code: code, day: day, to: to, why: 'This day is in the file twice.' }); continue; } seen[code + day] = 1;
    changes.push({ employee_id: w.id, code: w.code, name: w.name, day: day, was: was, to: c.to, reason: R.str(x.reason, 200) });
    if (before) { early++; if (!first || day < first) first = day; }
  }
  // begins: days of before attendance began are filled – the site's attendance then begins on the earliest of them, for everybody
  return Object.assign({ changes: changes, refused: refused, skipped: skipped }, early ? { begins: { days: early, from: first, was: start } } : {});
}
/* the changes are made: for each a NEW day entry (or an approved leave of the day). Returns { changed, import_id }. */
async function apply(s, site, body, askId) {
  const M = require('./act_muster'), month = body.month; await require('./act_month').needOpen(site, month + '-01');
  const ids = [...new Set(body.changes.map(c => c.employee_id))], emps = []; for (let i = 0; i < ids.length; i += 60) ((await db('GET', 'hr_employees?select=id,code,name,category,site,department_id,reports_to,status,joined_on,left_on&site=eq.' + enc(site) + '&id=in.(' + ids.slice(i, i + 60).join(',') + ')')) || []).forEach(e => emps.push(e));
  const cfg = await M.setup(site), r = await M.daysOf(site, 'site=eq.' + enc(site), emps, month + '-01', lastDay(month), cfg), dayOf = {}; r.rows.forEach(w => w.days.forEach(d => { dayOf[w.emp.id + d.day] = d; }));
  const imp = ((await db('POST', 'hr_att_imports', [{ site: site, month: month, reason: body.reason, file_name: R.str(body.file_name, 120), asked: body.asked || body.changes.length, changed: body.changes.length, refused: body.refused || 0, ask_id: askId || null, imported_by: s.email }], 'return=representation')) || [])[0];
  let n = 0;
  for (const c of body.changes) {
    const d = dayOf[c.employee_id + c.day]; if (!d) continue; const why = (c.reason || body.reason) + ' (bulk correction #' + imp.id + ')';
    if (c.to === 'L') {
      await db('POST', 'hr_leave_requests', [{ employee_id: c.employee_id, site: site, from_day: c.day, to_day: c.day, part: 'full', days: 1, reason: why, status: 'approved', level: 2, steps: [{ level: 2, by: s.email, at: new Date().toISOString(), decision: 'approved', note: 'bulk correction' }], asked_by: s.email, decided_at: new Date().toISOString() }], 'return=minimal');
    } else {
      const t = timesFor(c.to, d), has = d.punches > 0 || (d.src && d.src !== 'punch');
      const e = ((await db('POST', 'hr_day_entries', [{ employee_id: c.employee_id, site: site, day: c.day, in_at: iso(t.in), out_at: iso(t.out), old_in: iso(d.in), old_out: iso(d.out), source: has ? 'correction' : 'manual', reason: why, entered_by: s.email }], 'return=representation')) || [])[0];
      if (e) await db('POST', 'hr_att_import_rows', [{ import_id: imp.id, entry_id: e.id, employee_id: c.employee_id, day: c.day, was: c.was, now_is: c.to }], 'return=minimal');
    }
    n++;
  }
  await audit(site, s.email, 'Attendance corrected in bulk', month + ' · import #' + imp.id, { changed: n, reason: body.reason, file: R.str(body.file_name, 120) });
  return { changed: n, import_id: imp.id };
}

const ACT = {
  /* a file is looked at (dry: true – nothing is saved) or taken. { month, reason, file_name, rows: [{ code, day, to, reason }], dry } */
  async attImport(s, x) {
    if (s.role === 'self') throw fail(403, 'This is for the HR office only.', 'role');
    if (s.role !== 'super' && s.role !== 'admin' && !(await isHo(s))) throw fail(403, 'A bulk correction is made by the HR Admin of the site, the HO HR or the Super Admin.', 'role');
    const month = monthOf(x.month), rows = (Array.isArray(x.rows) ? x.rows : []); if (!rows.length) throw fail(400, 'The file has no day to set right.', 'empty'); if (rows.length > 20000) throw fail(400, 'At most 20,000 cells at a time.', 'big');
    await require('./act_month').needOpen(s.site, month + '-01');
    const book = await siteBook(s.site, 'employee_id=is.null'); if (!book.ready) throw fail(400, NOT_READY13, 'notready');
    const c = await check(s, month, rows);
    if (x.dry === true) return Object.assign({ dry: true, month: month }, c);
    const why = R.str(x.reason, 200); if (why.length < 3) throw fail(400, 'Reason: write why these days are set right (one reason for the whole file).', 'reason');
    if (!c.changes.length) throw fail(400, 'Nothing in the file can be set right' + (c.refused.length ? ' – ' + c.refused.length + ' line(s) were refused.' : '.'), 'none');
    const body = { month: month, reason: why, file_name: R.str(x.file_name, 120), changes: c.changes, asked: rows.length, refused: c.refused.length };
    const p = B.policyOn({ assign: [], defaults: book.defaults.attendance || [], versions: book.versions }, R.today()), a = p && p.auth && (p.auth.approve || []).length ? p.auth : null;
    if (a) {
      const ask = ((await db('POST', 'hr_asks', [{ site: s.site, employee_id: null, kind: 'att_import', day: lastDay(month), body: body, auth: a, stage: B.firstStage(a), asked_by: s.email }], 'return=representation')) || [])[0];
      await audit(s.site, s.email, 'Bulk correction sent for approval', month, { changes: c.changes.length, reason: why }); return { waits: true, stage: ask.stage, changes: c.changes.length, refused: c.refused, skipped: c.skipped };
    }
    if (s.role !== 'super') await power.need(s.role === 'admin' ? s : Object.assign({}, s, { role: 'super' }), 'correct');      // (the HO HR is not held by a site's switch)
    const done = await apply(s, s.site, body, null); return { waits: false, changed: done.changed, import_id: done.import_id, refused: c.refused, skipped: c.skipped };
  },
  // the bulk corrections of this site, the newest first
  async attImports(s) {
    if (s.role === 'self') throw fail(403, 'This is for the HR office only.', 'role');
    let rows; try { rows = (await db('GET', 'hr_att_imports?select=*&site=eq.' + enc(s.site) + '&order=id.desc&limit=100')) || []; } catch (e) { if (e && e.code === 'notinstalled') return { ready: false, rows: [] }; throw e; }
    return { ready: true, rows: rows.map(r => ({ id: r.id, month: r.month, reason: r.reason, file_name: r.file_name, asked: r.asked, changed: r.changed, refused: r.refused, by: r.imported_by, at: r.imported_at })) };
  },
};
module.exports = { ACT, apply, check, timesFor };
