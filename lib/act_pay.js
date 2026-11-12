/* AN EMPLOYEE'S SALARY: proposed by the site's HR, approved by the HO HR (step 11 – asked 12-11-2026: "SITE HR EMPLOYEE ON BORD KRU
 * SHAKEL … TYACHI SALARY PN MENTION KARU SHAKEL … APPROVAL SATHI JAIL"; decided: straight to the HO HR).
 *   Who sees a salary: the HR Admin of the employee's site, the HO HR, the Super Admin. Never an HR User, never "My HR".
 *   The HR Admin (the power "salary" – the Super Admin gives or takes it) proposes: a month's salary or a day's rate, the amount,
 *   from which date. It counts only when the HO HR approved it – never the person who proposed it (the Super Admin may).
 *   A new salary later is a new proposal; the earlier ones stay as they were. Nothing is deleted. */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const power = require('./powers');
const { needOffice } = require('./act_attend');
const { isHo } = require('./act_month');

const NOT_READY11 = 'Salaries are not set up yet: the Super Admin runs sql/hr_step11_salary.sql once in the rcl-hr Supabase → SQL Editor.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLS = 'id,employee_id,site,pay_type,amount,valid_from,note,status,asked_by,asked_at,decided_by,decided_at,decide_note';
const TYPES = { monthly: 'A month\'s salary', daily: 'A day\'s rate' };
const mail = v => String(v || '').trim().toLowerCase();
// the amount as typed: digits, at most two decimals, more than 0, less than 1 crore
function amountOf(v) { const t = String(v === undefined || v === null ? '' : v).replace(/[,\s₹]/g, ''); if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return null; const n = Math.round(parseFloat(t) * 100) / 100; return n > 0 && n < 10000000 ? n : null; }
const out = r => ({ id: r.id, pay_type: r.pay_type, amount: +r.amount, valid_from: r.valid_from, note: r.note, status: r.status, asked_by: r.asked_by, asked_at: r.asked_at, decided_by: r.decided_by, decided_at: r.decided_at, decide_note: r.decide_note });
// the salary that counts on a day: the newest approved one that began by then
const current = (rows, day) => rows.filter(r => r.status === 'approved' && r.valid_from <= day).sort((a, b) => (a.valid_from < b.valid_from ? 1 : a.valid_from > b.valid_from ? -1 : b.id - a.id))[0] || null;
async function maySee(s) { needOffice(s); const ho = await isHo(s); if (!ho && s.role !== 'admin') throw fail(403, 'A salary is seen only by the HR Admin of the site, the HO HR and the Super Admin.', 'role'); return ho; }
const empOf = async (s, empId) => { const e = UUID.test(String(empId)) ? ((await db('GET', 'hr_employees?select=id,code,name,category,site,status,joined_on&id=eq.' + empId + '&site=eq.' + enc(s.site))) || [])[0] : null; if (!e) throw fail(404, 'This employee was not found on this site.', 'notfound'); return e; };
const sitesOf = s => { const l = ((s.info && s.info.sites) || []).filter(v => v && v.code).map(v => ({ code: v.code, name: v.name })).slice(0, 60); if (!l.some(v => v.code === s.site)) l.unshift({ code: s.site, name: (s.info && s.info.siteName) || s.site }); return l; };

const ACT = {
  // one employee's salary: what counts today, what waits, everything before
  async salaryGet(s, x) {
    const ho = await maySee(s), emp = await empOf(s, x.id), rows = (await db('GET', 'hr_salaries?select=' + COLS + '&employee_id=eq.' + emp.id + '&order=id.desc&limit=100')) || [];
    const cur = current(rows, R.today()), wait = rows.find(r => r.status === 'pending') || null;
    return { employee: { id: emp.id, code: emp.code, name: emp.name }, types: TYPES, current: cur ? out(cur) : null, waiting: wait ? out(wait) : null, history: rows.map(out),
      can: { ask: !wait && emp.status !== 'left' && (s.role === 'super' || (s.role === 'admin' && !!(await power.of(s.site)).salary)), decide: ho && !!wait && (s.role === 'super' || mail(wait.asked_by) !== mail(s.email)) } };
  },
  async salaryAsk(s, x) {
    await power.need(s, 'salary'); const emp = await empOf(s, x.id), type = TYPES[x.pay_type] ? x.pay_type : '', amount = amountOf(x.amount), from = R.date(x.valid_from) || emp.joined_on || R.today(), note = R.str(x.note, 200);
    if (emp.status === 'left') throw fail(400, 'This employee has left.', 'left');
    if (!type) throw fail(400, 'Salary type: a month\'s salary or a day\'s rate.', 'type'); if (amount === null) throw fail(400, 'Amount: a number above 0 (at most two decimals).', 'amount');
    try { await db('POST', 'hr_salaries', [{ employee_id: emp.id, site: emp.site, pay_type: type, amount: amount, valid_from: from, note: note, asked_by: s.email }], 'return=minimal'); }
    catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'A salary of this employee already waits for the HO HR.', 'duplicate'); throw e; }
    await audit(emp.site, s.email, 'Salary proposed', emp.code, { type: type, from: from });      // (the amount itself is not written into the audit)
    return ACT.salaryGet(s, { id: emp.id });
  },
  // the HO HR: every salary that waits, on the sites of his sign-in – a new employee is said
  async salaryWaiting(s) {
    needOffice(s); if (!(await isHo(s))) throw fail(403, 'Only the HO HR or the Super Admin can do this.', 'role');
    const sites = sitesOf(s), rows = (await db('GET', 'hr_salaries?select=' + COLS + '&status=eq.pending&site=in.(' + sites.map(v => enc(v.code)).join(',') + ')&order=asked_at&limit=500')) || [];
    const ids = [...new Set(rows.map(r => r.employee_id))], by = {}, had = {};
    for (let i = 0; i < ids.length; i += 80) { const part = ids.slice(i, i + 80).join(',');
      ((await db('GET', 'hr_employees?select=id,code,name,category,joined_on&id=in.(' + part + ')')) || []).forEach(e => { by[e.id] = e; });
      ((await db('GET', 'hr_salaries?select=' + COLS + '&status=eq.approved&employee_id=in.(' + part + ')')) || []).forEach(r => { (had[r.employee_id] = had[r.employee_id] || []).push(r); }); }
    return { here: s.site, rows: rows.map(r => { const e = by[r.employee_id] || {}, c = current(had[r.employee_id] || [], R.today());
      return Object.assign(out(r), { site: r.site, site_name: (sites.find(v => v.code === r.site) || {}).name || r.site, code: e.code, name: e.name, category: e.category, joined_on: e.joined_on, is_new: !(had[r.employee_id] || []).length, now: c ? { pay_type: c.pay_type, amount: +c.amount } : null, mine: s.role !== 'super' && mail(r.asked_by) === mail(s.email) }); }) };
  },
  async salaryDecide(s, x) {
    needOffice(s); if (!(await isHo(s))) throw fail(403, 'Only the HO HR or the Super Admin can do this.', 'role');
    const dec = x.decision === 'approved' || x.decision === 'returned' ? x.decision : '', note = R.str(x.note, 200); if (!dec) throw fail(400, 'Decision: approve or send back.', 'decision');
    if (dec === 'returned' && note.length < 3) throw fail(400, 'Reason: write why it is sent back.', 'note');
    const r = ((await db('GET', 'hr_salaries?select=' + COLS + '&id=eq.' + (parseInt(x.id, 10) || 0))) || [])[0];
    if (!r || !sitesOf(s).some(v => v.code === r.site)) throw fail(404, 'This proposal was not found on your sites.', 'notfound');
    if (r.status !== 'pending') throw fail(409, 'This proposal was already decided.', 'decided');
    if (s.role !== 'super' && mail(r.asked_by) === mail(s.email)) throw fail(403, 'A salary is approved by another person than the one who proposed it.', 'own');
    const done = (await db('PATCH', 'hr_salaries?id=eq.' + r.id + '&status=eq.pending', { status: dec, decided_by: s.email, decided_at: new Date().toISOString(), decide_note: note }, 'return=representation')) || [];
    if (!done.length) throw fail(409, 'This proposal was already decided.', 'decided');
    const emp = ((await db('GET', 'hr_employees?select=code&id=eq.' + r.employee_id)) || [])[0] || {};
    await audit(r.site, s.email, dec === 'approved' ? 'Salary approved (HO HR)' : 'Salary sent back (HO HR)', emp.code || '', { proposal: r.id, note: note });
    return ACT.salaryWaiting(s);
  },
};
module.exports = { ACT, NOT_READY11, amountOf, current, TYPES };
