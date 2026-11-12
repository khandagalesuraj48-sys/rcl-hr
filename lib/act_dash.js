/* THE ATTENDANCE DASHBOARD of the HR office (asked 12-11-2026: "web sathi pn attendance modual design … proffesional dashbord").
 * ONE action, attDash – it only READS what is already there (employees, punches, the day's entries, requests, phones) and counts
 * it with the same measure as the muster (lib/act_muster.js → daysOf). Nothing is written, no table is added.
 * Today a person is: at work (IN, no OUT yet) · out (IN and OUT) · weekly off / holiday · not marked yet. Nobody is "absent"
 * while the day still runs – so the absent count shown is YESTERDAY's. */
'use strict';
const { db, enc } = require('./db');
const R = require('./rules');
const D = require('./day');
const { needOffice } = require('./act_attend');
const { setup, daysOf, all, chunks, soft, hmOf } = require('./act_muster');

const FROM_MIN = 6 * 60, STEP = 30, SLOTS = 32;      // the day's arc: 06:00 to 22:00 in half hours
const minOf = ms => { const t = hmOf(ms); return +t.slice(0, 2) * 60 + +t.slice(3); };
const present = c => c === 'P' || c === 'WOP' || c === 'HP' || c === 'IN';

const ACT = {
  async attDash(s) {
    needOffice(s); const site = s.site, today = R.today(), from = D.addDays(today, -6), q = 'site=eq.' + enc(site);
    const emps = (await all('hr_employees?select=id,code,name,category,department_id,joined_on,left_on,status&' + q + '&status=neq.left&order=name,id')).filter(e => !(e.joined_on && e.joined_on > today));
    const cfg = await setup(site), ids = emps.map(e => e.id);
    const [r, pun, places, regs, doubt] = await Promise.all([daysOf(site, q, emps, from, today, cfg),
      soft(all('hr_punches?select=id,employee_id,kind,at,status,place_id&' + q + '&day=eq.' + today + '&order=at')),
      soft(db('GET', 'hr_places?select=id,name&' + q)),
      soft(db('GET', 'hr_regularize?select=id,asked_at&' + q + '&status=eq.pending&order=asked_at&limit=1000')),
      soft(db('GET', 'hr_punches?select=id&' + q + '&status=eq.review&order=at.desc&limit=300'))]);
    // the doubtful punches nobody has decided yet
    const decided = {}; for (const c of chunks((doubt || []).map(p => p.id), 60)) ((await soft(db('GET', 'hr_punch_reviews?select=punch_id&punch_id=in.(' + c.join(',') + ')'))) || []).forEach(v => { decided[v.punch_id] = 1; });
    // phones: who has one tied, who tried with another one in the last 7 days
    const has = {}, tried = {}, since = enc(new Date(Date.now() - 7 * 86400000).toISOString());
    for (const c of chunks(ids, 80)) {
      const w = 'employee_id=in.(' + c.join(',') + ')';
      const [dv, tr] = await Promise.all([soft(db('GET', 'hr_devices?select=employee_id&' + w + '&active=is.true')), soft(db('GET', 'hr_device_tries?select=employee_id&' + w + '&at=gte.' + since + '&limit=1000'))]);
      (dv || []).forEach(d => { has[d.employee_id] = 1; }); (tr || []).forEach(t => { tried[t.employee_id] = 1; });
    }
    const pl = {}; (places || []).forEach(p => { pl[p.id] = p.name; });
    const last = {}; (pun || []).forEach(p => { if (p.kind === 'in' && (p.status !== 'review' || !last[p.employee_id])) last[p.employee_id] = p; });      // his IN of today: where, and its photo
    const shStart = {}; cfg.shifts.forEach(x => { shStart[x.name] = x.start_time; });
    const c = { total: emps.length, on: 0, present: 0, out: 0, late: 0, off: 0, none: 0, absent_yesterday: 0, first_in: '' }, slots = new Array(SLOTS).fill(0), byPlace = {}, starts = {}; let first = null, noPhone = 0;
    const who = r.rows.map(w => {
      const d = w.days[w.days.length - 1], y = w.days[w.days.length - 2], p = last[w.emp.id] || null, here = d.in !== null;
      const state = d.code === 'IN' ? 'on' : here ? 'out' : d.review ? 'check' : d.code === 'WO' || d.code === 'H' ? 'off' : 'none';
      if (here) { c.present++; if (first === null || d.in < first) first = d.in; const k = Math.min(SLOTS - 1, Math.max(0, Math.floor((minOf(d.in) - FROM_MIN) / STEP))); slots[k]++; if (d.late_min > 0) c.late++; }
      if (state === 'on') { c.on++; const n = (p && pl[p.place_id]) || ''; if (n) byPlace[n] = (byPlace[n] || 0) + 1; } else if (state === 'out') c.out++; else if (state === 'off') c.off++; else c.none++;
      if (y && (y.code === 'A' || y.code === 'MIS')) c.absent_yesterday++;
      if (state === 'none' && !has[w.emp.id]) noPhone++;
      if (d.shift && shStart[d.shift]) starts[shStart[d.shift]] = 1;
      return { id: w.emp.id, code: w.emp.code, name: w.emp.name, category: w.emp.category, state: state, in: hmOf(d.in), out: state === 'out' ? hmOf(d.out) : '', late_min: d.late_min, place: (p && pl[p.place_id]) || '', punch: p ? p.id : '' };
    });
    c.first_in = hmOf(first);
    const rank = { on: 0, out: 1, check: 2, none: 3, off: 4 }; who.sort((a, b) => rank[a.state] - rank[b.state] || (a.in < b.in ? -1 : a.in > b.in ? 1 : 0) || (a.name < b.name ? -1 : 1));
    const week = r.days.map((day, i) => { const t = { day: day, P: 0, HD: 0, A: 0 }; r.rows.forEach(w => { const k = w.days[i].code; if (present(k)) t.P++; else if (k === 'HD') t.HD++; else if (k === 'A' || k === 'MIS') t.A++; }); return t; });
    const st = Object.keys(starts), wait = (doubt || []).filter(p => !decided[p.id]).length;
    return { today: today, now: hmOf(Date.now()), count: c, who: who, week: week,
      arc: { from: '06:00', to: '22:00', step: STEP, slots: slots, shift: st.length === 1 ? st[0] : '' },
      places: Object.keys(byPlace).map(n => ({ name: n, on: byPlace[n] })).sort((a, b) => b.on - a.on || (a.name < b.name ? -1 : 1)),
      needs: { requests: (regs || []).length, oldest: (regs || []).length ? regs[0].asked_at : '', review: wait, phones: Object.keys(tried).length, no_phone: noPhone } };
  },
};
module.exports = { ACT };
