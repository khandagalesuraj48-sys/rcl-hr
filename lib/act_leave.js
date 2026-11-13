/* THE ACTIONS OF LEAVE (api/hr.js sends them here) – step 7 (12-11-2026).
 *   A person for himself: his balance and requests (myLeave), a request (leaveAsk), taking a waiting one back (leaveCancel); the
 *   requests of the people who report to him (teamLeaves, teamLeaveDecide).
 *   The HR office: the requests (leaveList, leaveDecide), everybody's balance (leaveBalances), adding to / taking from one
 *   balance with the reason (leaveAdjust), the site's policy with its date (leavePolicy, leavePolicySave).
 * How a balance is counted: lib/leave.js – never a stored number. Nothing is deleted or changed afterwards: a policy and an
 * adjustment are only added; a request only moves on (pending → approved / refused / cancelled) with who and when.
 * In the muster a day covered by leave reads "L" (apply). */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const D = require('./day');
const L = require('./leave');
const power = require('./powers');
const { me, needOffice } = require('./act_attend');
const { setup, daysOf, chunks } = require('./act_muster');

const NOT_READY7 = 'Leave is not set up yet: the Super Admin runs sql/hr_step7_leave.sql once in the rcl-hr Supabase → SQL Editor.';
const REQ = 'id,employee_id,site,from_day,to_day,part,days,reason,status,level,steps,asked_by,asked_at,decided_at';
const EMPF = 'id,code,name,category,site,department_id,reports_to,status,joined_on,left_on';
const PARTS = ['full', 'first', 'second'];
const policies = async site => (await db('GET', 'hr_leave_policy?select=id,valid_from,per_month,carry,auto_absent,levels,created_by,created_at&site=eq.' + enc(site) + '&order=valid_from,id&limit=500')) || [];
const free = (cfg, hol, day) => { const rl = D.validOn(cfg.rules, day); return !!hol[day] || ((rl && rl.rules.week_off) || []).indexOf(D.weekday(day)) > -1; };
const eachDay = (a, b, fn) => { for (let d = a, i = 0; d <= b && i < 400; d = D.addDays(d, 1), i++) fn(d); };

/* THE LEAVE OF SOME EMPLOYEES OF ONE SITE, counted up to today.   where: 'site=eq.X' or 'employee_id=eq.X'
 * → { policy (the one of today, or null), by: { empId: { balance, booked, pending, month: { credit, added, used }, marks, future } } }
 *   balance – as of today;  booked – approved leave days still to come;  pending – days asked and not decided yet. */
async function state(site, where, emps) {
  const today = R.today(), pol = await policies(site), v = L.versions(pol), by = {}, blank = () => ({ balance: 0, booked: 0, pending: 0, month: { credit: 0, added: 0, used: 0 }, marks: {}, future: {} });
  emps.forEach(e => { by[e.id] = blank(); });
  if (!emps.length) return { policy: v.on(today), by: by, today: today };
  /* (step 13) THE RULE BOOK: when this site (or one of these people) has a leave policy of the Rule Book, or days were added to
   * a balance there, the leave is walked the new way (two balances, a ledger – stateBook below). Otherwise: exactly as before. */
  const cfg0 = await setup(site), bk = cfg0.book && cfg0.book.used ? cfg0.book : null;
  if (bk) { const lv = (bk.defaults.leave || []).length > 0 || emps.some(e => (((bk.assign[e.id] || {}).leave) || []).length > 0); let cr = []; try { cr = (await db('GET', 'hr_leave_credits?select=employee_id,day,bucket,days,source,reason&' + where + '&order=day,id&limit=20000')) || []; } catch (e) { if (!e || e.code !== 'notinstalled') throw e; }
    if (lv || cr.length) return stateBook(site, where, emps, { today: today, pol: pol, v: v, by: by, cfg: cfg0, bk: bk, credits: cr }); }
  if (!pol.length) return { policy: v.on(today), by: by, today: today };
  const cfg = cfg0, from = pol[0].valid_from <= today ? pol[0].valid_from : today, hol = {}; cfg.holidays.forEach(h => { hol[h.day] = 1; });
  const [r, adj, req] = await Promise.all([daysOf(site, where, emps, from, today, cfg),
    db('GET', 'hr_leave_adjust?select=employee_id,day,days&' + where + '&limit=20000'),
    db('GET', 'hr_leave_requests?select=employee_id,from_day,to_day,part,days,status&' + where + '&status=in.(approved,pending)&to_day=gte.' + from + '&limit=20000')]);
  const A = {}, LV = {}; (adj || []).forEach(a => { const o = (A[a.employee_id] = A[a.employee_id] || {}), d = a.day < from ? from : a.day > today ? today : a.day; o[d] = (o[d] || 0) + +a.days; });
  (req || []).forEach(q => {
    const s = by[q.employee_id]; if (!s) return;
    if (q.status === 'pending') { s.pending = L.r1(s.pending + +q.days); return; }
    eachDay(q.from_day, q.to_day, d => { const n = q.part === 'full' ? 1 : 0.5; if (d <= today) (LV[q.employee_id] = LV[q.employee_id] || {})[d] = n; else if (!free(cfg, hol, d)) { s.future[d] = n; s.booked = L.r1(s.booked + n); } });
  });
  r.rows.forEach(w => {
    const e = w.emp, first = e.joined_on && e.joined_on > from ? e.joined_on : from, k = L.walk(w.days.map(d => ({ day: d.day, code: d.code })), { policies: pol, first: first, adjust: A[e.id], leave: LV[e.id] });
    Object.assign(by[e.id], { balance: k.balance, marks: k.marks, month: k.months[today.slice(0, 7)] || { credit: 0, added: 0, used: 0 } });
  });
  return { policy: v.on(today), by: by, today: today };
}
/* (step 13) the same answer as state(), walked with the Rule Book: by[emp] also has comp (the Comp-off balance), ledger and
 * absent ({ day: 'none' | 'refused' | 'nobalance' }). A day with no Rule Book policy for the person keeps the site's policy of
 * before (as it counted before – a leave is taken as asked). */
async function stateBook(site, where, emps, x) {
  const { today, pol, v, by, cfg, bk } = x, hol = {}; cfg.holidays.forEach(h => { hol[h.day] = 1; });
  const firsts = [pol.length ? pol[0].valid_from : ''].concat((bk.defaults.leave || []).map(r => r.valid_from)); emps.forEach(e => (((bk.assign[e.id] || {}).leave) || []).forEach(r => firsts.push(r.valid_from))); x.credits.forEach(c => firsts.push(c.day));
  const f0 = firsts.filter(Boolean).sort()[0] || today, from = (f0 <= today ? f0 : today).slice(0, 8) + '01';
  const [r, adj, req] = await Promise.all([daysOf(site, where, emps, from, today, cfg), db('GET', 'hr_leave_adjust?select=employee_id,day,days,reason&' + where + '&limit=20000'),
    db('GET', 'hr_leave_requests?select=employee_id,from_day,to_day,part,days,status,bucket&' + where + '&status=in.(approved,pending,refused)&to_day=gte.' + from + '&limit=20000')]);
  const CR = {}, LV = {}, RF = {}, put = (emp, day, row) => { const o = (CR[emp] = CR[emp] || {}), d = day < from ? from : day > today ? today : day; (o[d] = o[d] || []).push(row); };
  (adj || []).forEach(a => put(a.employee_id, a.day, { bucket: 'paid', days: +a.days, source: 'hr', reason: a.reason || 'Added by the HR office' })); x.credits.forEach(c => put(c.employee_id, c.day, { bucket: c.bucket, days: +c.days, source: c.source, reason: c.reason }));
  (req || []).forEach(q => {
    const s = by[q.employee_id]; if (!s) return;
    if (q.status === 'pending') { s.pending = L.r1(s.pending + +q.days); return; }
    if (q.status === 'refused') { eachDay(q.from_day, q.to_day, d => { (RF[q.employee_id] = RF[q.employee_id] || {})[d] = true; }); return; }
    eachDay(q.from_day, q.to_day, d => { const n = q.part === 'full' ? 1 : 0.5; if (d <= today) (LV[q.employee_id] = LV[q.employee_id] || {})[d] = { days: n }; else if (!free(cfg, hol, d)) { s.future[d] = n; s.booked = L.r1(s.booked + n); } });
  });
  const B = require('./rulebook');
  r.rows.forEach(w => {
    const e = w.emp, first = e.joined_on && e.joined_on > from ? e.joined_on : from;
    const polOn = day => { const p = B.policyOn({ assign: ((bk.assign[e.id] || {}).leave) || [], defaults: bk.defaults.leave || [], versions: bk.versions }, day); if (p) return Object.assign({ strict: true }, p.body); const o = v.on(day); return o ? { earn: 'month', per_month: +o.per_month, carry: o.carry, auto_absent: o.auto_absent, strict: false } : null; };
    const k = L.walk2(w.days.map(d => ({ day: d.day, code: d.code })), { polOn: polOn, first: first, credits: CR[e.id], leave: LV[e.id], refused: RF[e.id] });
    Object.assign(by[e.id], { balance: k.paid, comp: k.comp, marks: k.marks, month: k.months[today.slice(0, 7)] || { credit: 0, added: 0, used: 0 }, ledger: k.ledger, absent: k.absent });
  });
  return { policy: v.on(today), by: by, today: today, book: true };
}
/* THE MUSTER'S "L": the days of a month (act_muster's rows, each { emp, days, total }) get code L where leave covers them –
 * an approved leave day, or an absent day the balance paid for – and the count of the month follows (L, and the days for pay). */
async function apply(site, where, emps, r, cfg) {
  let st; try { st = await state(site, where, emps); } catch (e) { if (e && e.code === 'notinstalled') return r; throw e; }
  if (!st.policy && !st.book && !Object.keys(st.by).some(k => Object.keys(st.by[k].future).length)) { r.rows.forEach(w => { w.total.L = 0; }); return r; }
  const last = r.days[r.days.length - 1], rl = D.validOn(cfg.rules, last);
  r.rows.forEach(w => {
    const s = st.by[w.emp.id] || { marks: {}, future: {} }; let n = 0, paid = 0;
    w.days.forEach(d => { if (s.absent && s.absent[d.day]) d.absent = s.absent[d.day];      // (step 13) absent with no request / despite a refusal / the balance had no more
      const m = s.marks[d.day] || (s.future[d.day] ? { days: s.future[d.day], auto: false } : null); if (!m) return; paid += m.days; d.leave = m.days; if (m.days >= 1 || d.code === 'A' || d.code === '') { d.code = 'L'; n++; } });
    w.total = D.total(w.days, rl ? rl.rules : {}); w.total.L = n; w.total.paid = L.r1(w.total.paid + paid);
  });
  return r;
}
const names = async list => { const ids = [...new Set(list.map(q => q.employee_id))], by = {}; for (const c of chunks(ids, 80)) ((await db('GET', 'hr_employees?select=id,code,name&id=in.(' + c.join(',') + ')')) || []).forEach(e => { by[e.id] = e; }); return by; };
async function rows(list) {
  const by = await names(list);
  return list.map(q => { const last = (q.steps || [])[(q.steps || []).length - 1] || null; return { id: q.id, code: (by[q.employee_id] || {}).code, name: (by[q.employee_id] || {}).name, from: q.from_day, to: q.to_day, part: q.part, days: +q.days, reason: q.reason, status: q.status, level: q.level, steps: q.steps || [], note: last ? last.note || '' : '', asked_at: q.asked_at }; });
}
const full = async id => ((await db('GET', 'hr_employees?select=' + EMPF + '&id=eq.' + id)) || [])[0];
const empOf = async (s, id) => { const e = ((await db('GET', 'hr_employees?select=' + EMPF + '&id=eq.' + id + '&site=eq.' + enc(s.site))) || [])[0]; if (!e) throw fail(404, 'This employee was not found on this site.', 'notfound'); return e; };
const polOut = p => (p ? { valid_from: p.valid_from, per_month: +p.per_month, carry: p.carry, auto_absent: p.auto_absent, levels: p.levels } : null);

/* (step 13) the person's LEAVE POLICY OF THE RULE BOOK today, or null (then everything here is decided as before).
 * With it: who verifies and who approves a leave is what the policy says (level 1 = "verify", level 2 = "approve"). */
async function bookPolicy(emp) {
  const BK = require('./act_rulebook'); let book; try { book = await BK.siteBook(emp.site, 'employee_id=eq.' + emp.id); } catch (e) { return null; }
  return BK.bookOn(book, emp.id, 'leave', R.today());
}
const mayStep = async (s, emp, p, level) => require('./rulebook').mayDo((p.auth || {})[level === 1 ? 'verify' : 'approve'] || [], await require('./act_asks').whoIs(s, emp));

const ACT = {
  /* ───────────── a person, for himself ───────────── */
  async myLeave(s) {
    const emp = await me(s); Object.assign(emp, await full(emp.id)); const st = await state(emp.site, 'employee_id=eq.' + emp.id, [emp]), b = st.by[emp.id];
    const list = (await db('GET', 'hr_leave_requests?select=' + REQ + '&employee_id=eq.' + emp.id + '&order=id.desc&limit=50')) || [];
    const comp = b.comp || 0, all = L.r1(b.balance + comp);      // (step 13) one leave for the person: the Paid leave and the Comp-off days together
    return { today: st.today, employee: { code: emp.code, name: emp.name }, policy: polOut(st.policy), book: !!st.book, balance: all, paid: b.balance, comp: comp, booked: b.booked, pending: b.pending, available: L.r1(all - b.booked - b.pending), month: b.month,
      ledger: st.book ? (b.ledger || []).slice(-40).reverse() : [], requests: await rows(list) };
  },
  // a request: from – to (whole days), or one day's first / second half. Weekly offs and holidays inside are not counted.
  async leaveAsk(s, x) {
    const emp = await me(s); Object.assign(emp, await full(emp.id)); const today = R.today(), from = R.date(x.from), to = R.date(x.to) || from, part = PARTS.indexOf(x.part) > -1 ? x.part : 'full', why = R.str(x.reason, 200);
    if (!from || !to) throw fail(400, 'From and To: dates as DD-MM-YYYY.', 'day'); if (to < from) throw fail(400, 'To: it is before From.', 'day');
    if (from < today) throw fail(400, 'Leave is asked for today or a day to come – a day gone is set right with a request.', 'day');
    if (to > D.addDays(from, 61)) throw fail(400, 'One request: at most 62 days.', 'day'); if (from > D.addDays(today, 366)) throw fail(400, 'Leave can be asked at most a year ahead.', 'day');
    if (part !== 'full' && from !== to) throw fail(400, 'A half day is for one day: From and To the same.', 'part');
    if (why.length < 3) throw fail(400, 'Reason: write why (at least 3 letters).', 'reason');
    const st = await state(emp.site, 'employee_id=eq.' + emp.id, [emp]); if (!st.policy && !st.book) throw fail(400, 'No leave policy is set for your site yet – ask the HR office.', 'nopolicy');
    const cfg = await setup(emp.site), hol = {}; cfg.holidays.forEach(h => { hol[h.day] = 1; }); let n = 0; eachDay(from, to, d => { if (!free(cfg, hol, d)) n++; });
    if (!n) throw fail(400, 'These days are a weekly off or a holiday – no leave is needed.', 'free'); const days = part === 'full' ? n : 0.5;
    const over = (await db('GET', 'hr_leave_requests?select=id&employee_id=eq.' + emp.id + '&status=in.(pending,approved)&from_day=lte.' + to + '&to_day=gte.' + from + '&limit=1')) || [];
    if (over.length) throw fail(409, 'A leave request for these days is already there.', 'duplicate');
    /* (step 13, his rule: "leave balance jitka aahe titkech days add hotil bakich absent") with a leave policy of the Rule Book a
     * request may be longer than the balance – the days the balance has are leave, the others stay absent. Before: refused. */
    const bp = st.book ? await bookPolicy(emp) : null, b = st.by[emp.id], avail = L.r1(b.balance + (b.comp || 0) - b.booked - b.pending); if (!bp && days > avail) throw fail(400, 'Not enough leave: you ask ' + days + ', the balance is ' + avail + '.', 'balance');
    let level = 2; if (bp) level = ((bp.auth || {}).verify || []).length ? 1 : 2; else if (st.policy && st.policy.levels === 2 && emp.reports_to && ((await db('GET', 'hr_employees?select=id&id=eq.' + emp.reports_to + '&status=neq.left')) || []).length) level = 1;
    await db('POST', 'hr_leave_requests', [{ employee_id: emp.id, site: emp.site, from_day: from, to_day: to, part: part, days: days, reason: why, level: level, asked_by: s.email }], 'return=minimal');
    await audit(emp.site, s.email, 'Leave asked', emp.code + ' ' + from + (to !== from ? ' – ' + to : ''), { days: days, part: part, level: level });
    return ACT.myLeave(s);
  },
  async leaveCancel(s, x) {
    const emp = await me(s), done = (await db('PATCH', 'hr_leave_requests?id=eq.' + (parseInt(x.id, 10) || 0) + '&employee_id=eq.' + emp.id + '&status=eq.pending', { status: 'cancelled', decided_at: new Date().toISOString() }, 'return=representation')) || [];
    if (!done.length) throw fail(409, 'Only a request that still waits can be taken back.', 'decided');
    await audit(done[0].site, s.email, 'Leave request taken back', emp.code + ' ' + done[0].from_day, { request: done[0].id });
    return ACT.myLeave(s);
  },
  // the leave requests of the people who report to me (the first level)
  async teamLeaves(s) {
    const emp = await me(s), team = ((await db('GET', 'hr_employees?select=id&reports_to=eq.' + emp.id + '&status=neq.left&limit=500')) || []).map(e => e.id), list = [];
    for (const c of chunks(team, 80)) ((await db('GET', 'hr_leave_requests?select=' + REQ + '&status=eq.pending&level=eq.1&employee_id=in.(' + c.join(',') + ')&order=asked_at')) || []).forEach(q => list.push(q));
    return { team: team.length, rows: await rows(list) };
  },
  async teamLeaveDecide(s, x) {
    const boss = await me(s), q = ((await db('GET', 'hr_leave_requests?select=' + REQ + '&id=eq.' + (parseInt(x.id, 10) || 0))) || [])[0]; if (!q) throw fail(404, 'This request was not found.', 'notfound');
    const emp = await full(q.employee_id); if (!emp || emp.reports_to !== boss.id) throw fail(403, 'This person does not report to you.', 'team');
    const bp0 = await bookPolicy(emp); if (bp0 && !(await mayStep(s, emp, bp0, 1))) throw fail(403, 'By his leave policy this request is verified by somebody else.', 'step');      // (step 13)
    if (q.status !== 'pending' || q.level !== 1) throw fail(409, 'This request does not wait for you any more.', 'decided');
    const dec = x.decision === 'approved' || x.decision === 'refused' ? x.decision : '', note = R.str(x.note, 200); if (!dec) throw fail(400, 'Decision: approve or refuse.', 'decision');
    if (dec === 'refused' && note.length < 3) throw fail(400, 'Reason: write why it is refused.', 'note');
    const step = { level: 1, by: s.email, decision: dec, note: note, at: new Date().toISOString() };
    const done = (await db('PATCH', 'hr_leave_requests?id=eq.' + q.id + '&status=eq.pending&level=eq.1', dec === 'approved' ? { level: 2, steps: (q.steps || []).concat([step]) } : { status: 'refused', steps: (q.steps || []).concat([step]), decided_at: step.at }, 'return=representation')) || [];
    if (!done.length) throw fail(409, 'This request does not wait for you any more.', 'decided');
    await audit(q.site, s.email, dec === 'approved' ? 'Leave passed to the HR office' : 'Leave refused', emp.code + ' ' + q.from_day, { request: q.id, note: note });
    return ACT.teamLeaves(s);
  },

  /* ───────────── the HR office ───────────── */
  async leaveList(s, x) {
    needOffice(s); const st = ['pending', 'approved', 'refused', 'cancelled'].indexOf(x.status) > -1 ? x.status : 'pending';
    const list = (await db('GET', 'hr_leave_requests?select=' + REQ + '&site=eq.' + enc(s.site) + '&status=eq.' + st + '&order=asked_at.desc&limit=300')) || [];
    const out = await rows(list);
    // (step 13) a request of a person with a leave policy of the Rule Book: "can" = this person may do the step it waits for
    if (st === 'pending' && list.length) { const BK = require('./act_rulebook'); let book = null; try { book = await BK.siteBook(s.site); } catch (e) { book = null; }
      if (book && book.ready && book.used !== false && (Object.keys(book.defaults).length || Object.keys(book.assign).length)) for (let i = 0; i < list.length; i++) { const p = BK.bookOn(book, list[i].employee_id, 'leave', R.today()); if (p) { const emp = await full(list[i].employee_id); out[i].can = await mayStep(s, emp, p, list[i].level); out[i].stage = list[i].level === 1 ? 'verify' : 'approve'; } } }
    return { status: st, rows: out, can: s.role === 'super' || (s.role === 'admin' && (await power.of(s.site)).regularize) };
  },
  async leaveDecide(s, x) {
    needOffice(s); const q = ((await db('GET', 'hr_leave_requests?select=' + REQ + '&id=eq.' + (parseInt(x.id, 10) || 0) + '&site=eq.' + enc(s.site))) || [])[0]; if (!q) throw fail(404, 'This request was not found on this site.', 'notfound');
    if (q.status !== 'pending') throw fail(409, 'This request was already decided.', 'decided');
    /* (step 13) with a leave policy of the Rule Book the policy says who does this step; "verify" passes it on to "approve" */
    const emp0 = await empOf(s, q.employee_id), bp = await bookPolicy(emp0);
    if (bp) {
      if (!(await mayStep(s, emp0, bp, q.level))) throw fail(403, q.level === 1 ? 'By his leave policy this request is verified by somebody else.' : 'By his leave policy this request is approved by somebody else.', 'step');
      if (q.level === 1 && x.decision === 'approved') {
        const st1 = { level: 1, by: s.email, decision: 'approved', note: R.str(x.note, 200), at: new Date().toISOString() };
        const moved = (await db('PATCH', 'hr_leave_requests?id=eq.' + q.id + '&status=eq.pending&level=eq.1', { level: 2, steps: (q.steps || []).concat([st1]) }, 'return=representation')) || []; if (!moved.length) throw fail(409, 'This request was already decided.', 'decided');
        await audit(s.site, s.email, 'Leave verified', emp0.code + ' ' + q.from_day, { request: q.id }); return ACT.leaveList(s, { status: 'pending' });
      }
    } else { await power.need(s, 'regularize'); if (q.level === 1 && s.role !== 'super') throw fail(403, 'This request still waits for the reporting person.', 'level'); }
    await require('./act_month').needOpen(s.site, q.from_day);      // (step 10) a month the HO HR approved is closed
    const dec = x.decision === 'approved' || x.decision === 'refused' ? x.decision : '', note = R.str(x.note, 200); if (!dec) throw fail(400, 'Decision: approve or refuse.', 'decision');
    if (dec === 'refused' && note.length < 3) throw fail(400, 'Reason: write why it is refused.', 'note');
    const step = { level: q.level === 1 ? 1 : 2, by: s.email, decision: dec, note: note, at: new Date().toISOString() }, emp = emp0;
    const done = (await db('PATCH', 'hr_leave_requests?id=eq.' + q.id + '&status=eq.pending', { status: dec, steps: (q.steps || []).concat([step]), decided_at: step.at }, 'return=representation')) || [];
    if (!done.length) throw fail(409, 'This request was already decided.', 'decided');
    await audit(s.site, s.email, dec === 'approved' ? 'Leave approved' : 'Leave refused', emp.code + ' ' + q.from_day + (q.to_day !== q.from_day ? ' – ' + q.to_day : ''), { request: q.id, days: +q.days, note: note });
    return ACT.leaveList(s, { status: 'pending' });
  },
  // everybody's leave on this site, as of today
  async leaveBalances(s) {
    needOffice(s); const emps = (await db('GET', 'hr_employees?select=' + EMPF + '&site=eq.' + enc(s.site) + '&status=neq.left&order=name,id&limit=5000')) || [];
    const st = await state(s.site, 'site=eq.' + enc(s.site), emps);
    return { today: st.today, policy: polOut(st.policy), can: s.role === 'super' || (s.role === 'admin' && (await power.of(s.site)).regularize),
      rows: emps.map(e => { const b = st.by[e.id]; return { id: e.id, code: e.code, name: e.name, category: e.category, balance: b.balance, comp: b.comp || 0, booked: b.booked, pending: b.pending, credit: b.month.credit, added: b.month.added, used: b.month.used }; }) };
  },
  // the HR office adds to (or takes from) one employee's balance – a new row with the reason; the balance itself is never typed
  async leaveAdjust(s, x) {
    await power.need(s, 'regularize'); const emp = await empOf(s, String(x.id || '')), why = R.str(x.reason, 200), n = Number(String(x.days === undefined || x.days === null ? '' : x.days).trim());
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 366 || Math.round(n * 2) !== n * 2) throw fail(400, 'Days: a number (halves allowed), + to add, − to take – not 0.', 'days');
    if (why.length < 3) throw fail(400, 'Reason: write why (at least 3 letters).', 'reason');
    if (!(await policies(s.site)).length) throw fail(400, 'Set the leave policy of this site first.', 'nopolicy');
    await db('POST', 'hr_leave_adjust', [{ employee_id: emp.id, site: s.site, day: R.today(), days: n, reason: why, entered_by: s.email }], 'return=minimal');
    await audit(s.site, s.email, n > 0 ? 'Leave added' : 'Leave taken off', emp.code + ' ' + emp.name, { days: n, reason: why });
    return ACT.leaveBalances(s);
  },
  async leavePolicy(s) { needOffice(s); const pol = await policies(s.site), now = L.versions(pol).on(R.today()); return { today: R.today(), policy: polOut(now), versions: pol.slice().reverse().map(p => Object.assign(polOut(p), { by: p.created_by, at: p.created_at })), can: s.role === 'super' || (s.role === 'admin' && (await power.of(s.site)).shifts) }; },
  async leavePolicySave(s, x) {
    await power.need(s, 'shifts'); const c = L.policy(x), today = R.today(), from = R.date(x.valid_from) || today; if (c.errors.length) throw fail(400, c.errors.join(' '), 'policy');
    if (from < today && s.role !== 'super') throw fail(403, 'A policy for days already gone can be set only by the Super Admin.', 'past');
    const was = L.versions(await policies(s.site)).on(from);
    await db('POST', 'hr_leave_policy', [Object.assign({ site: s.site, valid_from: from, created_by: s.email }, c.row)], 'return=minimal');
    await audit(s.site, s.email, 'Leave policy set', 'from ' + from, { old: polOut(was), new: c.row });
    return ACT.leavePolicy(s);
  },
};
const SELF = ['myLeave', 'leaveAsk', 'leaveCancel', 'teamLeaves', 'teamLeaveDecide'];
module.exports = { ACT, SELF, NOT_READY7, state, apply };
