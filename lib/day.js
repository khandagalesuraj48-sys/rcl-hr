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
 *   shift: { start: 'HH:MM', end: 'HH:MM', break_min } – end before start = it ends the next day.
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
 * → { code, hours, late_min, early_min }   code:
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
  if (x.out === null || x.out === undefined) { out.code = x.day === x.today ? 'IN' : 'MIS'; return out; }
  const worked = Math.max(0, x.out - x.in) - (sh && sh.break_min ? sh.break_min * 60000 : 0);
  out.hours = Math.round(Math.max(0, worked) / 36000) / 100;
  if (free) { out.code = free + 'P'; return out; }
  out.code = r.full_hours !== undefined && out.hours < r.full_hours ? (r.half_hours !== undefined && out.hours < r.half_hours ? 'A' : r.half_hours !== undefined || out.hours > 0 ? 'HD' : 'A') : 'P';
  return out;
}
// a month's count of one person from his days ([{ code, late_min }]) – P, HD, A, WO, H, MIS, late days, days counted for pay
function total(days, r) {
  const t = { P: 0, HD: 0, A: 0, WO: 0, H: 0, MIS: 0, late: 0, paid: 0 };
  for (const d of days) { const c = d.code === 'WOP' || d.code === 'HP' || d.code === 'IN' ? 'P' : d.code; if (t[c] !== undefined) t[c]++; if (d.late_min > 0) t.late++; }
  const lateHalf = r && r.late_to_half > 0 ? Math.floor(t.late / r.late_to_half) : 0;
  t.late_half = lateHalf; t.paid = Math.max(0, t.P + t.HD * 0.5 + t.WO + t.H - lateHalf * 0.5);
  return t;
}
module.exports = { hm, at, weekday, addDays, rules, shift, validOn, shiftOf, status, total };
