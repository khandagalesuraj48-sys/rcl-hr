/* THE ACTIONS OF ATTENDANCE (api/hr.js sends them here) – step 4 (12-11-2026).
 *   The HR Admin / Super Admin: projects, work places (the geofences: where, how many metres, for whom – one by one or many at
 *   once), the phones (release one), the day's punches and the doubtful ones.
 *   Every person, for himself only: his places, his day, his punch, his month.
 * A punch is only ever ADDED – never changed, never deleted (the database itself refuses it). */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const A = require('./attend');
const G = require('./geo');
const store = require('./store');
const power = require('./powers');      // (step 5) what the Super Admin left the HR Admin on this site

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = v => { v = String(v || '').toLowerCase(); return UUID.test(v) ? v : ''; };
const needOffice = s => { if (s.role === 'self') throw fail(403, 'This is for the HR office only.', 'role'); };
const PLACE = 'id,site,project_id,name,kind,shape,lat,lng,radius_m,points,scope,scope_values,valid_from,active,updated_at';
const PUNCH = 'id,employee_id,kind,day,at,received_at,lat,lng,accuracy_m,place_id,inside,distance_m,offline,flags,status,client_id';
/* WHO MAY PUNCH. His rule: DOB and a verified e-mail before activation. The e-mail check (OTP) is the next piece of work – until
 * it is there, an employee whose details are complete ("pending") may punch too; then this line becomes ['active'] only. */
const MAY_PUNCH = ['pending', 'active'];
const CLIENT = /^[A-Za-z0-9_-]{16,64}$/;
const dayOf = ms => R.today(ms);
const hm = iso => new Date(Date.parse(iso) + 19800000).toISOString().slice(11, 16);

// the employee this sign-in IS (his e-mail in the Employee Master) – for his own attendance
async function me(s) {
  const e = String(s.email || '').toLowerCase().replace(/["\\(),]/g, '');
  const rows = (await db('GET', 'hr_employees?select=id,code,name,category,site,department_id,status&status=neq.left&or=(email.eq.' + enc('"' + e + '"') + ',portal_email.eq.' + enc('"' + e + '"') + ')')) || [];
  // (12-11-2026) the message names the e-mail HR looked for – the one of the sign-in – so that the office can compare it with the record
  if (!rows.length) throw fail(403, 'Your sign-in (' + (e || 'no e-mail') + ') is not in the Employee Master: ask the HR office to put this e-mail in your employee record.', 'noemployee');
  return rows[0];
}
async function placesOf(emp, day) {
  const all = (await db('GET', 'hr_places?select=' + PLACE + '&site=eq.' + enc(emp.site) + '&active=is.true&removed_at=is.null&valid_from=lte.' + day)) || [];
  const mine = {}; if (all.some(p => p.scope === 'people')) ((await db('GET', 'hr_place_people?select=place_id&employee_id=eq.' + emp.id)) || []).forEach(r => { mine[r.place_id] = 1; });
  return all.filter(p => A.applies(p, emp, day, mine));
}
const dayPunches = async (empId, day) => (await db('GET', 'hr_punches?select=' + PUNCH + '&employee_id=eq.' + empId + '&day=eq.' + day + '&order=at')) || [];
const forMe = p => ({ id: p.id, kind: p.kind, at: p.at, time: hm(p.at), place_id: p.place_id, offline: p.offline, status: p.status });
const nextKind = list => { const l = list[list.length - 1]; return l && l.kind === 'in' ? 'out' : 'in'; };
/* WHERE HIS DAY STANDS NOW (12-11-2026, his words: "user 1 day madhe fkt ekadach sign in and sign out … sign out karaych visrun
 * gela tr systeam … auto sign out krel"): his punches of today and yesterday, the rules of today and his shift – worked out in
 * lib/day.js (stand). Nothing is written: a day closed by itself is only READ so (absent) – the punches stay as they were taken. */
async function stand(emp, now) {
  const D = require('./day'), day = dayOf(now), yest = D.addDays(day, -1);
  const [two, cfg] = await Promise.all([db('GET', 'hr_punches?select=' + PUNCH + '&employee_id=eq.' + emp.id + '&day=gte.' + yest + '&day=lte.' + day + '&order=at'), require('./act_muster').setup(emp.site)]);
  /* (step 13) HIS OWN POLICIES of the Rule Book over the site's rules – the same measure as the muster (act_muster.daysOf): one
   * IN and OUT a day, and his weekly off (also "the 2nd and 4th Saturday", and a day the HR office said). No policy: the site's rules. */
  const B = require('./rulebook'), bk = cfg.book && cfg.book.used ? cfg.book : null;
  const polOn = (k, d) => { const p = B.policyOn({ assign: ((bk.assign[emp.id] || {})[k]) || [], defaults: bk.defaults[k] || [], versions: bk.versions }, d); return p ? p.body : null; };
  const rulesOn = d => { const w = D.validOn(cfg.rules, d), r = w ? w.rules : {}; return bk ? B.dayRules(r, { attendance: polOn('attendance', d), late: polOn('late', d), weekoff: polOn('weekoff', d) }, d, cfg.said[d]) : r; };
  const rules = rulesOn(day), chosen = {}; cfg.shifts.forEach(sh => { if ((sh.people || []).indexOf(emp.id) > -1) chosen[sh.id] = 1; });
  const shiftOn = d => D.shiftOf(cfg.shifts, emp, d, chosen), st = D.stand(two || [], now, day, rules, shiftOn), shift = shiftOn(day);
  const own = !!(bk && polOn('weekoff', day)), week = []; if (own) for (let i = 0; i <= 7; i++) { const d = D.addDays(day, i); if ((rulesOn(d).week_off || []).length) week.push(d); }
  return Object.assign(st, { day: day, once: !!rules.once, face: !!rules.face, shift: shift ? { name: shift.name, start: shift.start_time, end: shift.end_time, auto_out: shift.auto_out || '' } : null,
    // (12-11-2026, the phone's reminders – "sign in and out ch notification ardha tas adhi") the free days of the coming week: no reminder on them
    // (step 13) with a weekly-off policy of his own the free days are named day by day (days_off) – a "2nd and 4th Saturday" is not a weekday
    week_off: own ? [] : rules.week_off || [], days_off: [...new Set((cfg.holidays || []).filter(h => h.day >= day && h.day <= D.addDays(day, 7)).map(h => h.day).concat(week))].sort() });
}
const onePlace = async (s, pid) => { const p = ((await db('GET', 'hr_places?select=' + PLACE + '&id=eq.' + pid + '&site=eq.' + enc(s.site) + '&removed_at=is.null')) || [])[0]; if (!p) throw fail(404, 'This work place was not found on this site.', 'notfound'); return p; };
async function projectOk(s, pid) { if (!pid) return null; if (!((await db('GET', 'hr_projects?select=id&id=eq.' + pid + '&site=eq.' + enc(s.site))) || []).length) throw fail(400, 'Project: choose one of the list.', 'project_id'); return pid; }
// the chosen people of a place: employees of THIS site only
async function peopleOk(s, list) {
  const ids = [...new Set((Array.isArray(list) ? list : []).map(id).filter(Boolean))].slice(0, 2000); if (!ids.length) throw fail(400, 'For whom: choose at least one employee.', 'people');
  const ok = []; for (let i = 0; i < ids.length; i += 80) ((await db('GET', 'hr_employees?select=id&site=eq.' + enc(s.site) + '&status=neq.left&id=in.(' + ids.slice(i, i + 80).join(',') + ')')) || []).forEach(r => ok.push(r.id));
  if (ok.length !== ids.length) throw fail(400, 'For whom: ' + (ids.length - ok.length) + ' of the chosen people are not employees of this site.', 'people');
  return ok;
}
async function setPeople(s, placeId, ids) {
  await db('DELETE', 'hr_place_people?place_id=eq.' + placeId, undefined, 'return=minimal');
  for (let i = 0; i < ids.length; i += 500) await db('POST', 'hr_place_people', ids.slice(i, i + 500).map(e => ({ place_id: placeId, employee_id: e, created_by: s.email })), 'return=minimal');
}
async function placeList(s) {
  const [pr, pl] = await Promise.all([db('GET', 'hr_projects?select=id,name,active&site=eq.' + enc(s.site) + '&order=name'), db('GET', 'hr_places?select=' + PLACE + '&site=eq.' + enc(s.site) + '&removed_at=is.null&order=name')]);
  const places = pl || [], chosen = {}; const pp = places.filter(p => p.scope === 'people').map(p => p.id);
  for (let i = 0; i < pp.length; i += 60) ((await db('GET', 'hr_place_people?select=place_id,employee_id&place_id=in.(' + pp.slice(i, i + 60).join(',') + ')')) || []).forEach(r => { (chosen[r.place_id] = chosen[r.place_id] || []).push(r.employee_id); });
  return { projects: pr || [], places: places.map(p => Object.assign({}, p, { people: chosen[p.id] || [] })), kinds: A.KINDS.map(k => ({ key: k, name: A.KIND_NAME[k] })) };
}

const scopeWords = p => p.scope === 'all' ? 'everybody of the site' : p.scope === 'category' ? 'some categories' : 'some departments';
// the people a place is for now – by its "for whom" alone (also while it is switched off or not yet valid)
async function peopleNow(s, p) {
  if (p.scope === 'people') return ((await db('GET', 'hr_place_people?select=employee_id&place_id=eq.' + p.id)) || []).map(r => r.employee_id);
  const emps = (await db('GET', 'hr_employees?select=id,category,department_id&site=eq.' + enc(s.site) + '&status=neq.left')) || [], by = Object.assign({}, p, { active: true, removed_at: null, valid_from: '0000-01-01' });
  return emps.filter(e => A.applies(by, e, '9999-12-31', null)).map(e => e.id);
}
// single people added to / taken from a place; a place that was for everybody / categories / departments becomes "Chosen people"
async function changePeople(s, p, now, add, rem) {
  const set = new Set(now); add.forEach(e => set.add(e)); rem.forEach(e => set.delete(e)); const list = [...set];
  if (p.scope !== 'people') await db('PATCH', 'hr_places?id=eq.' + p.id, { scope: 'people', scope_values: [], updated_by: s.email, updated_at: new Date().toISOString() }, 'return=minimal');
  await setPeople(s, p.id, list);
  await audit(s.site, s.email, 'Work place: people changed', p.name, { added: add.filter(e => now.indexOf(e) < 0).length, removed: rem.filter(e => now.indexOf(e) > -1).length, people: list.length, was: p.scope === 'people' ? undefined : { scope: p.scope, scope_values: p.scope_values } });
  return list.length;
}

async function placeMap(s) {
  const now = Date.now(), day = dayOf(now), from = require('./day').addDays(day, -6);
  const [pl, em, pu] = await Promise.all([db('GET', 'hr_places?select=' + PLACE + '&site=eq.' + enc(s.site) + '&removed_at=is.null&order=name'),
    db('GET', 'hr_employees?select=id,code,name,category,department_id,status&site=eq.' + enc(s.site) + '&status=neq.left&order=name'),
    db('GET', 'hr_punches?select=employee_id,kind,at,place_id&site=eq.' + enc(s.site) + '&day=gte.' + from + '&order=at.desc&limit=20000')]);
  const places = pl || [], emps = em || [], chosen = {}, pp = places.filter(p => p.scope === 'people').map(p => p.id);
  for (let i = 0; i < pp.length; i += 60) ((await db('GET', 'hr_place_people?select=place_id,employee_id&place_id=in.(' + pp.slice(i, i + 60).join(',') + ')')) || []).forEach(r => { (chosen[r.employee_id] = chosen[r.employee_id] || {})[r.place_id] = 1; });
  const last = {}; (pu || []).forEach(r => { if (!last[r.employee_id]) last[r.employee_id] = { kind: r.kind, day: dayOf(Date.parse(r.at)), time: hm(r.at), place_id: r.place_id }; });
  const count = {}, people = emps.map(e => { const at = places.filter(p => A.applies(p, e, day, chosen[e.id])).map(p => p.id); at.forEach(i => { count[i] = (count[i] || 0) + 1; });
    return { id: e.id, code: e.code, name: e.name, category: e.category, department_id: e.department_id, status: e.status, places: at, last: last[e.id] || null }; });
  return { today: day, places: places.map(p => ({ id: p.id, name: p.name, kind: p.kind, shape: p.shape, radius_m: p.radius_m, scope: p.scope, scope_values: p.scope_values || [], active: p.active, valid_from: p.valid_from, on: p.active && p.valid_from <= day, count: count[p.id] || 0 })), people: people };
}

const ACT = {
  /* ───────────── projects and work places (HR Admin / Super Admin) ───────────── */
  async placeList(s) { needOffice(s); return placeList(s); },
  async projSave(s, x) {
    await power.need(s, 'places'); const name = R.str(x.name, 60); if (name.length < 2) throw fail(400, 'Project: at least 2 letters.', 'name');
    const had = ((await db('GET', 'hr_projects?select=id,name,active&site=eq.' + enc(s.site))) || []), pid = id(x.id), same = had.find(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== pid);
    if (same) throw fail(409, 'This project is already in the list.', 'duplicate');
    if (pid) { const was = had.find(p => p.id === pid); if (!was) throw fail(404, 'This project was not found on this site.', 'notfound');
      const row = { name: name, active: x.active !== false, updated_at: new Date().toISOString() }; await db('PATCH', 'hr_projects?id=eq.' + pid, row, 'return=minimal'); await audit(s.site, s.email, 'Project changed', name, { old: { name: was.name, active: was.active }, new: { name: row.name, active: row.active } }); }
    else { await db('POST', 'hr_projects', [{ site: s.site, name: name, created_by: s.email }], 'return=minimal'); await audit(s.site, s.email, 'Project added', name, null); }
    return placeList(s);
  },
  async placeSave(s, x) {
    await power.need(s, 'places'); const c = A.place(x); if (c.errors.length) throw fail(400, c.errors.join(' '), 'place');
    const pid = id(x.id), row = Object.assign(c.row, { project_id: await projectOk(s, id(x.project_id)), active: x.active !== false, updated_by: s.email, updated_at: new Date().toISOString() });
    const people = row.scope === 'people' ? await peopleOk(s, x.people) : [];
    const twin = ((await db('GET', 'hr_places?select=id,name&site=eq.' + enc(s.site) + '&removed_at=is.null')) || []).find(p => p.name.toLowerCase() === row.name.toLowerCase() && p.id !== pid);
    if (twin) throw fail(409, 'A work place with this name is already there.', 'duplicate');
    let placeId = pid;
    if (pid) { const was = await onePlace(s, pid); await db('PATCH', 'hr_places?id=eq.' + pid, row, 'return=minimal'); await audit(s.site, s.email, 'Work place changed', row.name, { old: was, new: row, people: people.length }); }
    else { placeId = (await db('POST', 'hr_places', [Object.assign({ site: s.site, created_by: s.email }, row)], 'return=representation'))[0].id; await audit(s.site, s.email, 'Work place added', row.name, { new: row, people: people.length }); }
    if (row.scope === 'people' || pid) await setPeople(s, placeId, people);
    return Object.assign({ id: placeId }, await placeList(s));
  },
  // many at once: the metres, for whom, the project, on / off – only what is sent is changed
  async placeBulk(s, x) {
    await power.need(s, 'places'); const ids = [...new Set((Array.isArray(x.ids) ? x.ids : []).map(id).filter(Boolean))].slice(0, 500); if (!ids.length) throw fail(400, 'Choose at least one work place.', 'ids');
    const all = ((await db('GET', 'hr_places?select=' + PLACE + '&site=eq.' + enc(s.site) + '&removed_at=is.null')) || []).filter(p => ids.indexOf(p.id) > -1);
    if (all.length !== ids.length) throw fail(404, 'Some of the chosen work places were not found on this site.', 'notfound');
    const set = {};
    if (x.radius_m !== undefined && x.radius_m !== '' && x.radius_m !== null) { const r = Math.round(G.num(x.radius_m)); if (!(r >= 20 && r <= 5000)) throw fail(400, 'Radius: 20 to 5000 metres.', 'radius_m'); if (all.some(p => p.shape === 'polygon')) throw fail(400, 'Metres cannot be set for an area drawn on the map (' + all.filter(p => p.shape === 'polygon').map(p => p.name).join(', ') + ') – leave it out.', 'radius_m'); set.radius_m = r; }
    if (x.active === true || x.active === false) set.active = x.active;
    if (x.project_id !== undefined) set.project_id = x.project_id === '' || x.project_id === null ? null : await projectOk(s, id(x.project_id) || 'x');
    let people = null;
    if (x.scope !== undefined) { const c = A.place({ name: 'xx', lat: 1, lng: 1, radius_m: 100, scope: x.scope, scope_values: x.scope_values }); if (c.errors.length) throw fail(400, c.errors.join(' '), 'scope'); set.scope = c.row.scope; set.scope_values = c.row.scope_values; people = set.scope === 'people' ? await peopleOk(s, x.people) : []; }
    if (!Object.keys(set).length) throw fail(400, 'Nothing to change was given.', 'nothing');
    set.updated_by = s.email; set.updated_at = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 60) await db('PATCH', 'hr_places?id=in.(' + ids.slice(i, i + 60).join(',') + ')', set, 'return=minimal');
    if (people) for (const p of ids) await setPeople(s, p, people);
    await audit(s.site, s.email, 'Work places changed together', all.length + ' places', { places: all.map(p => p.name), old: all.map(p => ({ name: p.name, radius_m: p.radius_m, scope: p.scope, scope_values: p.scope_values, active: p.active, project_id: p.project_id })), new: set, people: people ? people.length : undefined });
    return Object.assign({ changed: all.length }, await placeList(s));
  },
  // many NEW circles at once (a list: name, latitude, longitude, metres) – all or none
  async placeImport(s, x) {
    await power.need(s, 'places'); const rows = Array.isArray(x.rows) ? x.rows.slice(0, 300) : []; if (!rows.length) throw fail(400, 'The list is empty.', 'rows');
    const had = {}; ((await db('GET', 'hr_places?select=name&site=eq.' + enc(s.site) + '&removed_at=is.null')) || []).forEach(p => { had[p.name.toLowerCase()] = 1; });
    const project = await projectOk(s, id(x.project_id)), good = [], lines = [];
    rows.forEach((r, i) => { const c = A.place(Object.assign({}, r, { shape: 'circle', scope: 'all' })), k = c.row.name.toLowerCase(); if (!c.errors.length && had[k]) c.errors.push('A work place with this name is already there.'); had[k] = 1;
      if (c.errors.length) lines.push({ line: i + 1, name: c.row.name, error: c.errors.join(' ') }); else good.push(Object.assign({ site: s.site, project_id: project, created_by: s.email, updated_by: s.email }, c.row)); });
    if (lines.length) return { saved: 0, lines: lines };
    await db('POST', 'hr_places', good, 'return=minimal'); await audit(s.site, s.email, 'Work places added together', good.length + ' places', { places: good.map(p => p.name) });
    return Object.assign({ saved: good.length, lines: [] }, await placeList(s));
  },
  // "delete": it goes from every list and no punch is taken there any more; the punches already taken there keep it
  async placeRemove(s, x) {
    await power.need(s, 'places'); const p = await onePlace(s, id(x.id)), why = R.str(x.reason, 200); if (why.length < 3) throw fail(400, 'Reason: write why it is removed.', 'reason');
    await db('PATCH', 'hr_places?id=eq.' + p.id, { removed_at: new Date().toISOString(), removed_by: s.email, removed_reason: why, active: false }, 'return=minimal');
    await audit(s.site, s.email, 'Work place removed', p.name, { old: p, reason: why });
    return placeList(s);
  },
  /* WHO MARKS WHERE (13-11-2026, his words: "konta user konte location war sign in kartoy … konte location sathi konte user
   * aahet … ek employee aso ki bulk employee"): every work place with the people it is for today, and every employee with the
   * places he may mark at and where he marked last (the last 7 days). Only read – worked out with the same rule the phone's
   * punch is checked with (attend.applies). */
  async placeMap(s) { needOffice(s); return placeMap(s); },
  /* SINGLE PEOPLE TO / FROM A PLACE – one or many at once. A place "for chosen people": they are added / taken. A place for
   * everybody, categories or departments holds no single people: it is changed only when the Admin says so (convert) – it
   * becomes "Chosen people" with the people it is for now, plus / minus the chosen; a new employee then no longer gets it by
   * himself. Nothing else of the place changes. */
  async placePeople(s, x) {
    await power.need(s, 'places'); const p = await onePlace(s, id(x.place_id) || 'x');
    const add = Array.isArray(x.add) && x.add.length ? await peopleOk(s, x.add) : [], rem = [...new Set((Array.isArray(x.remove) ? x.remove : []).map(id).filter(Boolean))].slice(0, 2000);
    if (!add.length && !rem.length) throw fail(400, 'Choose at least one employee.', 'people');
    const now = await peopleNow(s, p);
    if (p.scope !== 'people' && x.convert !== true) throw fail(409, '"' + p.name + '" is for ' + scopeWords(p) + ' (' + now.length + ' people now) – it holds no single people. To add or take single people it becomes "Chosen people" with these ' + now.length + '; a new employee then does not get it by himself.', 'scope');
    const n = await changePeople(s, p, now, add, rem);
    return Object.assign({ people_now: n }, await placeMap(s));
  },
  /* ONE PERSON'S PLACES (13-11-2026, his words: "employee ch location change krta yeil mala ani multiple location access deu
   * shakel"): the work places he may mark at are set to exactly the chosen ones – one or several. A place that is for everybody /
   * categories / departments is touched only after the Admin said yes (convert), as above; a place that does not change is left
   * alone. */
  async placePerson(s, x) {
    await power.need(s, 'places'); const eid = (await peopleOk(s, [x.employee_id]))[0];
    const want = {}; (Array.isArray(x.places) ? x.places : []).map(id).filter(Boolean).forEach(i => { want[i] = 1; });
    const all = (await db('GET', 'hr_places?select=' + PLACE + '&site=eq.' + enc(s.site) + '&removed_at=is.null&order=name')) || [];
    Object.keys(want).forEach(i => { if (!all.some(p => p.id === i)) throw fail(404, 'A chosen work place was not found on this site.', 'notfound'); });
    const todo = []; for (const p of all) { const now = await peopleNow(s, p), has = now.indexOf(eid) > -1; if (has !== !!want[p.id]) todo.push({ p: p, now: now, add: want[p.id] ? [eid] : [], rem: want[p.id] ? [] : [eid] }); }
    const wide = todo.filter(t => t.p.scope !== 'people');
    if (wide.length && x.convert !== true) throw fail(409, wide.map(t => '"' + t.p.name + '" is for ' + scopeWords(t.p) + ' (' + t.now.length + ' people now)').join('; ') + ' – such a place holds no single people. To change it for this person it becomes "Chosen people" with the people it is for now; a new employee then does not get it by himself.', 'scope');
    for (const t of todo) await changePeople(s, t.p, t.now, t.add, t.rem);
    return Object.assign({ changed: todo.length }, await placeMap(s));
  },

  /* ───────────── the phones ───────────── */
  async devList(s) {
    needOffice(s);
    const emps = (await db('GET', 'hr_employees?select=id,code,name,category&site=eq.' + enc(s.site) + '&status=neq.left')) || [], by = {}; emps.forEach(e => { by[e.id] = e; });
    const ids = emps.map(e => e.id), devs = [], tries = [];
    for (let i = 0; i < ids.length; i += 80) {
      const q = 'employee_id=in.(' + ids.slice(i, i + 80).join(',') + ')';
      ((await db('GET', 'hr_devices?select=id,employee_id,device_id,model,os,active,bound_at,released_at,released_by,release_reason&' + q + '&order=bound_at.desc')) || []).forEach(d => devs.push(d));
      ((await db('GET', 'hr_device_tries?select=id,at,employee_id,model,why&' + q + '&at=gte.' + enc(new Date(Date.now() - 30 * 86400000).toISOString()) + '&order=at.desc&limit=200')) || []).forEach(t => tries.push(t));
    }
    const who = r => Object.assign({ code: (by[r.employee_id] || {}).code, name: (by[r.employee_id] || {}).name }, r);
    return { devices: devs.map(d => who(Object.assign({}, d, { device_id: undefined, mark: String(d.device_id).slice(-6) }))), tries: tries.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200).map(who) };
  },
  async devRelease(s, x) {
    await power.need(s, 'phones'); const why = R.str(x.reason, 200); if (why.length < 3) throw fail(400, 'Reason: write why this phone is released.', 'reason');
    const d = ((await db('GET', 'hr_devices?select=id,employee_id,model,active&id=eq.' + id(x.id))) || [])[0]; if (!d) throw fail(404, 'This phone was not found.', 'notfound');
    const e = ((await db('GET', 'hr_employees?select=code,name&id=eq.' + d.employee_id + '&site=eq.' + enc(s.site))) || [])[0]; if (!e) throw fail(404, 'This phone was not found on this site.', 'notfound');
    if (!d.active) throw fail(400, 'This phone is already released.', 'released');
    await db('PATCH', 'hr_devices?id=eq.' + d.id + '&active=is.true', { active: false, released_at: new Date().toISOString(), released_by: s.email, release_reason: why }, 'return=minimal');
    await audit(s.site, s.email, 'Phone released', e.code + ' ' + e.name, { model: d.model, reason: why });
    return ACT.devList(s);
  },

  /* ───────────── the day's punches (the HR office) ───────────── */
  async punchDay(s, x) {
    needOffice(s); const day = R.date(x.day) || R.today();
    const list = (await db('GET', 'hr_punches?select=' + PUNCH + ',selfie_path&site=eq.' + enc(s.site) + (x.review ? '&status=eq.review&order=at.desc&limit=300' : '&day=eq.' + day + '&order=at'))) || [];
    const eids = [...new Set(list.map(p => p.employee_id))], by = {}, pl = {}, rv = {};
    for (let i = 0; i < eids.length; i += 80) ((await db('GET', 'hr_employees?select=id,code,name,category&id=in.(' + eids.slice(i, i + 80).join(',') + ')')) || []).forEach(e => { by[e.id] = e; });
    ((await db('GET', 'hr_places?select=id,name&site=eq.' + enc(s.site))) || []).forEach(p => { pl[p.id] = p.name; });
    const doubt = list.filter(p => p.status === 'review').map(p => p.id);
    for (let i = 0; i < doubt.length; i += 60) ((await db('GET', 'hr_punch_reviews?select=punch_id,decision,note,by,at&punch_id=in.(' + doubt.slice(i, i + 60).join(',') + ')&order=at')) || []).forEach(r => { rv[r.punch_id] = r; });
    const rows = list.map(p => ({ id: p.id, code: (by[p.employee_id] || {}).code, name: (by[p.employee_id] || {}).name, category: (by[p.employee_id] || {}).category, kind: p.kind, day: p.day, at: p.at, time: hm(p.at), place: pl[p.place_id] || '', accuracy_m: p.accuracy_m, offline: p.offline, status: p.status, why: (p.flags && p.flags.why) || [], decided: rv[p.id] || null }));
    return { day: day, punches: x.review ? rows.filter(r => !r.decided) : rows };
  },
  async punchSelfie(s, x) {
    needOffice(s); const p = ((await db('GET', 'hr_punches?select=selfie_path&id=eq.' + id(x.id) + '&site=eq.' + enc(s.site))) || [])[0]; if (!p) throw fail(404, 'This punch was not found on this site.', 'notfound');
    const url = await store.link(p.selfie_path, 120, store.SELFIES); if (!url) throw fail(404, 'The photo of this punch is not there any more (photos are kept 90 days).', 'nofile');
    return { url: url };
  },
  // a doubtful punch: counts (accepted) or does not (refused) – the punch itself stays as it came
  async punchReview(s, x) {
    await power.need(s, 'review'); const p = ((await db('GET', 'hr_punches?select=id,employee_id,kind,at,status&id=eq.' + id(x.id) + '&site=eq.' + enc(s.site))) || [])[0]; if (!p) throw fail(404, 'This punch was not found on this site.', 'notfound');
    if (p.status !== 'review') throw fail(400, 'This punch needs no decision.', 'noreview');
    await require('./act_month').needOpen(s.site, R.today(Date.parse(p.at)));      // (step 10) a month the HO HR approved is closed
    const dec = x.decision === 'accepted' || x.decision === 'refused' ? x.decision : ''; if (!dec) throw fail(400, 'Decision: accept or refuse.', 'decision');
    const note = R.str(x.note, 200); if (dec === 'refused' && note.length < 3) throw fail(400, 'Reason: write why it is refused.', 'note');
    if (((await db('GET', 'hr_punch_reviews?select=id&punch_id=eq.' + p.id)) || []).length) throw fail(409, 'This punch was already decided.', 'decided');
    await db('POST', 'hr_punch_reviews', [{ punch_id: p.id, decision: dec, note: note, by: s.email }], 'return=minimal');
    await audit(s.site, s.email, 'Punch ' + dec, p.kind + ' ' + p.at, { punch: p.id, note: note });
    return ACT.punchDay(s, { review: 1 });
  },

  /* ───────────── a person, for himself ───────────── */
  async myAttend(s, x) {
    const emp = await me(s), now = Date.now(), day = dayOf(now), [places, st, dev] = await Promise.all([placesOf(emp, day), stand(emp, now), db('GET', 'hr_devices?select=device_id,model&employee_id=eq.' + emp.id + '&active=is.true')]);
    const d = (dev || [])[0], mine = R.str(x && x.device_id, 100);
    return { employee: { code: emp.code, name: emp.name, category: emp.category }, may: MAY_PUNCH.indexOf(emp.status) > -1, now: now, day: day, places: places.map(A.forPhone), max_accuracy: A.MAX_ACCURACY,
      phone: !d ? 'none' : mine && d.device_id === mine ? 'this' : 'other', phone_model: d ? d.model : '', punches: st.shown.map(forMe), next: st.next, face: st.face, once: st.once, closed: st.closed ? hm(new Date(st.closed).toISOString()) : '', shift: st.shift, week_off: st.week_off, days_off: st.days_off };
  },
  // where the phone puts the proof photo of ONE punch (a JPEG, at most 1 MB); a photo is never replaced
  async selfieUrl(s, x) {
    const emp = await me(s), cid = String(x.client_id || ''); if (!CLIENT.test(cid)) throw fail(400, 'Bad punch number.', 'client_id');
    const path = emp.id + '/' + cid + '.jpg'; if (await store.link(path, 60, store.SELFIES)) return { url: '', there: true, type: 'image/jpeg', max: 1048576 };      // already sent: not a second time
    return { url: await store.uploadUrl(path, store.SELFIES), there: false, type: 'image/jpeg', max: 1048576 };
  },
  async punch(s, x) {
    const emp = await me(s), cid = String(x.client_id || ''), kind = x.kind === 'in' || x.kind === 'out' ? x.kind : '';
    if (!CLIENT.test(cid) || !kind) throw fail(400, 'Bad punch.', 'punch');
    // sent twice (the phone got no answer the first time): kept once, the same answer again
    const had = ((await db('GET', 'hr_punches?select=' + PUNCH + '&client_id=eq.' + cid)) || [])[0];
    if (had) { if (had.employee_id !== emp.id) throw fail(409, 'Bad punch number.', 'client_id'); const af = await stand(emp, Date.now()); return { again: true, punch: forMe(had), punches: af.shown.map(forMe), next: af.next }; }
    if (MAY_PUNCH.indexOf(emp.status) < 0) throw fail(403, 'Your employee record is not complete (date of birth, e-mail, mobile) – ask the HR office.', 'incomplete');
    if (x.dev_options === true) throw fail(403, 'Developer Options are ON in this phone: switch them off (Settings → Developer options) to mark attendance.', 'devoptions');
    if (x.mock === true) throw fail(403, 'This phone gives a made-up location: attendance cannot be marked.', 'mock');
    const dv = x.device || {}, did = R.str(dv.id, 100), model = R.str(dv.model, 60), os = R.str(dv.os, 40); if (did.length < 8) throw fail(400, 'This phone could not be identified.', 'device');
    // one phone a person, one person a phone
    let bound = ((await db('GET', 'hr_devices?select=id,device_id&employee_id=eq.' + emp.id + '&active=is.true')) || [])[0];
    const refuse = async (why, msg) => { try { await db('POST', 'hr_device_tries', [{ employee_id: emp.id, device_id: did, model: model, why: why }], 'return=minimal'); } catch (e) { /* the refusal stands */ } throw fail(403, msg, 'device'); };
    if (bound && bound.device_id !== did) await refuse('another phone', 'Your attendance is tied to another phone. Only the HR Admin can release it – then this phone will work.');
    const lat = G.num(x.lat), lng = G.num(x.lng), acc = G.num(x.accuracy_m);
    if (!G.okLat(lat) || !G.okLng(lng)) throw fail(400, 'Your location was not received: switch on Location and try again.', 'gps');
    if (!(acc >= 0) || acc > A.MAX_ACCURACY) throw fail(400, 'Your location is not exact enough yet (' + (acc >= 0 ? Math.round(acc) + ' m' : 'unknown') + '): stand in the open for a moment and try again.', 'accuracy');
    const now = Date.now(), m = A.moment(x, now), day = dayOf(m.at);
    if (!x.offline && day !== dayOf(now)) throw fail(400, 'Attendance is marked for today only.', 'day');
    const places = await placesOf(emp, day); if (!places.length) throw fail(403, 'No work place is set for you yet – ask the HR office.', 'noplace');
    const near = G.nearest(places, lat, lng);
    if (!near.inside) throw fail(403, 'You are outside your work place (' + near.place.name + ' – ' + near.distance + ' m away). Attendance is marked only inside.', 'outside', { distance: near.distance, place: near.place.name });
    const list = await dayPunches(emp.id, day), last = list[list.length - 1], why = m.why.slice();
    const st = await stand(emp, now);      // (12-11-2026) once a day; the OUT of a night shift the morning after; a day closed by itself
    /* (step 9, his rule: the geofence AND the face – "yatle ek jari nahi zal attendence mark nahi honar") where the site's rule
     * asks for the face, THIS punch's proof photo must have been checked against his registered face and found his (api/face.js
     * faceCheck wrote "ok" for this punch number). No such note: nothing is saved. A photo is never replaced, so the note is of
     * exactly the photo kept with the punch. */
    if (st.face) {
      let seen; try { seen = (await db('GET', 'hr_face_tries?select=id&employee_id=eq.' + emp.id + '&client_id=eq.' + cid + '&kind=eq.punch&result=eq.ok&limit=1')) || []; }
      catch (e) { if (e && e.code === 'notinstalled') throw fail(500, 'The face check is not set up yet: the Super Admin runs sql/hr_step9_faces.sql once in the rcl-hr Supabase → SQL Editor.', 'notinstalled9'); throw e; }
      if (!seen.length) throw fail(403, 'Not marked: your face was not checked for this punch. Update the app (the face check is needed on your site) and mark again.', 'face');
    }
    if (!x.offline) {
      if (kind === 'in' && st.open) throw fail(409, 'You are already IN since ' + hm(st.open.at) + '.', 'already');
      if (kind === 'in' && st.next === 'done') throw fail(409, 'Today\'s attendance is done – one IN and one OUT a day. A mistake: ask to set the day right.', 'done');
      if (kind === 'out' && !st.open) throw fail(409, st.closed ? 'Today was closed by itself at ' + hm(new Date(st.closed).toISOString()) + ' – OUT was not marked in time. Ask to set the day right.' : last && last.kind === 'out' ? 'You are already OUT since ' + hm(last.at) + '.' : 'Mark IN first.', 'already');
    } else {
      if (last && Date.parse(last.at) > m.at) why.push('came after a later punch'); if ((kind === 'in' && last && last.kind === 'in') || (kind === 'out' && (!last || last.kind === 'out'))) why.push('IN / OUT not in order');
      if (st.once && kind === 'in' && list.some(p => p.kind === 'in')) why.push('a second IN on one day');
    }
    const path = emp.id + '/' + cid + '.jpg'; if (!(await store.link(path, 60, store.SELFIES))) throw fail(400, 'The photo of this punch did not arrive – take it again.', 'selfie');
    if (!bound) {
      try { bound = (await db('POST', 'hr_devices', [{ employee_id: emp.id, device_id: did, model: model, os: os }], 'return=representation'))[0]; await audit(emp.site, s.email, 'Phone tied to attendance', emp.code + ' ' + emp.name, { model: model }); }
      catch (e) { if (e && e.code === 'duplicate') await refuse('phone of another person', 'This phone is already tied to another employee\'s attendance. Only the HR Admin can release it.'); throw e; }
    }
    const row = { employee_id: emp.id, site: emp.site, kind: kind, day: day, at: new Date(m.at).toISOString(), at_device: isNaN(Date.parse(String(x.at_device || ''))) ? null : new Date(Date.parse(x.at_device)).toISOString(),
      lat: lat, lng: lng, accuracy_m: acc, place_id: near.place.id, inside: true, distance_m: 0, selfie_path: path, device_row: bound.id, client_id: cid, offline: !!x.offline, flags: why.length ? { why: why } : {}, status: why.length ? 'review' : 'ok' };
    let saved;
    try { saved = (await db('POST', 'hr_punches', [row], 'return=representation'))[0]; }
    catch (e) { if (e && e.code === 'duplicate') { saved = ((await db('GET', 'hr_punches?select=' + PUNCH + '&client_id=eq.' + cid)) || [])[0]; if (!saved || saved.employee_id !== emp.id) throw e; } else throw e; }
    const af = await stand(emp, Date.now());
    return { again: false, punch: forMe(saved), place: near.place.name, punches: af.shown.map(forMe), next: af.next };
  },
};
// what a person who has only "My HR" (role self) may call – everything else is the HR office's
const SELF = ['myAttend', 'selfieUrl', 'punch'];
const NOT_READY4 = 'Attendance is not set up yet: the Super Admin runs sql/hr_step4_attendance.sql once in the rcl-hr Supabase → SQL Editor.';
module.exports = { ACT, SELF, NOT_READY4, MAY_PUNCH, me, hm, id, needOffice, PUNCH, placesOf };
