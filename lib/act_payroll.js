/* PAYROLL – the month's pay of a site, made by the HO HR (step 12 – asked 12-11-2026: "HO HR … SALARY CALCULATE KRU SHAKEL JYAT PT PF
 * DEDUCTION SALARY ADVANCE HE SAGLE HO WARUN KARTA YEIL").
 *   Only the HO HR and the Super Admin. A site's month can be paid only after the HO HR APPROVED its attendance (step 10): the pay
 *   is made from the counts verified then and from each person's approved salary (step 11) of the month's last day.
 *   Before the lock the sheet is counted fresh every time it is opened; the HO HR ticks for whom PF / ESIC / Profession Tax is
 *   deducted, adds another earning or deduction with its note, sets the advance of the month.
 *   LOCK: the run, every payslip and what was taken back of the advances are written in one piece (hr_pay_lock). A locked month is
 *   never counted again and never changed – a mistake is set right in the next month (another earning / deduction).
 *   A person sees his own payslips of locked months (the app's "Salary slips"). */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const M = require('./month');
const P = require('./pay');
const { needOffice, me } = require('./act_attend');
const { isHo } = require('./act_month');
const { current, amountOf } = require('./act_pay');
const MUS = require('./act_muster');

const NOT_READY12 = 'Payroll is not set up yet: the Super Admin runs sql/hr_step12_payroll.sql once in the rcl-hr Supabase → SQL Editor.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uid = v => { v = String(v || '').toLowerCase(); return UUID.test(v) ? v : ''; };
async function needHo(s) { needOffice(s); if (!(await isHo(s))) throw fail(403, 'Payroll is only for the HO HR and the Super Admin.', 'role'); }
const monthOf = v => { if (!M.monthOk(v)) throw fail(400, 'Month: as YYYY-MM.', 'month'); return String(v); };
const inList = async (path, ids) => { const out = []; for (const c of MUS.chunks(ids, 80)) ((await db('GET', path + '=in.(' + c.join(',') + ')')) || []).forEach(r => out.push(r)); return out; };
// the settings valid on a day (the newest version that began by then)
async function settingsOn(day) { const r = ((await db('GET', 'hr_pay_settings?select=id,valid_from,settings,created_by,created_at&valid_from=lte.' + day + '&order=valid_from.desc,id.desc&limit=1')) || [])[0]; return r || null; }
const empRow = async (s, empId) => { const e = uid(empId) ? ((await db('GET', 'hr_employees?select=id,code,name,site,status&id=eq.' + uid(empId) + '&site=eq.' + enc(s.site))) || [])[0] : null; if (!e) throw fail(404, 'This employee was not found on this site.', 'notfound'); return e; };
const advOut = a => ({ id: a.id, amount: +a.amount, monthly: +a.monthly, recovered: +a.recovered, left: P.r2(+a.amount - +a.recovered), given_on: a.given_on, note: a.note, status: a.status, by: a.created_by, close_reason: a.close_reason || '' });

/* the pay sheet of a site's month as it stands now (not locked): everybody verified in that month */
async function sheet(site, month) {
  const last = M.lastDay(month), days = +last.slice(8);
  const people = (await MUS.all('hr_month_people?select=employee_id,counts&site=eq.' + enc(site) + '&month=eq.' + month + '&returned_at=is.null')) || [], ids = people.map(p => p.employee_id);
  const [emps, sal, flags, adj, adv, set] = await Promise.all([inList('hr_employees?select=id,code,name,category&id', ids), inList('hr_salaries?select=id,employee_id,pay_type,amount,valid_from,status&status=eq.approved&employee_id', ids),
    inList('hr_pay_emp?select=employee_id,pf,esic,pt&employee_id', ids), db('GET', 'hr_pay_adjust?select=*&site=eq.' + enc(site) + '&month=eq.' + month), inList('hr_advances?select=*&status=eq.active&given_on=lte.' + last + '&employee_id', ids), settingsOn(last)]);
  const by = (list, k) => { const o = {}; (list || []).forEach(r => { (o[r[k]] = o[r[k]] || []).push(r); }); return o; };
  const E = by(emps, 'id'), S = by(sal, 'employee_id'), F = by(flags, 'employee_id'), A = by(adj, 'employee_id'), V = by(adv, 'employee_id');
  const rows = people.map(p => { const e = (E[p.employee_id] || [{}])[0], sl = current(S[p.employee_id] || [], last), f = (F[p.employee_id] || [{}])[0], a = (A[p.employee_id] || [null])[0], v = (V[p.employee_id] || [null])[0];
    const flagsOf = { pf: !!f.pf, esic: !!f.esic, pt: !!f.pt }, adjust = a ? { other_earn: +a.other_earn, earn_note: a.earn_note, other_ded: +a.other_ded, ded_note: a.ded_note, advance: a.advance === null ? null : +a.advance } : { other_earn: 0, earn_note: '', other_ded: 0, ded_note: '', advance: null };
    const advance = v ? advOut(v) : null, pay = P.slip({ salary: sl ? { pay_type: sl.pay_type, amount: +sl.amount } : null, counts: p.counts, month_days: days, flags: flagsOf, settings: set ? set.settings : {}, adjust: adjust, advance: advance });
    return Object.assign({ id: p.employee_id, code: e.code || '', name: e.name || '', category: e.category || '', counts: p.counts, flags: flagsOf, adjust: adjust, advance_of: advance }, pay); })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { rows: rows, settings: set };
}
const slipOut = r => Object.assign({ id: r.employee_id }, r.data, { net: +r.net });

const ACT = {
  async payList(s, x) {
    await needHo(s); const month = monthOf(x.month), base = { month: month, site: s.site, month_days: +M.lastDay(month).slice(8) };
    const run = ((await db('GET', 'hr_pay_runs?select=*&site=eq.' + enc(s.site) + '&month=eq.' + month)) || [])[0];
    if (run) { const slips = await MUS.all('hr_payslips?select=employee_id,net,data&run_id=eq.' + run.id + '&order=id');
      return Object.assign(base, { ready: true, locked: { by: run.locked_by, at: run.locked_at, people: run.people }, rows: slips.map(slipOut), totals: run.totals, settings: null, problems: 0 }); }
    const ap = ((await db('GET', 'hr_months?select=status,approved_by,approved_at&site=eq.' + enc(s.site) + '&month=eq.' + month + '&status=eq.approved')) || [])[0];
    if (!ap) return Object.assign(base, { ready: false, reason: 'The attendance of this month is not approved by the HO HR yet (Month verification) – the pay is made after that.', locked: null, rows: [], totals: P.totals([]), settings: null, problems: 0 });
    const sh = await sheet(s.site, month);
    return Object.assign(base, { ready: true, locked: null, rows: sh.rows, totals: P.totals(sh.rows.filter(r => !r.problem)), settings: sh.settings ? { valid_from: sh.settings.valid_from, settings: sh.settings.settings } : null, problems: sh.rows.filter(r => r.problem).length });
  },
  // for whom PF / ESIC / Profession Tax is deducted – kept for the months to come
  async payFlags(s, x) {
    await needHo(s); const emp = await empRow(s, x.id);
    await db('POST', 'hr_pay_emp?on_conflict=employee_id', [{ employee_id: emp.id, pf: x.pf === true, esic: x.esic === true, pt: x.pt === true, updated_by: s.email, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
    await audit(s.site, s.email, 'Pay: PF / ESIC / PT set', emp.code, { pf: x.pf === true, esic: x.esic === true, pt: x.pt === true });
    return x.month ? ACT.payList(s, { month: x.month }) : {};
  },
  // this month's own additions for a person – only while the month is not locked
  async payAdjust(s, x) {
    await needHo(s); const month = monthOf(x.month), emp = await empRow(s, x.id);
    if (((await db('GET', 'hr_pay_runs?select=id&site=eq.' + enc(s.site) + '&month=eq.' + month)) || []).length) throw fail(409, 'The pay of this month is locked – nothing of it is changed. Set it right in the next month.', 'locked');
    const earn = P.num(x.other_earn, 1e7), ded = P.num(x.other_ded, 1e7), adv = P.num(x.advance, 1e7), en = R.str(x.earn_note, 120), dn = R.str(x.ded_note, 120);
    if (earn === null || ded === null || adv === null) throw fail(400, 'Amounts: numbers (at most two decimals).', 'amount');
    if (earn > 0 && en.length < 3) throw fail(400, 'Another earning: write what it is for.', 'note'); if (ded > 0 && dn.length < 3) throw fail(400, 'Another deduction: write what it is for.', 'note');
    await db('POST', 'hr_pay_adjust?on_conflict=site,month,employee_id', [{ site: s.site, month: month, employee_id: emp.id, other_earn: earn || 0, earn_note: earn ? en : '', other_ded: ded || 0, ded_note: ded ? dn : '', advance: adv === undefined ? null : adv, updated_by: s.email, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
    await audit(s.site, s.email, 'Pay: a month\'s addition set', emp.code + ' ' + month, { earn_note: en, ded_note: dn });
    return ACT.payList(s, { month: month });
  },
  // LOCK: everything in one piece; refused while a person's pay has a problem
  async payLock(s, x) {
    await needHo(s); const month = monthOf(x.month), r = await ACT.payList(s, { month: month });
    if (r.locked) throw fail(409, 'The pay of this month is already locked.', 'locked'); if (!r.ready) throw fail(400, r.reason, 'notready');
    if (!r.rows.length) throw fail(400, 'Nobody is verified in this month.', 'none');
    const bad = r.rows.filter(p => p.problem); if (bad.length && x.without !== true) throw fail(400, bad.length + ' people cannot be paid – for example ' + bad.slice(0, 3).map(p => p.code + ' ' + p.name + ': ' + p.problem).join(' ') + ' Set it right, or lock without them.', 'problems');
    const good = r.rows.filter(p => !p.problem); if (!good.length) throw fail(400, 'Nobody can be paid yet.', 'none');
    const slips = good.map(p => { const d = Object.assign({}, p); delete d.id; delete d.advance_of; delete d.problem; d.advance_left_before = p.advance_of ? p.advance_of.left : 0;
      return { employee_id: p.id, net: p.net, advance: p.advance, advance_id: p.advance_of ? p.advance_of.id : null, data: d }; });
    const set = await settingsOn(M.lastDay(month));
    try { await db('POST', 'rpc/hr_pay_lock', { p_site: s.site, p_month: month, p_by: s.email, p_run: { totals: P.totals(good), settings_id: set ? String(set.id) : '' }, p_slips: slips }); }
    catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'The pay of this month is already locked.', 'locked'); if (/ADVANCE_CHANGED/.test(String(e && e.message))) throw fail(409, 'An advance changed meanwhile – open the pay sheet again.', 'advance'); throw e; }
    await audit(s.site, s.email, 'Pay locked', month + ' · ' + good.length + ' people', { left_out: bad.map(p => p.code) });
    return ACT.payList(s, { month: month });
  },
  /* PF, ESIC, Profession Tax – the accountant's numbers, each version with its date */
  async paySettings(s) {
    await needHo(s); const list = (await db('GET', 'hr_pay_settings?select=id,valid_from,settings,created_by,created_at&order=valid_from.desc,id.desc&limit=50')) || [], now = await settingsOn(R.today());
    return { today: R.today(), settings: now ? now.settings : {}, valid_from: now ? now.valid_from : '', versions: list.map(v => ({ valid_from: v.valid_from, settings: v.settings, by: v.created_by, at: v.created_at })) };
  },
  async paySettingsSave(s, x) {
    await needHo(s); const c = P.settings(x), from = R.date(x.valid_from) || R.today(); if (c.errors.length) throw fail(400, c.errors.join(' '), 'settings');
    const was = await settingsOn(from);
    await db('POST', 'hr_pay_settings', [{ valid_from: from, settings: c.settings, created_by: s.email }], 'return=minimal');
    await audit(s.site, s.email, 'Pay settings set', 'from ' + from, { old: was ? was.settings : null, new: c.settings });
    return ACT.paySettings(s);
  },
  /* salary advances of this site */
  async advList(s) {
    await needHo(s); const list = (await db('GET', 'hr_advances?select=*&site=eq.' + enc(s.site) + '&order=id.desc&limit=500')) || [], emps = await inList('hr_employees?select=id,code,name&id', [...new Set(list.map(a => a.employee_id))]), by = {}; emps.forEach(e => { by[e.id] = e; });
    return { rows: list.map(a => Object.assign(advOut(a), { emp: a.employee_id, code: (by[a.employee_id] || {}).code, name: (by[a.employee_id] || {}).name })) };
  },
  async advGive(s, x) {
    await needHo(s); const emp = await empRow(s, x.id), amount = amountOf(x.amount), monthly = amountOf(x.monthly), on = R.date(x.given_on) || R.today(), note = R.str(x.note, 200);
    if (emp.status === 'left') throw fail(400, 'This employee has left.', 'left'); if (amount === null) throw fail(400, 'Amount: a number above 0.', 'amount');
    if (monthly === null || monthly > amount) throw fail(400, 'Taken back a month: a number above 0, not more than the advance.', 'monthly'); if (on > R.today()) throw fail(400, 'Given on: not a day to come.', 'day');
    try { await db('POST', 'hr_advances', [{ employee_id: emp.id, site: emp.site, amount: amount, monthly: monthly, given_on: on, note: note, created_by: s.email }], 'return=minimal'); }
    catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'This employee has an advance that is not taken back yet – one advance at a time.', 'duplicate'); throw e; }
    await audit(s.site, s.email, 'Advance given', emp.code, { given_on: on });      // (no amount in the audit)
    return ACT.advList(s);
  },
  // an advance is closed by hand (he paid it back himself, it is written off) – what was taken back stays as it is
  async advClose(s, x) {
    await needHo(s); const why = R.str(x.reason, 200); if (why.length < 3) throw fail(400, 'Reason: write why the advance is closed.', 'reason');
    const done = (await db('PATCH', 'hr_advances?id=eq.' + (parseInt(x.id, 10) || 0) + '&site=eq.' + enc(s.site) + '&status=eq.active', { status: 'closed', closed_by: s.email, closed_at: new Date().toISOString(), close_reason: why }, 'return=representation')) || [];
    if (!done.length) throw fail(404, 'This advance was not found, or is closed already.', 'notfound');
    await audit(s.site, s.email, 'Advance closed', String(done[0].id), { reason: why });
    return ACT.advList(s);
  },
  /* a person, for himself: his payslips of locked months (the newest first) */
  async mySlips(s) {
    const emp = await me(s); let rows = [];
    try { rows = (await db('GET', 'hr_payslips?select=month,net,data&employee_id=eq.' + emp.id + '&order=month.desc&limit=36')) || []; } catch (e) { if (!e || e.code !== 'notinstalled') throw e; }
    return { employee: { code: emp.code, name: emp.name }, slips: rows.map(r => { const d = r.data || {}; return { month: r.month, net: +r.net, pay_type: d.pay_type, rate: d.rate, month_days: d.month_days, pay_days: d.pay_days, extra_days: d.extra_days, counts: d.counts || {},
      earnings: [['Earned pay', d.earned], ['Extra days', d.extra], [d.adjust && d.adjust.earn_note ? d.adjust.earn_note : 'Other earning', d.other_earn]].filter(l => +l[1] > 0).map(l => ({ label: l[0], amount: +l[1] })), gross: d.gross,
      deductions: [['PF', d.pf], ['ESIC', d.esic], ['Profession Tax', d.pt], ['Advance', d.advance], [d.adjust && d.adjust.ded_note ? d.adjust.ded_note : 'Other deduction', d.other_ded]].filter(l => +l[1] > 0).map(l => ({ label: l[0], amount: +l[1] })), total_deductions: d.deductions }; }) };
  },
};
const SELF = ['mySlips'];
module.exports = { ACT, SELF, NOT_READY12 };
