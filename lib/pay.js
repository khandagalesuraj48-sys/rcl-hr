/* THE PAY OF ONE PERSON FOR ONE MONTH – plain numbers, no database (step 12).
 * Decided 12-11-2026: a day's pay = the month's salary ÷ the days of THAT month (30 / 31 / 28); an extra day (worked on a weekly
 * off or a holiday) = one day's pay more; a month's salary or a day's rate is chosen per person.
 *   a month's salary: earned = day × the days counted for pay (present, half days as ½, weekly offs, holidays, paid leave – as the
 *                     verified month says); extra = day × extra days
 *   a day's rate:     earned = rate × (present + half days as ½ + leave); extra = rate × extra days (no pay for a weekly off or
 *                     a holiday not worked)
 * PF, ESIC and Profession Tax are the company's own settings with their date (the accountant's numbers) – NO number of them is
 * in this code; a setting left empty is not applied; each is deducted only for a person it is ticked for.
 *   PF   = pf_pct % of the earned pay (at most of pf_cap, when given), to the nearest rupee
 *   ESIC = esic_pct % of the gross, rounded UP to the rupee – not when the full month's salary is above esic_limit (when given)
 *   PT   = the amount of the highest slab whose "from" the gross reaches
 * The advance of the month is never more than what is left of the advance, nor more than the pay left after the deductions.
 * (step 13, the Rule Book – only for a person whose policy says so; without it nothing here changes)
 *   extra days: with a COMP-OFF policy a day worked on a weekly off or a holiday is paid only when it was approved "for pay"
 *               (approved "for leave" it went to his Comp-off balance; not approved it gives nothing) – o.extra_days says how many
 *   overtime:   approved overtime "for pay" = the hours × (a day's pay ÷ the hours of his shift) × the policy's rate – o.overtime
 *   relieving:  when his leave policy says "unused leave is paid", the days left on his last day (at most the policy's number)
 *               × a day's pay, in the month he is relieved – o.leave_days */
'use strict';
const r2 = n => Math.round((+n || 0) * 100) / 100;
const num = (v, max) => { if (v === undefined || v === null || v === '') return undefined; const t = String(v).replace(/[,\s₹%]/g, ''); if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null; const n = parseFloat(t); return n <= max ? n : null; };
// the settings as typed → { errors, settings } (an empty one is left out = not applied)
function settings(x) {
  x = x || {}; const s = {}, errors = [];
  [['pf_pct', 100, 'PF %'], ['pf_cap', 1e7, 'PF: the wage it is counted on at most'], ['esic_pct', 100, 'ESIC %'], ['esic_limit', 1e7, 'ESIC: up to which month\'s salary']].forEach(k => { const v = num(x[k[0]], k[1]); if (v === null) errors.push(k[2] + ': a number (at most two decimals).'); else if (v !== undefined) s[k[0]] = v; });
  const slabs = [];
  (Array.isArray(x.pt_slabs) ? x.pt_slabs : []).slice(0, 12).forEach((row, i) => { if (!row || (row.from === '' && row.amount === '') || (row.from === undefined && row.amount === undefined)) return; const f = num(row.from, 1e7), a = num(row.amount, 1e5);
    if (f === null || f === undefined || a === null || a === undefined) errors.push('Profession Tax, line ' + (i + 1) + ': "gross from" and "amount" as numbers.'); else slabs.push({ from: f, amount: a }); });
  slabs.sort((a, b) => a.from - b.from); if (slabs.some((v, i) => i && v.from === slabs[i - 1].from)) errors.push('Profession Tax: the same "gross from" twice.');
  if (slabs.length) s.pt_slabs = slabs;
  return { errors, settings: s };
}
/* o: { salary: { pay_type, amount } | null, counts (lib/month.js), month_days, flags: { pf, esic, pt }, settings,
 *      adjust: { other_earn, other_ded, advance (this month's, or undefined = the usual one) }, advance: { id, left, monthly } | null,
 *      extra_days (step 13: instead of counts.extra), overtime (step 13): [{ minutes, shift_hours, rate }] } */
function slip(o) {
  const c = o.counts || {}, st = o.settings || {}, f = o.flags || {}, ad = o.adjust || {}, sal = o.salary;
  const out = { pay_type: sal ? sal.pay_type : '', rate: sal ? +sal.amount : 0, month_days: o.month_days, pay_days: 0, extra_days: o.extra_days !== undefined && o.extra_days !== null ? +o.extra_days || 0 : +c.extra || 0, day: 0, earned: 0, extra: 0, other_earn: r2(ad.other_earn), gross: 0, pf: 0, esic: 0, pt: 0, advance: 0, other_ded: r2(ad.other_ded), deductions: 0, net: 0, problem: '' };
  if (!sal) { out.problem = 'No approved salary – his pay is not made.'; return out; }
  if (sal.pay_type === 'daily') { out.day = r2(sal.amount); out.pay_days = (+c.present || 0) + (+c.half || 0) * 0.5 + (+c.leave || 0); }
  else { out.day = +sal.amount / o.month_days; out.pay_days = Math.min(+c.paid || 0, o.month_days); }
  out.earned = r2(out.day * out.pay_days); out.extra = r2(out.day * out.extra_days);
  let ot = 0; if (Array.isArray(o.overtime) && o.overtime.length) {      // (step 13) approved overtime for pay
    let min = 0; o.overtime.forEach(x => { const h = +x.shift_hours, m = +x.minutes; if (!(h > 0) || !(m > 0)) return; min += m; ot += out.day / h * (m / 60) * (x.rate === undefined || x.rate === null ? 1 : +x.rate || 0); });
    out.ot_hours = Math.round(min / 6) / 10; out.overtime = ot = r2(ot);
  }
  let lp = 0; if (+o.leave_days > 0) { out.leave_pay_days = +o.leave_days; out.leave_pay = lp = r2(out.day * out.leave_pay_days); }      // (step 13) unused leave paid on relieving
  out.day = r2(out.day);
  out.gross = r2(out.earned + out.extra + ot + lp + out.other_earn);
  if (f.pf && st.pf_pct !== undefined) out.pf = Math.round(Math.min(out.earned, st.pf_cap !== undefined ? st.pf_cap : Infinity) * st.pf_pct / 100);
  const full = sal.pay_type === 'daily' ? +sal.amount * o.month_days : +sal.amount;
  if (f.esic && st.esic_pct !== undefined && (st.esic_limit === undefined || full <= st.esic_limit)) out.esic = Math.ceil(r2(out.gross * st.esic_pct / 100));
  if (f.pt && Array.isArray(st.pt_slabs)) { const hit = st.pt_slabs.filter(x => out.gross >= x.from).pop(); out.pt = hit ? r2(hit.amount) : 0; }
  const left = Math.max(0, r2(out.gross - out.pf - out.esic - out.pt - out.other_ded));
  if (o.advance && o.advance.left > 0) out.advance = r2(Math.max(0, Math.min(ad.advance === undefined || ad.advance === null ? o.advance.monthly : +ad.advance, o.advance.left, left)));
  out.deductions = r2(out.pf + out.esic + out.pt + out.advance + out.other_ded);
  out.net = Math.round(out.gross - out.deductions);
  if (out.net < 0) out.problem = 'The deductions are more than the pay – lessen "another deduction".';
  return out;
}
const SUM = ['earned', 'extra', 'other_earn', 'gross', 'pf', 'esic', 'pt', 'advance', 'other_ded', 'net'];
const totals = rows => { const t = {}; SUM.forEach(k => { t[k] = r2(rows.reduce((n, r) => n + (+r[k] || 0), 0)); }); if (rows.some(r => r.overtime !== undefined)) t.overtime = r2(rows.reduce((n, r) => n + (+r.overtime || 0), 0)); if (rows.some(r => r.leave_pay !== undefined)) t.leave_pay = r2(rows.reduce((n, r) => n + (+r.leave_pay || 0), 0)); return t; };      // (step 13) overtime: only in a month that has any
module.exports = { settings, slip, totals, num, r2, SUM };
