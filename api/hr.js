/* POST /api/hr { action, … } – every action of the HR pages. One door: the sign-in is asked first (lib/session.js), then the
 * action's own access (HR User / HR Admin / Super Admin – as the Portal gave it for THIS site), then the work. A person reads
 * and writes only the site of his sign-in; a transfer goes only to a site he has HR on. An employee who leaves is "left" (relieved,
 * with his relieving date) and stays; a department is switched off. ONE thing can be deleted (asked 12-11-2026: "EMPLOYEE DELET PN
 * KRTA YAWA"): an employee added by mistake, while NOTHING hangs on him – empDelete. Every change is written in hr_audit with the old and the new value.
 * Phase 1 (12-11-2026): the masters (departments, designations), the Employee Master, transfer, exit, import. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { db, enc } = require('../lib/db');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const R = require('../lib/rules');
const store = require('../lib/store');
const crypto = require('crypto');
const ATT = require('../lib/act_attend');      // (step 4) attendance: work places, phones, punches
const MUS = require('../lib/act_muster');      // (step 5) shifts, holidays, rules, the muster, requests
const DASH = require('../lib/act_dash');      // the attendance dashboard of the HR office (reads only)
const LEAVE = require('../lib/act_leave');      // (step 7) leave: the policy, balances, requests
const MONTH = require('../lib/act_month');      // (step 10) the month: verified by the site's HR, approved by the HO HR
const PAY = require('../lib/act_pay');      // (step 11) an employee's salary: proposed by the site's HR, approved by the HO HR
const ROLL = require('../lib/act_payroll');      // (step 12) payroll: the month's pay, the settings, advances, a person's payslips
const MORE = require('../lib/act_more');      // what comes up (papers, birthdays), a payslip to print, the bank list
const power = require('../lib/powers');      // what the Super Admin left the HR Admin of a site
const PROF = require('../lib/act_profile');      // (step 6) the full profile, the lists, what is compulsory
const BOOK = require('../lib/act_rulebook');      // (step 13) the Rule Book: policies with dates, a site's own, a person's own
const ASKS = require('../lib/act_asks');      // (step 13) what waits for verify / approve: overtime, comp-off, extra leave; the ledger
const IMP = require('../lib/act_import');      // (step 13) a month's attendance set right in bulk from an Excel file
const SHEET = require('../lib/act_sheet');      // (13-11-2026) the employee sheet: one Excel format to import and export

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = v => { v = String(v || '').toLowerCase(); return UUID.test(v) ? v : ''; };
const isAdmin = s => s.role === 'admin' || s.role === 'super';
const needAdmin = s => { if (!isAdmin(s)) throw fail(403, 'Only the HR Admin or the Super Admin can do this.', 'role'); };
const EMP = 'id,code,name,category,gender,dob,mobile,email,site,department_id,designation_id,reports_to,joined_on,left_on,left_reason,status,email_verified_at,portal_email,updated_at';
const NOT_READY3 = 'The employee\'s details and papers are not set up yet: the Super Admin runs sql/hr_step3_kyc_docs.sql once in the rcl-hr Supabase → SQL Editor.';
const NOT_READY = 'The Employee Master is not set up yet: the Super Admin runs sql/hr_step2_employees.sql once in the rcl-hr Supabase → SQL Editor.';
const MAST = { department: 'hr_departments', designation: 'hr_designations' };
/* (asked 12-11-2026: "employee code … ase banayla haw RCL001 RCL002") the company's letters and the number, three digits at
 * least (RCL001 … RCL999, RCL1000 …). The number comes from hr_next_no – never given twice. A code already given is not changed. */
const codeOf = n => 'RCL' + String(n).padStart(3, '0');
/* (asked 12-11-2026: "EMPLOYEE CODE CHANGE EDIT KRTA YAWET … FIX NASAWET") a code can be typed and changed by the HR office: capital
 * letters, digits, "-" and "/", 2 to 20; never the code of another employee (the database refuses a double too). Punches, papers
 * and the history hang on the employee himself, not on his code – a changed code moves nothing; the change is written down. */
const CODE_OK = /^[A-Z0-9][A-Z0-9\-\/]{1,19}$/;
const codeTyped = v => R.str(v, 40).toUpperCase().replace(/\s+/g, '');
async function codeFree(code, exceptId) {
  if (!CODE_OK.test(code)) throw fail(400, 'Employee code: 2 to 20 capital letters and digits (also - and /), e.g. RCL001.', 'code');
  const o = ((await db('GET', 'hr_employees?select=id,name&code=eq.' + enc(code))) || [])[0];
  if (o && o.id !== exceptId) throw fail(409, 'The code ' + code + ' already belongs to another employee.', 'codetaken');
}
// `count` codes made by themselves – a number whose code somebody typed by hand already is passed over
async function newCodes(count) {
  const out = [];
  for (let round = 0; out.length < count && round < 20; round++) {
    const need = count - out.length, first = Number(await db('POST', 'rpc/hr_next_no', { p_kind: 'emp', p_count: need })), all = Array.from({ length: need }, (_, i) => codeOf(first + i));
    const used = {}; ((await db('GET', 'hr_employees?select=code&code=in.(' + all.map(c => '"' + c + '"').join(',') + ')')) || []).forEach(r => { used[r.code] = 1; });
    all.forEach(c => { if (!used[c]) out.push(c); });
  }
  if (out.length < count) throw fail(500, 'No free employee code could be made – type the code yourself.', 'code');
  return out;
}
const sitesOf = s => { const l = (s.info && Array.isArray(s.info.sites) ? s.info.sites : []).map(x => String(x.code)); if (l.indexOf(s.site) < 0) l.push(s.site); return l; };

// (13-11-2026: "designation … yatun categery samjun yete") a designation carries its category – Staff when none is set
async function masters() {
  const [d, g, cat] = await Promise.all([db('GET', 'hr_departments?select=id,name,active&order=name'), db('GET', 'hr_designations?select=id,name,active&order=name'), SHEET.desCats()]);
  return { departments: d || [], designations: (g || []).map(x => Object.assign(x, { category: cat[x.id] || 'staff' })) };
}
// a master's row by its name (made when it is not there – the import); '' = no name
async function masterId(kind, name, who, made) {
  name = R.str(name, 60); if (!name) return null;
  const t = MAST[kind], had = (await db('GET', t + '?select=id,name&name=ilike.' + enc(name.replace(/[%_*,()\\]/g, ' ')))) || [];
  const hit = had.find(x => x.name.toLowerCase() === name.toLowerCase()); if (hit) return hit.id;
  const r = await db('POST', t, [{ name: name, created_by: who }], 'return=representation'); made.push(kind + ': ' + name); return r[0].id;
}
// the mobile numbers and e-mails already taken (by another employee)
async function taken(rows, exceptId) {
  const mob = [...new Set(rows.map(r => r.mobile).filter(Boolean))], em = [...new Set(rows.map(r => r.email).filter(Boolean))], out = { mobile: {}, email: {} };
  const not = exceptId ? '&id=neq.' + exceptId : '';
  for (let i = 0; i < mob.length; i += 100) ((await db('GET', 'hr_employees?select=code,mobile&mobile=in.(' + mob.slice(i, i + 100).join(',') + ')' + not)) || []).forEach(x => { out.mobile[x.mobile] = x.code; });
  for (let i = 0; i < em.length; i += 50) ((await db('GET', 'hr_employees?select=code,email&email=in.(' + em.slice(i, i + 50).map(e => '"' + e.replace(/"/g, '') + '"').map(enc).join(',') + ')' + not)) || []).forEach(x => { out.email[x.email] = x.code; });
  return out;
}
const one = async (s, empId) => { const e = ((await db('GET', 'hr_employees?select=' + EMP + '&id=eq.' + empId + '&site=eq.' + enc(s.site))) || [])[0]; if (!e) throw fail(404, 'This employee was not found on this site.', 'notfound'); return e; };
async function checkLinks(s, x, selfId) {
  const dep = id(x.department_id) || null, des = id(x.designation_id) || null, rep = id(x.reports_to) || null;
  if (dep && !((await db('GET', 'hr_departments?select=id&id=eq.' + dep)) || []).length) throw fail(400, 'Department: choose one of the list.', 'department_id');
  if (des && !((await db('GET', 'hr_designations?select=id&id=eq.' + des)) || []).length) throw fail(400, 'Designation: choose one of the list.', 'designation_id');
  if (rep) { if (rep === selfId) throw fail(400, 'Reporting person: a person cannot report to himself.', 'reports_to'); if (!((await db('GET', 'hr_employees?select=id&id=eq.' + rep + '&status=neq.left')) || []).length) throw fail(400, 'Reporting person: choose an employee of the list.', 'reports_to'); }
  return { department_id: dep, designation_id: des, reports_to: rep };
}

const ACT = {
  // the lists a page needs to begin
  async init(s) { const m = await masters(); return Object.assign({ site: s.site, role: s.role, signin: s.role === 'super' || (s.role === 'admin' && !!(await power.of(s.site)).signin), ho: s.role !== 'self' && await require('../lib/act_month').isHo(s).catch(() => false), sites: (s.info && s.info.sites) || [], categories: R.CATS.map(k => ({ key: k, name: R.CAT_NAME[k] })) }, m); },

  async masterSave(s, x) {
    needAdmin(s); const t = MAST[x.kind]; if (!t) throw fail(400, 'Unknown list.');
    const name = R.str(x.name, 60); if (name.length < 2) throw fail(400, 'Name: at least 2 letters.', 'name');
    const mid = id(x.id), same = ((await db('GET', t + '?select=id,name&name=ilike.' + enc(name.replace(/[%_*,()\\]/g, ' ')))) || []).find(r => r.name.toLowerCase() === name.toLowerCase() && r.id !== mid);
    if (same) throw fail(409, 'This name is already in the list.', 'name');
    const cat = x.kind === 'designation' && x.category !== undefined ? R.category(x.category) : undefined; if (cat === null) throw fail(400, 'Category: Staff, Operator, Driver or Labour.', 'category');
    if (mid && cat) { const had = (await SHEET.desCats())[mid] || 'staff'; if (had !== cat) { await SHEET.desCatSave(mid, cat, s.email); await audit(s.site, s.email, 'Designation\'s category changed', name, { old: had, new: cat }); } }
    if (mid) {
      const was = ((await db('GET', t + '?select=id,name,active&id=eq.' + mid)) || [])[0]; if (!was) throw fail(404, 'Not found.');
      const now = { name: name, active: x.active === undefined ? was.active : !!x.active, updated_at: new Date().toISOString() };
      await db('PATCH', t + '?id=eq.' + mid, now, 'return=minimal'); await audit(s.site, s.email, 'Master changed', x.kind + ' ' + name, { old: { name: was.name, active: was.active }, new: { name: now.name, active: now.active } });
    } else { const made = await db('POST', t, [{ name: name, created_by: s.email }], 'return=representation'); if (cat && cat !== 'staff' && made && made[0]) await SHEET.desCatSave(made[0].id, cat, s.email); await audit(s.site, s.email, 'Master added', x.kind + ' ' + name, cat ? { category: cat } : null); }
    return masters();
  },

  async empList(s, x) {
    const q = R.str(x.q, 60).replace(/[%_*,()\\"]/g, ' ').trim(), st = ['incomplete', 'pending', 'active', 'left'].indexOf(x.status) > -1 ? x.status : '', cat = R.CATS.indexOf(x.category) > -1 ? x.category : '';
    let path = 'hr_employees?select=' + EMP + '&site=eq.' + enc(s.site) + (st ? '&status=eq.' + st : '&status=neq.left') + (cat ? '&category=eq.' + cat : '');
    if (q) path += '&or=' + enc('(name.ilike.*' + q + '*,code.ilike.*' + q + '*,mobile.ilike.*' + q + '*,email.ilike.*' + q + '*)');
    // (12-11-2026, "hr modual slow ahe") the two readings are asked together – one wait, not two
    const [rs, al] = await Promise.all([db('GET', path + '&order=name&limit=501'), db('GET', 'hr_employees?select=status&site=eq.' + enc(s.site))]);
    const rows = rs || [], all = al || [], counts = { incomplete: 0, pending: 0, active: 0, left: 0 }; all.forEach(r => { counts[r.status]++; });
    return { rows: rows.slice(0, 500), more: rows.length > 500, counts: counts };
  },

  async empGet(s, x) {
    const e = await one(s, id(x.id));
    const [hist, bs] = await Promise.all([db('GET', 'hr_employment?select=id,site,department_id,designation_id,reports_to,valid_from,valid_to,note,created_by,created_at&employee_id=eq.' + e.id + '&order=valid_from.desc,created_at.desc'),
      e.reports_to ? db('GET', 'hr_employees?select=id,code,name&id=eq.' + e.reports_to) : null]);      // (asked together – one wait)
    return { employee: e, history: hist || [], boss: (bs || [])[0] || null };
  },
  // the people an employee can report to (this site's, not left) – for the box of the form
  async empPick(s, x) {
    const q = R.str(x.q, 40).replace(/[%_*,()\\"]/g, ' ').trim();
    return { rows: (await db('GET', 'hr_employees?select=id,code,name&site=eq.' + enc(s.site) + '&status=neq.left' + (q ? '&or=' + enc('(name.ilike.*' + q + '*,code.ilike.*' + q + '*)') : '') + '&order=name&limit=30')) || [] };
  },

  async empSave(s, x) {
    const empId = id(x.id), c = R.employee(x);
    if (c.errors.length) throw fail(400, c.errors.join(' '), 'check');
    const was = empId ? await one(s, empId) : null;
    if (was && was.status === 'left') throw fail(400, 'This employee has left – his details are not changed.', 'left');
    const t = await taken([c.row], empId || '');
    if (c.row.mobile && t.mobile[c.row.mobile]) throw fail(409, 'This mobile number already belongs to employee ' + t.mobile[c.row.mobile] + '.', 'mobile');
    if (c.row.email && t.email[c.row.email]) throw fail(409, 'This e-mail already belongs to employee ' + t.email[c.row.email] + '.', 'email');
    const links = await checkLinks(s, x, empId), now = new Date().toISOString();
    // (12-11-2026: "EMPLOYEE LA SITE ASIGN KRTA YEIL") his site: one of the sites of this sign-in; a new employee is put there, an
    // employee of today is moved there from today (the HR Admin's – it is a transfer, the history keeps the old site)
    const site = R.str(x.site, 12).toUpperCase() || (was ? was.site : s.site);
    if (sitesOf(s).indexOf(site) < 0) throw fail(403, 'Site: choose a site where you have HR.', 'site');
    if (was && site !== was.site) needAdmin(s);
    const code = codeTyped(x.code);      // typed: his code (changed, or given at once); empty: as it is / made by itself
    if (code && (!was || code !== was.code)) await codeFree(code, empId || '');
    if (was) {
      // the e-mail changed: it must be verified again (the activation step)
      const row = Object.assign({}, c.row, links, { status: R.statusOf(c.row, was.status === 'active' && c.row.email === was.email ? 'active' : ''), updated_by: s.email, updated_at: now });
      if (c.row.email !== was.email) row.email_verified_at = null;
      row.site = site; if (code && code !== was.code) row.code = code;
      const moved = site !== was.site || ['department_id', 'designation_id', 'reports_to'].some(k => (row[k] || null) !== (was[k] || null));
      await db('PATCH', 'hr_employees?id=eq.' + empId + '&site=eq.' + enc(s.site), row, 'return=minimal');
      if (moved) { const d = R.today(); await db('PATCH', 'hr_employment?employee_id=eq.' + empId + '&valid_to=is.null', { valid_to: d }, 'return=minimal'); await db('POST', 'hr_employment', [Object.assign({ employee_id: empId, site: site, valid_from: d, note: site !== was.site ? 'Transfer' : 'Changed', created_by: s.email }, links)], 'return=minimal'); }
      const diff = {}; Object.keys(row).forEach(k => { if (['updated_by', 'updated_at'].indexOf(k) < 0 && String(row[k] === null ? '' : row[k]) !== String(was[k] === null || was[k] === undefined ? '' : was[k])) diff[k] = [was[k] === undefined ? null : was[k], row[k]]; });
      await audit(s.site, s.email, 'Employee changed', was.code, diff);
      return { id: empId, code: row.code || was.code, status: row.status, missing: c.missing, site: site };
    }
    const row = Object.assign({ code: code || (await newCodes(1))[0], site: site, status: R.statusOf(c.row, ''), created_by: s.email, updated_by: s.email }, c.row, links);
    const made = (await db('POST', 'hr_employees', [row], 'return=representation'))[0];
    await db('POST', 'hr_employment', [Object.assign({ employee_id: made.id, site: site, valid_from: row.joined_on || R.today(), note: 'Joined', created_by: s.email }, links)], 'return=minimal');
    await audit(s.site, s.email, 'Employee added', made.code, { category: row.category, status: row.status, site: site });
    return { id: made.id, code: made.code, status: row.status, missing: c.missing, site: site };
  },

  // to another site of his sign-in, or another department / designation / reporting person, from a date – the history keeps the old
  async empTransfer(s, x) {
    needAdmin(s); const e = await one(s, id(x.id)); if (e.status === 'left') throw fail(400, 'This employee has left.', 'left');
    const site = R.str(x.site, 12).toUpperCase() || s.site; if (sitesOf(s).indexOf(site) < 0) throw fail(403, 'You can transfer only to a site where you have HR.', 'site');
    const from = R.date(x.from) || R.today(); if (from === null) throw fail(400, 'From: a date as DD-MM-YYYY.', 'from');
    const links = await checkLinks(s, x, e.id), note = R.str(x.note, 200);
    const open = ((await db('GET', 'hr_employment?select=valid_from&employee_id=eq.' + e.id + '&valid_to=is.null&order=valid_from.desc&limit=1')) || [])[0];
    if (open && from < open.valid_from) throw fail(400, 'From: it is before his present posting began (' + open.valid_from.split('-').reverse().join('-') + ').', 'from');
    await db('PATCH', 'hr_employment?employee_id=eq.' + e.id + '&valid_to=is.null', { valid_to: from }, 'return=minimal');
    await db('POST', 'hr_employment', [Object.assign({ employee_id: e.id, site: site, valid_from: from, note: note || 'Transfer', created_by: s.email }, links)], 'return=minimal');
    await db('PATCH', 'hr_employees?id=eq.' + e.id, Object.assign({ site: site, updated_by: s.email, updated_at: new Date().toISOString() }, links), 'return=minimal');
    await audit(s.site, s.email, 'Employee transferred', e.code, { old: { site: e.site, department_id: e.department_id, designation_id: e.designation_id, reports_to: e.reports_to }, new: Object.assign({ site: site }, links), from: from, note: note });
    return { ok: true, site: site };
  },

  async empExit(s, x) {
    needAdmin(s); const e = await one(s, id(x.id)); if (e.status === 'left') throw fail(400, 'This employee has already left.', 'left');
    const on = R.date(x.on); if (!on) throw fail(400, 'Relieving date: a date as DD-MM-YYYY.', 'on');
    if (e.joined_on && on < e.joined_on) throw fail(400, 'Relieving date: it is before the date he is active from (joining).', 'on');
    const reason = R.str(x.reason, 200); if (reason.length < 3) throw fail(400, 'Reason: please write the reason.', 'reason');
    await db('PATCH', 'hr_employees?id=eq.' + e.id, { status: 'left', left_on: on, left_reason: reason, updated_by: s.email, updated_at: new Date().toISOString() }, 'return=minimal');
    await db('PATCH', 'hr_employment?employee_id=eq.' + e.id + '&valid_to=is.null', { valid_to: on }, 'return=minimal');
    await audit(s.site, s.email, 'Employee left', e.code, { old: { status: e.status }, new: { status: 'left', left_on: on, reason: reason } });
    return { ok: true };
  },
  /* (asked 12-11-2026: "EMPLOYEE DELET PN KRTA YAWA") an employee ADDED BY MISTAKE is deleted for ever – by the HR Admin / the Super
   * Admin, with the reason, and only while nothing hangs on him: no punch, no day's entry, no request, no phone, no paper, no KYC, nobody
   * reporting to him. Anybody else is RELIEVED (empExit) – his attendance and papers are never deleted. What he was is written in
   * the audit; his code is not given again by the counter. */
  async empDelete(s, x) {
    needAdmin(s); const e = await one(s, id(x.id)), why = R.str(x.reason, 200); if (why.length < 3) throw fail(400, 'Reason: write why he is deleted.', 'reason');
    const q = 'employee_id=eq.' + e.id + '&limit=1', soft = p => p.catch(er => { if (er && er.code === 'notinstalled') return []; throw er; }), hangs = [];
    const [pun, ent, reg, dev, tri, doc, kyc, prf, prw, lvr, lva, rep, repH] = await Promise.all([soft(db('GET', 'hr_punches?select=id&' + q)), soft(db('GET', 'hr_day_entries?select=id&' + q)), soft(db('GET', 'hr_regularize?select=id&' + q)),
      soft(db('GET', 'hr_devices?select=id&' + q)), soft(db('GET', 'hr_device_tries?select=id&' + q)), soft(db('GET', 'hr_employee_docs?select=id&' + q)), soft(db('GET', 'hr_employee_private?select=employee_id&' + q)), soft(db('GET', 'hr_employee_profile?select=employee_id&' + q)), soft(db('GET', 'hr_employee_rows?select=id&' + q)), soft(db('GET', 'hr_leave_requests?select=id&' + q)), soft(db('GET', 'hr_leave_adjust?select=id&' + q)),
      db('GET', 'hr_employees?select=id&reports_to=eq.' + e.id + '&limit=1'), db('GET', 'hr_employment?select=id&reports_to=eq.' + e.id + '&employee_id=neq.' + e.id + '&limit=1')]);
    if ((pun || []).length || (ent || []).length || (reg || []).length) hangs.push('attendance'); if ((lvr || []).length || (lva || []).length) hangs.push('leave');
    if ((dev || []).length || (tri || []).length) hangs.push('a phone'); if ((doc || []).length) hangs.push('papers'); if ((kyc || []).length || (prf || []).length || (prw || []).length) hangs.push('personal details (KYC / profile)'); if ((rep || []).length || (repH || []).length) hangs.push('people reporting to him');
    if (hangs.length) throw fail(409, 'This employee has ' + hangs.join(', ') + ' – he cannot be deleted. Relieve him with his relieving date instead: his record stays.', 'inuse');
    const hist = (await db('GET', 'hr_employment?select=site,department_id,designation_id,valid_from,valid_to,note&employee_id=eq.' + e.id)) || [];
    for (const t of ['hr_place_people', 'hr_shift_people']) await soft(db('DELETE', t + '?employee_id=eq.' + e.id, undefined, 'return=minimal'));
    await db('DELETE', 'hr_employment?employee_id=eq.' + e.id, undefined, 'return=minimal');
    const gone = (await db('DELETE', 'hr_employees?id=eq.' + e.id + '&site=eq.' + enc(s.site), undefined, 'return=representation')) || []; if (!gone.length) throw fail(409, 'This employee was not deleted – open him again.', 'gone');
    await audit(s.site, s.email, 'Employee deleted', e.code + ' ' + e.name, { old: Object.assign({}, e, { history: hist }), reason: why });
    return { ok: true, code: e.code };
  },
  // the list as a file (Excel): the same people as the list shows (search, status, category) – all of them, not only the first 500
  async empExport(s, x) {
    const q = R.str(x.q, 60).replace(/[%_*,()\\"]/g, ' ').trim(), st = ['incomplete', 'pending', 'active', 'left'].indexOf(x.status) > -1 ? x.status : x.status === 'all' ? 'all' : '', cat = R.CATS.indexOf(x.category) > -1 ? x.category : '';
    let path = 'hr_employees?select=' + EMP + '&site=eq.' + enc(s.site) + (st === 'all' ? '' : st ? '&status=eq.' + st : '&status=neq.left') + (cat ? '&category=eq.' + cat : '');
    if (q) path += '&or=' + enc('(name.ilike.*' + q + '*,code.ilike.*' + q + '*,mobile.ilike.*' + q + '*,email.ilike.*' + q + '*)');
    const rows = []; for (let off = 0; off < 100000; off += 1000) { const r = (await db('GET', path + '&order=name,id&limit=1000&offset=' + off)) || []; r.forEach(v => rows.push(v)); if (r.length < 1000) break; }
    const m = await masters(), nm = (list, v) => ((list || []).find(d => d.id === v) || {}).name || '';
    await audit(s.site, s.email, 'Employees exported', rows.length + ' employees', { status: st, category: cat, q: q });
    return { site: s.site, rows: rows.map(e => ({ code: e.code, name: e.name, category: e.category, designation: nm(m.designations, e.designation_id), department: nm(m.departments, e.department_id), mobile: e.mobile || '', email: e.email || '', dob: e.dob || '', gender: e.gender || '', joined_on: e.joined_on || '', left_on: e.left_on || '', left_reason: e.left_reason || '', status: e.status })) };
  },

  /* HIS OWN DETAILS (12-11-2026): Aadhaar, PAN, second mobile, a family member, the addresses – kept apart from the Employee
   * Master. An HR User sees the Aadhaar only as XXXX XXXX 1234 (he can type a new one); the HR Admin / Super Admin see it whole.
   * The record of changes never holds an Aadhaar or PAN – only that it changed and its last four. */
  async privGet(s, x) {
    const e = await one(s, id(x.id)), [pv, dc] = await Promise.all([db('GET', 'hr_employee_private?select=*&employee_id=eq.' + e.id), db('GET', 'hr_employee_docs?select=kind&employee_id=eq.' + e.id + '&active=is.true')]);
    const p = (pv || [])[0] || {}, docs = dc || [];
    return { personal: { aadhaar: isAdmin(s) ? (p.aadhaar || '') : '', aadhaar_mask: R.aadhaarMask(p.aadhaar), pan: p.pan || '', mobile2: p.mobile2 || '', family_name: p.family_name || '', family_relation: p.family_relation || '', family_mobile: p.family_mobile || '',
      address_current: p.address_current || '', address_permanent: p.address_permanent || '' }, relations: R.REL, docsMissing: R.docsMissing(e.category, docs.map(d => d.kind)) };
  },
  async privSave(s, x) {
    const e = await one(s, id(x.id)); if (e.status === 'left') throw fail(400, 'This employee has left – his details are not changed.', 'left');
    const was = ((await db('GET', 'hr_employee_private?select=*&employee_id=eq.' + e.id)) || [])[0] || null;
    // an HR User who left the Aadhaar box as it was (he sees only the mask): the number is kept
    const src = Object.assign({}, x); if (!isAdmin(s) && was && (x.aadhaar === undefined || x.aadhaar === '' || /^X/i.test(String(x.aadhaar)))) src.aadhaar = was.aadhaar;
    const c = R.personal(src); if (c.errors.length) throw fail(400, c.errors.join(' '), 'check');
    for (const k of ['aadhaar', 'pan']) if (c.row[k]) { const o = ((await db('GET', 'hr_employee_private?select=employee_id&' + k + '=eq.' + enc(c.row[k]) + '&employee_id=neq.' + e.id)) || [])[0]; if (o) { const oe = ((await db('GET', 'hr_employees?select=code&id=eq.' + o.employee_id)) || [])[0]; throw fail(409, (k === 'aadhaar' ? 'This Aadhaar' : 'This PAN') + ' already belongs to employee ' + (oe ? oe.code : '') + '.', k); } }
    const row = Object.assign({ employee_id: e.id, updated_by: s.email, updated_at: new Date().toISOString() }, c.row);
    await db('POST', 'hr_employee_private?on_conflict=employee_id', [row], 'resolution=merge-duplicates,return=minimal');
    const diff = {}; Object.keys(c.row).forEach(k => { const o = was ? was[k] || '' : ''; if (o !== c.row[k]) diff[k] = k === 'aadhaar' || k === 'pan' ? ['…' + String(o).slice(-4), '…' + String(c.row[k]).slice(-4)] : [o, c.row[k]]; });
    if (Object.keys(diff).length) await audit(s.site, s.email, 'Employee details changed', e.code, diff);
    return { ok: true };
  },

  /* HIS PAPERS. The pay papers (bank passbook, salary slip) are opened only by the HR Admin / Super Admin; an HR User can attach
   * them. A paper is never deleted: "removed" with who, when and why. A link to a file works 5 minutes. */
  async docList(s, x) {
    const e = await one(s, id(x.id)), rows = (await db('GET', 'hr_employee_docs?select=id,kind,title,number,expires_on,mime,bytes,active,removed_by,removed_at,removed_reason,created_by,created_at&employee_id=eq.' + e.id + '&order=created_at.desc')) || [];
    return { kinds: R.DOCS.map(d => ({ key: d.key, name: d.name, pay: !!d.pay, expires: !!d.expires })), docs: rows.map(r => Object.assign(r, { canOpen: r.active && (isAdmin(s) || !(R.docKind(r.kind) || {}).pay) })), docsMissing: R.docsMissing(e.category, rows.filter(r => r.active).map(r => r.kind)), maxMb: R.DOC_MAX / 1048576 };
  },
  async docUploadUrl(s, x) {
    const e = await one(s, id(x.id)); if (e.status === 'left') throw fail(400, 'This employee has left.', 'left');
    if (!R.docKind(x.kind)) throw fail(400, 'Choose what kind of paper this is.', 'kind');
    const ext = R.DOC_TYPES[String(x.type || '')], bytes = Number(x.bytes);
    if (!ext) throw fail(400, 'Only a photo (JPG, PNG, WebP) or a PDF can be attached.', 'type');
    if (!(bytes > 0)) throw fail(400, 'This file is empty.', 'bytes'); if (bytes > R.DOC_MAX) throw fail(400, 'This file is ' + Math.ceil(bytes / 1048576) + ' MB – a paper can be at most 10 MB.', 'bytes');
    const path = e.id + '/' + crypto.randomBytes(12).toString('hex') + '.' + ext;
    return { path: path, url: await store.uploadUrl(path), type: String(x.type) };
  },
  async docAdd(s, x) {
    const e = await one(s, id(x.id)), k = R.docKind(x.kind); if (!k) throw fail(400, 'Choose what kind of paper this is.', 'kind');
    const path = String(x.path || ''); if (!new RegExp('^' + e.id + '/[0-9a-f]{24}\\.(jpg|png|webp|pdf)$').test(path)) throw fail(400, 'This file does not belong to this employee.', 'path');
    const mime = Object.keys(R.DOC_TYPES).filter(t => R.DOC_TYPES[t] === path.split('.').pop())[0], bytes = Number(x.bytes);
    if (!(bytes > 0 && bytes <= R.DOC_MAX)) throw fail(400, 'This file is too big or empty.', 'bytes');
    if (!(await store.link(path, 60))) throw fail(400, 'The file did not arrive – attach it again.', 'path');
    const exp = R.date(x.expires_on); if (exp === null) throw fail(400, 'Valid up to: a date as DD-MM-YYYY.', 'expires_on');
    const row = { employee_id: e.id, kind: k.key, title: R.str(x.title, 80), number: R.str(x.number, 40).toUpperCase(), expires_on: exp || null, path: path, mime: mime, bytes: Math.round(bytes), created_by: s.email };
    const made = (await db('POST', 'hr_employee_docs', [row], 'return=representation'))[0];
    await audit(s.site, s.email, 'Paper attached', e.code, { kind: k.key, doc: made.id });
    return { ok: true, id: made.id };
  },
  async docLink(s, x) {
    const d = ((await db('GET', 'hr_employee_docs?select=id,employee_id,kind,path,active&id=eq.' + id(x.doc))) || [])[0]; if (!d || !d.active) throw fail(404, 'This paper was not found.', 'notfound');
    const e = await one(s, d.employee_id);
    if ((R.docKind(d.kind) || {}).pay && !isAdmin(s)) throw fail(403, 'Only the HR Admin or the Super Admin opens the pay papers (bank passbook, salary slip).', 'role');
    const url = await store.link(d.path, 300); if (!url) throw fail(404, 'The file of this paper was not found.', 'notfound');
    await audit(s.site, s.email, 'Paper opened', e.code, { kind: d.kind, doc: d.id });
    return { url: url };
  },
  /* (12-11-2026, asked: "user swatacha photo pn set karu shakel profile picture") THE FACES OF THE LIST: the newest paper of the
   * kind "Photo" (a picture, not a PDF) of each employee asked for – of this site only – as links that work 10 minutes. The photo
   * is the employee's own paper: he sets it in the app (Me), or the office attaches it under Documents. Nothing new is kept. */
  async empPhotos(s, x) {
    if (s.role === 'self') throw fail(403, 'This is for the HR office only.', 'role');
    const ids = [...new Set((Array.isArray(x.ids) ? x.ids : []).map(id).filter(Boolean))].slice(0, 200); if (!ids.length) return { photos: {} };
    const mine = ((await db('GET', 'hr_employees?select=id&site=eq.' + enc(s.site) + '&id=in.(' + ids.join(',') + ')')) || []).map(e => e.id); if (!mine.length) return { photos: {} };
    const docs = (await db('GET', 'hr_employee_docs?select=employee_id,path,mime,created_at&kind=eq.photo&active=is.true&mime=like.image*&employee_id=in.(' + mine.join(',') + ')&order=created_at.desc')) || [], first = {};
    docs.forEach(d => { if (!first[d.employee_id]) first[d.employee_id] = d.path; });
    const got = await store.links(Object.keys(first).map(k => first[k]), 600), photos = {}; Object.keys(first).forEach(k => { if (got[first[k]]) photos[k] = got[first[k]]; });
    return { photos: photos };
  },
  async docRemove(s, x) {
    needAdmin(s); const d = ((await db('GET', 'hr_employee_docs?select=id,employee_id,kind,active&id=eq.' + id(x.doc))) || [])[0]; if (!d || !d.active) throw fail(404, 'This paper was not found.', 'notfound');
    const e = await one(s, d.employee_id), reason = R.str(x.reason, 200); if (reason.length < 3) throw fail(400, 'Reason: please write why it is removed.', 'reason');
    await db('PATCH', 'hr_employee_docs?id=eq.' + d.id, { active: false, removed_by: s.email, removed_at: new Date().toISOString(), removed_reason: reason }, 'return=minimal');
    await audit(s.site, s.email, 'Paper removed', e.code, { kind: d.kind, doc: d.id, reason: reason });
    return { ok: true };
  },

  /* THE SIGN-IN OF MANY AT ONCE (13-11-2026: after an import nobody can be given his sign-in one by one – the Portal makes the
   * users, its api/hrlogin, by its own rule; HR's server keeps and sees nothing of it). Who may: the Super Admin, or the HR Admin of a site the Super Admin gave
   * the power "signin" (off until he gives it). The people of this site who are not relieved and have an e-mail or a mobile
   * number; `known` = the user ID the Portal gave him before (kept in portal_email) so that a changed number finds the same user. */
  async signinPeople(s) {
    await power.need(s, 'signin');
    const rows = []; for (let off = 0; off < 20000; off += 1000) { const r = (await db('GET', 'hr_employees?select=id,code,name,email,mobile,portal_email&site=eq.' + enc(s.site) + '&status=neq.left&order=code,id&limit=1000&offset=' + off)) || []; r.forEach(v => rows.push(v)); if (r.length < 1000) break; }
    const can = rows.filter(e => e.email || e.mobile);
    return { site: s.site, people: can.map(e => ({ id: e.id, code: e.code, name: e.name, email: e.email || '', mobile: e.mobile || '', known: e.portal_email || '' })), without: rows.length - can.length };
  },
  /* What the Portal answered is kept: the USER ID of an employee who signs in with his mobile number only (<number>@mobile.id) –
   * "My HR" finds him by it. An employee with an e-mail is found by his e-mail: nothing is kept for him. HR Admin / Super Admin. */
  async signinLinked(s, x) {
    needAdmin(s); const list = (Array.isArray(x.rows) ? x.rows : []).slice(0, 100), done = [];
    for (const r of list) {
      const pid = R.str(r.portal, 60).toLowerCase(), eid = id(r.id); if (!eid || !/^[6-9]\d{9}@mobile\.id$/.test(pid)) continue;
      const e = ((await db('GET', 'hr_employees?select=id,code,email,portal_email&id=eq.' + eid + '&site=eq.' + enc(s.site))) || [])[0]; if (!e || e.portal_email === pid) continue;
      if (((await db('GET', 'hr_employees?select=id&portal_email=eq.' + enc(pid) + '&id=neq.' + eid + '&limit=1')) || []).length) continue;      // one user = one employee
      await db('PATCH', 'hr_employees?id=eq.' + eid, { portal_email: pid, updated_by: s.email, updated_at: new Date().toISOString() }, 'return=minimal'); done.push(e.code);
    }
    if (done.length) await audit(s.site, s.email, 'Sign-in by mobile number linked', done.length + ' employees', { codes: done.slice(0, 200) });
    return { ok: true, linked: done.length };
  },

  /* IMPORT from Excel: the page reads the file and sends its rows. A row with a fault is NOT saved and comes back with why; a row
   * without DOB / e-mail / mobile is saved as INCOMPLETE; a mobile number or e-mail that an employee already has (or that is twice
   * in the file) is refused. check: 1 = only look, save nothing. At most 1000 rows in one go. */
  async empImport(s, x) {
    const list = Array.isArray(x.rows) ? x.rows : []; if (!list.length) throw fail(400, 'The file has no rows.', 'rows'); if (list.length > 1000) throw fail(400, 'At most 1000 rows in one file – split it.', 'rows');
    const out = [], good = [], seenM = {}, seenE = {};
    const parsed = list.map((r, i) => Object.assign(R.employee(r), { line: i + 2, src: r }));
    const t = await taken(parsed.map(p => p.row), '');
    parsed.forEach(p => {
      const errs = p.errors.slice();
      if (p.row.mobile) { if (t.mobile[p.row.mobile]) errs.push('Mobile already belongs to employee ' + t.mobile[p.row.mobile] + '.'); else if (seenM[p.row.mobile]) errs.push('Mobile is twice in the file (line ' + seenM[p.row.mobile] + ').'); else seenM[p.row.mobile] = p.line; }
      if (p.row.email) { if (t.email[p.row.email]) errs.push('E-mail already belongs to employee ' + t.email[p.row.email] + '.'); else if (seenE[p.row.email]) errs.push('E-mail is twice in the file (line ' + seenE[p.row.email] + ').'); else seenE[p.row.email] = p.line; }
      if (errs.length) out.push({ line: p.line, name: p.row.name, ok: false, why: errs.join(' ') }); else good.push(p);
    });
    const sum = { rows: list.length, faults: out.length, toSave: good.length, incomplete: good.filter(p => p.missing.length).length };
    if (x.check || !good.length) return Object.assign({ saved: 0, checked: true, lines: out, made: [] }, sum);
    const made = [], dep = {}, des = {};
    for (const p of good) {
      const dn = R.str(p.src.department, 60), gn = R.str(p.src.designation, 60);
      if (dn && !(dn.toLowerCase() in dep)) dep[dn.toLowerCase()] = await masterId('department', dn, s.email, made);
      if (gn && !(gn.toLowerCase() in des)) des[gn.toLowerCase()] = await masterId('designation', gn, s.email, made);
      p.links = { department_id: dn ? dep[dn.toLowerCase()] : null, designation_id: gn ? des[gn.toLowerCase()] : null, reports_to: null };
    }
    const codes = await newCodes(good.length);
    const rows = good.map((p, i) => Object.assign({ code: codes[i], site: s.site, status: R.statusOf(p.row, ''), created_by: s.email, updated_by: s.email }, p.row, p.links));
    let saved = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200), back = await db('POST', 'hr_employees', part, 'return=representation');
      await db('POST', 'hr_employment', back.map(b => ({ employee_id: b.id, site: s.site, department_id: b.department_id, designation_id: b.designation_id, valid_from: b.joined_on || R.today(), note: 'Joined (import)', created_by: s.email })), 'return=minimal');
      saved += back.length;
    }
    await audit(s.site, s.email, 'Employees imported', saved + ' employees', { first: codes[0], last: codes[rows.length - 1], incomplete: sum.incomplete, faults: out.length, made: made });
    return Object.assign({ saved: saved, checked: false, lines: out, made: made }, sum);
  },
};

const SHEET_ACT = SHEET({ masters: masters, masterId: masterId, taken: taken, newCodes: newCodes, codeTyped: codeTyped, CODE_OK: CODE_OK, needOffice: ATT.needOffice }).ACT;
const MAST_ACT = require('../lib/act_masters')({ masters: masters, needAdmin: needAdmin, id: id, desCatSave: SHEET.desCatSave, ACT: ACT }).ACT;      // (13-11-2026) delete / the usual list of the masters; an employee's page in one reading
[ATT.ACT, MUS.ACT, DASH.ACT, PROF.ACT, LEAVE.ACT, MONTH.ACT, PAY.ACT, ROLL.ACT, MORE.ACT, SHEET_ACT, MAST_ACT, BOOK.ACT, ASKS.ACT, IMP.ACT].forEach(part => Object.keys(part).forEach(k => { if (ACT[k]) throw new Error('action twice: ' + k); ACT[k] = part[k]; }));
// (12-11-2026) the app's "Me": a person's own record and papers – the office's own paper actions, for the employee the sign-in is
const MINE = require('../lib/act_self')(ACT);
Object.keys(MINE.ACT).forEach(k => { if (ACT[k]) throw new Error('action twice: ' + k); ACT[k] = MINE.ACT[k]; });
const SELF = ATT.SELF.concat(MUS.SELF, LEAVE.SELF, MINE.SELF, ROLL.SELF);
module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const x = await readBody(req), fn = Object.prototype.hasOwnProperty.call(ACT, String(x.action)) ? ACT[x.action] : null;
  if (!fn) return send(res, 400, { error: 'Unknown action.' });
  const s = await ses.need(req), att = Object.prototype.hasOwnProperty.call(ATT.ACT, String(x.action));
  const mus = Object.prototype.hasOwnProperty.call(MUS.ACT, String(x.action)) || Object.prototype.hasOwnProperty.call(DASH.ACT, String(x.action));
  // "My HR" (an employee for himself): only his own attendance – nothing of the HR office's pages
  if (s.role === 'self' && SELF.indexOf(String(x.action)) < 0) throw fail(403, 'This is for the HR office only.', 'role');
  try { send(res, 200, Object.assign({ ok: true }, await fn(s, x))); }
  catch (e) { if (e && e.code === 'notinstalled') throw fail(500, Object.prototype.hasOwnProperty.call(ROLL.ACT, String(x.action)) || /^pay(SlipOf|Bank)$/.test(String(x.action)) ? ROLL.NOT_READY12 : Object.prototype.hasOwnProperty.call(PAY.ACT, String(x.action)) ? PAY.NOT_READY11 : Object.prototype.hasOwnProperty.call(MONTH.ACT, String(x.action)) ? MONTH.NOT_READY10 : Object.prototype.hasOwnProperty.call(LEAVE.ACT, String(x.action)) ? LEAVE.NOT_READY7 : Object.prototype.hasOwnProperty.call(PROF.ACT, String(x.action)) ? PROF.NOT_READY6 : mus ? MUS.NOT_READY5 : att ? ATT.NOT_READY4 : /^(priv|doc|myDoc)/.test(String(x.action)) ? NOT_READY3 : NOT_READY, 'notinstalled'); throw e; }
});
module.exports.ACT = ACT; module.exports.SELF = SELF;
