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
/* ───────────── (step 13, 13-11-2026) THE RULE BOOK'S LEAVE: two balances and a ledger ─────────────
 * His decisions: "site sunday working ahe sunday la employee working asel tr tyala tya month che 4 leave miltil"; two balances –
 * PAID leave (the month's / the Sundays' leaves, what the HR office adds) and COMP-OFF (work on a day off, overtime as leave);
 * unused leave goes on without a limit; "leave balance jitka aahe titkech days add hotil bakich absent" – a leave is taken only
 * while its balance has it; an absent day with no approved request takes nothing (unless the policy says so).
 * days: [{ day, code }] in order, up to today.
 * ctx: { polOn(day) → { earn: 'month' | 'sunday', per_month, carry, auto_absent, strict } or null,
 *        first, credits: { day: [{ bucket: 'paid' | 'comp', days, source, reason }] }, leave: { day: { days } },
 *        refused: { day: true } (a leave request for that day was refused) }
 * → { paid, comp (the balances), marks: { day: { days, auto, bucket } }, months: { 'YYYY-MM': { credit, added, used } },
 *     ledger: [{ day, bucket, days (+ / −), source, text }], absent: { day: 'refused' | 'none' } }
 * The balance is still never stored: it is walked from the policy, the credits and the muster. */
const SUN_FULL = ['P', 'WOP', 'HP', 'IN'];
function walk2(days, ctx) {
  const marks = {}, months = {}, ledger = [], absent = {}, mrow = m => (months[m] = months[m] || { credit: 0, added: 0, used: 0 }), bal = { paid: 0, comp: 0 };
  const add = (day, bucket, n, source, text) => { bal[bucket] += n; ledger.push({ day: day, bucket: bucket, days: r1(n), source: source, text: text }); };
  let month = '', credited = '', earned = 0;
  for (const d of days) {
    if (ctx.first && d.day < ctx.first) continue;
    if (ctx.last && d.day > ctx.last) break;      // relieved: nothing is earned or taken after his last day – the balance stands as of that day
    const m = d.day.slice(0, 7), p = ctx.polOn ? ctx.polOn(d.day) : null;
    if (m !== month) { month = m; earned = 0; if (p && p.carry === false && bal.paid !== 0) { add(d.day, 'paid', -bal.paid, 'lapse', 'Unused leave of last month lapsed'); } }
    if (p && p.earn !== 'sunday' && credited !== m) { credited = m; if (+p.per_month) { add(d.day, 'paid', +p.per_month, 'month', 'Leave of the month'); mrow(m).credit += +p.per_month; } }
    (ctx.credits && ctx.credits[d.day] || []).forEach(c => { add(d.day, c.bucket === 'comp' ? 'comp' : 'paid', +c.days, c.source || 'hr', c.reason || ''); if (c.bucket !== 'comp') mrow(m).added += +c.days; });
    // a Sunday worked earns a leave (a half day worked: half), at most per_month a month
    if (p && p.earn === 'sunday' && new Date(d.day + 'T00:00:00Z').getUTCDay() === 0) {
      const n = Math.min(SUN_FULL.indexOf(d.code) > -1 ? 1 : d.code === 'HD' ? 0.5 : 0, Math.max(0, +p.per_month - earned));
      if (n > 0) { earned += n; add(d.day, 'paid', n, 'sunday', 'Sunday worked'); mrow(m).credit += n; }
    }
    const lv = ctx.leave && ctx.leave[d.day], taken = FREE.indexOf(d.code) < 0 && HERE.indexOf(d.code) < 0;
    if (lv && taken) {
      /* (his correction of 13-11-2026: "employee leave apply krtana type select krt nko basayla … systeam auto samjel ki ya 2 ni
       * milun leave balance ekach aahe") ONE leave for the person: it is taken from what he has in both balances together –
       * the Comp-off days first, then the Paid leave. He never chooses; the ledger still says from which each day came. */
      const want = +lv.days, half = v => Math.max(0, Math.floor(v * 2) / 2), n = p && p.strict ? Math.min(want, half(bal.comp) + half(bal.paid)) : want;
      if (n > 0) {
        const c = Math.min(n, half(bal.comp)), q = n - c, cut = n < want ? ' (only ' + n + ' of ' + want + ' – the balance had no more)' : '';
        if (c > 0) add(d.day, 'comp', -c, 'leave', 'Leave' + cut); if (q > 0) { add(d.day, 'paid', -q, 'leave', 'Leave' + cut); mrow(m).used += q; }
        marks[d.day] = { days: n, auto: false, bucket: c > 0 && q > 0 ? 'both' : c > 0 ? 'comp' : 'paid' };
      } else if (d.code === 'A') absent[d.day] = 'nobalance';
    } else if (!lv && p && p.auto_absent && d.code === 'A' && bal.paid >= 1) { add(d.day, 'paid', -1, 'absent', 'Absent – taken from the balance'); mrow(m).used += 1; marks[d.day] = { days: 1, auto: true, bucket: 'paid' }; }
    else if (!lv && d.code === 'A') absent[d.day] = ctx.refused && ctx.refused[d.day] ? 'refused' : 'none';
  }
  Object.keys(months).forEach(k => { const x = months[k]; x.credit = r1(x.credit); x.added = r1(x.added); x.used = r1(x.used); });
  return { paid: r1(bal.paid), comp: r1(bal.comp), balance: r1(bal.paid), marks: marks, months: months, ledger: ledger, absent: absent };
}
module.exports = { walk, walk2, versions, policy, FREE, HERE, r1 };
