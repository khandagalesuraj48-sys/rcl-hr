/* THE ACTIONS OF THE MUSTER (api/hr.js sends them here) – step 5 (12-11-2026).
 *   The HR office: shifts, holidays, the rules with their dates, the Admin's powers (Super Admin), the muster of a month, one
 *   day of one person, a manual entry / a correction, the requests.
 *   A person for himself: his month, a request to set an old day right; the requests of the people who report to him.
 * Nothing here changes a punch: what counts for a day instead of its punches is a NEW row (hr_day_entries) with the old times,
 * the new times, the reason, who and when. */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const D = require('./day');
const A = require('./attend');
const power = require('./powers');
const { me, hm, id, needOffice, placesOf } = require('./act_attend');

const REG_DAYS = 60;      // a request / an HR Admin's entry reaches this many days back (the Super Admin: any day)
const soft = p => p.catch(e => { if (e && e.code === 'notinstalled') return []; throw e; });
// every row of a query (the database gives at most 1000 at a time)
async function all(path) { const out = []; for (let off = 0; off < 200000; off += 1000) { const r = (await db('GET', path + '&limit=1000&offset=' + off)) || []; r.forEach(x => out.push(x)); if (r.length < 1000) break; } return out; }
const chunks = (list, n) => { const o = []; for (let i = 0; i < list.length; i += n) o.push(list.slice(i, i + n)); return o; };
const monthOf = v => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v)) ? String(v) : R.today().slice(0, 7));
const lastDay = m => m + '-' + String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate()).padStart(2, '0');
const empOf = async (s, empId) => { const e = ((await db('GET', 'hr_employees?select=id,code,name,category,site,department_id,reports_to,status,joined_on,left_on&id=eq.' + empId + '&site=eq.' + enc(s.site))) || [])[0]; if (!e) throw fail(404, 'This employee was not found on this site.', 'notfound'); return e; };

/* what the site's days are measured with: rule versions, shifts (with their chosen people), holidays */
async function setup(site) {
  const [rules, shifts, hol] = await Promise.all([soft(db('GET', 'hr_att_rules?select=id,valid_from,rules,created_by,created_at&site=eq.' + enc(site) + '&order=valid_from.desc,id.desc&limit=200')),
    soft(db('GET', 'hr_shifts?select=id,name,start_time,end_time,break_min,scope,scope_values,valid_from,active,removed_at&site=eq.' + enc(site) + '&removed_at=is.null&order=name')),
    soft(db('GET', 'hr_holidays?select=id,day,name&site=eq.' + enc(site) + '&removed_at=is.null&order=day'))]);
  const sp = {}, pids = (shifts || []).filter(x => x.scope === 'people').map(x => x.id);
  for (const c of chunks(pids, 60)) ((await db('GET', 'hr_shift_people?select=shift_id,employee_id&shift_id=in.(' + c.join(',') + ')')) || []).forEach(r => { (sp[r.shift_id] = sp[r.shift_id] || []).push(r.employee_id); });
  // the first day anything was recorded at this site: the days before it are left empty (nobody is "absent" before attendance began)
  const [p0, e0] = await Promise.all([soft(db('GET', 'hr_punches?select=day&site=eq.' + enc(site) + '&order=day&limit=1')), soft(db('GET', 'hr_day_entries?select=day&site=eq.' + enc(site) + '&order=day&limit=1'))]);
  const firsts = [(p0 || [])[0], (e0 || [])[0]].filter(Boolean).map(r => r.day).sort();
  return { start: firsts[0] || '', rules: rules || [], shifts: (shifts || []).map(x => Object.assign({}, x, { start_time: D.hm(x.start_time), end_time: D.hm(x.end_time), people: sp[x.id] || [] })), holidays: hol || [] };
}
/* THE DAYS of some employees between two dates: for each day what counts (IN, OUT, where it comes from) and its code.
 * where: 'site=eq.X' (the muster) or 'employee_id=eq.X' (one person). A punch counts when it is in order, or was doubtful and
 * accepted. A night shift: an OUT after midnight closes the IN of the evening before (within 20 hours). */
async function daysOf(site, where, emps, from, to, cfg) {
  const today = R.today(), until = D.addDays(to, 1);
  const [punches, entries] = await Promise.all([all('hr_punches?select=id,employee_id,kind,day,at,status&' + where + '&day=gte.' + from + '&day=lte.' + until + '&order=at'),
    soft(all('hr_day_entries?select=id,employee_id,day,in_at,out_at,source&' + where + '&day=gte.' + from + '&day=lte.' + to + '&order=id'))]);
  const doubt = punches.filter(p => p.status === 'review').map(p => p.id), ok = {};
  for (const c of chunks(doubt, 60)) ((await db('GET', 'hr_punch_reviews?select=punch_id,decision&punch_id=in.(' + c.join(',') + ')')) || []).forEach(r => { if (r.decision === 'accepted') ok[r.punch_id] = 1; });
  const cell = {}, key = (e, d) => e + '|' + d, open = {}, wait = {};
  for (const p of punches) {
    if (p.status === 'review' && !ok[p.id]) { if (p.day <= to) wait[key(p.employee_id, p.day)] = (wait[key(p.employee_id, p.day)] || 0) + 1; continue; }
    const t = Date.parse(p.at);
    if (p.kind === 'in') { const k = key(p.employee_id, p.day), c = (cell[k] = cell[k] || { in: null, out: null, n: 0 }); c.n++; if (c.in === null) c.in = t; c.out = null; open[p.employee_id] = { k: k, t: t }; }      // IN again (back from a break): at work, no OUT yet
    else { const o = open[p.employee_id], k = o && t - o.t <= 20 * 3600000 ? o.k : key(p.employee_id, p.day), c = (cell[k] = cell[k] || { in: null, out: null, n: 0 }); c.n++; c.out = t; }
  }
  const ent = {}; (entries || []).forEach(e => { ent[key(e.employee_id, e.day)] = e; });
  const hol = {}; cfg.holidays.forEach(h => { hol[h.day] = h.name; });
  const chosen = {}; cfg.shifts.forEach(sh => (sh.people || []).forEach(e => { (chosen[e] = chosen[e] || {})[sh.id] = 1; }));
  const days = []; for (let d = from; d <= to; d = D.addDays(d, 1)) days.push(d);
  const rows = emps.map(e => {
    const list = days.map(d => {
      const k = key(e.id, d), c = cell[k] || { in: null, out: null, n: 0 }, x = ent[k], rl = D.validOn(cfg.rules, d), sh = D.shiftOf(cfg.shifts, e, d, chosen[e.id]);
      let i = c.in, o = c.out !== null && c.in !== null && c.out > c.in ? c.out : null, src = c.n ? 'punch' : '';
      if (x) { i = x.in_at ? Date.parse(x.in_at) : null; o = x.out_at ? Date.parse(x.out_at) : null; src = x.source; }
      const before = !cfg.start || d < cfg.start || (e.joined_on && d < e.joined_on) || (e.left_on && d > e.left_on);
      const st = before ? { code: '', hours: 0, late_min: 0, early_min: 0 } : D.status({ day: d, today: today, in: i, out: o, holiday: hol[d] || '', rules: rl ? rl.rules : {}, shift: sh });
      return { day: d, code: st.code, hours: st.hours, late_min: st.late_min, early_min: st.early_min, in: i, out: o, src: src, punches: c.n, review: wait[k] || 0, holiday: hol[d] || '', shift: sh ? sh.name : '' };
    });
    const rl = D.validOn(cfg.rules, to);
    return { emp: e, days: list, total: D.total(list, rl ? rl.rules : {}) };
  });
  return { days: days, rows: rows };
}
const hmOf = ms => (ms === null || ms === undefined ? '' : new Date(ms + 19800000).toISOString().slice(11, 16));
const dayOut = d => ({ day: d.day, code: d.code, hours: d.hours, late_min: d.late_min, early_min: d.early_min, in: hmOf(d.in), out: hmOf(d.out), next_day: d.in !== null && d.out !== null && R.today(d.out) > R.today(d.in), src: d.src, punches: d.punches, review: d.review, holiday: d.holiday, shift: d.shift });
// the times of a form (HH:MM on the day; OUT may be the next morning) → moments, checked
function times(day, x, base) {
  const it = x.in_time === undefined || x.in_time === null || x.in_time === '' ? null : D.hm(x.in_time), ot = x.out_time === undefined || x.out_time === null || x.out_time === '' ? null : D.hm(x.out_time);
  if ((x.in_time && !it) || (x.out_time && !ot)) throw fail(400, 'Time: as HH:MM (for example 09:05).', 'time');
  const i = it ? D.at(day, it) : base ? base.in : null, o = ot ? D.at(x.out_next_day ? D.addDays(day, 1) : day, ot) : base ? base.out : null;
  if (i === null && o === null) throw fail(400, 'Give the IN time, the OUT time, or both.', 'time');
  if (i === null) throw fail(400, 'This day has no IN: give the IN time too.', 'time');
  if (o !== null && o <= i) throw fail(400, 'OUT must be after IN (tick "next day" when he left after midnight).', 'time');
  if (o !== null && o - i > 24 * 3600000) throw fail(400, 'IN to OUT cannot be more than 24 hours.', 'time');
  if (i > Date.now() || (o !== null && o > Date.now())) throw fail(400, 'A time that is still to come cannot be entered.', 'time');
  return { in: i, out: o };
}
async function oneDay(s, emp, day) { const cfg = await setup(emp.site); return (await daysOf(emp.site, 'employee_id=eq.' + emp.id, [emp], day, day, cfg)).rows[0].days[0]; }
const iso = ms => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
async function regRows(list) {
  const eids = [...new Set(list.map(r => r.employee_id))], by = {};
  for (const c of chunks(eids, 80)) ((await db('GET', 'hr_employees?select=id,code,name,category&id=in.(' + c.join(',') + ')')) || []).forEach(e => { by[e.id] = e; });
  return list.map(r => ({ id: r.id, code: (by[r.employee_id] || {}).code, name: (by[r.employee_id] || {}).name, day: r.day, in_time: D.hm(r.in_time) || '', out_time: D.hm(r.out_time) || '', out_next_day: r.out_next_day, reason: r.reason, status: r.status, level: r.level, steps: r.steps || [], asked_at: r.asked_at }));
}
const REG = 'id,employee_id,site,day,in_time,out_time,out_next_day,reason,status,level,steps,asked_by,asked_at';
// a request is approved for good: the day's new entry (what counted before is kept in it)
async function settle(s, r, emp, step) {
  const was = await oneDay(s, emp, r.day), t = times(r.day, { in_time: D.hm(r.in_time), out_time: D.hm(r.out_time), out_next_day: r.out_next_day }, { in: was.in, out: was.out });
  const done = (await db('PATCH', 'hr_regularize?id=eq.' + r.id + '&status=eq.pending', { status: 'approved', steps: (r.steps || []).concat([step]), decided_at: new Date().toISOString() }, 'return=representation')) || [];
  if (!done.length) throw fail(409, 'This request was already decided.', 'decided');
  await db('POST', 'hr_day_entries', [{ employee_id: emp.id, site: emp.site, day: r.day, in_at: iso(t.in), out_at: iso(t.out), old_in: iso(was.in), old_out: iso(was.out), source: 'regularized', reason: r.reason, request_id: r.id, entered_by: s.email }], 'return=minimal');
  await audit(emp.site, s.email, 'Request approved', emp.code + ' ' + r.day, { request: r.id, old: { in: hmOf(was.in), out: hmOf(was.out) }, new: { in: hmOf(t.in), out: hmOf(t.out) }, note: step.note });
}

const ACT = {
  /* ───────────── shifts, holidays, rules, powers ───────────── */
  async attSetup(s) {
    needOffice(s); const cfg = await setup(s.site), today = R.today(), now = D.validOn(cfg.rules, today);
    return { shifts: cfg.shifts, holidays: cfg.holidays, rules: now ? now.rules : {}, rules_from: now ? now.valid_from : '', versions: cfg.rules.map(r => ({ id: r.id, valid_from: r.valid_from, rules: r.rules, by: r.created_by, at: r.created_at })),
      powers: await power.of(s.site), power_list: power.POWERS, today: today };
  },
  async shiftSave(s, x) {
    await power.need(s, 'shifts'); const c = D.shift(x), sc = A.place({ name: 'xx', lat: 1, lng: 1, radius_m: 100, scope: x.scope, scope_values: x.scope_values, valid_from: x.valid_from });
    const errs = c.errors.concat(sc.errors); if (errs.length) throw fail(400, errs.join(' '), 'shift');
    const sid = id(x.id), row = Object.assign(c.row, { scope: sc.row.scope, scope_values: sc.row.scope_values, valid_from: sc.row.valid_from, active: x.active !== false, updated_by: s.email, updated_at: new Date().toISOString() });
    let people = [];
    if (row.scope === 'people') { const ids = [...new Set((Array.isArray(x.people) ? x.people : []).map(id).filter(Boolean))].slice(0, 2000); if (!ids.length) throw fail(400, 'For whom: choose at least one employee.', 'people');
      for (const ch of chunks(ids, 80)) ((await db('GET', 'hr_employees?select=id&site=eq.' + enc(s.site) + '&status=neq.left&id=in.(' + ch.join(',') + ')')) || []).forEach(r => people.push(r.id));
      if (people.length !== ids.length) throw fail(400, 'For whom: some of the chosen people are not employees of this site.', 'people'); }
    const had = (await db('GET', 'hr_shifts?select=id,name,start_time,end_time,break_min,scope,scope_values,valid_from,active&site=eq.' + enc(s.site) + '&removed_at=is.null')) || [];
    if (had.some(h => h.name.toLowerCase() === row.name.toLowerCase() && h.id !== sid)) throw fail(409, 'A shift with this name is already there.', 'duplicate');
    let shiftId = sid;
    if (sid) { const was = had.find(h => h.id === sid); if (!was) throw fail(404, 'This shift was not found on this site.', 'notfound'); await db('PATCH', 'hr_shifts?id=eq.' + sid, row, 'return=minimal'); await audit(s.site, s.email, 'Shift changed', row.name, { old: was, new: row, people: people.length }); }
    else { shiftId = (await db('POST', 'hr_shifts', [Object.assign({ site: s.site, created_by: s.email }, row)], 'return=representation'))[0].id; await audit(s.site, s.email, 'Shift added', row.name, { new: row, people: people.length }); }
    await db('DELETE', 'hr_shift_people?shift_id=eq.' + shiftId, undefined, 'return=minimal');
    for (const ch of chunks(people, 500)) await db('POST', 'hr_shift_people', ch.map(e => ({ shift_id: shiftId, employee_id: e, created_by: s.email })), 'return=minimal');
    return ACT.attSetup(s);
  },
  async shiftRemove(s, x) {
    await power.need(s, 'shifts'); const why = R.str(x.reason, 200); if (why.length < 3) throw fail(400, 'Reason: write why it is removed.', 'reason');
    const sh = ((await db('GET', 'hr_shifts?select=id,name&id=eq.' + id(x.id) + '&site=eq.' + enc(s.site) + '&removed_at=is.null')) || [])[0]; if (!sh) throw fail(404, 'This shift was not found on this site.', 'notfound');
    await db('PATCH', 'hr_shifts?id=eq.' + sh.id, { removed_at: new Date().toISOString(), removed_by: s.email, removed_reason: why, active: false }, 'return=minimal'); await audit(s.site, s.email, 'Shift removed', sh.name, { reason: why });
    return ACT.attSetup(s);
  },
  // one holiday, or a list of them (all or none)
  async holidaySave(s, x) {
    await power.need(s, 'shifts'); const rows = Array.isArray(x.rows) ? x.rows.slice(0, 100) : [{ day: x.day, name: x.name }], good = [], lines = [];
    const had = {}; ((await db('GET', 'hr_holidays?select=day&site=eq.' + enc(s.site) + '&removed_at=is.null')) || []).forEach(h => { had[h.day] = 1; });
    rows.forEach((r, i) => { const day = R.date(r && r.day), name = R.str(r && r.name, 60), e = []; if (!day) e.push('Day: a date as DD-MM-YYYY.'); if (name.length < 2) e.push('Name: at least 2 letters.'); if (day && had[day]) e.push('This day is already a holiday.'); if (day) had[day] = 1;
      if (e.length) lines.push({ line: i + 1, error: e.join(' ') }); else good.push({ site: s.site, day: day, name: name, created_by: s.email }); });
    if (lines.length) { if (!Array.isArray(x.rows)) throw fail(400, lines[0].error, 'holiday'); return { saved: 0, lines: lines }; }
    await db('POST', 'hr_holidays', good, 'return=minimal'); await audit(s.site, s.email, good.length === 1 ? 'Holiday added' : 'Holidays added', good.length === 1 ? good[0].day + ' ' + good[0].name : good.length + ' days', { days: good.map(g => g.day + ' ' + g.name) });
    return Object.assign({ saved: good.length, lines: [] }, await ACT.attSetup(s));
  },
  async holidayRemove(s, x) {
    await power.need(s, 'shifts'); const h = ((await db('GET', 'hr_holidays?select=id,day,name&id=eq.' + id(x.id) + '&site=eq.' + enc(s.site) + '&removed_at=is.null')) || [])[0]; if (!h) throw fail(404, 'This holiday was not found on this site.', 'notfound');
    await db('PATCH', 'hr_holidays?id=eq.' + h.id, { removed_at: new Date().toISOString(), removed_by: s.email }, 'return=minimal'); await audit(s.site, s.email, 'Holiday removed', h.day + ' ' + h.name, null);
    return ACT.attSetup(s);
  },
  // the rules from a date: a NEW version – the days before it keep the version they had
  async rulesSave(s, x) {
    await power.need(s, 'shifts'); const c = D.rules(x), today = R.today(), from = R.date(x.valid_from) || today;
    if (x.reg_levels !== undefined && x.reg_levels !== null && x.reg_levels !== '') { if (+x.reg_levels === 1 || +x.reg_levels === 2) c.rules.reg_levels = +x.reg_levels; else c.errors.push('Who decides a request: 1 or 2 levels.'); }
    if (c.errors.length) throw fail(400, c.errors.join(' '), 'rules');
    if (from < today && s.role !== 'super') throw fail(403, 'Rules for days already gone can be set only by the Super Admin.', 'past');
    const was = D.validOn((await setup(s.site)).rules, from);
    await db('POST', 'hr_att_rules', [{ site: s.site, valid_from: from, rules: c.rules, created_by: s.email }], 'return=minimal');
    await audit(s.site, s.email, 'Attendance rules set', 'from ' + from, { old: was ? was.rules : null, new: c.rules });
    return ACT.attSetup(s);
  },
  async powerSet(s, x) {
    if (s.role !== 'super') throw fail(403, 'Only the Super Admin gives or takes the HR Admin\'s powers.', 'role');
    const p = String(x.power || ''); if (power.KEYS.indexOf(p) < 0) throw fail(400, 'Unknown power.', 'power'); const on = x.allowed === true;
    const was = (await power.of(s.site))[p];
    await db('POST', 'hr_admin_powers?on_conflict=site,power', [{ site: s.site, power: p, allowed: on, set_by: s.email, set_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
    await audit(s.site, s.email, 'HR Admin\'s power ' + (on ? 'given' : 'taken'), p, { old: was, new: on });
    return ACT.attSetup(s);
  },

  /* ───────────── the muster ───────────── */
  async muster(s, x) {
    needOffice(s); const m = monthOf(x.month), from = m + '-01', to = lastDay(m), cat = R.CATS.indexOf(x.category) > -1 ? x.category : '';
    const emps = (await all('hr_employees?select=id,code,name,category,department_id,joined_on,left_on,status&site=eq.' + enc(s.site) + (cat ? '&category=eq.' + cat : '') + '&order=name,id')).filter(e => !(e.left_on && e.left_on < from) && !(e.joined_on && e.joined_on > to));
    const cfg = await setup(s.site), r = await daysOf(s.site, 'site=eq.' + enc(s.site), emps, from, to, cfg), now = D.validOn(cfg.rules, to);
    return { month: m, days: r.days, today: R.today(), holidays: cfg.holidays.filter(h => h.day >= from && h.day <= to), week_off: (now && now.rules.week_off) || [],
      rows: r.rows.map(w => ({ id: w.emp.id, code: w.emp.code, name: w.emp.name, category: w.emp.category, codes: w.days.map(d => d.code), late: w.days.map(d => (d.late_min > 0 ? 1 : 0)), fix: w.days.map(d => (d.src && d.src !== 'punch' ? 1 : 0)), wait: w.days.map(d => (d.review ? 1 : 0)), total: w.total })) };
  },
  /* everything of attendance around ONE employee, for his page in the Employee Master (12-11-2026: "EMPLOYEE MASTER JAR OPEN KEL
   * SAGLE KAHI ASEL TYA EMPLOYEE RELETED"): his work places of today, his shift, his phone, this month's count, today, what waits */
  async empAround(s, x) {
    needOffice(s); const emp = await empOf(s, id(x.id)), today = R.today(), m = today.slice(0, 7), cfg = await setup(emp.site);
    const [r, places, dev, regs] = await Promise.all([daysOf(emp.site, 'employee_id=eq.' + emp.id, [emp], m + '-01', lastDay(m), cfg), soft(placesOf(emp, today)),
      soft(db('GET', 'hr_devices?select=model,os,bound_at&employee_id=eq.' + emp.id + '&active=is.true')), soft(db('GET', 'hr_regularize?select=id&employee_id=eq.' + emp.id + '&status=eq.pending'))]);
    const row = r.rows[0], t = row.days.find(d => d.day === today) || null, d = (dev || [])[0] || null;
    return { month: m, total: row.total, today: t ? dayOut(t) : null, shift: t ? t.shift : '', places: (places || []).map(p => ({ id: p.id, name: p.name, kind: p.kind })),
      phone: d ? { model: d.model, os: d.os, since: d.bound_at } : null, requests_waiting: (regs || []).length };
  },

  // one day of one person: what counts, its punches as they came, every entry made for it, his requests
  async dayGet(s, x) {
    needOffice(s); const emp = await empOf(s, id(x.id)), day = R.date(x.day); if (!day) throw fail(400, 'Day: a date.', 'day');
    const d = await oneDay(s, emp, day);
    const [pun, ent, req] = await Promise.all([db('GET', 'hr_punches?select=id,kind,at,offline,status,place_id&employee_id=eq.' + emp.id + '&day=eq.' + day + '&order=at'),
      soft(db('GET', 'hr_day_entries?select=id,in_at,out_at,old_in,old_out,source,reason,entered_by,entered_at&employee_id=eq.' + emp.id + '&day=eq.' + day + '&order=id.desc')),
      soft(db('GET', 'hr_regularize?select=' + REG + '&employee_id=eq.' + emp.id + '&day=eq.' + day + '&order=id.desc'))]);
    const hmI = v => (v ? hm(v) : '');
    return { employee: { id: emp.id, code: emp.code, name: emp.name }, day: dayOut(d), today: R.today(),
      punches: (pun || []).map(p => ({ id: p.id, kind: p.kind, time: hm(p.at), offline: p.offline, status: p.status })),
      entries: (ent || []).map(e => ({ id: e.id, in: hmI(e.in_at), out: hmI(e.out_at), old_in: hmI(e.old_in), old_out: hmI(e.old_out), source: e.source, reason: e.reason, by: e.entered_by, at: e.entered_at })),
      requests: await regRows(req || []) };
  },
  /* a day set by the office: a manual entry (a day with no punch – labour without a phone) or a correction (a day that has
   * punches or an entry). { none: true } = "no attendance on this day" (a correction only). The punches stay as they came. */
  async daySet(s, x) {
    needOffice(s); const emp = await empOf(s, id(x.id)), day = R.date(x.day), today = R.today(), why = R.str(x.reason, 200);
    if (!day) throw fail(400, 'Day: a date.', 'day'); if (day > today) throw fail(400, 'A day that is still to come cannot be entered.', 'day');
    if (emp.status === 'left' && emp.left_on && day > emp.left_on) throw fail(400, 'This employee had left by then.', 'left');
    const was = await oneDay(s, emp, day), has = was.punches > 0 || (was.src && was.src !== 'punch');
    await power.need(s, has ? 'correct' : 'manual');
    if (s.role !== 'super' && day < D.addDays(today, -REG_DAYS)) throw fail(403, 'A day more than ' + REG_DAYS + ' days back can be set only by the Super Admin.', 'old');
    if (why.length < 3) throw fail(400, 'Reason: write why (at least 3 letters).', 'reason');
    let t = { in: null, out: null };
    if (x.none === true) { if (!has) throw fail(400, 'This day has no attendance to set aside.', 'none'); } else t = times(day, x, null);
    await db('POST', 'hr_day_entries', [{ employee_id: emp.id, site: emp.site, day: day, in_at: iso(t.in), out_at: iso(t.out), old_in: iso(was.in), old_out: iso(was.out), source: has ? 'correction' : 'manual', reason: why, entered_by: s.email }], 'return=minimal');
    await audit(s.site, s.email, has ? 'Attendance corrected' : 'Attendance entered by hand', emp.code + ' ' + day, { old: { in: hmOf(was.in), out: hmOf(was.out) }, new: { in: hmOf(t.in), out: hmOf(t.out) }, reason: why });
    return ACT.dayGet(s, { id: emp.id, day: day });
  },

  /* ───────────── requests (regularization) ───────────── */
  async regList(s, x) {
    needOffice(s); const st = ['pending', 'approved', 'refused'].indexOf(x.status) > -1 ? x.status : 'pending';
    const list = (await db('GET', 'hr_regularize?select=' + REG + '&site=eq.' + enc(s.site) + '&status=eq.' + st + '&order=asked_at.desc&limit=300')) || [];
    return { status: st, rows: await regRows(list), can: s.role === 'super' || (s.role === 'admin' && (await power.of(s.site)).regularize) };
  },
  async regDecide(s, x) {
    await power.need(s, 'regularize'); const r = ((await db('GET', 'hr_regularize?select=' + REG + '&id=eq.' + (parseInt(x.id, 10) || 0) + '&site=eq.' + enc(s.site))) || [])[0]; if (!r) throw fail(404, 'This request was not found on this site.', 'notfound');
    if (r.status !== 'pending') throw fail(409, 'This request was already decided.', 'decided');
    if (r.level === 1 && s.role !== 'super') throw fail(403, 'This request still waits for the reporting person.', 'level');
    const dec = x.decision === 'approved' || x.decision === 'refused' ? x.decision : '', note = R.str(x.note, 200); if (!dec) throw fail(400, 'Decision: approve or refuse.', 'decision');
    if (dec === 'refused' && note.length < 3) throw fail(400, 'Reason: write why it is refused.', 'note');
    const step = { level: 2, by: s.email, decision: dec, note: note, at: new Date().toISOString() }, emp = await empOf(s, r.employee_id);
    if (dec === 'approved') await settle(s, r, emp, step);
    else { const done = (await db('PATCH', 'hr_regularize?id=eq.' + r.id + '&status=eq.pending', { status: 'refused', steps: (r.steps || []).concat([step]), decided_at: step.at }, 'return=representation')) || []; if (!done.length) throw fail(409, 'This request was already decided.', 'decided'); await audit(s.site, s.email, 'Request refused', emp.code + ' ' + r.day, { request: r.id, note: note }); }
    return ACT.regList(s, { status: 'pending' });
  },

  /* ───────────── a person, for himself ───────────── */
  async myMonth(s, x) {
    const emp = await me(s), m = monthOf(x.month), cfg = await setup(emp.site), r = await daysOf(emp.site, 'employee_id=eq.' + emp.id, [emp], m + '-01', lastDay(m), cfg);
    const days = r.rows[0].days.map(dayOut);
    return { month: m, today: R.today(), all: days, days: days.filter(d => d.punches || d.in), total: r.rows[0].total, reg_days: REG_DAYS };
  },
  // "set an old day right": IN and / or OUT of a day gone (not today), with the reason – it counts only when approved
  async regAsk(s, x) {
    const emp = await me(s), day = R.date(x.day), today = R.today(), why = R.str(x.reason, 200);
    if (!day) throw fail(400, 'Day: a date.', 'day'); if (day >= today) throw fail(400, 'A request is for a day already gone – today is marked with the phone.', 'day');
    if (day < D.addDays(today, -REG_DAYS)) throw fail(400, 'A request reaches only ' + REG_DAYS + ' days back – ask the HR office.', 'old');
    if (why.length < 5) throw fail(400, 'Reason: write what happened (at least 5 letters).', 'reason');
    const full = ((await db('GET', 'hr_employees?select=id,code,name,category,site,department_id,reports_to,status,joined_on,left_on&id=eq.' + emp.id)) || [])[0];
    const was = await oneDay(s, full, day); times(day, x, { in: was.in, out: was.out });      // checked now, as it will be checked at the approval
    const it = x.in_time ? D.hm(x.in_time) : null, ot = x.out_time ? D.hm(x.out_time) : null; if (!it && !ot) throw fail(400, 'Give the IN time, the OUT time, or both.', 'time');
    const rl = D.validOn((await setup(full.site)).rules, today); let level = 2;
    if (rl && rl.rules.reg_levels === 2 && full.reports_to && ((await db('GET', 'hr_employees?select=id&id=eq.' + full.reports_to + '&status=neq.left')) || []).length) level = 1;
    try { await db('POST', 'hr_regularize', [{ employee_id: full.id, site: full.site, day: day, in_time: it, out_time: ot, out_next_day: !!x.out_next_day && !!ot, reason: why, level: level, asked_by: s.email }], 'return=minimal'); }
    catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'A request for this day is already waiting.', 'duplicate'); throw e; }
    await audit(full.site, s.email, 'Request to set a day right', full.code + ' ' + day, { in: it, out: ot, level: level });
    return ACT.myRegs(s);
  },
  async myRegs(s) { const emp = await me(s); return { rows: await regRows((await soft(db('GET', 'hr_regularize?select=' + REG + '&employee_id=eq.' + emp.id + '&order=id.desc&limit=50'))) || []) }; },
  // the requests of the people who report to me (the first level)
  async teamRegs(s) {
    const emp = await me(s), team = ((await db('GET', 'hr_employees?select=id&reports_to=eq.' + emp.id + '&status=neq.left&limit=500')) || []).map(e => e.id), list = [];
    for (const c of chunks(team, 80)) ((await soft(db('GET', 'hr_regularize?select=' + REG + '&status=eq.pending&level=eq.1&employee_id=in.(' + c.join(',') + ')&order=asked_at'))) || []).forEach(r => list.push(r));
    return { team: team.length, rows: await regRows(list) };
  },
  async teamRegDecide(s, x) {
    const boss = await me(s), r = ((await db('GET', 'hr_regularize?select=' + REG + '&id=eq.' + (parseInt(x.id, 10) || 0))) || [])[0]; if (!r) throw fail(404, 'This request was not found.', 'notfound');
    const emp = ((await db('GET', 'hr_employees?select=id,code,name,reports_to&id=eq.' + r.employee_id)) || [])[0]; if (!emp || emp.reports_to !== boss.id) throw fail(403, 'This person does not report to you.', 'team');
    if (r.status !== 'pending' || r.level !== 1) throw fail(409, 'This request does not wait for you any more.', 'decided');
    const dec = x.decision === 'approved' || x.decision === 'refused' ? x.decision : '', note = R.str(x.note, 200); if (!dec) throw fail(400, 'Decision: approve or refuse.', 'decision');
    if (dec === 'refused' && note.length < 3) throw fail(400, 'Reason: write why it is refused.', 'note');
    const step = { level: 1, by: s.email, decision: dec, note: note, at: new Date().toISOString() };
    const done = (await db('PATCH', 'hr_regularize?id=eq.' + r.id + '&status=eq.pending&level=eq.1', dec === 'approved' ? { level: 2, steps: (r.steps || []).concat([step]) } : { status: 'refused', steps: (r.steps || []).concat([step]), decided_at: step.at }, 'return=representation')) || [];
    if (!done.length) throw fail(409, 'This request does not wait for you any more.', 'decided');
    await audit(r.site, s.email, dec === 'approved' ? 'Request passed to the HR office' : 'Request refused', emp.code + ' ' + r.day, { request: r.id, note: note });
    return ACT.teamRegs(s);
  },
};
const SELF = ['myMonth', 'regAsk', 'myRegs', 'teamRegs', 'teamRegDecide'];
const NOT_READY5 = 'Shifts, the muster and requests are not set up yet: the Super Admin runs sql/hr_step5_muster.sql once in the rcl-hr Supabase → SQL Editor.';
module.exports = { ACT, SELF, NOT_READY5, REG_DAYS };
