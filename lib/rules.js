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
