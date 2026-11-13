/* THE THINGS THAT WAIT FOR "VERIFY" AND "APPROVE" (api/hr.js sends them here) – step 13 (13-11-2026).
 * His decisions of 13-11-2026:
 *   · Every policy says who verifies and who approves ("authorization … kon verify krel kon approval krel"); the request takes
 *     that with it when it is asked, so a later change of the policy does not move a request that is already waiting.
 *   · OVERTIME and COMP-OFF are counted by themselves but count for nothing until they are approved; what they give (pay /
 *     leave / nothing) is what the person's policy says – nobody chooses it at the approval.
 *   · EXTRA LEAVE (and taking leave back, and the opening balance) is ASKED by the HR office of the site and approved by whom the
 *     leave policy says – by the HO HR when the person has no leave policy of the Rule Book.
 * An approval only ADDS rows: days to a balance (hr_leave_credits). Nothing is changed, nothing is deleted. */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const B = require('./rulebook');
const L = require('./leave');
const { isHo } = require('./act_month');
const { siteBook, bookOn, NOT_READY13 } = require('./act_rulebook');
const { setup, daysOf, all } = require('./act_muster');

const ready = e => { if (e && e.code === 'notinstalled') throw fail(400, NOT_READY13, 'notready'); throw e; };
const needOffice = s => { if (s.role === 'self') throw fail(403, 'This is for the HR office only.', 'role'); };
const needAsker = async s => { needOffice(s); if (s.role === 'super' || s.role === 'admin') return; if (await isHo(s)) return; throw fail(403, 'Only the HR Admin of the site, the HO HR or the Super Admin can ask this.', 'role'); };
const uuid = v => { const x = String(v || ''); if (!/^[0-9a-f-]{36}$/i.test(x)) throw fail(400, 'This employee was not found.', 'notfound'); return x; };
const monthOf = v => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v)) ? String(v) : R.today().slice(0, 7));
const lastDay = m => m + '-' + String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate()).padStart(2, '0');
const HO_ONLY = { verify: [], approve: [{ role: 'ho_hr' }] };      // no policy of the Rule Book: the HO HR approves
const EMPF = 'id,code,name,category,site,department_id,reports_to,status,joined_on,left_on';
// who this person is for a step: the Super Admin, the HO HR, the HR Admin of the site, the one the employee reports to
async function whoIs(s, emp) {
  const who = { email: s.email, roles: { super: s.role === 'super', site_hr: s.role === 'admin', ho_hr: s.role !== 'super' && await isHo(s) }, reports: false };
  if (emp && emp.reports_to) { const boss = ((await db('GET', 'hr_employees?select=email&id=eq.' + emp.reports_to)) || [])[0]; who.reports = !!boss && !!boss.email && String(boss.email).toLowerCase() === String(s.email).toLowerCase(); }
  return who;
}
async function makeAsk(s, row) {
  const a = row.auth && (row.auth.approve || []).length ? row.auth : HO_ONLY;
  return ((await db('POST', 'hr_asks', [Object.assign({}, row, { auth: a, stage: B.firstStage(a), asked_by: s.email })], 'return=representation').catch(e => { if (e && e.code === 'duplicate') throw fail(409, 'This was asked already.', 'duplicate'); return ready(e); })) || [])[0];
}
/* WHAT A MONTH HOLDS of overtime and comp-off for the people of this site – counted from the muster with each person's own
 * policy of the day; a day that was asked already says where it stands. Nothing is saved here. */
async function extras(site, month) {
  const from = month + '-01', to = lastDay(month), today = R.today(), cfg = await setup(site), book = cfg.book;
  if (!book || !book.ready) return { ready: false, rows: [] };
  const emps = await all('hr_employees?select=' + EMPF + '&site=eq.' + enc(site) + '&or=(status.neq.left,left_on.gte.' + from + ')&order=name');
  const [r, asks] = await Promise.all([daysOf(site, 'site=eq.' + enc(site), emps, from, to < today ? to : today, cfg), db('GET', 'hr_asks?select=id,employee_id,kind,day,status,stage&site=eq.' + enc(site) + '&kind=in.(overtime,compoff)&day=gte.' + from + '&day=lte.' + to + '&limit=20000').catch(ready)]);
  const had = {}; (asks || []).forEach(a => { if (a.status === 'pending' || a.status === 'approved' || !had[a.employee_id + a.kind + a.day]) had[a.employee_id + a.kind + a.day] = a; });
  const out = [];
  r.rows.forEach(w => w.days.forEach(d => {
    const co = bookOn(book, w.emp.id, 'compoff', d.day), ot = bookOn(book, w.emp.id, 'overtime', d.day);
    const cd = co ? B.compoffDays(co.body, d.code, d.hours, d.sh_hours) : 0, om = ot && ot.body.result !== 'none' && d.code !== 'WOP' && d.code !== 'HP' ? B.overtimeMin(ot.body, d.out, d.sh_end) : 0;
    const push = (kind, p, body) => { const a = had[w.emp.id + kind + d.day]; out.push({ employee_id: w.emp.id, code: w.emp.code, name: w.emp.name, category: w.emp.category, day: d.day, kind: kind, gives: p.body.result, body: body, auth: p.auth, ask_id: a ? a.id : null, status: a ? a.status : '', stage: a ? a.stage : '' }); };
    if (cd > 0) push('compoff', co, { days: cd, code: d.code, hours: d.hours, result: co.body.result });
    if (om > 0) push('overtime', ot, { minutes: om, result: ot.body.result, rate: ot.body.rate === undefined ? 1 : ot.body.rate, shift_hours: d.sh_hours, days: ot.body.result === 'leave' ? B.overtimeDays(om, d.sh_hours) : 0 });
  }));
  return { ready: true, rows: out };
}
/* what an approval adds. Only rows are added. */
async function effect(s, ask) {
  const b = ask.body || {};
  if (ask.kind === 'att_import') { await require('./act_import').apply(s, ask.site, b, ask.id); return; }      // a bulk correction: its days are entered now
  if (ask.kind === 'leave_credit') { await db('POST', 'hr_leave_credits', (b.rows || [{ employee_id: ask.employee_id, bucket: b.bucket, days: b.days, source: b.source, reason: b.reason }]).map(x => ({ employee_id: x.employee_id, site: ask.site, day: ask.day, bucket: x.bucket === 'comp' ? 'comp' : 'paid', days: x.days, source: x.source === 'opening' ? 'opening' : 'hr', reason: x.reason || b.reason || 'Added by the HR office', ask_id: ask.id, entered_by: s.email })), 'return=minimal'); return; }
  if (ask.kind === 'compoff' && b.result === 'leave' && b.days > 0) await db('POST', 'hr_leave_credits', [{ employee_id: ask.employee_id, site: ask.site, day: ask.day, bucket: 'comp', days: b.days, source: 'compoff', reason: 'Worked on a day off (' + ask.day.split('-').reverse().join('-') + ')', ask_id: ask.id, entered_by: s.email }], 'return=minimal');
  if (ask.kind === 'overtime' && b.result === 'leave' && b.days > 0) await db('POST', 'hr_leave_credits', [{ employee_id: ask.employee_id, site: ask.site, day: ask.day, bucket: 'comp', days: b.days, source: 'overtime', reason: 'Overtime ' + (Math.round(b.minutes / 6) / 10) + ' h on ' + ask.day.split('-').reverse().join('-'), ask_id: ask.id, entered_by: s.email }], 'return=minimal');
  // overtime / comp-off that gives PAY: the approved request itself is the record – payroll reads the approved ones of the month
}

const ACT = {
  /* what waits (or was decided) on this site, the newest first; can = this person may do the step it waits for */
  async askList(s, x) {
    needOffice(s); const st = ['pending', 'approved', 'refused', 'cancelled'].indexOf(x.status) > -1 ? x.status : 'pending';
    let rows; try { rows = (await db('GET', 'hr_asks?select=*&site=eq.' + enc(s.site) + '&status=eq.' + st + '&order=asked_at.desc&limit=500')) || []; } catch (e) { if (e && e.code === 'notinstalled') return { ready: false, note: NOT_READY13, rows: [] }; throw e; }
    const ids = [...new Set(rows.map(r => r.employee_id).filter(Boolean))], emp = {}; for (let i = 0; i < ids.length; i += 60) ((await db('GET', 'hr_employees?select=id,code,name,category,reports_to&id=in.(' + ids.slice(i, i + 60).join(',') + ')')) || []).forEach(e => { emp[e.id] = e; });
    const base = await whoIs(s, null), bossOf = {}; for (const r of rows) { const e = emp[r.employee_id]; if (e && e.reports_to && bossOf[e.reports_to] === undefined) bossOf[e.reports_to] = (await whoIs(s, e)).reports; }
    return { ready: true, status: st, rows: rows.map(r => { const e = emp[r.employee_id] || {}, who = Object.assign({}, base, { reports: !!(e.reports_to && bossOf[e.reports_to]) }); return { id: r.id, kind: r.kind, day: r.day, employee_id: r.employee_id, code: e.code || '', name: e.name || '', category: e.category || '', body: r.body && Array.isArray(r.body.rows) ? Object.assign({}, r.body, { rows: undefined }) : r.body, status: r.status, stage: r.stage, auth: r.auth, steps: r.steps, asked_by: r.asked_by, asked_at: r.asked_at, can: r.status === 'pending' && B.mayDo((r.auth || {})[r.stage] || [], who) }; }) };
  },
  // verify / approve / refuse. { id, ok, note }
  async askDecide(s, x) {
    needOffice(s); const id = Number(x.id); if (!Number.isInteger(id) || id <= 0) throw fail(400, 'This request was not found.', 'notfound');
    const ask = ((await db('GET', 'hr_asks?select=*&id=eq.' + id + '&site=eq.' + enc(s.site)).catch(ready)) || [])[0]; if (!ask) throw fail(404, 'This request was not found.', 'notfound');
    const emp = ask.employee_id ? ((await db('GET', 'hr_employees?select=' + EMPF + '&id=eq.' + ask.employee_id)) || [])[0] : null, who = Object.assign(await whoIs(s, emp), { note: x.note }), okNo = x.ok === true;
    if (!okNo && R.str(x.note, 200).length < 3) throw fail(400, 'Why it is refused: write the reason.', 'note');
    if (ask.asked_by && String(ask.asked_by).toLowerCase() === String(s.email).toLowerCase() && s.role !== 'super' && ask.kind === 'leave_credit' && ask.stage === 'approve') throw fail(403, 'The one who asked cannot approve it himself.', 'self');
    const d = B.decide(ask, okNo, who, new Date().toISOString()); if (d.error) throw fail(403, d.error, 'step');
    // only a request that still waits at this very step is moved (two people pressing at once: the second is told)
    const done = (await db('PATCH', 'hr_asks?id=eq.' + id + '&status=eq.pending&stage=eq.' + ask.stage, Object.assign({ status: d.status, stage: d.stage, steps: d.steps }, d.done ? { decided_at: new Date().toISOString() } : {}), 'return=representation')) || [];
    if (!done.length) throw fail(409, 'Somebody else decided this a moment ago – open the list again.', 'changed');
    if (d.status === 'approved') await effect(s, Object.assign({}, ask, d));
    await audit(s.site, s.email, 'ask ' + (d.status === 'approved' ? 'approved' : d.status === 'refused' ? 'refused' : 'verified'), ask.kind + ' #' + id, { day: ask.day, employee_id: ask.employee_id, note: R.str(x.note, 200) });
    return { status: d.status, stage: d.stage };
  },
  /* the month's overtime and comp-off as counted, each with where it stands */
  async extraFind(s, x) { needOffice(s); const m = monthOf(x.month), r = await extras(s.site, m); return Object.assign({ month: m, note: r.ready ? '' : NOT_READY13 }, r); },
  /* send some of them for approval. { month, rows: [{ employee_id, day, kind }] } – what each holds is counted again here */
  async extraAsk(s, x) {
    await needAsker(s); const m = monthOf(x.month), want = {}; (Array.isArray(x.rows) ? x.rows : []).slice(0, 500).forEach(r => { want[String(r.employee_id) + r.kind + r.day] = 1; });
    const found = (await extras(s.site, m)).rows.filter(r => want[r.employee_id + r.kind + r.day] && r.status !== 'pending' && r.status !== 'approved'); if (!found.length) throw fail(400, 'Nothing of what was ticked can be sent (it was sent already, or it is not there any more).', 'none');
    let n = 0; for (const r of found) { await makeAsk(s, { site: s.site, employee_id: r.employee_id, kind: r.kind, day: r.day, body: r.body, auth: r.auth }); n++; }
    await audit(s.site, s.email, 'overtime / comp-off sent for approval', m, { count: n }); return { sent: n };
  },
  /* days to add to (or take from) one person's balance – asked here, added when approved. { id, bucket, days, reason, day } */
  /* (his answer 31) THE OPENING BALANCE OF MANY PEOPLE AT ONCE: the HR office fills a sheet – Code, Paid leave, Comp-off. It is
   * looked at first (dry: what can be taken, what is refused and why – nothing is kept); then ONE request for the whole file.
   * When it is approved every balance gets its days ("opening balance"). A person who has an opening balance already – or one
   * that waits – is refused: no balance is put in twice. { rows: [{ code, paid, comp }], day, reason, file_name, dry } */
  async leaveOpening(s, x) {
    await needAsker(s); const why = R.str(x.reason, 200), day = R.date(x.day) || R.today(), list = Array.isArray(x.rows) ? x.rows : [];
    if (!list.length) throw fail(400, 'The sheet is empty: fill Code and the days.', 'rows'); if (list.length > 3000) throw fail(400, 'One file: at most 3000 rows.', 'rows'); if (day > R.today()) throw fail(400, 'As of: not a day to come.', 'day');
    const book = await siteBook(s.site); if (!book.ready) throw fail(400, NOT_READY13, 'notready');
    const by = {}; (await all('hr_employees?select=id,code,name,status&site=eq.' + enc(s.site) + '&order=code')).forEach(e => { by[String(e.code).toUpperCase()] = e; });
    const had = {}; (await all('hr_leave_credits?select=employee_id&site=eq.' + enc(s.site) + '&source=eq.opening&order=id').catch(ready)).forEach(c => { had[c.employee_id] = 'has an opening balance already'; });
    ((await db('GET', 'hr_asks?select=body&site=eq.' + enc(s.site) + '&kind=eq.leave_credit&status=eq.pending&limit=1000').catch(ready)) || []).forEach(a => { const b = a.body || {}; if (b.opening) (b.rows || []).forEach(r => { had[r.employee_id] = 'an opening balance for him waits for approval'; }); });
    const days = v => { const t = String(v === undefined || v === null ? '' : v).trim(); if (!t) return 0; const n = Number(t); return Number.isFinite(n) && n >= 0 && n <= 366 && Math.round(n * 2) === n * 2 ? n : NaN; };
    const take = [], refused = [], seen = {}; let skipped = 0;
    list.forEach(r => {
      const code = R.str(r && r.code, 20).toUpperCase(); if (!code) { skipped++; return; } const e = by[code], paid = days(r.paid), comp = days(r.comp), no = t => refused.push({ code: code, name: e ? e.name : '', why: t });
      if (!e) return no('this code is not on this site'); if (seen[code]) return no('this code is in the file twice'); seen[code] = 1;
      if (e.status === 'left') return no('he has left'); if (Number.isNaN(paid) || Number.isNaN(comp)) return no('days: a number of days or half days, 0 to 366');
      if (!paid && !comp) { skipped++; return; } if (had[e.id]) return no(had[e.id]);
      take.push({ employee_id: e.id, code: e.code, name: e.name, paid: paid, comp: comp });
    });
    const sum = k => Math.round(take.reduce((a, r) => a + r[k], 0) * 10) / 10, out = { day: day, people: take.length, paid: sum('paid'), comp: sum('comp'), take: take.slice(0, 500), refused: refused.slice(0, 500), refusedCount: refused.length, skipped: skipped };
    if (x.dry === true) return Object.assign({ dry: true }, out);
    if (why.length < 3) throw fail(400, 'Reason: write why (for the whole file).', 'reason'); if (!take.length) throw fail(400, 'Nothing in this file can be taken.', 'rows');
    const rows = []; take.forEach(r => { if (r.paid) rows.push({ employee_id: r.employee_id, bucket: 'paid', days: r.paid, source: 'opening', reason: 'Opening balance' }); if (r.comp) rows.push({ employee_id: r.employee_id, bucket: 'comp', days: r.comp, source: 'opening', reason: 'Opening balance' }); });
    const p = bookOn(book, '', 'leave', R.today());      // who verifies / approves: the site's own leave policy says it (none: the HO HR)
    const a = await makeAsk(s, { site: s.site, employee_id: null, kind: 'leave_credit', day: day, body: { opening: true, reason: why, file: R.str(x.file_name, 120), people: take.length, paid: out.paid, comp: out.comp, rows: rows }, auth: p ? p.auth : HO_ONLY });
    await audit(s.site, s.email, 'opening leave balances asked', take.length + ' people', { paid: out.paid, comp: out.comp, reason: why, ask: a.id });
    return Object.assign({ id: a.id, stage: a.stage, waits: true }, out);
  },
  async leaveCreditAsk(s, x) {
    await needAsker(s); const id = uuid(x.id), bucket = x.bucket === 'comp' ? 'comp' : 'paid', days = Number(x.days), why = R.str(x.reason, 200), day = R.date(x.day) || R.today();
    if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 366 || Math.round(days * 2) !== days * 2) throw fail(400, 'Days: a number of days or half days (a minus takes them away).', 'days'); if (why.length < 3) throw fail(400, 'Reason: write why.', 'reason'); if (day > R.today()) throw fail(400, 'Day: not in the future.', 'day');
    const emp = ((await db('GET', 'hr_employees?select=' + EMPF + '&id=eq.' + id + '&site=eq.' + enc(s.site))) || [])[0]; if (!emp) throw fail(404, 'This employee was not found on this site.', 'notfound');
    const book = await siteBook(s.site, 'employee_id=eq.' + id); if (!book.ready) throw fail(400, NOT_READY13, 'notready'); const p = bookOn(book, id, 'leave', R.today());
    const a = await makeAsk(s, { site: s.site, employee_id: id, kind: 'leave_credit', day: day, body: { bucket: bucket, days: days, source: x.opening === true ? 'opening' : 'hr', reason: why }, auth: p ? p.auth : HO_ONLY });
    await audit(s.site, s.email, 'leave days asked', emp.code, { bucket: bucket, days: days, reason: why }); return { id: a.id, stage: a.stage };
  },
  /* one person's two balances and his ledger – every line says where the days came from */
  async leaveLedger(s, x) {
    needOffice(s); const id = uuid(x.id), emp = ((await db('GET', 'hr_employees?select=' + EMPF + '&id=eq.' + id + '&site=eq.' + enc(s.site))) || [])[0]; if (!emp) throw fail(404, 'This employee was not found on this site.', 'notfound');
    const st = await require('./act_leave').state(s.site, 'employee_id=eq.' + id, [emp]), me = st.by[id] || {};
    return { book: !!st.book, paid: me.balance || 0, comp: me.comp || 0, booked: me.booked || 0, pending: me.pending || 0, ledger: (me.ledger || []).slice().reverse(), absent: me.absent || {} };
  },
};
module.exports = { ACT, extras, whoIs, L };
