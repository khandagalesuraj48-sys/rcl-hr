/* "MY HR" IN THE APP – A PERSON'S OWN RECORD (12-11-2026; asked: "ATTENDANCE APP MADHUN … EMPLOYE SWATA SWATCHE DOCUMENT UPLOAD
 * KRNE … BAKI DETAIL MADHE SAGLE KAHI WEB WAR"; the app's "Me": my details, my documents) – api/hr.js sends these actions here.
 *   myHr            – who he is in the Employee Master, how complete his profile is, his details to READ (he changes nothing:
 *                     the HR office does), which papers are still expected, the phone his attendance is tied to
 *   myDocs          – his papers            myDocUploadUrl / myDocAdd – he attaches a paper himself (the office's same checks)
 *   myDocLink       – he opens a paper of his own (a link for 5 minutes)
 * Always the employee the sign-in is (me) – never an id from the phone. PF / UAN / ESIC / bank account numbers are shown masked
 * here too. He never removes a paper: only the HR Admin / Super Admin (with the reason). */
'use strict';
const { fail } = require('./http');
const { db } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const store = require('./store');
const { me } = require('./act_attend');
const { soft } = require('./act_muster');
const P = require('./act_profile');

const MASKED = ['pf_no', 'uan', 'esic_no', 'bank_account'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dmy = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(0, 4) : '');
const CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
// one detail as it is read: a list's value by its name, a date as DD-MM-YYYY, Yes / No; a secret number masked
function shown(d, v, names, secret) {
  if (v === undefined || v === null || v === '') return '';
  if (d.type === 'list') return names[v] || '';
  if (d.type === 'date') return dmy(v);
  if (d.type === 'yesno') return v ? 'Yes' : 'No';
  return secret && MASKED.indexOf(d.key) > -1 ? P.mask(v) : String(v);
}

/* base: the HR office's own actions for papers (api/hr.js) – used for his own record, so the checks are the same ones. */
module.exports = base => {
  const own = (s, emp) => Object.assign({}, s, { site: emp.site });      // his own record, at the site it is kept at
  const ACT = {
    async myHr(s) {
      const emp = await me(s), e = ((await db('GET', 'hr_employees?select=id,code,name,category,gender,dob,mobile,email,site,department_id,designation_id,joined_on,status&id=eq.' + emp.id)) || [])[0] || emp;
      const [dep, des, pr, rw, li, rq, docs, dev] = await Promise.all([
        e.department_id ? db('GET', 'hr_departments?select=name&id=eq.' + e.department_id) : [], e.designation_id ? db('GET', 'hr_designations?select=name&id=eq.' + e.designation_id) : [],
        soft(db('GET', 'hr_employee_profile?select=data,secret&employee_id=eq.' + e.id)), soft(db('GET', 'hr_employee_rows?select=kind&employee_id=eq.' + e.id + '&removed_at=is.null')),
        soft(db('GET', 'hr_lists?select=id,name&limit=5000')), soft(db('GET', 'hr_settings?select=value&site=eq.' + encodeURIComponent(e.site) + '&key=eq.profile_required')),
        soft(db('GET', 'hr_employee_docs?select=kind,path,mime,created_at&employee_id=eq.' + e.id + '&active=is.true&order=created_at.desc')), soft(db('GET', 'hr_devices?select=model,bound_at&employee_id=eq.' + e.id + '&active=is.true'))]);
      const department = ((dep || [])[0] || {}).name || '', designation = ((des || [])[0] || {}).name || '', p = (pr || [])[0] || { data: {}, secret: {} }, names = {}, rows = {};
      (li || []).forEach(l => { names[l.id] = l.name; }); Object.keys(P.ROWS).forEach(k => { rows[k] = []; }); (rw || []).forEach(r => { if (rows[r.kind]) rows[r.kind].push(r); });
      const required = rq && rq[0] && Array.isArray((rq[0].value || {}).keys) ? rq[0].value.keys : [];
      const details = [{ name: 'Employee', rows: [['Code', e.code], ['Name', e.name], ['Category', CAT[e.category] || e.category || ''], ['Department', department], ['Designation', designation], ['Active from', dmy(e.joined_on)], ['Date of birth', dmy(e.dob)],
        ['Gender', e.gender ? String(e.gender).charAt(0).toUpperCase() + String(e.gender).slice(1) : ''], ['Mobile', e.mobile || ''], ['E-mail', e.email || '']].filter(r => r[1]).map(r => ({ label: r[0], value: String(r[1]) })) }];
      if (pr !== null) ['profile', 'job', 'secret'].forEach(g => {
        const G = P.GROUPS[g], src = (g === 'secret' ? p.secret : p.data) || {}, list = G.fields.map(d => ({ label: d.label, value: shown(d, src[d.key], names, g === 'secret') })).filter(r => r.value);
        if (list.length) details.push({ name: G.name, rows: list });
      });
      const d = (dev || [])[0] || null, c = pr === null ? null : P.complete(e, p, rows, required);
      // his profile picture: the newest paper "Photo" that is a picture – a link for 10 minutes ('' = none yet)
      const pic = (docs || []).filter(x => x.kind === 'photo' && /^image\//.test(x.mime || ''))[0], photo = pic ? await store.link(pic.path, 600).catch(() => '') : '';
      return { employee: { code: e.code, name: e.name, category: e.category, department: department, designation: designation }, complete: c ? { pct: c.pct, missing: c.missing } : null,
        details: details, photo: photo, docs: docs === null ? null : { have: docs.length, missing: R.docsMissing(e.category, docs.map(x => x.kind)) }, phone: { bound: !!d, model: d ? d.model || '' : '' } };
    },
    async myDocs(s) {
      const emp = await me(s), r = await base.docList(own(s, emp), { id: emp.id });
      // his own papers: he opens every one of them; who removed one and why is the office's
      return { kinds: r.kinds, docs: r.docs.filter(d => d.active).map(d => ({ id: d.id, kind: d.kind, title: d.title, number: d.number, expires_on: d.expires_on, mime: d.mime, created_at: d.created_at })), docsMissing: r.docsMissing, maxMb: r.maxMb };
    },
    async myDocUploadUrl(s, x) { const emp = await me(s); return base.docUploadUrl(own(s, emp), Object.assign({}, x, { id: emp.id })); },
    async myDocAdd(s, x) { const emp = await me(s); return base.docAdd(own(s, emp), Object.assign({}, x, { id: emp.id })); },
    async myDocLink(s, x) {
      const emp = await me(s), doc = String(x.doc || '').toLowerCase(); if (!UUID.test(doc)) throw fail(404, 'This paper was not found.', 'notfound');
      const d = ((await db('GET', 'hr_employee_docs?select=id,employee_id,kind,path,active&id=eq.' + doc + '&employee_id=eq.' + emp.id)) || [])[0]; if (!d || !d.active) throw fail(404, 'This paper was not found.', 'notfound');
      const url = await store.link(d.path, 300); if (!url) throw fail(404, 'The file of this paper was not found.', 'notfound');
      await audit(emp.site, s.email, 'Paper opened', emp.code, { kind: d.kind, doc: d.id, self: true });
      return { url: url };
    },
  };
  return { ACT, SELF: Object.keys(ACT) };
};
