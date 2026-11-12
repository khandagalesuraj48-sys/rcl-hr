/* POST /api/face { action, … } – THE FACE FOR ATTENDANCE (step 9, 12-11-2026). Its own endpoint: the model is heavy, and the rest
 * of HR (api/hr.js) must stay light and must keep working whatever happens here.
 *   An employee, for himself (also "My HR"):
 *     faceState      – is the face needed on his site, how much must match, is his face registered
 *     faceEnrolUrls  – where the phone sends the five pictures of the registration (front, left, right, up, down)
 *     faceEnrol      – the five pictures are measured; all must show ONE person – his face is registered. Once: a second
 *                      registration only after the HR Admin / Super Admin reset the first.
 *     faceCheck      – the proof photo of ONE punch (already sent to its place) against his registered face. It matches at
 *                      least the site's percentage: noted as "ok" – api/hr.js then takes that punch. It does not: noted, refused,
 *                      NOTHING of the punch is saved ("yatle ek jari nahi zal attendence mark nahi honar").
 *   The HR office:
 *     faceInfo       – an employee's registration (its pictures: HR Admin / Super Admin) and his last checks
 *     faceReset      – HR Admin / Super Admin, with the reason: he registers again. Nothing is deleted.
 * Always the employee the sign-in is – never an id from the phone. The pictures stay in the private store; a face is kept as
 * numbers. Every check is written down (hr_face_tries), with how far it matched. */
'use strict';
const crypto = require('crypto');
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { db, enc } = require('../lib/db');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const R = require('../lib/rules');
const D = require('../lib/day');
const store = require('../lib/store');
const F = require('../lib/face');
const { me, needOffice } = require('../lib/act_attend');
const { setup } = require('../lib/act_muster');

const NOT_READY9 = 'The face check is not set up yet: the Super Admin runs sql/hr_step9_faces.sql once in the rcl-hr Supabase → SQL Editor.';
const POSES = ['front', 'left', 'right', 'up', 'down'], POSE_NAME = { front: 'Front', left: 'Left', right: 'Right', up: 'Up', down: 'Down' };
const CLIENT = /^[A-Za-z0-9_-]{16,64}$/, TOKEN = /^[0-9a-f]{24}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isAdmin = s => s.role === 'admin' || s.role === 'super';
const rulesOf = async site => { const v = D.validOn((await setup(site)).rules, R.today()); return v ? v.rules : {}; };
const faceOf = async empId => ((await db('GET', 'hr_faces?select=id,descriptors,photos,enrolled_at,device_id,model&employee_id=eq.' + empId + '&active=is.true')) || [])[0] || null;
// a file of the private store, as it is ('' path or not there: null)
async function bytes(path, bucket) {
  const u = await store.link(path, 60, bucket); if (!u) return null;
  let r; try { r = await fetch(u, { signal: AbortSignal.timeout(15000) }); } catch (e) { throw fail(503, 'Could not reach the place of the pictures – please try again in a moment.', 'net'); }
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}
const note = (emp, row) => db('POST', 'hr_face_tries', [Object.assign({ employee_id: emp.id, site: emp.site }, row)], 'return=minimal');
const said = { noface: 'no face was found in the picture – look straight at the phone, in the light', manyfaces: 'more than one face is in the picture – only you' };

const ACT = {
  /* ───────────── an employee, for himself ───────────── */
  async faceState(s) {
    const emp = await me(s), [rules, f] = await Promise.all([rulesOf(emp.site), faceOf(emp.id)]);
    return { required: !!rules.face, min: F.minOf(rules), enrolled: !!f, enrolled_at: f ? f.enrolled_at : '', poses: POSES };
  },
  async faceEnrolUrls(s) {
    const emp = await me(s); if (await faceOf(emp.id)) throw fail(409, 'Your face is registered already. Only the HR Admin can reset it – then you register again.', 'enrolled');
    const token = crypto.randomBytes(12).toString('hex'), out = [];
    for (const p of POSES) out.push({ pose: p, url: await store.uploadUrl('faces/' + emp.id + '/' + token + '-' + p + '.jpg') });
    return { token: token, pictures: out, type: 'image/jpeg' };
  },
  async faceEnrol(s, x) {
    const emp = await me(s), token = String(x.token || ''); if (!TOKEN.test(token)) throw fail(400, 'Bad registration number.', 'token');
    if (await faceOf(emp.id)) throw fail(409, 'Your face is registered already. Only the HR Admin can reset it – then you register again.', 'enrolled');
    const got = [];
    for (const p of POSES) {
      const path = 'faces/' + emp.id + '/' + token + '-' + p + '.jpg', b = await bytes(path); if (!b) throw fail(400, POSE_NAME[p] + ': the picture did not arrive – take it again.', 'picture', { pose: p });
      let d; try { d = await F.describe(b); } catch (e) { if (e && e.status) throw e; throw fail(400, POSE_NAME[p] + ': the picture could not be read – take it again.', 'picture', { pose: p }); }
      if (d.result !== 'ok') { await note(emp, { kind: 'enrol', result: d.result, selfie_path: path }); throw fail(400, POSE_NAME[p] + ': ' + said[d.result] + '.', d.result, { pose: p }); }
      got.push({ pose: p, path: path, descriptor: d.descriptor });
    }
    // the five pictures must be of ONE person (each against the one from the front, by the model's own line)
    const front = got[0].descriptor, far = got.slice(1).filter(g => F.dist(front, g.descriptor) > F.HALF)[0];
    if (far) { await note(emp, { kind: 'enrol', result: 'nomatch', distance: Math.round(F.dist(front, far.descriptor) * 1e4) / 1e4, match_pct: F.pct(F.dist(front, far.descriptor)), selfie_path: far.path }); throw fail(400, POSE_NAME[far.pose] + ': this is not the same face as the picture from the front – take all five of yourself.', 'nomatch', { pose: far.pose }); }
    const dev = x.device || {};
    try { await db('POST', 'hr_faces', [{ employee_id: emp.id, site: emp.site, descriptors: got.map(g => g.descriptor), photos: got.map(g => ({ pose: g.pose, path: g.path })), device_id: R.str(dev.id, 100), model: R.str(dev.model, 80), enrolled_by: s.email }], 'return=minimal'); }
    catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'Your face is registered already.', 'enrolled'); throw e; }
    await note(emp, { kind: 'enrol', result: 'ok', selfie_path: got[0].path });
    await audit(emp.site, s.email, 'Face registered', emp.code + ' ' + emp.name, { pictures: POSES.length });
    return { enrolled: true };
  },
  async faceCheck(s, x) {
    const emp = await me(s), cid = String(x.client_id || ''); if (!CLIENT.test(cid)) throw fail(400, 'Bad punch number.', 'client_id');
    const [rules, f] = await Promise.all([rulesOf(emp.site), faceOf(emp.id)]), min = F.minOf(rules);
    if (!f) throw fail(409, 'Your face is not registered yet – register it first (once).', 'notenrolled');
    const path = emp.id + '/' + cid + '.jpg', b = await bytes(path, store.SELFIES); if (!b) throw fail(400, 'The photo of this punch did not arrive – take it again.', 'selfie');
    let d; try { d = await F.describe(b); } catch (e) { if (e && e.status) throw e; throw fail(400, 'The photo could not be read – take it again.', 'selfie'); }
    if (d.result !== 'ok') { await note(emp, { kind: 'punch', result: d.result, min_pct: min, client_id: cid, selfie_path: path }); throw fail(403, 'Not marked: ' + said[d.result] + '. Nothing is saved.', d.result); }
    const n = F.nearest(f.descriptors, d.descriptor), ok = n.pct >= min;
    await note(emp, { kind: 'punch', result: ok ? 'ok' : 'nomatch', match_pct: n.pct, distance: Math.round(n.distance * 1e4) / 1e4, min_pct: min, client_id: cid, selfie_path: path });
    if (!ok) throw fail(403, 'Not marked: the face does not match the registered face of ' + emp.name + ' (' + n.pct + ' % – at least ' + min + ' % is needed). Nothing is saved.', 'face', { pct: n.pct, min: min });
    return { match: true, pct: n.pct, min: min };
  },

  /* ───────────── the HR office ───────────── */
  async faceInfo(s, x) {
    needOffice(s); const id = String(x.id || '').toLowerCase(); if (!UUID.test(id)) throw fail(404, 'This employee was not found.', 'notfound');
    const emp = ((await db('GET', 'hr_employees?select=id,code,name&id=eq.' + id + '&site=eq.' + enc(s.site))) || [])[0]; if (!emp) throw fail(404, 'This employee was not found on this site.', 'notfound');
    const [faces, tries, rules] = await Promise.all([db('GET', 'hr_faces?select=id,photos,active,enrolled_at,model,reset_by,reset_at,reset_reason&employee_id=eq.' + emp.id + '&order=enrolled_at.desc&limit=10'),
      db('GET', 'hr_face_tries?select=kind,result,match_pct,min_pct,at&employee_id=eq.' + emp.id + '&order=at.desc&limit=20'), rulesOf(s.site)]);
    const now = (faces || []).filter(f => f.active)[0] || null; let pictures = [];
    if (now && isAdmin(s)) { const got = await store.links((now.photos || []).map(p => p.path), 300); pictures = (now.photos || []).map(p => ({ pose: p.pose, url: got[p.path] || '' })).filter(p => p.url); }
    return { required: !!rules.face, min: F.minOf(rules), enrolled: !!now, enrolled_at: now ? now.enrolled_at : '', model: now ? now.model : '', pictures: pictures, can_reset: isAdmin(s),
      resets: (faces || []).filter(f => !f.active).map(f => ({ enrolled_at: f.enrolled_at, reset_at: f.reset_at, reset_by: f.reset_by, reason: f.reset_reason })), tries: tries || [] };
  },
  async faceReset(s, x) {
    if (!isAdmin(s)) throw fail(403, 'Only the HR Admin or the Super Admin resets a registered face.', 'role');
    const id = String(x.id || '').toLowerCase(), why = R.str(x.reason, 200); if (!UUID.test(id)) throw fail(404, 'This employee was not found.', 'notfound'); if (why.length < 3) throw fail(400, 'Reason: write why the face is reset.', 'reason');
    const emp = ((await db('GET', 'hr_employees?select=id,code,name&id=eq.' + id + '&site=eq.' + enc(s.site))) || [])[0]; if (!emp) throw fail(404, 'This employee was not found on this site.', 'notfound');
    const done = (await db('PATCH', 'hr_faces?employee_id=eq.' + emp.id + '&active=is.true', { active: false, reset_by: s.email, reset_at: new Date().toISOString(), reset_reason: why }, 'return=representation')) || [];
    if (!done.length) throw fail(400, 'No face is registered for him.', 'none');
    await audit(s.site, s.email, 'Face reset', emp.code + ' ' + emp.name, { reason: why });
    return { reset: true };
  },
};
const SELF = ['faceState', 'faceEnrolUrls', 'faceEnrol', 'faceCheck'];

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const x = await readBody(req), fn = Object.prototype.hasOwnProperty.call(ACT, String(x.action)) ? ACT[x.action] : null;
  if (!fn) return send(res, 400, { error: 'Unknown action.' });
  const s = await ses.need(req);
  if (s.role === 'self' && SELF.indexOf(String(x.action)) < 0) throw fail(403, 'This is for the HR office only.', 'role');
  try { send(res, 200, Object.assign({ ok: true }, await fn(s, x))); }
  catch (e) { if (e && e.code === 'notinstalled') throw fail(500, NOT_READY9, 'notinstalled'); throw e; }
});
module.exports.ACT = ACT; module.exports.SELF = SELF; module.exports.NOT_READY9 = NOT_READY9;
