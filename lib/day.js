/* ONE DAY OF ONE PERSON – what the muster shows, worked out in one place (step 5, 12-11-2026).
 * His rule: the late / half-day / absent rules are SETTINGS WITH DATES, never numbers in the code – a day is always measured
 * with the rules and the shift that were valid on THAT day. A rule that is not filled in is simply not applied: with no rules at
 * all, a day with IN and OUT is Present.
 *   rules (hr_att_rules.rules):  full_hours   – so many hours = a full day
 *                                half_hours   – at least so many = a half day (below: absent)
 *                                grace_min    – minutes after the shift's start that are not "late"
 *                                early_min    – minutes before the shift's end that are not "left early"
 *                                late_to_half – so many late days in a month count as one half day (0 / empty = never)
 *                                week_off     – the weekly days off, 0 = Sunday … 6 = Saturday
 *   (12-11-2026, his words: "user 1 day madhe fkt ekadach sign in and sign out … late mark 3 allow aahet … 4th late mark pasun
 *    direct half day … no late mark policy rule asel")
 *                                once         – true: one IN and one OUT a day (the server refuses a second IN)
 *                                late_free    – so many late days in a month are only marked; every late day after them counts
 *                                               as a HALF DAY (empty = late days are only marked)
 *                                half_after_min – IN later than the shift's start + so many minutes = a half day at once
 *   No late policy at all = grace_min left empty: nobody is "late".
 *   shift: { start: 'HH:MM', end: 'HH:MM', break_min, auto_out } – end before start = it ends the next day.
 *     auto_out ('HH:MM', step 8): he forgot OUT – at this time the day is closed by itself and counts as ABSENT (he can ask to
 *     set it right). At or before the shift's start = that time on the NEXT day (a night shift). Empty = never: "IN without OUT".
 * Times are India's (UTC+05:30, no summer time). */
'use strict';
const IST = 19800000;
const num = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const hm = v => { const m = /^([01]?\d|2[0-3]):([0-5]\d)(:\d\d)?$/.exec(String(v || '').trim()); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : null; };
const minOf = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
// the moment (ms) of HH:MM on a day in India
const at = (day, t) => Date.parse(day + 'T' + t + ':00.000Z') - IST;
const weekday = day => new Date(day + 'T00:00:00Z').getUTCDay();
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// the rules as typed → { rules, errors } (only what is filled is kept)
function rules(x) {
  x = x || {}; const out = {}, errors = [];
  const n = (k, name, min, max, whole) => { if (x[k] === undefined || x[k] === null || x[k] === '') return; const v = num(x[k]); if (!Number.isFinite(v) || v < min || v > max || (whole && v !== Math.round(v))) errors.push(name + ': ' + min + ' to ' + max + '.'); else out[k] = v; };
  n('full_hours', 'Hours for a full day', 1, 24); n('half_hours', 'Hours for a half day', 0.5, 24); n('grace_min', 'Grace minutes', 0, 240, true); n('early_min', 'Early-leaving minutes', 0, 240, true); n('late_to_half', 'Late days for one half day', 0, 31, true);
  n('late_free', 'Late days allowed in a month', 0, 31, true); n('half_after_min', 'Half day when later than (minutes)', 1, 720, true); if (x.once === true || x.once === 'yes' || x.once === 1 || x.once === '1') out.once = true;
  if (out.half_after_min !== undefined && out.grace_min !== undefined && out.half_after_min <= out.grace_min) errors.push('Half day when later than: it must be more than the grace minutes.');
  if (out.full_hours !== undefined && out.half_hours !== undefined && out.half_hours >= out.full_hours) errors.push('Hours for a half day must be less than the hours for a full day.');
  if (Array.isArray(x.week_off)) { const w = [...new Set(x.week_off.map(v => Math.round(num(v))))].filter(v => v >= 0 && v <= 6).sort(); if (w.length > 6) errors.push('Weekly off: at most 6 days.'); else out.week_off = w; }
  return { rules: out, errors };
}
// a shift as typed → { row, errors }
function shift(x) {
  x = x || {}; const errors = [], row = {};
  row.name = String(x.name === undefined || x.name === null ? '' : x.name).replace(/\s+/g, ' ').trim().slice(0, 40); if (row.name.length < 2) errors.push('Name: at least 2 letters.');
  row.start_time = hm(x.start_time); if (!row.start_time) errors.push('Starts at: a time as HH:MM.');
  row.end_time = hm(x.end_time); if (!row.end_time) errors.push('Ends at: a time as HH:MM.');
  if (row.start_time && row.end_time && row.start_time === row.end_time) errors.push('A shift cannot start and end at the same time.');
  if (x.auto_out !== undefined && x.auto_out !== null && String(x.auto_out).trim() !== '') { row.auto_out = hm(x.auto_out); if (!row.auto_out) errors.push('Closed by itself at: a time as HH:MM.'); else if (row.auto_out === row.start_time) errors.push('Closed by itself at: not the time the shift starts.'); } else row.auto_out = null;
  const b = x.break_min === undefined || x.break_min === null || x.break_min === '' ? 0 : num(x.break_min); if (!Number.isFinite(b) || b < 0 || b > 240 || b !== Math.round(b)) errors.push('Break: 0 to 240 minutes.'); else row.break_min = b;
  return { row, errors };
}
// the version valid on a day: the newest row whose valid_from is not after it (rows: [{ valid_from, … }])
const validOn = (rows, day) => (rows || []).filter(r => r.valid_from <= day).sort((a, b) => (a.valid_from < b.valid_from ? 1 : a.valid_from > b.valid_from ? -1 : String(b.created_at || '').localeCompare(String(a.created_at || ''))))[0] || null;
/* the person's shift on a day: the most exact one wins – chosen for him, then his department, then his category, then everybody
 * (shifts: [{ id, scope, scope_values, valid_from, active, … }], chosen: { shiftId: true } for this person) */
function shiftOf(shifts, emp, day, chosen) {
  const rank = s => (s.scope === 'people' ? (chosen && chosen[s.id] ? 4 : 0) : s.scope === 'department' ? ((s.scope_values || []).indexOf(emp.department_id) > -1 ? 3 : 0) : s.scope === 'category' ? ((s.scope_values || []).indexOf(emp.category) > -1 ? 2 : 0) : 1);
  return (shifts || []).filter(s => s.active && !s.removed_at && s.valid_from <= day).map(s => ({ s, r: rank(s) })).filter(x => x.r > 0).sort((a, b) => b.r - a.r || (a.s.valid_from < b.s.valid_from ? 1 : -1))[0]?.s || null;
}
/* THE DAY.  x: { day, today, now, in, out (ms or null), holiday (its name or ''), rules, shift }
 * → { code, hours, late_min, early_min, auto (closed by itself), late_half (a half day for coming too late) }   code:
 *   ''   a day to come, or today with nothing yet        P   present          HD  half day        A   absent
 *   IN   at work now (today, IN without OUT)             MIS IN without OUT on a past day – to be set right (regularization)
 *   WO   weekly off      H   holiday       WOP / HP  worked on a weekly off / a holiday */
function status(x) {
  const r = x.rules || {}, off = (r.week_off || []).indexOf(weekday(x.day)) > -1, free = x.holiday ? 'H' : off ? 'WO' : '';
  const out = { code: '', hours: 0, late_min: 0, early_min: 0 };
  if (x.day > x.today) return out;
  if (x.in === null || x.in === undefined) { out.code = free || (x.day === x.today ? '' : 'A'); return out; }
  const sh = x.shift && hm(x.shift.start_time) && hm(x.shift.end_time) ? x.shift : null;
  if (sh) {
    const st = at(x.day, hm(sh.start_time)), en = at(minOf(hm(sh.end_time)) <= minOf(hm(sh.start_time)) ? addDays(x.day, 1) : x.day, hm(sh.end_time));
    if (r.grace_min !== undefined && x.in > st + r.grace_min * 60000) out.late_min = Math.floor((x.in - st) / 60000);
    if (r.early_min !== undefined && x.out !== null && x.out !== undefined && x.out < en - r.early_min * 60000) out.early_min = Math.floor((en - x.out) / 60000);
  }
  if (x.out === null || x.out === undefined) {
    // (step 8) he forgot OUT: at the shift's own time the day is closed by itself – absent
    const ao = autoOutAt(sh, x.day);
    if (ao !== null && x.in < ao && (x.now === undefined || x.now === null ? x.day < x.today : x.now >= ao)) { out.code = free || 'A'; out.auto = true; return out; }      // (an IN after that time is not closed by it)
    out.code = x.day === x.today ? 'IN' : 'MIS'; return out;
  }
  const worked = Math.max(0, x.out - x.in) - (sh && sh.break_min ? sh.break_min * 60000 : 0);
  out.hours = Math.round(Math.max(0, worked) / 36000) / 100;
  if (free) { out.code = free + 'P'; return out; }
  out.code = r.full_hours !== undefined && out.hours < r.full_hours ? (r.half_hours !== undefined && out.hours < r.half_hours ? 'A' : r.half_hours !== undefined || out.hours > 0 ? 'HD' : 'A') : 'P';
  if (out.code === 'P' && sh && r.half_after_min !== undefined && out.late_min >= r.half_after_min) { out.code = 'HD'; out.late_half = true; }
  return out;
}
// the moment a forgotten OUT of [day] is closed by itself (ms), or null when the shift has no such time
function autoOutAt(sh, day) {
  const t = sh && hm(sh.auto_out), st = sh && hm(sh.start_time); if (!t || !st) return null;
  return at(minOf(t) <= minOf(st) ? addDays(day, 1) : day, t);
}
/* WHERE A PERSON'S DAY STANDS NOW – for the phone and for the server's check of a punch.
 * list: his punches of yesterday and today in order ([{ kind, day, at }]); shiftOn(day) → his shift of that day (or null).
 *   open   – the IN that waits for its OUT: today's, or yesterday evening's of a night shift – until that shift's own closing
 *            time (without one: today's stays open all day, yesterday's for 20 hours – as the muster pairs them)
 *   closed – the moment today's IN was closed by itself, or null
 *   next   – 'out' while an IN is open; 'done' when "once a day" is on and today has its IN; else 'in'
 *   shown  – what the phone lists: today's punches, with the open IN of yesterday before them */
function stand(list, now, day, r, shiftOn) {
  r = r || {}; const last = list[list.length - 1], today = list.filter(p => p.day === day); let open = null, closed = null;
  if (last && last.kind === 'in') {
    const t = Date.parse(last.at), ao = autoOutAt(shiftOn(last.day), last.day), shut = ao !== null && t < ao;
    if (shut ? now < ao : last.day === day || now - t <= 20 * 3600000) open = last; else if (shut && last.day === day) closed = ao;
  }
  return { today: today, shown: open && open.day !== day ? [open].concat(today) : today, open: open, closed: closed, next: open ? 'out' : r.once && today.some(p => p.kind === 'in') ? 'done' : 'in' };
}
/* THE LATE DAYS OF A MONTH (rule late_free): the first so many are only marked; every late day after them is a half day.
 * days: one person's days in order, each { day, code, late_min } – whole months (a month cut at its start would count wrongly).
 * rulesOn(day) → the rules valid on that day. Changes the days in place. */
function lateHalves(days, rulesOn) {
  let month = '', n = 0;
  for (const d of days) {
    if (d.day.slice(0, 7) !== month) { month = d.day.slice(0, 7); n = 0; }
    if (!(d.late_min > 0) || ['P', 'HD', 'WOP', 'HP'].indexOf(d.code) < 0) continue;
    n++; const r = rulesOn(d.day) || {};
    if (r.late_free !== undefined && n > r.late_free && d.code === 'P') { d.code = 'HD'; d.late_half = true; }
  }
  return days;
}
// a month's count of one person from his days ([{ code, late_min }]) – P, HD, A, WO, H, MIS, late days, days counted for pay
function total(days, r) {
  const t = { P: 0, HD: 0, A: 0, WO: 0, H: 0, MIS: 0, late: 0, paid: 0 };
  for (const d of days) { const c = d.code === 'WOP' || d.code === 'HP' || d.code === 'IN' ? 'P' : d.code; if (t[c] !== undefined) t[c]++; if (d.late_min > 0) t.late++; }
  const lateHalf = r && r.late_to_half > 0 ? Math.floor(t.late / r.late_to_half) : 0;
  t.late_half = lateHalf; t.paid = Math.max(0, t.P + t.HD * 0.5 + t.WO + t.H - lateHalf * 0.5);
  return t;
}
module.exports = { hm, at, weekday, addDays, rules, shift, validOn, shiftOf, status, total, autoOutAt, lateHalves, stand };
