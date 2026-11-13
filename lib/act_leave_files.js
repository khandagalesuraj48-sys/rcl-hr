/* THE PAPERS OF A LEAVE REQUEST (api/hr.js sends them here) – step 13 (13-11-2026, asked: "leave form attachment").
 *   A paper (a photo or a PDF – a doctor's note, a wedding card, a ticket) is NEVER compulsory: it can be attached with the
 *   request or any time afterwards, by the person himself or by the HR office of his site.
 *   Who sees it: the person, the person he reports to, the HR office of his site. A link to the file works 5 minutes.
 *   A paper is never deleted: "removed" with who and when – the person only his own while the request still waits, the HR
 *   office any time. The file stays in HR's private store (the same one as the employees' papers), under leave/<employee>/. */
'use strict';
const crypto = require('crypto');
const { fail } = require('./http');
const { db, enc } = require('./db');
const { audit } = require('./audit');
const R = require('./rules');
const store = require('./store');
const { me, needOffice } = require('./act_attend');
const { NOT_READY13 } = require('./act_rulebook');

const MAX = 5;      // papers of one request
const FILE = 'id,request_id,employee_id,site,path,name,mime,size,added_by,added_at,removed_at';
const ready = e => { if (e && e.code === 'notinstalled') throw fail(400, NOT_READY13, 'notready'); throw e; };
const num = v => parseInt(v, 10) || 0;
const req = async v => { const q = ((await db('GET', 'hr_leave_requests?select=id,employee_id,site,status,from_day&id=eq.' + num(v))) || [])[0]; if (!q) throw fail(404, 'This leave request was not found.', 'notfound'); return q; };
const live = async q => { try { return (await db('GET', 'hr_leave_files?select=' + FILE + '&request_id=eq.' + q.id + '&removed_at=is.null&order=id')) || []; } catch (e) { return ready(e); } };
const out = (f, who, office, q) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, added_by: f.added_by, added_at: f.added_at, canRemove: office || (f.added_by === who && q.status === 'pending') });

// how many papers each of these requests has: { requestId: n } – null while step 13 is not run (nothing about papers is shown then)
async function counts(ids) {
  const by = {}; if (!ids.length) return by;
  try { ((await db('GET', 'hr_leave_files?select=request_id&removed_at=is.null&request_id=in.(' + ids.map(num).join(',') + ')&limit=5000')) || []).forEach(f => { by[f.request_id] = (by[f.request_id] || 0) + 1; }); }
  catch (e) { if (e && e.code === 'notinstalled') return null; throw e; }
  return by;
}
// the place for one new file of this request
async function place(q, x) {
  if (q.status === 'cancelled') throw fail(400, 'This request was taken back – nothing is attached to it.', 'cancelled');
  const ext = R.DOC_TYPES[String(x.type || '')], bytes = Number(x.bytes);
  if (!ext) throw fail(400, 'Only a photo (JPG, PNG, WebP) or a PDF can be attached.', 'type');
  if (!(bytes > 0)) throw fail(400, 'This file is empty.', 'bytes'); if (bytes > R.DOC_MAX) throw fail(400, 'This file is ' + Math.ceil(bytes / 1048576) + ' MB – a paper can be at most 10 MB.', 'bytes');
  if ((await live(q)).length >= MAX) throw fail(400, 'A leave request holds at most ' + MAX + ' papers.', 'many');
  const path = 'leave/' + q.employee_id + '/' + crypto.randomBytes(12).toString('hex') + '.' + ext;
  return { path: path, url: await store.uploadUrl(path), type: String(x.type) };
}
// the file has arrived: it is written to the request
async function keep(s, q, x) {
  if (q.status === 'cancelled') throw fail(400, 'This request was taken back – nothing is attached to it.', 'cancelled');
  const path = String(x.path || ''); if (!new RegExp('^leave/' + q.employee_id + '/[0-9a-f]{24}\\.(jpg|png|webp|pdf)$').test(path)) throw fail(400, 'This file does not belong to this request.', 'path');
  const mime = Object.keys(R.DOC_TYPES).filter(t => R.DOC_TYPES[t] === path.split('.').pop())[0], bytes = Number(x.bytes);
  if (!(bytes > 0 && bytes <= R.DOC_MAX)) throw fail(400, 'This file is too big or empty.', 'bytes');
  const have = await live(q); if (have.some(f => f.path === path)) return { ok: true }; if (have.length >= MAX) throw fail(400, 'A leave request holds at most ' + MAX + ' papers.', 'many');
  if (!(await store.link(path, 60))) throw fail(400, 'The file did not arrive – attach it again.', 'path');
  const made = (await db('POST', 'hr_leave_files', [{ request_id: q.id, employee_id: q.employee_id, site: q.site, path: path, name: R.str(x.name, 80), mime: mime, size: Math.round(bytes), added_by: s.email }], 'return=representation'))[0];
  await audit(q.site, s.email, 'Leave paper attached', 'request ' + q.id, { file: made.id });
  return { ok: true, id: made.id };
}
const one = async v => { let f; try { f = ((await db('GET', 'hr_leave_files?select=' + FILE + '&id=eq.' + num(v))) || [])[0]; } catch (e) { return ready(e); } if (!f || f.removed_at) throw fail(404, 'This paper was not found.', 'notfound'); return f; };
async function open(s, f) { const url = await store.link(f.path, 300); if (!url) throw fail(404, 'The file of this paper was not found.', 'notfound'); await audit(f.site, s.email, 'Leave paper opened', 'request ' + f.request_id, { file: f.id }); return { url: url }; }
async function remove(s, f) {
  const done = (await db('PATCH', 'hr_leave_files?id=eq.' + f.id + '&removed_at=is.null', { removed_by: s.email, removed_at: new Date().toISOString() }, 'return=representation')) || [];
  if (done.length) await audit(f.site, s.email, 'Leave paper removed', 'request ' + f.request_id, { file: f.id });
  return { ok: true };
}
// the request is the person's own; or (to look only) of somebody who reports to him
const mine = async (emp, q, look) => {
  if (q.employee_id === emp.id) return true;
  if (look && ((await db('GET', 'hr_employees?select=id&id=eq.' + q.employee_id + '&reports_to=eq.' + emp.id + '&limit=1')) || []).length) return false;
  throw fail(403, 'This leave request is not yours.', 'own');
};
const office = (s, q) => { needOffice(s); if (q.site !== s.site) throw fail(404, 'This leave request was not found on this site.', 'notfound'); };

const ACT = {
  /* ───────────── a person, for himself ───────────── */
  async myLeaveFiles(s, x) { const emp = await me(s), q = await req(x.request), own = await mine(emp, q, true); return { request: q.id, max: MAX, maxMb: R.DOC_MAX / 1048576, canAdd: own && q.status !== 'cancelled', files: (await live(q)).map(f => out(f, s.email, false, own ? q : { status: '' })) }; },
  async myLeaveFileUrl(s, x) { const emp = await me(s), q = await req(x.request); await mine(emp, q); return place(q, x); },
  async myLeaveFileAdd(s, x) { const emp = await me(s), q = await req(x.request); await mine(emp, q); return keep(s, q, x); },
  async myLeaveFileLink(s, x) { const emp = await me(s), f = await one(x.file); await mine(emp, await req(f.request_id), true); return open(s, f); },
  async myLeaveFileRemove(s, x) {
    const emp = await me(s), f = await one(x.file), q = await req(f.request_id); await mine(emp, q);
    if (f.added_by !== s.email) throw fail(403, 'This paper was attached by the HR office – only the office removes it.', 'own');
    if (q.status !== 'pending') throw fail(409, 'The request is decided – ask the HR office to remove a paper.', 'decided');
    return remove(s, f);
  },
  /* ───────────── the HR office ───────────── */
  async leaveFiles(s, x) { const q = await req(x.request); office(s, q); return { request: q.id, max: MAX, maxMb: R.DOC_MAX / 1048576, canAdd: q.status !== 'cancelled', files: (await live(q)).map(f => out(f, s.email, true, q)) }; },
  async leaveFileUrl(s, x) { const q = await req(x.request); office(s, q); return place(q, x); },
  async leaveFileAdd(s, x) { const q = await req(x.request); office(s, q); return keep(s, q, x); },
  async leaveFileLink(s, x) { const f = await one(x.file); office(s, f); return open(s, f); },
  async leaveFileRemove(s, x) { const f = await one(x.file); office(s, f); return remove(s, f); },
};
const SELF = ['myLeaveFiles', 'myLeaveFileUrl', 'myLeaveFileAdd', 'myLeaveFileLink', 'myLeaveFileRemove'];
module.exports = { ACT, SELF, MAX, counts };
