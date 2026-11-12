/* THE HR ADMIN'S POWERS (12-11-2026: "admin limited power super admin super power super admin, admin la power deu shakel").
 * The Super Admin does everything. An HR Admin does what the Super Admin left him on THIS site – each power can be switched off
 * (hr_admin_powers; no row = allowed). An HR User and "My HR" never have them. */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const POWERS = [
  { key: 'places', name: 'Work places and projects' },
  { key: 'phones', name: 'Release a phone' },
  { key: 'review', name: 'Decide doubtful punches' },
  { key: 'shifts', name: 'Shifts, holidays and the rules' },
  { key: 'manual', name: 'Manual entry (a day without a punch)' },
  { key: 'correct', name: 'Correct a day that has punches' },
  { key: 'regularize', name: 'Decide requests (regularization)' },
  { key: 'month', name: 'Verify the month\'s attendance' },
  { key: 'salary', name: 'Propose an employee\'s salary' },
];
const KEYS = POWERS.map(p => p.key);
// { power: true / false } for the HR Admin of a site (before step 5 is run: everything, as before)
async function of(site) {
  const out = {}; KEYS.forEach(k => { out[k] = true; });
  let rows = [];
  try { rows = (await db('GET', 'hr_admin_powers?select=power,allowed&site=eq.' + enc(site))) || []; } catch (e) { if (!e || e.code !== 'notinstalled') throw e; }
  rows.forEach(r => { if (out[r.power] !== undefined) out[r.power] = !!r.allowed; });
  return out;
}
async function need(s, power) {
  if (s.role === 'super') return;
  if (s.role !== 'admin') throw fail(403, 'Only the HR Admin or the Super Admin can do this.', 'role');
  if (!(await of(s.site))[power]) throw fail(403, 'The Super Admin has not given the HR Admin this power on this site (' + POWERS.find(p => p.key === power).name + ').', 'power');
}
module.exports = { POWERS, KEYS, of, need };
