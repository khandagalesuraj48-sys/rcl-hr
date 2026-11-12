/* THE EMPLOYEE'S DETAILS – checked and made tidy in one place (the page shows the same rules; the server decides).
 * His decisions (12-11-2026): four categories – Staff, Operator, Driver, Labour – apart from the designation; DOB and e-mail are
 * compulsory for everybody: an employee without them is kept as INCOMPLETE and cannot be activated; mobile number and e-mail are
 * what a person signs in with, so neither may belong to two employees. */
'use strict';
const CATS = ['staff', 'operator', 'driver', 'labour'];
const CAT_NAME = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
const str = (v, n) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 120);
// an Indian mobile number: 10 digits starting 6–9 (a leading +91 / 91 / 0 and spaces, dashes are taken off); '' = none; null = not a number
function mobile(v) {
  let d = String(v === undefined || v === null ? '' : v).replace(/[\s\-().]/g, '');
  if (!d) return '';
  d = d.replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
function email(v) { const e = str(v, 120).toLowerCase(); if (!e) return ''; return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) ? e : null; }
// a date as yyyy-mm-dd; also dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy and an Excel day number; '' = none; null = not a date
function date(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number' && v > 59 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return d.toISOString().slice(0, 10); }
  const s = String(v).trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else { m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); if (!m) return null; d = +m[1]; mo = +m[2]; y = +m[3]; }
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}
const today = now => new Date((now || Date.now()) + 19800000).toISOString().slice(0, 10);      // the day in India
function age(dob, now) { const t = today(now); let a = +t.slice(0, 4) - +dob.slice(0, 4); if (t.slice(5) < dob.slice(5)) a--; return a; }
function category(v) { const c = str(v, 20).toLowerCase(); return CATS.indexOf(c) > -1 ? c : c === 'labor' || c === 'labourer' || c === 'worker' ? 'labour' : null; }

/* one employee as typed / imported → { row, errors[], missing[] }. errors = cannot be saved; missing = saved as INCOMPLETE. */
function employee(x, now) {
  x = x || {}; const errors = [], missing = [], row = {};
  row.name = str(x.name, 80); if (row.name.length < 2) errors.push('Name: at least 2 letters.');
  row.category = category(x.category); if (!row.category) { errors.push('Category: Staff, Operator, Driver or Labour.'); row.category = ''; }
  row.gender = ['male', 'female', 'other'].indexOf(str(x.gender, 10).toLowerCase()) > -1 ? str(x.gender, 10).toLowerCase() : '';
  const mob = mobile(x.mobile); if (mob === null) errors.push('Mobile: a 10-digit mobile number.'); row.mobile = mob || '';
  const em = email(x.email); if (em === null) errors.push('E-mail: not a proper e-mail address.'); row.email = em || '';
  const dob = date(x.dob);
  if (dob === null) errors.push('Date of birth: a date as DD-MM-YYYY.');
  else if (dob) { const a = age(dob, now); if (dob > today(now)) errors.push('Date of birth: it is in the future.'); else if (a < 18) errors.push('Date of birth: the person is under 18.'); else if (a > 80) errors.push('Date of birth: please check the year.'); }
  row.dob = dob || null;
  const j = date(x.joined_on); if (j === null) errors.push('Joining date: a date as DD-MM-YYYY.'); else if (j && j > today((now || Date.now()) + 366 * 86400000)) errors.push('Joining date: more than a year ahead.'); row.joined_on = j || null;
  if (!row.dob) missing.push('Date of birth'); if (!row.email) missing.push('E-mail'); if (!row.mobile) missing.push('Mobile');
  return { row, errors, missing };
}
// INCOMPLETE until DOB, e-mail and mobile are there; then PENDING (waiting for the person's own e-mail OTP – the activation step)
const statusOf = (row, was) => was === 'left' || was === 'active' ? was : (row.dob && row.email && row.mobile ? 'pending' : 'incomplete');
module.exports = { CATS, CAT_NAME, str, mobile, email, date, today, age, category, employee, statusOf };

/* ---- (12-11-2026) the employee's own details and papers: Aadhaar, PAN, second mobile, a family member's number, addresses ---- */
// Aadhaar: 12 digits with its own check digit (Verhoeff) – a mistyped number is caught; '' = none; null = not an Aadhaar number
const VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
const VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
function aadhaar(v) {
  const d = String(v === undefined || v === null ? '' : v).replace(/[\s-]/g, ''); if (!d) return '';
  if (!/^[2-9]\d{11}$/.test(d)) return null;
  let c = 0; d.split('').reverse().forEach((ch, i) => { c = VD[c][VP[i % 8][+ch]]; });
  return c === 0 ? d : null;
}
const aadhaarMask = a => a ? 'XXXX XXXX ' + String(a).slice(-4) : '';
function pan(v) { const p = str(v, 12).toUpperCase().replace(/\s/g, ''); if (!p) return ''; return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p) ? p : null; }
const REL = ['father', 'mother', 'spouse', 'brother', 'sister', 'son', 'daughter', 'other'];
function personal(x) {
  x = x || {}; const errors = [], row = {};
  const a = aadhaar(x.aadhaar); if (a === null) errors.push('Aadhaar: 12 digits – please check the number.'); row.aadhaar = a || '';
  const p = pan(x.pan); if (p === null) errors.push('PAN: 10 letters and digits like ABCDE1234F.'); row.pan = p || '';
  const m2 = mobile(x.mobile2); if (m2 === null) errors.push('Second mobile: a 10-digit mobile number.'); row.mobile2 = m2 || '';
  const fm = mobile(x.family_mobile); if (fm === null) errors.push('Family member\'s mobile: a 10-digit mobile number.'); row.family_mobile = fm || '';
  row.family_name = str(x.family_name, 80); row.family_relation = REL.indexOf(str(x.family_relation, 12).toLowerCase()) > -1 ? str(x.family_relation, 12).toLowerCase() : '';
  row.address_current = str(x.address_current, 300); row.address_permanent = str(x.address_permanent, 300);
  return { row, errors };
}
// the papers of an employee. pay: true = only the HR Admin / Super Admin opens them (salary, bank). need = for which categories it is expected
const DOCS = [
  { key: 'photo', name: 'Photo', need: 'all' }, { key: 'aadhaar', name: 'Aadhaar card', need: 'all' }, { key: 'pan', name: 'PAN card', need: 'all' },
  { key: 'education', name: 'Education certificate' }, { key: 'licence', name: 'Driving licence', need: 'driver', expires: true },
  { key: 'bank_passbook', name: 'Bank passbook / cancelled cheque', need: 'all', pay: true }, { key: 'salary_slip', name: 'Salary slip of the last company', pay: true },
  { key: 'experience', name: 'Last company – experience / relieving letter' }, { key: 'other', name: 'Other document' },
];
const DOC_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }, DOC_MAX = 10 * 1048576;
const docKind = k => DOCS.filter(d => d.key === k)[0] || null;
// the papers still expected of this employee (by his category) – a reminder, never a block
const docsMissing = (category, have) => DOCS.filter(d => (d.need === 'all' || d.need === category) && have.indexOf(d.key) < 0).map(d => d.name);
Object.assign(module.exports, { aadhaar, aadhaarMask, pan, REL, personal, DOCS, DOC_TYPES, DOC_MAX, docKind, docsMissing });
