/* THE MONTH'S ATTENDANCE: VERIFIED BY THE SITE'S HR, APPROVED BY THE HO HR (step 10 – asked 12-11-2026: "MONTH END LA JYA TYA SITE
 * CHA HR ATTENDANCE VERIFY KAREL USER WISE BULK VERIFY … SITE HR NI VERIFY KEL KI DIRECT HO HR KADE DATA JAIL").
 *   The site's HR Admin (the power "month" – the Super Admin gives or takes it) verifies people of a month that has ended, one by
 *   one or many at once: the counts of that moment are kept. A verified row is with the HO HR at once. Until the HO HR approves,
 *   the site's HR may change a day and verify again.
 *   The HO HR (given by the Super Admin; or the Super Admin himself) checks, sends people back with the reason, or approves the
 *   site's month: from then on no day of that month is changed (the Super Admin can open it again, with the reason).
 * Nothing of attendance is written here – only what was verified, by whom and when. */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const M = require('./month');
const power = require('./powers');
const { needOffice } = require('./act_attend');
const MUS = require('./act_muster');

const NOT_READY10 = 'The month\'s verification is not set up yet: the Super Admin runs sql/hr_step10_month.sql once in the rcl-hr Supabase → SQL Editor.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mail = v => String(v || '').trim().toLowerCase();
const soft = MUS.soft;
// is this sign-in the HO HR? (the Super Admin always; an office sign-in whose e-mail the Super Admin put on the list)
async function isHo(s) {
  if (s.role === 'super') return true; if (s.role !== 'admin' && s.role !== 'user') return false;
  return ((await soft(db('GET', 'hr_ho_hr?select=email&email=eq.' + enc(mail(s.email)) + '&active=is.true'))) || []).length > 0;
}
async function needHo(s) { if (!(await isHo(s))) throw fail(403, 'Only the HO HR or the Super Admin can do this.', 'role'); }
const monthOf = v => { if (!M.monthOk(v)) throw fail(400, 'Month: as YYYY-MM.', 'month'); return String(v); };
const approvedRow = async (site, month) => ((await db('GET', 'hr_months?select=*&site=eq.' + enc(site) + '&month=eq.' + month)) || [])[0] || null;
/* Is this day of a month the HO HR approved? Then nothing of it is changed any more. (before step 10 is run: never) */
async function locked(site, day) {
  const r = ((await soft(db('GET', 'hr_months?select=status&site=eq.' + enc(site) + '&month=eq.' + String(day).slice(0, 7) + '&status=eq.approved'))) || [])[0];
  return !!r;
}
async function needOpen(site, day) {
  if (await locked(site, day)) throw fail(409, 'The attendance of ' + String(day).slice(5, 7) + '-' + String(day).slice(0, 4) + ' is approved by the HO HR – no day of that month is changed any more. Only the Super Admin can open the month again.', 'monthlocked');
}
// everybody of the site in that month with his days of today, and what still waits for a decision
async function people(site, month) {
  const from = month + '-01', to = M.lastDay(month);
  const emps = (await MUS.all('hr_employees?select=id,code,name,category,department_id,joined_on,left_on,status&site=eq.' + enc(site) + '&order=name,id')).filter(e => !(e.left_on && e.left_on < from) && !(e.joined_on && e.joined_on > to));
  const cfg = await MUS.setup(site), r = await MUS.daysOf(site, 'site=eq.' + enc(site), emps, from, to, cfg);
  await require('./act_leave').apply(site, 'site=eq.' + enc(site), emps, r, cfg);
  const [regs, leaves] = await Promise.all([soft(db('GET', 'hr_regularize?select=employee_id&site=eq.' + enc(site) + '&status=eq.pending&day=gte.' + from + '&day=lte.' + to)),
    soft(db('GET', 'hr_leave_requests?select=employee_id&site=eq.' + enc(site) + '&status=eq.pending&from_day=lte.' + to + '&to_day=gte.' + from))]);
  const wait = {}; (regs || []).concat(leaves || []).forEach(q => { wait[q.employee_id] = (wait[q.employee_id] || 0) + 1; });
  return r.rows.map(w => ({ emp: w.emp, counts: M.counts(w.days, w.total), waiting: (wait[w.emp.id] || 0) + w.days.reduce((n, d) => n + (d.review || 0), 0) }));
}
const why = p => (p.counts.open ? p.counts.open + ' day(s) with IN and no OUT – set them right first' : p.waiting ? p.waiting + ' request(s) / doubtful punch(es) still wait for a decision' : '');

const ACT = {
  // the month of this site: everybody with his counts of today, what was verified, where the month stands
  async monthList(s, x) {
    needOffice(s); const month = monthOf(x.month || R.today().slice(0, 7)), today = R.today(), ended = M.lastDay(month) < today;
    const [list, rows, ap, ho, pw] = await Promise.all([people(s.site, month), db('GET', 'hr_month_people?select=*&site=eq.' + enc(s.site) + '&month=eq.' + month), approvedRow(s.site, month), isHo(s), power.of(s.site)]);
    const by = {}; (rows || []).forEach(r => { by[r.employee_id] = r; });
    const isLocked = !!ap && ap.status === 'approved';
    const out = list.map(p => { const v = by[p.emp.id] || null, back = !!(v && v.returned_at);
      return { id: p.emp.id, code: p.emp.code, name: p.emp.name, category: p.emp.category, counts: isLocked && v ? v.counts : p.counts, waiting: p.waiting, blocked: why(p),
        state: !v ? 'open' : back ? 'returned' : M.same(v.counts, p.counts) || isLocked ? 'verified' : 'changed',
        verified: v ? { by: v.verified_by, at: v.verified_at, counts: v.counts } : null, returned: back ? { by: v.returned_by, at: v.returned_at, reason: v.return_reason } : null }; });
    const n = k => out.filter(r => r.state === k).length;
    return { month: month, today: today, ended: ended, site: s.site, rows: out, sum: { people: out.length, verified: n('verified'), changed: n('changed'), returned: n('returned'), open: n('open') },
      approved: isLocked ? { by: ap.approved_by, at: ap.approved_at, note: ap.note, people: ap.people } : null, reopened: ap && ap.status === 'reopened' ? { by: ap.reopened_by, at: ap.reopened_at, reason: ap.reopen_reason } : null,
      can: { verify: !isLocked && ended && (s.role === 'super' || (s.role === 'admin' && !!pw.month)), ho: ho, reopen: s.role === 'super' && isLocked } };
  },
  // the site's HR verifies people (many at once): each one's counts of this moment are kept. Who cannot be verified is said, the others are.
  async monthVerify(s, x) {
    await power.need(s, 'month'); const month = monthOf(x.month), ids = [...new Set((Array.isArray(x.ids) ? x.ids : []).map(v => String(v).toLowerCase()).filter(v => UUID.test(v)))].slice(0, 3000);
    if (!ids.length) throw fail(400, 'Choose at least one person.', 'people');
    if (M.lastDay(month) >= R.today()) throw fail(400, 'A month is verified after its last day.', 'running');
    await needOpen(s.site, month + '-01');
    const list = await people(s.site, month), by = {}; list.forEach(p => { by[p.emp.id] = p; });
    const good = [], skipped = [];
    ids.forEach(i => { const p = by[i]; if (!p) skipped.push({ id: i, name: '', reason: 'Not an employee of this site in that month.' }); else if (why(p)) skipped.push({ id: i, code: p.emp.code, name: p.emp.name, reason: why(p) + '.' }); else good.push(p); });
    const now = new Date().toISOString();
    for (const c of MUS.chunks(good, 200)) await db('POST', 'hr_month_people?on_conflict=site,month,employee_id', c.map(p => ({ site: s.site, month: month, employee_id: p.emp.id, counts: p.counts, verified_by: s.email, verified_at: now, returned_by: null, returned_at: null, return_reason: null })), 'resolution=merge-duplicates,return=minimal');
    if (good.length) await audit(s.site, s.email, 'Month verified', month + ' · ' + good.length + ' people', { codes: good.slice(0, 300).map(p => p.emp.code) });
    return Object.assign({ saved: good.length, skipped: skipped }, await ACT.monthList(s, { month: month }));
  },
  // the HO HR sends people back to the site's HR, with the reason
  async monthReturn(s, x) {
    needOffice(s); await needHo(s); const month = monthOf(x.month), reason = R.str(x.reason, 200), ids = [...new Set((Array.isArray(x.ids) ? x.ids : []).map(v => String(v).toLowerCase()).filter(v => UUID.test(v)))].slice(0, 3000);
    if (!ids.length) throw fail(400, 'Choose at least one person.', 'people'); if (reason.length < 3) throw fail(400, 'Reason: write why it is sent back.', 'reason');
    await needOpen(s.site, month + '-01'); let n = 0; const now = new Date().toISOString();
    for (const c of MUS.chunks(ids, 60)) n += ((await db('PATCH', 'hr_month_people?site=eq.' + enc(s.site) + '&month=eq.' + month + '&returned_at=is.null&employee_id=in.(' + c.join(',') + ')', { returned_by: s.email, returned_at: now, return_reason: reason }, 'return=representation')) || []).length;
    if (!n) throw fail(400, 'None of the chosen people is verified – there is nothing to send back.', 'none');
    await audit(s.site, s.email, 'Month sent back to the site\'s HR', month + ' · ' + n + ' people', { reason: reason });
    return ACT.monthList(s, { month: month });
  },
  // the HO HR approves the site's month: everybody verified, nothing changed since – from now on the month is closed
  async monthApprove(s, x) {
    needOffice(s); await needHo(s); const month = monthOf(x.month), note = R.str(x.note, 200);
    if (M.lastDay(month) >= R.today()) throw fail(400, 'A month is approved after its last day.', 'running');
    await needOpen(s.site, month + '-01');
    const r = await ACT.monthList(s, { month: month });
    if (!r.rows.length) throw fail(400, 'This site has no employee in that month.', 'none');
    const bad = r.rows.filter(p => p.state !== 'verified');
    if (bad.length) throw fail(400, bad.length + ' of ' + r.rows.length + ' people are not verified by the site\'s HR yet (not verified, sent back, or changed since) – for example ' + bad.slice(0, 3).map(p => p.code + ' ' + p.name).join(', ') + '.', 'notverified');
    const row = { site: s.site, month: month, status: 'approved', people: r.rows.length, note: note, approved_by: s.email, approved_at: new Date().toISOString(), reopened_by: null, reopened_at: null, reopen_reason: null };
    await db('POST', 'hr_months?on_conflict=site,month', [row], 'resolution=merge-duplicates,return=minimal');
    await audit(s.site, s.email, 'Month approved (HO HR)', month + ' · ' + r.rows.length + ' people', { note: note });
    return ACT.monthList(s, { month: month });
  },
  async monthReopen(s, x) {
    if (s.role !== 'super') throw fail(403, 'Only the Super Admin opens an approved month again.', 'role');
    const month = monthOf(x.month), reason = R.str(x.reason, 200); if (reason.length < 3) throw fail(400, 'Reason: write why the month is opened again.', 'reason');
    const done = (await db('PATCH', 'hr_months?site=eq.' + enc(s.site) + '&month=eq.' + month + '&status=eq.approved', { status: 'reopened', reopened_by: s.email, reopened_at: new Date().toISOString(), reopen_reason: reason }, 'return=representation')) || [];
    if (!done.length) throw fail(400, 'This month is not approved.', 'notapproved');
    await audit(s.site, s.email, 'Approved month opened again', month, { reason: reason });
    return ACT.monthList(s, { month: month });
  },
  // the HO HR: every site of his sign-in, where its month stands
  async monthSites(s, x) {
    needOffice(s); await needHo(s); const month = monthOf(x.month || R.today().slice(0, 7)), from = month + '-01', to = M.lastDay(month);
    const sites = ((s.info && s.info.sites) || []).filter(v => v && v.code).slice(0, 60); if (!sites.some(v => v.code === s.site)) sites.unshift({ code: s.site, name: (s.info && s.info.siteName) || s.site });
    const codes = sites.map(v => enc(v.code)).join(',');
    const [emps, rows, aps] = await Promise.all([MUS.all('hr_employees?select=site,joined_on,left_on&site=in.(' + codes + ')'), MUS.all('hr_month_people?select=site,returned_at&month=eq.' + month + '&site=in.(' + codes + ')'), db('GET', 'hr_months?select=site,status,approved_by,approved_at&month=eq.' + month + '&site=in.(' + codes + ')')]);
    return { month: month, here: s.site, sites: sites.map(v => { const ap = (aps || []).find(a => a.site === v.code && a.status === 'approved');
      return { code: v.code, name: v.name, people: emps.filter(e => e.site === v.code && !(e.left_on && e.left_on < from) && !(e.joined_on && e.joined_on > to)).length,
        verified: rows.filter(r => r.site === v.code && !r.returned_at).length, returned: rows.filter(r => r.site === v.code && r.returned_at).length, approved: ap ? { by: ap.approved_by, at: ap.approved_at } : null }; }) };
  },
  /* who is HO HR – the Super Admin gives and takes it */
  async hoList(s) {
    if (s.role !== 'super') throw fail(403, 'Only the Super Admin sees and sets who is HO HR.', 'role');
    return { rows: ((await db('GET', 'hr_ho_hr?select=email,active,given_by,given_at,taken_by,taken_at&order=email')) || []) };
  },
  async hoSet(s, x) {
    if (s.role !== 'super') throw fail(403, 'Only the Super Admin gives or takes HO HR.', 'role');
    const email = mail(x.email), on = x.on === true; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) throw fail(400, 'E-mail: the e-mail the person signs in with.', 'email');
    const now = new Date().toISOString(), was = ((await db('GET', 'hr_ho_hr?select=email,active&email=eq.' + enc(email))) || [])[0];
    if (!was && !on) throw fail(400, 'This e-mail is not on the list.', 'notfound');
    if (!was) await db('POST', 'hr_ho_hr', [{ email: email, active: true, given_by: s.email, given_at: now }], 'return=minimal');
    else await db('PATCH', 'hr_ho_hr?email=eq.' + enc(email), on ? { active: true, given_by: s.email, given_at: now, taken_by: null, taken_at: null } : { active: false, taken_by: s.email, taken_at: now }, 'return=minimal');
    await audit(s.site, s.email, on ? 'HO HR given' : 'HO HR taken', email, null);
    return ACT.hoList(s);
  },
};
module.exports = { ACT, NOT_READY10, locked, needOpen, isHo };
