/* THE LISTS OF DEPARTMENTS AND DESIGNATIONS, and an employee's page in ONE reading (13-11-2026 – asked: "department and designation
 * ektr thew … add kelel edit and delet pn karta yawet … construction line madhe je astat te auto tu fill kr"; "employee war click
 * kel ki … data lagech yet nahi to pn fast yeyla hawa").
 *   masterDelete – a department / designation added by mistake is taken away – ONLY while no employee has it (today or in his
 *                  history); one in use is switched off as before. Written in the audit.
 *   masterSeed   – the usual departments and designations of a road / construction company are added – only the names that are
 *                  not there yet (a name that is there, or begins like one that is there, is left alone). Nothing is changed.
 *   empPage      – what an employee's page needs, asked together: the four readings of before in one answer. It only reads;
 *                  each part keeps its own check of who may see it (a part the person may not see comes back empty). */
'use strict';
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');

const MAST = { department: 'hr_departments', designation: 'hr_designations' }, COL = { department: 'department_id', designation: 'designation_id' };
const DEPARTMENTS = ['Accounts', 'Administration', 'Billing & Planning', 'Electrical', 'Highway', 'HR', 'Liaison', 'Management', 'Mechanical', 'Plant', 'Purchase', 'Quality Control', 'Safety', 'Security', 'Store', 'Structure', 'Survey', 'Transport'];
const DESIGNATIONS = {
  staff: ['Project Manager', 'Deputy Project Manager', 'Site In-charge', 'Site Engineer', 'Junior Engineer', 'Highway Engineer', 'Structure Engineer', 'Quantity Surveyor', 'Billing Engineer', 'Planning Engineer', 'Surveyor', 'Assistant Surveyor',
    'Quality Control Engineer', 'Lab Technician', 'Safety Officer', 'Mechanical Engineer', 'Mechanic', 'Electrician', 'Foreman', 'Supervisor', 'Store Keeper', 'Store Assistant', 'Purchase Officer', 'Accountant', 'Accounts Assistant', 'HR Executive',
    'Admin Officer', 'Time Keeper', 'Computer Operator', 'Liaison Officer', 'Security Guard', 'Office Assistant'],
  operator: ['Excavator Operator', 'Grader Operator', 'Paver Operator', 'Roller Operator', 'Loader Operator', 'Dozer Operator', 'Crane Operator', 'Backhoe Loader Operator', 'Batching Plant Operator', 'Hot Mix Plant Operator', 'Crusher Operator',
    'Transit Mixer Operator', 'Concrete Pump Operator', 'Generator Operator'],
  driver: ['Tipper Driver', 'Light Vehicle Driver', 'Water Tanker Driver', 'Diesel Bowser Driver', 'Trailer Driver', 'Tractor Driver'],
  labour: ['Helper', 'Mason', 'Carpenter', 'Bar Bender', 'Welder', 'Fitter', 'Plumber', 'Rigger', 'Labour'],
};
const low = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// a name of the list is "there" when the same name is there, or one of them begins with the other ("Account" – "Accounts")
const there = (have, name) => { const n = low(name); return have.some(h => h === n || (h.length >= 4 && n.indexOf(h) === 0) || (n.length >= 4 && h.indexOf(n) === 0)); };

module.exports = function (H) {
  const ACT = {
    async masterDelete(s, x) {
      H.needAdmin(s); const t = MAST[x.kind]; if (!t) throw fail(400, 'Unknown list.');
      const id = H.id(x.id), was = id ? ((await db('GET', t + '?select=id,name&id=eq.' + id)) || [])[0] : null; if (!was) throw fail(404, 'Not found.');
      const [now, hist] = await Promise.all([db('GET', 'hr_employees?select=id&' + COL[x.kind] + '=eq.' + id + '&limit=1000'), db('GET', 'hr_employment?select=id&' + COL[x.kind] + '=eq.' + id + '&limit=1000')]);
      const n = (now || []).length, h = (hist || []).length;
      if (n || h) throw fail(409, '"' + was.name + '" is in use (' + (n ? n + (n === 1 ? ' employee' : ' employees') : '') + (n && h ? ', ' : '') + (h ? h + ' in the history' : '') + ') – it cannot be deleted. Switch it off: it is then not offered any more.', 'inuse');
      await db('DELETE', t + '?id=eq.' + id, undefined, 'return=minimal');
      if (x.kind === 'designation') { try { await H.desCatSave(id, '', s.email); } catch (e) { /* its category is only a note – the list is right without it */ } }
      await audit(s.site, s.email, 'Master deleted', x.kind + ' ' + was.name, null);
      return Object.assign({ deleted: was.name }, await H.masters());
    },
    async masterSeed(s) {
      H.needAdmin(s); const m = await H.masters(), haveD = m.departments.map(d => low(d.name)), haveG = m.designations.map(d => low(d.name)), added = { departments: [], designations: [] };
      const deps = DEPARTMENTS.filter(n => !there(haveD, n));
      if (deps.length) { await db('POST', 'hr_departments', deps.map(n => ({ name: n, created_by: s.email })), 'return=minimal'); added.departments = deps; }
      for (const cat of Object.keys(DESIGNATIONS)) {
        const names = DESIGNATIONS[cat].filter(n => !there(haveG, n)); if (!names.length) continue;
        const made = (await db('POST', 'hr_designations', names.map(n => ({ name: n, created_by: s.email })), 'return=representation')) || [];
        if (cat !== 'staff') for (const r of made) await H.desCatSave(r.id, cat, s.email);
        added.designations = added.designations.concat(names);
      }
      if (added.departments.length || added.designations.length) await audit(s.site, s.email, 'Masters: the usual list added', added.departments.length + ' departments, ' + added.designations.length + ' designations', added);
      return Object.assign({ added: { departments: added.departments.length, designations: added.designations.length } }, await H.masters());
    },
    async empPage(s, x) {
      const part = async name => { try { return await H.ACT[name](s, { id: x.id }); } catch (e) { if (e && e.status && e.status < 500) return null; if (e && e.code === 'notinstalled') return null; throw e; } };
      const emp = await H.ACT.empGet(s, { id: x.id });      // (who may see him at all – its refusal is the page's)
      const [around, priv, prof] = await Promise.all([part('empAround'), part('privGet'), part('profGet')]);
      return { emp: emp, around: around, priv: priv, prof: prof };
    },
  };
  return { ACT: ACT };
};
module.exports.DEPARTMENTS = DEPARTMENTS; module.exports.DESIGNATIONS = DESIGNATIONS; module.exports.there = there; module.exports.low = low;
