/* WHAT COMES UP FOR A PERSON – plain dates, no database (12-11-2026: the papers whose date runs out, a birthday, the years at work).
 *   paper(expires_on, today, days) → { left } days until it runs out (negative = run out already) when that is within [days], else null
 *   yearly(date, today, days)      → { in, years } the next return of that day (29 Feb counts on 28 Feb in a short year) within [days], else null */
'use strict';
const ms = d => Date.parse(d + 'T00:00:00Z');
const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
function paper(expires, today, days) { if (!ok(expires) || !ok(today)) return null; const left = Math.round((ms(expires) - ms(today)) / 86400000); return left <= days ? { left: left } : null; }
function yearly(date, today, days) {
  if (!ok(date) || !ok(today) || date > today) return null;
  const y = +today.slice(0, 4), at = yy => { const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0, md = date.slice(5) === '02-29' && !leap ? '02-28' : date.slice(5); return yy + '-' + md; };
  let next = at(y); if (next < today) next = at(y + 1);
  const inDays = Math.round((ms(next) - ms(today)) / 86400000), years = +next.slice(0, 4) - +date.slice(0, 4);
  return inDays <= days && years > 0 ? { in: inDays, years: years, day: next } : null;
}
module.exports = { paper, yearly };
