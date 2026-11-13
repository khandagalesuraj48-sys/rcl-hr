/* THE EMPLOYEE SHEET (13-11-2026) – ONE Excel format to bring employees in and to take them out.
 * Asked with the company's own sheet ("Employee Detail All"): "je excel madhe column aahet te same column sagle aaple attendance
 * madhe hawet … mala ha data import karaycha aahe … apli excel pn same asel import export sathi … excel madhle code as it is …
 * adhar pan … bank details … ifsc … sagle kahi import export excel madhe asel … yes no je aahe te softwer madhe tas".
 *   – The first 29 columns are the company's sheet, heading for heading, in its order. After them: mobile, e-mail, date of birth,
 *     designation, department, Aadhaar, the family number, the addresses, PF / ESIC / bank and the rest of the profile.
 *   – NO "Category" column (his word: "categery colum remove kruya ani designation he theu yatun categery samjun yete"): a
 *     DESIGNATION carries its category (Staff / Operator / Driver / Labour – the HR Admin sets it on the Designations page); an
 *     employee without a designation is Staff. A file that still has a Category column is read as before.
 *   – IMPORT = add or change. A row whose Employee Code is an employee of this site CHANGES him – only the cells that are filled,
 *     an empty cell changes nothing. A row with a new code (or none: the code is made) ADDS him – and a new employee needs a
 *     MOBILE NUMBER OR AN E-MAIL ("he nasel tr import nahi honar": he signs in with one of them). A row with a fault is not saved
 *     and comes back with its line and why; the good rows are saved. check: 1 = only look, nothing is saved.
 *   – The codes of the sheet are kept as they are; the counter of the codes made by themselves is moved past them.
 *   – Pay (CTC and the pay details, Deduct PF / ESIC / PT) is read only from the HR Admin / Super Admin. The monthly CTC becomes
 *     the employee's SALARY, approved at once, only when the HO HR / Super Admin imports ("import kelel thew pagar pakad").
 *   – EXPORT gives the same columns (the template = the same file without rows). Numbers that are secret (Aadhaar, UAN, PF, ESIC,
 *     bank account) and the pay are written only for the HR Admin / Super Admin. Every import and export is in the audit –
 *     never a number.
 * No code of any other HR product is used. */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const P = require('./act_profile');
const PAY = require('./act_pay');
const { isHo } = require('./act_month');

const isAdmin = s => s.role === 'admin' || s.role === 'super';
const soft = p => p.catch(e => { if (e && e.code === 'notinstalled') return null; throw e; });
const blank = v => v === undefined || v === null || String(v).trim() === '';
const norm = v => String(v === undefined || v === null ? '' : v).toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, '');
const dmy = d => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '');
const yn = v => { if (v === true || v === false) return v; const t = String(v).trim().toLowerCase(); return ['yes', 'y', 'true', '1'].indexOf(t) > -1 ? true : ['no', 'n', 'false', '0'].indexOf(t) > -1 ? false : null; };
const inList = async (path, ids, size) => { const out = []; for (let i = 0; i < ids.length; i += size || 80) ((await db('GET', path + '=in.(' + ids.slice(i, i + (size || 80)).join(',') + ')')) || []).forEach(r => out.push(r)); return out; };

/* a column: key (what the page sends), head (the heading of the file), where it is kept, other headings read as this one.
 * kind: emp (the Employee Master) | master | priv (his own details) | prof [group, detail] | tick (PF / ESIC / PT) | none */
const c = (key, head, kind, more) => Object.assign({ key: key, head: head, kind: kind }, more || {});
const pf = (key, head, group, more) => c(key, head, 'prof', Object.assign({ group: group, field: (more && more.field) || key }, more || {}));
const COLS = [
  // ── the company's own sheet: its 29 columns, as they are ──
  pf('company', 'Name of Company', 'job', { fill: true }), pf('branch', 'Branch Name', 'job', { fill: true }), pf('project', 'Current Project Name', 'job'),
  pf('uan', 'UAN No.', 'secret', { also: ['uan', 'uannumber'] }), c('name', 'Employee Name', 'emp', { also: ['name', 'नाव'] }), c('code', 'Employee Code', 'emp', { also: ['code', 'empcode', 'employeeid', 'employeeno'] }),
  pf('ctc', 'Auto Monthly CTC', 'pay', { field: 'ctc_monthly', also: ['monthlyctc', 'ctc'] }), c('joined_on', 'Date of Joining', 'emp', { also: ['doj', 'joiningdate', 'joining', 'joinedon', 'joined'] }),
  pf('employment_type', 'Employee Status', 'job'), pf('retained', 'Employee Retained', 'job'), pf('sign_in', 'Sign In', 'job'), pf('sign_out', 'Sign Out', 'job'),
  c('pan', 'PAN', 'priv', { also: ['panno', 'pannumber'] }), c('pf', 'Deduct PF', 'tick'), pf('probation_days', 'Probation Period In Days', 'job'),
  pf('esic_contribution_rate', 'ESIC Contribution Rate', 'pay'), c('esic', 'Deduct ESIC', 'tick'), pf('esic_type', 'ESIC Type', 'pay'), pf('esic_deduction_rate', 'ESIC Deduction Rate', 'pay'),
  c('pt', 'Deduct PT', 'tick'), pf('tds_type', 'TDS Type', 'pay'), pf('attach', 'Attach', 'pay'), pf('basic', 'Basic', 'pay'), pf('pay_period', 'Check Time', 'pay'),
  pf('annual_bonus', 'Annual Bonus', 'pay'), pf('deduct_income_tax', 'Deduct Income Tax', 'pay'), pf('annual_medical', 'Annual Medical Reimbursement', 'pay'), pf('annual_lta', 'Annual LTA', 'pay'),
  c('totals', 'Totals', 'none'),
  // ── what a person signs in with, and the rest of his record ──
  c('mobile', 'Mobile', 'emp', { also: ['mobileno', 'mobilenumber', 'phone', 'phoneno', 'contact', 'contactno', 'contactnumber'] }), c('email', 'E-mail', 'emp', { also: ['emailid', 'emailaddress', 'mail'] }),
  c('dob', 'Date of Birth', 'emp', { also: ['dob', 'birthdate'] }), c('gender', 'Gender', 'emp', { also: ['sex'] }),
  c('designation', 'Designation', 'master', { also: ['post'] }), c('department', 'Department', 'master', { also: ['dept'] }),
  c('aadhaar', 'Aadhaar', 'priv', { also: ['aadhar', 'adhar', 'aadhaarno', 'aadharno', 'adharno', 'aadhaarnumber', 'aadharnumber'] }), c('mobile2', 'Second Mobile', 'priv', { also: ['secondarymobile', 'alternatemobile'] }),
  c('family_name', 'Family Member Name', 'priv'), c('family_relation', 'Family Relation', 'priv'), c('family_mobile', 'Family Mobile', 'priv', { also: ['familynumber', 'familymobileno'] }),
  c('address_current', 'Current Address', 'priv', { also: ['address', 'presentaddress'] }), c('address_permanent', 'Permanent Address', 'priv'),
  pf('prefix', 'Prefix', 'profile'), pf('father_name', 'Father / Husband Name', 'profile', { also: ['fathersname', 'fathername', 'husbandname', 'fathershusbandsname'] }), pf('marital', 'Marital Status', 'profile'), pf('blood', 'Blood Group', 'profile'),
  pf('nationality', 'Nationality', 'profile'), pf('disability', 'Physical Disability', 'profile'), pf('official_email', 'Official E-mail', 'profile'), pf('cug', 'CUG Number', 'profile'), pf('name_aadhaar', 'Name as on Aadhaar', 'profile'),
  pf('employee_type', 'Employee Type', 'job'), pf('worker_type', 'Type of Worker', 'job'), pf('skill_category', 'Skill Category', 'job'), pf('probation_end', 'Probation Ends On', 'job'), pf('confirmation_date', 'Confirmation Date', 'job'),
  pf('notice_days', 'Notice Period (Days)', 'job'), pf('retirement_age', 'Retirement Age', 'job'), pf('overtime', 'Overtime Applicable', 'job'),
  pf('pf_no', 'PF Number', 'secret', { also: ['pfno'] }), pf('pf_join', 'PF Joining Date', 'secret'), pf('esic_no', 'ESIC Number', 'secret', { also: ['esicno'] }), pf('esic_join', 'ESIC Joining Date', 'secret'),
  pf('bank_name', 'Bank', 'secret', { also: ['bankname'] }), pf('bank_ifsc', 'Bank IFSC Code', 'secret', { also: ['ifsc', 'ifsccode', 'bankifsc'] }), pf('bank_account', 'Bank Account Number', 'secret', { also: ['accountno', 'accountnumber', 'bankaccountno', 'bankaccount'] }), pf('bank_holder', 'Name as on Bank', 'secret'),
];
// a file of before (Phase 1) may still have this column – read, never written
const OLD = [c('category', 'Category', 'emp', { also: ['employeecategory'] })];
const fieldOf = col => P.GROUPS[col.group].fields.find(d => d.key === col.field);
COLS.forEach(col => { if (col.kind === 'prof' && !fieldOf(col)) throw new Error('sheet column without its detail: ' + col.key); });
const SECRET_COLS = COLS.filter(col => col.key === 'aadhaar' || (col.kind === 'prof' && col.group === 'secret' && P.MASKED.indexOf(col.field) > -1)).map(col => col.key);
const PAY_COLS = COLS.filter(col => col.kind === 'tick' || (col.kind === 'prof' && P.GROUPS[col.group].adminOnly)).map(col => col.key);
const colsOut = () => COLS.concat(OLD).map(col => ({ key: col.key, head: col.head, fill: !!col.fill, old: OLD.indexOf(col) > -1, names: [norm(col.head)].concat(col.also || []) }));

// which category a designation is (kept beside the designations – no change of the database): { designation id: category }
const DES_SITE = '*', DES_KEY = 'designation_category';
async function desCats() { const r = ((await soft(db('GET', 'hr_settings?select=value&site=eq.' + enc(DES_SITE) + '&key=eq.' + DES_KEY))) || [])[0]; return (r && r.value && r.value.by) || {}; }
async function desCatSave(desId, cat, who) {
  const by = Object.assign({}, await desCats()); if (cat) by[desId] = cat; else delete by[desId];
  await db('POST', 'hr_settings?on_conflict=site,key', [{ site: DES_SITE, key: DES_KEY, value: { by: by }, updated_by: who, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
  return by;
}

module.exports = function (H) {
  const EMP = 'id,code,name,category,gender,dob,mobile,email,site,department_id,designation_id,joined_on,left_on,status,email_verified_at';
  const PRIV = ['aadhaar', 'pan', 'mobile2', 'family_name', 'family_relation', 'family_mobile', 'address_current', 'address_permanent'];

  // one row of the file → what it would save: { errs, emp, priv, prof: { data, secret }, ticks, ctc, names }
  function read(r, ctx) {
    const errs = [], out = { priv: {}, data: {}, secret: {}, ticks: {}, lists: [], names: {} }, ex = ctx.ex, given = k => !blank(r[k]);
    // ── the Employee Master: for an employee of today an empty cell keeps what he has ──
    const src = { name: given('name') ? r.name : ex ? ex.name : '', gender: given('gender') ? r.gender : ex ? ex.gender : '', mobile: given('mobile') ? r.mobile : ex ? ex.mobile : '', email: given('email') ? r.email : ex ? ex.email : '',
      dob: given('dob') ? r.dob : ex ? ex.dob : '', joined_on: given('joined_on') ? r.joined_on : ex ? ex.joined_on : '' };
    out.names.designation = given('designation') ? R.str(r.designation, 60) : ''; out.names.department = given('department') ? R.str(r.department, 60) : '';
    const desId = out.names.designation ? ctx.desByName[out.names.designation.toLowerCase()] : ex ? ex.designation_id : null;
    src.category = given('category') ? r.category : (out.names.designation || !ex) ? (desId && ctx.desCat[desId]) || 'staff' : ex.category;
    const e = R.employee(src); e.errors.forEach(x => errs.push(x)); out.emp = e.row; out.missing = e.missing;
    if (!ex && !e.row.mobile && !e.row.email) errs.push('Mobile or E-mail: a new employee needs one of them – he signs in with it.');
    // ── his own details ──
    PRIV.forEach(k => { if (given(k)) out.priv[k] = r[k]; });
    if (Object.keys(out.priv).length) {
      const p = out.priv;
      if ('pan' in p) { const v = R.pan(p.pan); if (v === null) errs.push('PAN: 10 letters and digits like ABCDE1234F.'); else p.pan = v; }
      if ('aadhaar' in p) { const v = R.aadhaar(p.aadhaar); if (v === null) errs.push('Aadhaar: 12 digits – please check the number.'); else p.aadhaar = v; }
      if ('mobile2' in p) { const v = R.mobile(p.mobile2); if (v === null) errs.push('Second Mobile: a 10-digit mobile number.'); else p.mobile2 = v; }
      if ('family_mobile' in p) { const v = R.mobile(p.family_mobile); if (v === null) errs.push('Family Mobile: a 10-digit mobile number.'); else p.family_mobile = v; }
      if ('family_relation' in p) { const v = R.str(p.family_relation, 12).toLowerCase(); if (R.REL.indexOf(v) < 0) errs.push('Family Relation: ' + R.REL.join(', ') + '.'); else p.family_relation = v; }
      ['family_name', 'address_current', 'address_permanent'].forEach(k => { if (k in p) p[k] = R.str(p[k], k === 'family_name' ? 80 : 300); });
    }
    // ── the profile, the statutory & bank details, the pay details ──
    COLS.filter(col => col.kind === 'prof' && given(col.key)).forEach(col => {
      const G = P.GROUPS[col.group], d = fieldOf(col), to = G.secret ? out.secret : out.data;
      if (G.adminOnly && !ctx.admin) { ctx.skipped.pay = true; return; }
      let raw = r[col.key];
      if (d.type === 'list') {      // by its name; a name that is not in the list is added to it (HR Admin / Super Admin)
        const name = R.str(raw, 60), hit = (ctx.lists[d.list] || []).find(v => v.name.toLowerCase() === name.toLowerCase());
        if (hit) to[d.key] = hit.id; else if (ctx.admin) out.lists.push({ kind: d.list, name: name, key: d.key }); else errs.push(col.head + ': "' + name + '" is not in the list – the HR Admin adds it.');
        return;
      }
      if (d.type === 'yesno') { const v = yn(raw); if (v === null) { errs.push(col.head + ': Yes or No.'); return; } raw = v; }
      if (d.type === 'int' || d.type === 'num') raw = String(raw).trim().replace(/\.0+$/, '');
      if (d.type === 'digits') raw = String(raw).trim().replace(/\.0+$/, '').replace(/^'/, '');
      const cl = P.clean([d], { [d.key]: raw }, {}, {}); if (cl.errors.length) errs.push(cl.errors.join(' ').replace(d.label + ':', col.head + ':')); else if (d.key in cl.row) to[d.key] = cl.row[d.key];
    });
    // ── for whom PF / ESIC / Profession Tax is deducted ──
    ['pf', 'esic', 'pt'].forEach(k => { if (!given(k)) return; if (!ctx.admin) { ctx.skipped.pay = true; return; } const v = yn(r[k]); if (v === null) errs.push('Deduct ' + k.toUpperCase() + ': Yes or No.'); else out.ticks[k] = v; });
    // ── the month's CTC as his salary (0 = none) ──
    if (out.secret.ctc_monthly > 0) out.ctc = out.secret.ctc_monthly;
    out.errs = errs; return out;
  }

  const ACT = {
    // the columns of the sheet – the page reads a file with them and writes one
    async sheetCols(s) { H.needOffice(s); return { cols: colsOut(), pay: isAdmin(s) }; },

    async sheetImport(s, x) {
      H.needOffice(s);
      const list = Array.isArray(x.rows) ? x.rows : []; if (!list.length) throw fail(400, 'The file has no rows.', 'rows'); if (list.length > 1000) throw fail(400, 'At most 1000 rows in one file – split it.', 'rows');
      const admin = isAdmin(s), [m, desCat, listsBy, ho] = await Promise.all([H.masters(), desCats(), soft(P.listsAll()), isHo(s)]);
      const desByName = {}; m.designations.forEach(d => { desByName[d.name.toLowerCase()] = d.id; });
      const codes = list.map(r => H.codeTyped(r.code)), known = {};
      (await inList('hr_employees?select=' + EMP + '&code', [...new Set(codes.filter(Boolean))].map(v => '"' + v.replace(/"/g, '') + '"').map(enc), 60)).forEach(e => { known[e.code] = e; });
      const ctx0 = { admin: admin, lists: listsBy || {}, desCat: desCat, desByName: desByName, skipped: {} };
      const lines = [], good = [], seen = { code: {}, mobile: {}, email: {}, pan: {}, aadhaar: {} };
      const parsed = list.map((r, i) => {
        const line = Number(r._line) > 0 ? Number(r._line) : i + 2, code = codes[i], ex = code ? known[code] || null : null, errs = [];
        if (code && !H.CODE_OK.test(code)) errs.push('Employee Code: 2 to 20 capital letters and digits (also - and /).');
        if (ex && ex.site !== s.site) errs.push('Employee Code ' + code + ' is an employee of the site ' + ex.site + ' – he is changed there.');
        if (ex && ex.status === 'left') errs.push('Employee ' + code + ' has left – his details are not changed.');
        if (code) { if (seen.code[code]) errs.push('Employee Code is twice in the file (line ' + seen.code[code] + ').'); else seen.code[code] = line; }
        const p = read(r, Object.assign({ ex: ex && ex.site === s.site ? ex : null }, ctx0));
        return Object.assign(p, { line: line, code: code, ex: ex && ex.site === s.site ? ex : null, errs: errs.concat(p.errs) });
      });
      // a mobile number, an e-mail, a PAN, an Aadhaar belong to ONE employee – in the file and among the employees
      const t = await H.taken(parsed.map(p => p.emp), ''), pans = [...new Set(parsed.map(p => p.priv.pan).filter(Boolean))], aads = [...new Set(parsed.map(p => p.priv.aadhaar).filter(Boolean))], owner = { pan: {}, aadhaar: {} };
      if (pans.length || aads.length) {
        const got = [].concat(pans.length ? (await soft(inList('hr_employee_private?select=employee_id,pan&pan', pans, 60))) || [] : [], aads.length ? (await soft(inList('hr_employee_private?select=employee_id,aadhaar&aadhaar', aads, 60))) || [] : []);
        got.forEach(g => { if (g.pan) owner.pan[g.pan] = g.employee_id; if (g.aadhaar) owner.aadhaar[g.aadhaar] = g.employee_id; });
      }
      parsed.forEach(p => {
        const mine = p.ex ? p.ex.code : '\u0000', e = p.emp;
        [['mobile', 'Mobile'], ['email', 'E-mail']].forEach(k => { const v = e[k[0]]; if (!v) return;
          if (t[k[0]][v] && t[k[0]][v] !== mine) p.errs.push(k[1] + ' already belongs to employee ' + t[k[0]][v] + '.'); else if (seen[k[0]][v]) p.errs.push(k[1] + ' is twice in the file (line ' + seen[k[0]][v] + ').'); else seen[k[0]][v] = p.line; });
        [['pan', 'PAN'], ['aadhaar', 'Aadhaar']].forEach(k => { const v = p.priv[k[0]]; if (!v) return;
          if (owner[k[0]][v] && (!p.ex || owner[k[0]][v] !== p.ex.id)) p.errs.push(k[1] + ' already belongs to another employee.'); else if (seen[k[0]][v]) p.errs.push(k[1] + ' is twice in the file (line ' + seen[k[0]][v] + ').'); else seen[k[0]][v] = p.line; });
        if (p.errs.length) lines.push({ line: p.line, name: p.emp.name || '', code: p.code, ok: false, why: p.errs.join(' ') }); else good.push(p);
      });
      const add = good.filter(p => !p.ex), upd = good.filter(p => p.ex), notes = [];
      if (ctx0.skipped.pay) notes.push('The pay columns (CTC, Basic, Deduct PF / ESIC / PT …) were not read: only the HR Admin or the Super Admin brings them in.');
      const withPay = good.filter(p => p.ctc).length;
      if (withPay) notes.push(ho ? 'The monthly CTC of ' + withPay + ' employees becomes their approved salary.' : 'The monthly CTC is kept as a detail only: a salary counts when the HO HR / Super Admin imports the sheet (or approves it on the employee\'s page).');
      const newLists = {}; good.forEach(p => p.lists.forEach(l => { newLists[l.kind + '\u0001' + l.name.toLowerCase()] = l; }));
      const sum = { rows: list.length, faults: lines.length, toAdd: add.length, toChange: upd.length, incomplete: add.filter(p => p.missing.length).length, notes: notes, willMake: Object.keys(newLists).map(k => newLists[k].kind + ': ' + newLists[k].name) };
      if (x.check || !good.length) return Object.assign({ saved: 0, added: 0, changed: 0, checked: true, lines: lines, made: [] }, sum);

      // ── SAVE ──
      const made = [], now = new Date().toISOString(), today = R.today(), dep = {}, des = {};
      for (const p of good) {
        const dn = p.names.department, gn = p.names.designation;
        if (dn && !(dn.toLowerCase() in dep)) dep[dn.toLowerCase()] = await H.masterId('department', dn, s.email, made);
        if (gn && !(gn.toLowerCase() in des)) des[gn.toLowerCase()] = await H.masterId('designation', gn, s.email, made);
        p.department_id = dn ? dep[dn.toLowerCase()] : p.ex ? p.ex.department_id : null; p.designation_id = gn ? des[gn.toLowerCase()] : p.ex ? p.ex.designation_id : null;
      }
      for (const k of Object.keys(newLists)) {      // the list values the file brought (added once each)
        const l = newLists[k], row = (await db('POST', 'hr_lists', [{ kind: l.kind, name: l.name, sort: 999, created_by: s.email, updated_by: s.email }], 'return=representation'))[0];
        l.id = row.id; made.push(l.kind + ': ' + l.name);
      }
      good.forEach(p => p.lists.forEach(l => { const id = newLists[l.kind + '\u0001' + l.name.toLowerCase()].id, G = Object.keys(P.GROUPS).find(g => P.GROUPS[g].fields.some(d => d.key === l.key)); (P.GROUPS[G].secret ? p.secret : p.data)[l.key] = id; }));
      // the new employees: the code of the sheet, or one made by itself
      const fresh = await H.newCodes(add.filter(p => !p.code).length); let fi = 0; add.forEach(p => { if (!p.code) p.code = fresh[fi++]; });
      for (let i = 0; i < add.length; i += 200) {
        const part = add.slice(i, i + 200), rows = part.map(p => Object.assign({ code: p.code, site: s.site, status: R.statusOf(p.emp, ''), created_by: s.email, updated_by: s.email, department_id: p.department_id, designation_id: p.designation_id, reports_to: null }, p.emp));
        const back = await db('POST', 'hr_employees', rows, 'return=representation'), byCode = {}; back.forEach(b => { byCode[b.code] = b; });
        part.forEach(p => { p.id = byCode[p.code].id; });
        await db('POST', 'hr_employment', back.map(b => ({ employee_id: b.id, site: s.site, department_id: b.department_id, designation_id: b.designation_id, valid_from: b.joined_on || today, note: 'Joined (import)', created_by: s.email })), 'return=minimal');
      }
      // the employees of today: what the file gave, nothing else
      const changedKeys = {};
      for (const p of upd) {
        const was = p.ex, row = Object.assign({}, p.emp, { department_id: p.department_id, designation_id: p.designation_id });
        row.status = R.statusOf(p.emp, was.status === 'active' && p.emp.email === was.email ? 'active' : '');
        const diff = Object.keys(row).filter(k => String(row[k] === null || row[k] === undefined ? '' : row[k]) !== String(was[k] === null || was[k] === undefined ? '' : was[k]));
        p.id = was.id; if (!diff.length) continue;
        if (p.emp.email !== was.email) row.email_verified_at = null;
        await db('PATCH', 'hr_employees?id=eq.' + was.id + '&site=eq.' + enc(s.site), Object.assign(row, { updated_by: s.email, updated_at: now }), 'return=minimal');
        if (diff.indexOf('department_id') > -1 || diff.indexOf('designation_id') > -1) {
          await db('PATCH', 'hr_employment?employee_id=eq.' + was.id + '&valid_to=is.null', { valid_to: today }, 'return=minimal');
          await db('POST', 'hr_employment', [{ employee_id: was.id, site: s.site, department_id: p.department_id, designation_id: p.designation_id, valid_from: today, note: 'Changed (import)', created_by: s.email }], 'return=minimal');
        }
        changedKeys[was.code] = diff;
      }
      const ids = good.map(p => p.id);
      // his own details (Aadhaar, PAN …): the cells given are laid over what is kept
      const withPriv = good.filter(p => Object.keys(p.priv).length);
      if (withPriv.length) {
        const had = {}; ((await inList('hr_employee_private?select=employee_id,' + PRIV.join(',') + '&employee_id', withPriv.map(p => p.id), 80)) || []).forEach(v => { had[v.employee_id] = v; });
        const rows = withPriv.map(p => { const w = had[p.id] || {}, o = { employee_id: p.id, updated_by: s.email, updated_at: now }; PRIV.forEach(k => { o[k] = k in p.priv ? p.priv[k] : w[k] || ''; }); return o; });
        for (let i = 0; i < rows.length; i += 200) await db('POST', 'hr_employee_private?on_conflict=employee_id', rows.slice(i, i + 200), 'resolution=merge-duplicates,return=minimal');
      }
      // the profile and the secret / pay details
      const withProf = good.filter(p => Object.keys(p.data).length || Object.keys(p.secret).length);
      if (withProf.length) {
        const had = {}; ((await inList('hr_employee_profile?select=employee_id,data,secret&employee_id', withProf.map(p => p.id), 80)) || []).forEach(v => { had[v.employee_id] = v; });
        const rows = withProf.map(p => { const w = had[p.id] || {}; return { employee_id: p.id, data: Object.assign({}, w.data || {}, p.data), secret: Object.assign({}, w.secret || {}, p.secret), updated_by: s.email, updated_at: now }; });
        for (let i = 0; i < rows.length; i += 200) await db('POST', 'hr_employee_profile?on_conflict=employee_id', rows.slice(i, i + 200), 'resolution=merge-duplicates,return=minimal');
      }
      // for whom PF / ESIC / PT is deducted
      const withTick = good.filter(p => Object.keys(p.ticks).length);
      if (withTick.length) {
        const had = {}; ((await soft(inList('hr_pay_emp?select=employee_id,pf,esic,pt&employee_id', withTick.map(p => p.id), 80))) || []).forEach(v => { had[v.employee_id] = v; });
        const rows = withTick.map(p => { const w = had[p.id] || {}; return { employee_id: p.id, pf: 'pf' in p.ticks ? p.ticks.pf : !!w.pf, esic: 'esic' in p.ticks ? p.ticks.esic : !!w.esic, pt: 'pt' in p.ticks ? p.ticks.pt : !!w.pt, updated_by: s.email, updated_at: now }; });
        for (let i = 0; i < rows.length; i += 200) await db('POST', 'hr_pay_emp?on_conflict=employee_id', rows.slice(i, i + 200), 'resolution=merge-duplicates,return=minimal');
      }
      // the salary: the month's CTC, approved at once – only from the HO HR / Super Admin, and only when it is not his salary already
      let salaries = 0;
      const withCtc = ho ? good.filter(p => p.ctc) : [];
      if (withCtc.length) {
        const had = {}; ((await soft(inList('hr_salaries?select=id,employee_id,pay_type,amount,valid_from,status&employee_id', withCtc.map(p => p.id), 80))) || []).forEach(v => { (had[v.employee_id] = had[v.employee_id] || []).push(v); });
        const rows = [];
        withCtc.forEach(p => { const mine = had[p.id] || [], cur = PAY.current(mine, today); if (mine.some(v => v.status === 'pending')) return; if (cur && cur.pay_type === 'monthly' && +cur.amount === p.ctc) return;
          rows.push({ employee_id: p.id, site: s.site, pay_type: 'monthly', amount: p.ctc, valid_from: cur ? today : p.emp.joined_on && p.emp.joined_on <= today ? p.emp.joined_on : today, note: 'From the employee sheet', status: 'approved', asked_by: s.email, decided_by: s.email, decided_at: now, decide_note: 'Imported' }); });
        for (let i = 0; i < rows.length; i += 200) await db('POST', 'hr_salaries', rows.slice(i, i + 200), 'return=minimal');
        salaries = rows.length;
      }
      // the counter of the codes made by themselves goes past the RCL… codes of the sheet
      const top = Math.max(0, ...good.map(p => { const mm = /^RCL(\d{1,9})$/.exec(p.code); return mm ? +mm[1] : 0; }));
      if (top) { await db('POST', 'hr_numbers?on_conflict=kind', [{ kind: 'emp', next_no: top + 1 }], 'resolution=ignore-duplicates,return=minimal'); await db('PATCH', 'hr_numbers?kind=eq.emp&next_no=lt.' + (top + 1), { next_no: top + 1 }, 'return=minimal'); }
      await audit(s.site, s.email, 'Employee sheet imported', add.length + ' added, ' + upd.length + ' changed', { added: add.map(p => p.code).slice(0, 400), changed: changedKeys, faults: lines.length, made: made, salaries: salaries, details: withPriv.length, profile: withProf.length });      // never a number
      return Object.assign({ saved: good.length, added: add.length, changed: upd.length, salaries: salaries, checked: false, lines: lines, made: made, ids: ids.length }, sum);
    },

    /* the sheet as a file: the people the list shows (search, status, category), or no rows (the format). */
    async sheetExport(s, x) {
      H.needOffice(s); const admin = isAdmin(s), cols = COLS, heads = cols.map(col => col.head);
      if (x.template) return { site: s.site, heads: heads, rows: [], full: admin };
      const q = R.str(x.q, 60).replace(/[%_*,()\\"]/g, ' ').trim(), st = ['incomplete', 'pending', 'active', 'left'].indexOf(x.status) > -1 ? x.status : x.status === 'all' ? 'all' : '', cat = R.CATS.indexOf(x.category) > -1 ? x.category : '';
      let path = 'hr_employees?select=' + EMP + '&site=eq.' + enc(s.site) + (st === 'all' ? '' : st ? '&status=eq.' + st : '&status=neq.left') + (cat ? '&category=eq.' + cat : '');
      if (q) path += '&or=' + enc('(name.ilike.*' + q + '*,code.ilike.*' + q + '*,mobile.ilike.*' + q + '*,email.ilike.*' + q + '*)');
      const emps = []; for (let off = 0; off < 100000; off += 1000) { const r = (await db('GET', path + '&order=code,id&limit=1000&offset=' + off)) || []; r.forEach(v => emps.push(v)); if (r.length < 1000) break; }
      const ids = emps.map(e => e.id), by = rows => { const o = {}; (rows || []).forEach(r => { o[r.employee_id] = r; }); return o; };
      const [m, listsBy, pv, pr, tk, sal] = await Promise.all([H.masters(), soft(P.listsAll()), soft(inList('hr_employee_private?select=employee_id,' + PRIV.join(',') + '&employee_id', ids, 80)), soft(inList('hr_employee_profile?select=employee_id,data,secret&employee_id', ids, 80)),
        admin ? soft(inList('hr_pay_emp?select=employee_id,pf,esic,pt&employee_id', ids, 80)) : null, admin ? soft(inList('hr_salaries?select=id,employee_id,pay_type,amount,valid_from,status&status=eq.approved&employee_id', ids, 80)) : null]);
      const priv = by(pv), prof = by(pr), tick = by(tk), sals = {}; (sal || []).forEach(v => { (sals[v.employee_id] = sals[v.employee_id] || []).push(v); });
      const nm = (list, v) => ((list || []).find(d => d.id === v) || {}).name || '', today = R.today();
      const rows = emps.map(e => {
        const pv1 = priv[e.id] || {}, p1 = prof[e.id] || { data: {}, secret: {} }, cur = PAY.current(sals[e.id] || [], today);
        return cols.map(col => {
          if (!admin && (PAY_COLS.indexOf(col.key) > -1 || SECRET_COLS.indexOf(col.key) > -1)) return '';
          if (col.kind === 'none') return col.key === 'totals' ? 1 : '';
          if (col.kind === 'emp') return col.key === 'dob' || col.key === 'joined_on' ? dmy(e[col.key]) : col.key === 'gender' ? (e.gender ? e.gender.charAt(0).toUpperCase() + e.gender.slice(1) : '') : e[col.key] || '';
          if (col.kind === 'master') return col.key === 'designation' ? nm(m.designations, e.designation_id) : nm(m.departments, e.department_id);
          if (col.kind === 'priv') return col.key === 'family_relation' && pv1[col.key] ? pv1[col.key].charAt(0).toUpperCase() + pv1[col.key].slice(1) : pv1[col.key] || '';
          if (col.kind === 'tick') return tick[e.id] ? (tick[e.id][col.key] ? 'Yes' : 'No') : '';
          const d = fieldOf(col), v = ((P.GROUPS[col.group].secret ? p1.secret : p1.data) || {})[d.key];
          if (col.key === 'ctc' && cur && cur.pay_type === 'monthly') return +cur.amount;      // the salary that counts today
          if (v === undefined || v === null || v === '') return '';
          return d.type === 'list' ? nm((listsBy || {})[d.list], v) : d.type === 'yesno' ? (v ? 'Yes' : 'No') : d.type === 'date' ? dmy(v) : v;
        });
      });
      await audit(s.site, s.email, 'Employee sheet exported', rows.length + ' employees', { status: st, category: cat, q: q, full: admin });
      return { site: s.site, heads: heads, rows: rows, full: admin };
    },
  };
  return { ACT: ACT };
};
module.exports.COLS = COLS; module.exports.colsOut = colsOut; module.exports.norm = norm; module.exports.yn = yn; module.exports.desCats = desCats; module.exports.desCatSave = desCatSave;
