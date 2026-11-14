/* THE RULE BOOK – what a policy may say, who it belongs to on a day, and what follows from it. Pure: no database here, so that
 * every rule can be tested alone (step 13, 13-11-2026).
 * His decisions of 13-11-2026:
 *   · A policy has a KIND; many policies of a kind; a change is a NEW VERSION FROM A DATE (a day is measured with the version of
 *     that day); a policy that was used is CLOSED, never deleted.
 *   · A person has ONE policy of each kind: his own (given to him from a date), else the one his site gives to everybody
 *     (the site's default), else NONE – then the site's rules of before count, exactly as they did.
 *   · Every policy says WHO VERIFIES and WHO APPROVES (by role or by name, with a stand-in); "verify" may be left out.
 * The kinds and what each says (everything is optional unless said – a thing left empty is not applied, no number in the code):
 *   attendance  full_hours, half_hours, once
 *   late        grace_min, early_min, free (late + early days of a month that are only marked – every one after them is a
 *               half day), half_after_min (IN this much after the shift's start = a half day at once),
 *               half_before_min (OUT this much before the shift's end = a half day at once)
 *   weekoff     days [0 = Sunday … 6], nth { weekday: [1 … 5] } – only the 1st / 2nd / … of that weekday in the month are off
 *               (a Saturday off on the 2nd and 4th: nth { 6: [2, 4] })
 *   leave       earn 'month' (per_month leaves at the month's start) | 'sunday' (one for each Sunday worked, at most
 *               per_month a month), per_month, carry, auto_absent, exit 'pay' | 'none', exit_max
 *   compoff     result 'leave' | 'pay' | 'none', full_shift (true: only a whole shift on a day off earns it)
 *   overtime    after_min, round_min, result 'pay' | 'leave' | 'none', rate (1 = the plain hourly rate)                */
'use strict';
const KINDS = ['attendance', 'late', 'weekoff', 'leave', 'compoff', 'overtime'];
const KIND_NAME = { attendance: 'Attendance', late: 'Late coming & early going', weekoff: 'Weekly off', leave: 'Leave', compoff: 'Comp-off', overtime: 'Overtime' };
const ROLES = ['reporting', 'site_hr', 'ho_hr', 'super'];
const ROLE_NAME = { reporting: 'Reporting person', site_hr: 'Site HR Admin', ho_hr: 'HO HR', super: 'Super Admin' };
const str = (v, n) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 120);
const blank = v => v === undefined || v === null || v === '';
const yes = v => v === true || v === 'yes' || v === 1 || v === '1' || v === 'true';
const isDay = v => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(v || ''));

/* a number that may be left empty: put into [out] only when it is filled and in order */
function num(x, out, errors, key, name, min, max, opt) {
  if (blank(x[key])) return;
  const v = typeof x[key] === 'number' ? x[key] : Number(String(x[key]).trim());
  if (!Number.isFinite(v) || v < min || v > max || (opt && opt.whole && v !== Math.round(v)) || (opt && opt.half && Math.round(v * 2) !== v * 2)) errors.push(name + ': ' + min + ' to ' + max + '.'); else out[key] = v;
}
function pick(x, out, errors, key, name, list, need) {
  const v = str(x[key], 20).toLowerCase();
  if (!v) { if (need) errors.push(name + ': choose one.'); return; }
  if (list.indexOf(v) < 0) errors.push(name + ': ' + list.join(' / ') + '.'); else out[key] = v;
}

/* what a policy of [kind] says, as typed → { body, errors } (only what is filled is kept) */
function body(kind, x) {
  x = x || {}; const out = {}, errors = [];
  if (kind === 'attendance') {
    num(x, out, errors, 'full_hours', 'Hours for a full day', 1, 24); num(x, out, errors, 'half_hours', 'Hours for a half day', 0.5, 24); if (yes(x.once)) out.once = true;
    if (out.full_hours !== undefined && out.half_hours !== undefined && out.half_hours >= out.full_hours) errors.push('Hours for a half day must be less than the hours for a full day.');
  } else if (kind === 'late') {
    num(x, out, errors, 'grace_min', 'Late after (minutes)', 0, 240, { whole: true }); num(x, out, errors, 'early_min', 'Early before (minutes)', 0, 240, { whole: true });
    num(x, out, errors, 'free', 'Late / early days allowed in a month', 0, 31, { whole: true });
    num(x, out, errors, 'half_after_min', 'Half day when later than (minutes)', 1, 720, { whole: true }); num(x, out, errors, 'half_before_min', 'Half day when gone earlier than (minutes)', 1, 720, { whole: true });
    if (out.half_after_min !== undefined && out.grace_min !== undefined && out.half_after_min <= out.grace_min) errors.push('Half day when later than: it must be more than "late after".');
    if (out.half_before_min !== undefined && out.early_min !== undefined && out.half_before_min <= out.early_min) errors.push('Half day when gone earlier than: it must be more than "early before".');
  } else if (kind === 'weekoff') {
    const days = Array.isArray(x.days) ? [...new Set(x.days.map(v => Math.round(Number(v))))].filter(v => v >= 0 && v <= 6).sort() : [];
    const nth = {}; Object.keys(x.nth && typeof x.nth === 'object' ? x.nth : {}).forEach(k => { const wd = Math.round(Number(k)), list = Array.isArray(x.nth[k]) ? [...new Set(x.nth[k].map(v => Math.round(Number(v))))].filter(v => v >= 1 && v <= 5).sort() : []; if (wd >= 0 && wd <= 6 && list.length && list.length < 5 && days.indexOf(wd) < 0) nth[wd] = list; else if (wd >= 0 && wd <= 6 && list.length === 5 && days.indexOf(wd) < 0) days.push(wd); });
    days.sort(); if (days.length > 6) errors.push('Weekly off: at most 6 days of the week.');
    out.days = days; if (Object.keys(nth).length) out.nth = nth;
  } else if (kind === 'leave') {
    pick(x, out, errors, 'earn', 'How leave is earned', ['month', 'sunday'], true);
    if (blank(x.per_month)) errors.push('Leaves a month: 0 to 31 (halves allowed).'); else num(x, out, errors, 'per_month', 'Leaves a month', 0, 31, { half: true });
    out.carry = x.carry !== false && x.carry !== 'no' && x.carry !== 0; out.auto_absent = yes(x.auto_absent);
    pick(x, out, errors, 'exit', 'Unused leave when he is relieved', ['pay', 'none']); num(x, out, errors, 'exit_max', 'Relieving: at most so many days are paid', 0, 366, { half: true });
    if (out.earn === 'sunday' && out.per_month !== undefined && out.per_month !== Math.round(out.per_month)) errors.push('Leaves a month: a whole number when a leave is earned by a Sunday worked.');
  } else if (kind === 'compoff') {
    pick(x, out, errors, 'result', 'Work on a day off gives', ['leave', 'pay', 'none'], true); out.full_shift = x.full_shift !== false && x.full_shift !== 'no' && x.full_shift !== 0;
  } else if (kind === 'overtime') {
    num(x, out, errors, 'after_min', 'Counted when later than the shift\'s end by (minutes)', 0, 600, { whole: true }); num(x, out, errors, 'round_min', 'Counted in steps of (minutes)', 1, 120, { whole: true });
    pick(x, out, errors, 'result', 'Overtime gives', ['pay', 'leave', 'none'], true); num(x, out, errors, 'rate', 'Pay: times the hourly rate', 0.5, 4);
  } else errors.push('Unknown kind of policy.');
  return { body: out, errors: errors };
}

/* who verifies and who approves, as typed → { auth, errors }.  A step is a list of people who may do it, each
 * { role } or { email, stand_in } (a named person; stand_in = who does it when he cannot).  "verify" may be empty. */
function auth(x) {
  x = x || {}; const errors = [];
  const step = (list, name) => (Array.isArray(list) ? list : []).map(p => {
    p = p || {}; const role = str(p.role, 20).toLowerCase(), email = str(p.email, 120).toLowerCase(), sub = str(p.stand_in, 120).toLowerCase();
    if (role) { if (ROLES.indexOf(role) < 0) { errors.push(name + ': an unknown role.'); return null; } return { role: role }; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { errors.push(name + ': choose a role or a person.'); return null; }
    if (sub && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(sub)) { errors.push(name + ': the stand-in is not a person\'s e-mail.'); return null; }
    return sub && sub !== email ? { email: email, stand_in: sub } : { email: email };
  }).filter(Boolean).slice(0, 6);
  const out = { verify: step(x.verify, 'Who verifies'), approve: step(x.approve, 'Who approves') };
  if (!out.approve.length) errors.push('Who approves: at least one role or person.');
  return { auth: out, errors: errors };
}
/* may this person do a step?  who: { email, roles: { super, ho_hr, site_hr }, reports: true when the asker reports to him } */
function mayDo(list, who) {
  who = who || {}; const r = who.roles || {}, mail = str(who.email, 120).toLowerCase();
  if (r.super) return true;      // the Super Admin can always decide
  return (list || []).some(p => (p.role ? (p.role === 'reporting' ? !!who.reports : p.role === 'site_hr' ? !!r.site_hr : p.role === 'ho_hr' ? !!r.ho_hr : false) : (p.email === mail || p.stand_in === mail)));
}
/* where a new request starts and what a decision does.  a: the policy's auth (taken when it was asked) */
const firstStage = a => ((a && a.verify && a.verify.length) ? 'verify' : 'approve');
function decide(ask, yesNo, who, at) {
  const stage = ask.stage || firstStage(ask.auth), list = (ask.auth || {})[stage] || [];
  if (ask.status !== 'pending') return { error: 'This was decided already.' };
  if (!mayDo(list, who)) return { error: stage === 'verify' ? 'This waits for another person to verify it.' : 'This waits for another person to approve it.' };
  const steps = (ask.steps || []).concat([{ stage: stage, by: str(who.email, 120).toLowerCase(), at: at, ok: !!yesNo, note: str(who.note, 200) }]);
  if (!yesNo) return { status: 'refused', stage: stage, steps: steps, done: true };
  if (stage === 'verify') return { status: 'pending', stage: 'approve', steps: steps, done: false };
  return { status: 'approved', stage: 'approve', steps: steps, done: true };
}

/* the newest row whose valid_from is not after the day (rows of one thing; a later row of the same date wins) */
const validOn = (rows, day) => (rows || []).filter(r => r.valid_from <= day).sort((a, b) => (a.valid_from < b.valid_from ? 1 : a.valid_from > b.valid_from ? -1 : (b.id || 0) - (a.id || 0)))[0] || null;
/* THE POLICY OF A PERSON ON A DAY, for one kind.
 * ctx: { assign: [his rows of this kind], defaults: [his site's rows of this kind], versions: { policyId: [rows] } }
 * → { policy_id, from: 'person' | 'site', body, auth, version_id } or null (no policy of the Rule Book: the rules of before). */
function policyOn(ctx, day) {
  const own = validOn(ctx.assign, day), site = validOn(ctx.defaults, day);
  const pid = own && own.policy_id ? own.policy_id : site && site.policy_id ? site.policy_id : null; if (!pid) return null;
  const v = validOn((ctx.versions || {})[pid], day); if (!v) return null;      // the policy says nothing yet on that day
  return { policy_id: pid, from: own && own.policy_id ? 'person' : 'site', body: v.body || {}, auth: v.auth || {}, version_id: v.id };
}

/* WEEKLY OFF: is this day off by the policy?  nth: the 1st … 5th of that weekday in its month.  said: the HR office's word
 * on this very day (hr_weekoff_days: true / false) – it wins (a fifth Saturday of one month). */
const weekday = day => new Date(day + 'T00:00:00Z').getUTCDay();
const nthOf = day => Math.floor((+day.slice(8, 10) - 1) / 7) + 1;
function isOff(b, day, said) {
  if (said === true || said === false) return said;
  b = b || {}; const wd = weekday(day);
  if ((b.days || []).indexOf(wd) > -1) return true;
  const list = b.nth && (b.nth[wd] || b.nth[String(wd)]);
  return !!list && list.indexOf(nthOf(day)) > -1;
}
/* the rules a day is measured with (lib/day.js reads these names) from the person's policies of that day; a kind he has no
 * policy for keeps what the site's own rules say.  p: { attendance, late, weekoff } – each a policy body or null */
function dayRules(siteRules, p, day, said) {
  const r = Object.assign({}, siteRules || {});
  if (p && p.attendance) { delete r.full_hours; delete r.half_hours; delete r.once; Object.assign(r, p.attendance); }
  if (p && p.late) {
    ['grace_min', 'early_min', 'late_free', 'late_to_half', 'half_after_min'].forEach(k => { delete r[k]; });
    const l = p.late; if (l.grace_min !== undefined) r.grace_min = l.grace_min; if (l.early_min !== undefined) r.early_min = l.early_min; if (l.half_after_min !== undefined) r.half_after_min = l.half_after_min;
    if (l.half_before_min !== undefined) r.half_before_min = l.half_before_min; if (l.free !== undefined) { r.late_free = l.free; r.early_counts = true; }      // late and early days are counted together
  }
  if (p && p.weekoff) r.week_off = isOff(p.weekoff, day, said) ? [weekday(day)] : [];
  else if (said === true || said === false) r.week_off = said ? [weekday(day)] : (r.week_off || []).filter(w => w !== weekday(day));
  return r;
}

/* OVERTIME of a day in minutes: the time after the shift's end, counted only when it is at least after_min, in steps of
 * round_min (50 minutes in steps of 30 = 30).  b: the overtime policy; out, end: moments in ms. */
function overtimeMin(b, out, end) {
  if (!b || out === null || out === undefined || end === null || end === undefined) return 0;
  const extra = Math.floor((out - end) / 60000); if (extra <= 0 || extra < (b.after_min || 0)) return 0;
  const step = b.round_min || 1; return Math.floor(extra / step) * step;
}
/* overtime as leave: so many hours as the shift has = one day (halves)  →  days, 0.5 steps */
const overtimeDays = (minutes, shiftHours) => (shiftHours > 0 ? Math.floor((minutes / 60) / shiftHours * 2) / 2 : 0);
/* COMP-OFF of a day worked on a weekly off / a holiday: 1 when the policy gives it (a whole shift when it asks for one) */
function compoffDays(b, code, hours, shiftHours) {
  if (!b || b.result === 'none' || (code !== 'WOP' && code !== 'HP')) return 0;
  if (b.full_shift === false) return hours > 0 ? 1 : 0;
  return shiftHours > 0 && hours >= shiftHours ? 1 : 0;
}
/* A BULK CORRECTION changes a day only in the person's favour: A → P, A → HD, A → leave. Everything else is refused. */
const IMPORT_TO = { P: 'P', HD: 'HD', L: 'L', LV: 'L', LEAVE: 'L' };
function importChange(was, typed, before) {
  const to = IMPORT_TO[str(typed, 8).toUpperCase()] || '', from = str(was, 8).toUpperCase();
  if (!str(typed, 8) || str(typed, 8).toUpperCase() === from) return { skip: true };
  if (!to) return { error: 'Only P, HD or L can be written.' };
  // (14-11-2026) an EMPTY day of before attendance began at the site (he was an employee then): it can be filled – that is in his favour
  if (from === '' && before === true) return { to: to };
  // an absent day; a day that reads L because a leave paid for the absence (→ present / half day: the leave is not taken then); a half day → present
  if (from !== 'A' && from !== 'MIS' && !(from === 'L' && to !== 'L') && !(from === 'HD' && to === 'P')) return { error: 'Only an absent day (or a half day → present) can be set right here.' };
  return { to: to };
}

module.exports = { KINDS, KIND_NAME, ROLES, ROLE_NAME, body, auth, mayDo, firstStage, decide, validOn, policyOn, isOff, nthOf, weekday, dayRules, overtimeMin, overtimeDays, compoffDays, importChange, isDay, str };
