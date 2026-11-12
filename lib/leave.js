/* LEAVE – how a balance is counted, in one place (step 7, 12-11-2026). No database here: pure, so that it can be tested alone.
 * His words: "leave policy asel pratek month madhe site sathi 4 aahe sunday working ahe sunday absent or leave asel tr te
 * balance leave madhun kmi hot head office policy wegli aahe holiday yetat". So, per site, WITH A DATE (nothing in the code):
 *   per_month   – so many leaves are added at the start of every month;
 *   carry       – unused leaves go on to the next month (false: the balance starts from 0 every month);
 *   auto_absent – an absent day takes one leave by itself, while there is one (then it is leave, not absent).
 * THE BALANCE IS NEVER STORED: it is walked, day by day, from the first day of the first policy: + the month's leaves, + what the
 * HR office added, − each approved leave day, − each absent day (auto_absent). A weekly off / a holiday (the site's own rules –
 * the Head Office has a Sunday off, a road site has none) never takes a leave; nor does a day he was at work after all. */
'use strict';
const FREE = ['WO', 'H', 'WOP', 'HP'], HERE = ['P', 'IN'];
const r1 = n => Math.round(n * 10) / 10;
// the policy versions, the oldest first; on(day) = the one valid on a day
function versions(list) {
  const pol = (list || []).slice().sort((a, b) => (a.valid_from < b.valid_from ? -1 : a.valid_from > b.valid_from ? 1 : (a.id || 0) - (b.id || 0)));
  return { list: pol, on: day => { let p = null; for (const x of pol) if (x.valid_from <= day) p = x; return p; } };
}
/* days: [{ day, code }] in order, up to today.   ctx: { policies, first (the first day that counts for him), adjust: { day: days },
 * leave: { day: 1 | 0.5 } (his approved leave) }   →   { balance, marks: { day: { days, auto } }, months: { 'YYYY-MM': { credit, added, used } } } */
function walk(days, ctx) {
  const v = versions(ctx.policies), marks = {}, months = {}, mrow = m => (months[m] = months[m] || { credit: 0, added: 0, used: 0 });
  let bal = 0, month = '', credited = '';
  for (const d of days) {
    if (ctx.first && d.day < ctx.first) continue;
    const m = d.day.slice(0, 7), p = v.on(d.day);
    if (m !== month) { month = m; if (p && !p.carry) bal = 0; }
    if (p && credited !== m) { credited = m; bal += +p.per_month; mrow(m).credit += +p.per_month; }
    const adj = ctx.adjust && ctx.adjust[d.day]; if (adj) { bal += adj; mrow(m).added += adj; }
    const lv = ctx.leave && ctx.leave[d.day];
    if (lv && FREE.indexOf(d.code) < 0 && HERE.indexOf(d.code) < 0) { bal -= lv; mrow(m).used += lv; marks[d.day] = { days: lv, auto: false }; }
    else if (!lv && p && p.auto_absent && d.code === 'A' && bal >= 1) { bal -= 1; mrow(m).used += 1; marks[d.day] = { days: 1, auto: true }; }
  }
  Object.keys(months).forEach(k => { const x = months[k]; x.credit = r1(x.credit); x.added = r1(x.added); x.used = r1(x.used); });
  return { balance: r1(bal), marks: marks, months: months };
}
// a policy as typed → { row, errors }
function policy(x) {
  x = x || {}; const errors = [], n = Number(String(x.per_month === undefined || x.per_month === null ? '' : x.per_month).trim());
  if (String(x.per_month === undefined || x.per_month === null ? '' : x.per_month).trim() === '' || !Number.isFinite(n) || n < 0 || n > 31 || Math.round(n * 2) !== n * 2) errors.push('Leaves a month: 0 to 31 (halves allowed).');
  const levels = x.levels === undefined || x.levels === null || x.levels === '' ? 2 : +x.levels; if (levels !== 1 && levels !== 2) errors.push('Who approves: 1 or 2 levels.');
  return { row: { per_month: n, carry: x.carry !== false, auto_absent: x.auto_absent !== false, levels: levels }, errors: errors };
}
module.exports = { walk, versions, policy, FREE, HERE, r1 };
