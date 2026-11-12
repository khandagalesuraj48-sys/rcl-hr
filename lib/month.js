/* THE MONTH'S COUNT OF ONE PERSON, as the site's HR verifies it and the HO HR approves it (step 10) – plain numbers, no database.
 *   present   – days worked in full (P)                 half    – half days (HD)            absent – A
 *   leave     – days on leave (L)                       week_off / holiday – free days not worked
 *   extra     – days WORKED on a weekly off or a holiday (WOP, HP)        late – days he came late
 *   open      – "IN without OUT" days still to be set right (MIS) – a month with one cannot be verified
 *   paid      – days counted for pay, as the muster counts them */
'use strict';
const KEYS = ['present', 'half', 'absent', 'leave', 'week_off', 'holiday', 'extra', 'late', 'paid'];
function counts(days, total) {
  const c = { present: 0, half: 0, absent: 0, leave: 0, week_off: 0, holiday: 0, extra: 0, late: 0, open: 0, paid: 0 };
  const at = { P: 'present', IN: 'present', HD: 'half', A: 'absent', L: 'leave', WO: 'week_off', H: 'holiday', WOP: 'extra', HP: 'extra', MIS: 'open' };
  for (const d of days || []) { if (at[d.code]) c[at[d.code]]++; if (d.late_min > 0) c.late++; }
  c.paid = total && typeof total.paid === 'number' ? Math.round(total.paid * 10) / 10 : 0;
  return c;
}
// are the counts verified still what the days say today?
const same = (a, b) => !!a && !!b && KEYS.every(k => +a[k] === +b[k]);
const monthOk = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v));
const lastDay = m => m + '-' + String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate()).padStart(2, '0');
module.exports = { KEYS, counts, same, monthOk, lastDay };
