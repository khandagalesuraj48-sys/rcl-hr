/* MORE OF THE HR OFFICE (12-11-2026 – his yes to the list: "tu je sangtile 1 to 16 ek sath banwala ghe"; the first group):
 *   hrComing  – the office's dashboard: papers of this site's people whose date runs out within 30 days (or has run out), the
 *               birthdays and the years at work of the coming 7 days. Read only.
 *   paySlipOf – (HO HR) one person's payslip of a LOCKED month, to print.
 *   payBank   – (HO HR) the bank list of a LOCKED month: name, bank, IFSC, account number, net pay – for the bank's transfer
 *               sheet. The account numbers are given whole only here, only to the HO HR; that it was taken is written down
 *               (never a number).
 * Nothing is written by these but that one line. */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const M = require('./month');
const C = require('./coming');
const { needOffice } = require('./act_attend');
const { isHo } = require('./act_month');
const MUS = require('./act_muster');

const PAPER_DAYS = 30, YEARLY_DAYS = 7;
async function needHo(s) { needOffice(s); if (!(await isHo(s))) throw fail(403, 'Payroll is only for the HO HR and the Super Admin.', 'role'); }
const monthOf = v => { if (!M.monthOk(v)) throw fail(400, 'Month: as YYYY-MM.', 'month'); return String(v); };
const inList = async (path, ids) => { const out = []; for (const c of MUS.chunks(ids, 80)) ((await MUS.soft(db('GET', path + '=in.(' + c.join(',') + ')'))) || []).forEach(r => out.push(r)); return out; };
const runOf = async (site, month) => { const r = ((await db('GET', 'hr_pay_runs?select=id,locked_by,locked_at,people,totals&site=eq.' + enc(site) + '&month=eq.' + month)) || [])[0]; if (!r) throw fail(400, 'The pay of this month is not locked yet – the payslips and the bank list are made after the lock.', 'notlocked'); return r; };
// a payslip as it is read (the same for the office's print and the person's own app)
function slipView(month, net, d) {
  d = d || {};
  return { month: month, net: +net, pay_type: d.pay_type, rate: d.rate, month_days: d.month_days, pay_days: d.pay_days, extra_days: d.extra_days, counts: d.counts || {},
    earnings: [['Earned pay', d.earned], ['Extra days', d.extra], ['Overtime' + (d.ot_hours ? ' (' + d.ot_hours + ' h)' : ''), d.overtime], ['Unused leave paid on relieving' + (d.leave_pay_days ? ' (' + d.leave_pay_days + ' days)' : ''), d.leave_pay], [d.adjust && d.adjust.earn_note ? d.adjust.earn_note : 'Other earning', d.other_earn]].filter(l => +l[1] > 0).map(l => ({ label: l[0], amount: +l[1] })), gross: d.gross,
    deductions: [['PF', d.pf], ['ESIC', d.esic], ['Profession Tax', d.pt], ['Advance', d.advance], [d.adjust && d.adjust.ded_note ? d.adjust.ded_note : 'Other deduction', d.other_ded]].filter(l => +l[1] > 0).map(l => ({ label: l[0], amount: +l[1] })), total_deductions: d.deductions };
}

const ACT = {
  async hrComing(s) {
    needOffice(s); const today = R.today();
    const emps = await MUS.all('hr_employees?select=id,code,name,dob,joined_on&site=eq.' + enc(s.site) + '&status=neq.left&order=name,id'), by = {}; emps.forEach(e => { by[e.id] = e; });
    const docs = (await inList('hr_employee_docs?select=employee_id,kind,title,expires_on&active=is.true&expires_on=not.is.null&expires_on=lte.' + require('./day').addDays(today, PAPER_DAYS) + '&employee_id', emps.map(e => e.id)));
    const papers = docs.map(d => { const p = C.paper(String(d.expires_on).slice(0, 10), today, PAPER_DAYS), e = by[d.employee_id]; return p && e ? { id: e.id, code: e.code, name: e.name, paper: (R.docKind(d.kind) || {}).name || d.title || d.kind, expires_on: String(d.expires_on).slice(0, 10), left: p.left } : null; }).filter(Boolean).sort((a, b) => a.left - b.left);
    const days = [];
    emps.forEach(e => { const b = C.yearly(e.dob, today, YEARLY_DAYS), w = C.yearly(e.joined_on, today, YEARLY_DAYS);
      if (b) days.push({ id: e.id, code: e.code, name: e.name, what: 'birthday', in: b.in, day: b.day }); if (w) days.push({ id: e.id, code: e.code, name: e.name, what: 'work', years: w.years, in: w.in, day: w.day }); });
    days.sort((a, b) => a.in - b.in || (a.name < b.name ? -1 : 1));
    return { today: today, paper_days: PAPER_DAYS, papers: papers, days: days };
  },
  async paySlipOf(s, x) {
    await needHo(s); const month = monthOf(x.month), run = await runOf(s.site, month), eid = String(x.id || '').toLowerCase(); if (!/^[0-9a-f-]{36}$/.test(eid)) throw fail(400, 'Choose the person.', 'id');
    const r = ((await db('GET', 'hr_payslips?select=net,data&run_id=eq.' + run.id + '&employee_id=eq.' + eid)) || [])[0]; if (!r) throw fail(404, 'This person has no payslip in that month.', 'notfound');
    const e = ((await db('GET', 'hr_employees?select=code,name,category,department_id,designation_id,joined_on&id=eq.' + eid)) || [])[0] || {};
    const [dep, des] = await Promise.all([e.department_id ? db('GET', 'hr_departments?select=name&id=eq.' + e.department_id) : [], e.designation_id ? db('GET', 'hr_designations?select=name&id=eq.' + e.designation_id) : []]);
    return { site: s.site, site_name: (s.info && s.info.siteName) || s.site, locked: { by: run.locked_by, at: run.locked_at },
      employee: { code: e.code, name: e.name, category: e.category, department: ((dep || [])[0] || {}).name || '', designation: ((des || [])[0] || {}).name || '', joined_on: e.joined_on || '' }, slip: slipView(month, r.net, r.data) };
  },
  async payBank(s, x) {
    await needHo(s); const month = monthOf(x.month), run = await runOf(s.site, month);
    const slips = await MUS.all('hr_payslips?select=employee_id,net&run_id=eq.' + run.id + '&order=id'), ids = slips.map(r => r.employee_id);
    const [emps, prof] = await Promise.all([inList('hr_employees?select=id,code,name&id', ids), inList('hr_employee_profile?select=employee_id,secret&employee_id', ids)]);
    const E = {}, P = {}; emps.forEach(e => { E[e.id] = e; }); prof.forEach(p => { P[p.employee_id] = p.secret || {}; });
    const rows = slips.map(r => { const e = E[r.employee_id] || {}, b = P[r.employee_id] || {}; return { code: e.code || '', name: e.name || '', holder: b.bank_holder || '', bank: b.bank_name || '', ifsc: b.bank_ifsc || '', account: b.bank_account || '', net: +r.net, missing: !(b.bank_account && b.bank_ifsc) }; })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    await audit(s.site, s.email, 'Bank list taken', month + ' · ' + rows.length + ' people', { without_bank: rows.filter(r => r.missing).length });
    return { month: month, site: s.site, rows: rows, total: Math.round(rows.reduce((n, r) => n + r.net, 0) * 100) / 100, missing: rows.filter(r => r.missing).length };
  },
};
module.exports = { ACT, slipView, PAPER_DAYS, YEARLY_DAYS };
