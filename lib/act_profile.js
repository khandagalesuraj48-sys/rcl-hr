/* THE EMPLOYEE'S FULL PROFILE (step 6, 12-11-2026) – api/hr.js sends these actions here.
 * Asked with pictures of a reference product ("PROPER HE SAGLE OPTION BANWAYCHE AAHE") and: "TU FIX AS KAHI BANAU NAKO CHANGES
 * KARAT AYAWET SUPER ADMIN LA ANI ADMIN LA PN". So:
 *   – every pick-list (prefix, marital status, blood group, type of worker, branch, relation …) is a LIST the HR Admin / Super
 *     Admin fill themselves (hr_lists): add, rename, switch off. A value in use is never deleted – switched off, it stays where
 *     it was chosen.
 *   – which details are COMPULSORY for "profile complete" is their setting too (hr_settings).
 *   – the details themselves are described ONCE below (GROUPS, ROWS): the server checks with it and the page draws its forms
 *     from it – a new detail is one line here.
 * PF / UAN / ESIC / bank numbers ("secret") are never in a list or an export; an HR User sees them masked; the audit keeps only
 * WHICH detail changed, never the number. Nothing is deleted: a family member / education row is "removed" with who and why.
 * No code of any other HR product is used – the pictures were read for the workflow only. */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const { needOffice } = require('./act_attend');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uid = v => { v = String(v || '').toLowerCase(); return UUID.test(v) ? v : ''; };
const isAdmin = s => s.role === 'admin' || s.role === 'super';
const needAdmin = s => { if (!isAdmin(s)) throw fail(403, 'Only the HR Admin or the Super Admin can do this.', 'role'); };
const soft = p => p.catch(e => { if (e && e.code === 'notinstalled') return null; throw e; });
const NOT_READY6 = 'The full profile is not set up yet: the Super Admin runs sql/hr_step6_profile.sql once in the rcl-hr Supabase → SQL Editor.';

// the lists the office fills itself
const LISTS = [['prefix', 'Prefix (Mr., Mrs. …)'], ['marital', 'Marital status'], ['blood', 'Blood group'], ['nationality', 'Nationality'], ['employee_type', 'Employee type'], ['worker_type', 'Type of worker'],
  ['employment_type', 'Employment type'], ['skill_category', 'Skill category'], ['branch', 'Branch'], ['relation', 'Relation (family)'], ['qualification', 'Qualification'], ['skill', 'Skill']];
const LIST_KEYS = LISTS.map(l => l[0]);
/* a detail: [key, label, type, more]   type: text | email | mobile | date | int | digits | ifsc | yesno | list (more.list = its list) */
const f = (key, label, type, more) => Object.assign({ key: key, label: label, type: type }, more || {});
const GROUPS = {
  profile: { name: 'Profile', fields: [f('prefix', 'Prefix', 'list', { list: 'prefix' }), f('father_name', 'Father\'s / husband\'s name', 'text', { max: 80 }), f('marital', 'Marital status', 'list', { list: 'marital' }), f('blood', 'Blood group', 'list', { list: 'blood' }),
    f('nationality', 'Nationality', 'list', { list: 'nationality' }), f('disability', 'Physical disability (empty = none)', 'text', { max: 80 }), f('official_email', 'Official e-mail', 'email'), f('cug', 'CUG number', 'mobile'), f('name_aadhaar', 'Name as on Aadhaar', 'text', { max: 80 })] },
  job: { name: 'Job', fields: [f('employee_type', 'Employee type', 'list', { list: 'employee_type' }), f('worker_type', 'Type of worker', 'list', { list: 'worker_type' }), f('employment_type', 'Employment type', 'list', { list: 'employment_type' }),
    f('skill_category', 'Skill category', 'list', { list: 'skill_category' }), f('branch', 'Branch', 'list', { list: 'branch' }), f('probation_end', 'Probation ends on', 'date'), f('confirmation_date', 'Confirmation date', 'date'),
    f('notice_days', 'Notice period (days)', 'int', { min: 0, max: 365 }), f('retirement_age', 'Retirement age (years)', 'int', { min: 40, max: 80 }), f('overtime', 'Overtime applicable', 'yesno')] },
  secret: { name: 'Statutory & bank', secret: true, fields: [f('pf_no', 'PF number', 'text', { max: 30 }), f('uan', 'UAN number', 'digits', { min: 12, max: 12 }), f('pf_join', 'PF joining date', 'date'), f('esic_no', 'ESIC number', 'digits', { min: 10, max: 17 }), f('esic_join', 'ESIC joining date', 'date'),
    f('bank_name', 'Bank', 'text', { max: 60 }), f('bank_ifsc', 'Bank IFSC code', 'ifsc'), f('bank_account', 'Bank account number', 'digits', { min: 6, max: 18 }), f('bank_holder', 'Name as on bank', 'text', { max: 80 })] },
};
const MASKED = ['pf_no', 'uan', 'esic_no', 'bank_account'];
const ROWS = {
  family: { name: 'Family', one: 'family member', fields: [f('name', 'Name', 'text', { max: 80, need: true }), f('relation', 'Relation', 'list', { list: 'relation' }), f('dob', 'Date of birth', 'date'), f('mobile', 'Mobile', 'mobile'), f('nominee', 'Nominee', 'yesno')] },
  education: { name: 'Education', one: 'qualification', fields: [f('qualification', 'Qualification', 'list', { list: 'qualification', need: true }), f('institute', 'School / college / board', 'text', { max: 100 }), f('year', 'Year of passing', 'int', { min: 1950, max: 2100 }), f('grade', 'Marks / grade', 'text', { max: 30 })] },
  experience: { name: 'Experience', one: 'earlier job', fields: [f('company', 'Company', 'text', { max: 100, need: true }), f('designation', 'Designation', 'text', { max: 60 }), f('from', 'From', 'date'), f('to', 'To', 'date'), f('reason', 'Reason for leaving', 'text', { max: 120 })] },
  skill: { name: 'Skills', one: 'skill', fields: [f('skill', 'Skill', 'list', { list: 'skill', need: true }), f('level', 'Level / note', 'text', { max: 60 })] },
};
const mask = v => (v ? 'XXXX' + String(v).slice(-4) : '');

/* typed values → { row, errors } with the details of one group. lists: { kind: { id: {active} } }; was: what is kept now (a
 * value switched off stays allowed where it already is). Empty = the detail is taken out. */
function clean(fields, x, lists, was) {
  x = x || {}; was = was || {}; const row = {}, errors = [];
  for (const d of fields) {
    const raw = x[d.key], empty = raw === undefined || raw === null || String(raw).trim() === ''; let v = null;
    if (empty) { if (d.need) errors.push(d.label + ': needed.'); continue; }
    if (d.type === 'text') { v = R.str(raw, d.max || 120); }
    else if (d.type === 'email') { v = R.email(raw); if (!v) errors.push(d.label + ': not an e-mail address.'); }
    else if (d.type === 'mobile') { v = R.mobile(raw); if (!v) errors.push(d.label + ': a 10-digit mobile number.'); }
    else if (d.type === 'date') { v = R.date(raw); if (!v) errors.push(d.label + ': a date as DD-MM-YYYY.'); }
    else if (d.type === 'int') { const n = Number(String(raw).trim()); if (!Number.isInteger(n) || n < d.min || n > d.max) errors.push(d.label + ': a whole number, ' + d.min + ' to ' + d.max + '.'); else v = n; }
    else if (d.type === 'digits') { const t = String(raw).replace(/[\s-]/g, ''); if (!/^\d+$/.test(t) || t.length < d.min || t.length > d.max) errors.push(d.label + ': ' + (d.min === d.max ? d.min : d.min + ' to ' + d.max) + ' digits.'); else v = t; }
    else if (d.type === 'ifsc') { const t = R.str(raw, 15).toUpperCase().replace(/\s/g, ''); if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(t)) errors.push(d.label + ': 11 letters and digits, the fifth is 0 (for example SBIN0001234).'); else v = t; }
    else if (d.type === 'yesno') { v = raw === true || raw === 'yes' ? true : raw === false || raw === 'no' ? false : null; if (v === null) errors.push(d.label + ': Yes or No.'); }
    else if (d.type === 'list') { const t = uid(raw), it = t && lists[d.list] && lists[d.list][t]; if (!it || (!it.active && was[d.key] !== t)) errors.push(d.label + ': choose a value of the list.'); else v = t; }
    if (v !== null && v !== '') row[d.key] = v;
  }
  return { row: row, errors: errors };
}
async function listsAll() {
  const rows = (await db('GET', 'hr_lists?select=id,kind,name,active,sort&order=kind,sort,name&limit=5000')) || [], by = {};
  LIST_KEYS.forEach(k => { by[k] = []; }); rows.forEach(r => { if (by[r.kind]) by[r.kind].push({ id: r.id, name: r.name, active: r.active, sort: r.sort }); });
  return by;
}
const index = by => { const o = {}; Object.keys(by).forEach(k => { o[k] = {}; by[k].forEach(r => { o[k][r.id] = r; }); }); return o; };
const empOf = async (s, empId) => { const e = ((await db('GET', 'hr_employees?select=id,code,name,category,gender,dob,mobile,email,site,department_id,designation_id,joined_on,status&id=eq.' + empId + '&site=eq.' + enc(s.site))) || [])[0]; if (!e) throw fail(404, 'This employee was not found on this site.', 'notfound'); return e; };
const requiredOf = async site => { const r = ((await db('GET', 'hr_settings?select=value&site=eq.' + enc(site) + '&key=eq.profile_required')) || [])[0]; return r && Array.isArray(r.value.keys) ? r.value.keys : []; };
// every detail that counts for "profile complete": the basics of the Employee Master, the three groups, and "at least one" of each list of rows
const BASICS = [['dob', 'Date of birth'], ['mobile', 'Mobile'], ['email', 'E-mail'], ['gender', 'Gender'], ['joined_on', 'Active from (joining date)'], ['department_id', 'Department'], ['designation_id', 'Designation']];
const ITEMS = BASICS.map(b => ({ key: 'emp.' + b[0], label: b[1], group: 'Employee Master' }))
  .concat(...['profile', 'job', 'secret'].map(g => GROUPS[g].fields.map(d => ({ key: g + '.' + d.key, label: d.label, group: GROUPS[g].name }))))
  .concat(Object.keys(ROWS).map(k => ({ key: 'rows.' + k, label: ROWS[k].name + ' (at least one)', group: 'Lists' })));
function complete(e, p, rows, required) {
  const has = k => { const [g, n] = k.split('.'); if (g === 'emp') return !!e[n]; if (g === 'rows') return (rows[n] || []).length > 0; const v = ((g === 'secret' ? p.secret : p.data) || {})[n]; return v !== undefined && v !== null && v !== ''; };
  const filled = ITEMS.filter(i => has(i.key)).length;
  return { pct: Math.round(filled * 100 / ITEMS.length), filled: filled, of: ITEMS.length, missing: ITEMS.filter(i => required.indexOf(i.key) > -1 && !has(i.key)).map(i => i.label) };
}
async function load(s, empId) {
  const e = await empOf(s, empId);
  const [pr, rw, lists, required] = await Promise.all([db('GET', 'hr_employee_profile?select=data,secret,updated_by,updated_at&employee_id=eq.' + e.id), db('GET', 'hr_employee_rows?select=id,kind,data,updated_by,updated_at&employee_id=eq.' + e.id + '&removed_at=is.null&order=created_at'), listsAll(), requiredOf(s.site)]);
  const p = (pr || [])[0] || { data: {}, secret: {} }, rows = {}; Object.keys(ROWS).forEach(k => { rows[k] = []; }); (rw || []).forEach(r => { if (rows[r.kind]) rows[r.kind].push({ id: r.id, data: r.data }); });
  return { e: e, p: p, rows: rows, lists: lists, required: required };
}
const defs = () => ({ groups: Object.keys(GROUPS).map(k => ({ key: k, name: GROUPS[k].name, fields: GROUPS[k].fields })), rows: Object.keys(ROWS).map(k => ({ key: k, name: ROWS[k].name, one: ROWS[k].one, fields: ROWS[k].fields })), lists: LISTS.map(l => ({ key: l[0], name: l[1] })) });
function out(s, L) {
  const secret = Object.assign({}, L.p.secret || {}); if (!isAdmin(s)) MASKED.forEach(k => { if (secret[k]) secret[k] = mask(secret[k]); });
  return { employee: { id: L.e.id, code: L.e.code, name: L.e.name, category: L.e.category, status: L.e.status }, data: L.p.data || {}, secret: secret, masked: !isAdmin(s), rows: L.rows, lists: L.lists, defs: defs(), complete: complete(L.e, L.p, L.rows, L.required), can_admin: isAdmin(s) };
}

const ACT = {
  // one employee's full profile – with the lists and the description of every detail (the page draws its forms from it)
  async profGet(s, x) { needOffice(s); return out(s, await load(s, uid(x.id))); },
  // one group saved: profile | job | secret
  async profSave(s, x) {
    needOffice(s); const g = GROUPS[String(x.group)] ? String(x.group) : ''; if (!g) throw fail(400, 'Unknown part of the profile.', 'group');
    const L = await load(s, uid(x.id)); if (L.e.status === 'left') throw fail(400, 'This employee has left – his details are not changed.', 'left');
    const col = g === 'secret' ? 'secret' : 'data', was = L.p[col] || {}, src = Object.assign({}, x.data || {});
    // an HR User sees the numbers masked: a box he left as it was keeps its number
    if (g === 'secret' && !isAdmin(s)) MASKED.forEach(k => { if (was[k] && (src[k] === undefined || src[k] === '' || /^X/i.test(String(src[k])))) src[k] = was[k]; });
    const c = clean(GROUPS[g].fields, src, index(L.lists), was); if (c.errors.length) throw fail(400, c.errors.join(' '), 'check');
    const keys = GROUPS[g].fields.map(d => d.key), next = Object.assign({}, was); keys.forEach(k => { delete next[k]; }); Object.assign(next, c.row);
    const changed = keys.filter(k => JSON.stringify(was[k] === undefined ? null : was[k]) !== JSON.stringify(next[k] === undefined ? null : next[k]));
    if (changed.length) {
      await db('POST', 'hr_employee_profile?on_conflict=employee_id', [{ employee_id: L.e.id, data: col === 'data' ? next : L.p.data || {}, secret: col === 'secret' ? next : L.p.secret || {}, updated_by: s.email, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
      const diff = {}; changed.forEach(k => { diff[k] = g === 'secret' ? 'changed' : [was[k] === undefined ? '' : was[k], next[k] === undefined ? '' : next[k]]; });      // a number is never written in the audit
      await audit(s.site, s.email, 'Profile changed (' + GROUPS[g].name + ')', L.e.code, diff);
    }
    return ACT.profGet(s, { id: L.e.id });
  },
  // a family member / a qualification / an earlier job / a skill: added or changed
  async profRowSave(s, x) {
    needOffice(s); const kind = ROWS[String(x.kind)] ? String(x.kind) : ''; if (!kind) throw fail(400, 'Unknown list.', 'kind');
    const L = await load(s, uid(x.id)); if (L.e.status === 'left') throw fail(400, 'This employee has left – his details are not changed.', 'left');
    const rid = uid(x.row), was = rid ? (L.rows[kind].find(r => r.id === rid) || null) : null; if (rid && !was) throw fail(404, 'This row was not found.', 'notfound');
    const c = clean(ROWS[kind].fields, x.data, index(L.lists), was ? was.data : {}); if (c.errors.length) throw fail(400, c.errors.join(' '), 'check');
    if (kind === 'experience' && c.row.from && c.row.to && c.row.to < c.row.from) throw fail(400, 'To: it is before From.', 'check');
    if (!rid && L.rows[kind].length >= 30) throw fail(400, 'This list is full (30 rows).', 'full');
    const now = new Date().toISOString();
    if (rid) await db('PATCH', 'hr_employee_rows?id=eq.' + rid + '&employee_id=eq.' + L.e.id, { data: c.row, updated_by: s.email, updated_at: now }, 'return=minimal');
    else await db('POST', 'hr_employee_rows', [{ employee_id: L.e.id, kind: kind, data: c.row, created_by: s.email, updated_by: s.email }], 'return=minimal');
    await audit(s.site, s.email, ROWS[kind].name + (rid ? ' changed' : ' added'), L.e.code, { old: was ? was.data : null, new: c.row });
    return ACT.profGet(s, { id: L.e.id });
  },
  async profRowRemove(s, x) {
    needOffice(s); const rid = uid(x.row), why = R.str(x.reason, 200); if (why.length < 3) throw fail(400, 'Reason: write why it is removed.', 'reason');
    const r = ((await db('GET', 'hr_employee_rows?select=id,employee_id,kind,data&id=eq.' + rid + '&removed_at=is.null')) || [])[0]; if (!r) throw fail(404, 'This row was not found.', 'notfound');
    const e = await empOf(s, r.employee_id);
    await db('PATCH', 'hr_employee_rows?id=eq.' + r.id, { removed_at: new Date().toISOString(), removed_by: s.email, removed_reason: why }, 'return=minimal');
    await audit(s.site, s.email, ROWS[r.kind].name + ' removed', e.code, { old: r.data, reason: why });
    return ACT.profGet(s, { id: e.id });
  },

  /* ───────────── the lists and the settings (HR Admin / Super Admin) ───────────── */
  async listAll(s) { needOffice(s); return { kinds: LISTS.map(l => ({ key: l[0], name: l[1] })), lists: await listsAll(), items: ITEMS, required: await requiredOf(s.site), can: isAdmin(s) }; },
  // a value added, renamed, switched on / off, put in another place of the order
  async listSave(s, x) {
    needAdmin(s); const kind = LIST_KEYS.indexOf(String(x.kind)) > -1 ? String(x.kind) : ''; if (!kind) throw fail(400, 'Unknown list.', 'kind');
    const name = R.str(x.name, 60); if (!name) throw fail(400, 'Name: write the value.', 'name');
    const had = (await db('GET', 'hr_lists?select=id,name,active,sort&kind=eq.' + kind + '&limit=1000')) || [], lid = uid(x.id), was = lid ? had.find(h => h.id === lid) : null; if (lid && !was) throw fail(404, 'This value was not found.', 'notfound');
    if (had.some(h => h.name.toLowerCase() === name.toLowerCase() && h.id !== lid)) throw fail(409, 'This value is already in the list.', 'duplicate');
    if (!lid && had.length >= 300) throw fail(400, 'This list is full (300 values).', 'full');
    const sort = Number.isInteger(Number(x.sort)) ? Math.max(0, Math.min(9999, Number(x.sort))) : was ? was.sort : had.length + 1, row = { name: name, active: x.active !== false, sort: sort, updated_by: s.email, updated_at: new Date().toISOString() };
    if (lid) await db('PATCH', 'hr_lists?id=eq.' + lid, row, 'return=minimal'); else await db('POST', 'hr_lists', [Object.assign({ kind: kind, created_by: s.email }, row)], 'return=minimal');
    await audit(s.site, s.email, lid ? 'List value changed' : 'List value added', kind + ': ' + name, { old: was || null, new: row });
    return ACT.listAll(s);
  },
  // which details are compulsory for "profile complete" on this site
  async profRequiredSave(s, x) {
    needAdmin(s); const all = ITEMS.map(i => i.key), keys = [...new Set((Array.isArray(x.keys) ? x.keys : []).map(String))].filter(k => all.indexOf(k) > -1), was = await requiredOf(s.site);
    await db('POST', 'hr_settings?on_conflict=site,key', [{ site: s.site, key: 'profile_required', value: { keys: keys }, updated_by: s.email, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
    await audit(s.site, s.email, 'Compulsory details of the profile changed', keys.length + ' details', { old: was, new: keys });
    return ACT.listAll(s);
  },
};
module.exports = { ACT, NOT_READY6, GROUPS, ROWS, LISTS, ITEMS, clean, complete, mask };
