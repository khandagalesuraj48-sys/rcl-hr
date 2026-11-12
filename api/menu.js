/* GET /menu.json (→ /api/menu) – the pages of HR for the menu of the screen around it (Mechanical's dark menu): only the pages
 * this person has. Before the first sign-in here nobody is known: every page is listed – the page itself then opens only what he
 * has. (12-11-2026, Phase 1: the Employee Master and its two lists.) */
'use strict';
const { handler, send } = require('../lib/http');
const ses = require('../lib/session');
const PAGES = [
  { key: 'dashboard', name: 'Dashboard', who: 'all' },      // the attendance dashboard – the first page
  { key: 'employees', name: 'Employees', who: 'all' },
  { key: 'attendance', name: 'Attendance', who: 'all' },      // (step 4) the day's punches; work places (geofences); the phones
  { key: 'places', name: 'Work places', who: 'all' },
  { key: 'muster', name: 'Muster', who: 'all' },      // (step 5) the month; requests; shifts, holidays, rules
  { key: 'requests', name: 'Requests', who: 'all' },
  { key: 'phones', name: 'Phones', who: 'all' },
  { key: 'rules', name: 'Shifts & rules', who: 'all' },
  { key: 'lists', name: 'Lists', who: 'admin' },      // (step 6) the pick-lists of the profile and what is compulsory
  { key: 'departments', name: 'Departments', who: 'admin' },
  { key: 'designations', name: 'Designations', who: 'admin' },
];
const mayOpen = (who, role) => role === 'self' ? false : who === 'all' || (who === 'admin' && (role === 'admin' || role === 'super'));
module.exports = handler(async (req, res) => {
  let s = null; try { s = await ses.read(req); } catch (e) { s = null; }
  send(res, 200, { module: 'hr', name: 'HR', pages: PAGES.filter(p => !s || mayOpen(p.who, s.role)).map(p => ({ key: p.key, name: p.name })) });
});
module.exports.PAGES = PAGES; module.exports.mayOpen = mayOpen;
