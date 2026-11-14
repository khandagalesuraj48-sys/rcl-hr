// RIG ONLY (the local test database on 127.0.0.1:3140) – never a live database: timeout 150 node test/rig/place_guest.js
// A person of site A is given a work place of site B by the HR office of HIS OWN site (A); nothing of site B is changed.
process.env.SUPABASE_URL = 'http://127.0.0.1:3140'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_rigkey'; delete process.env.VERCEL_ENV;
const AT = require('../../lib/act_attend'), { db } = require('../../lib/db');
(async () => {
  let n = 0, bad = 0; const ok = (c, t) => { n++; if (!c) { bad++; console.log('FAIL', t); } }, no = async (p, t) => { try { await p; ok(false, t + ' (was allowed)'); } catch (e) { ok(e.status >= 400 && e.status < 500, t + ' → ' + e.status + ' ' + e.message); } };
  const A = 'DEMOBKTX2', B = 'TCTIR04', day = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const supA = { role: 'super', site: A, email: 'rig.super@rig.test', info: { sites: [{ code: A, name: 'Rig site A' }, { code: B, name: 'Rig site B' }] } }, supB = { role: 'super', site: B, email: 'rig.super@rig.test' }, usrA = { role: 'user', site: A, email: 'rig.user@rig.test' };
  const emp = ((await db('GET', 'hr_employees?select=id,code,name,category,site,department_id,status&site=eq.' + A + '&status=neq.left&order=code&limit=1')) || [])[0], empB = ((await db('GET', 'hr_employees?select=id&site=eq.' + B + '&status=neq.left&limit=1')) || [])[0];
  const pB = ((await db('GET', 'hr_places?select=id,name,scope,scope_values,active,valid_from&site=eq.' + B + '&removed_at=is.null&active=is.true&valid_from=lte.' + day + '&order=name')) || []), b1 = pB[0], b2 = pB[1];
  const before = JSON.stringify(await db('GET', 'hr_places?select=*&site=eq.' + B + '&order=id')), rowsB = async () => ((await db('GET', 'hr_place_people?select=place_id,employee_id&place_id=in.(' + pB.map(p => p.id).join(',') + ')&order=place_id,employee_id')) || []), had = await rowsB();
  const names = async () => (await AT.placesOf(emp, day)).map(p => p.name).sort().join(' | '), own = await names();
  const m0 = await AT.ACT.placeMap(supA); const o = (m0.others || []).find(x => x.site === B);
  ok(o && o.name === 'Rig site B' && o.places.length === pB.length + ((await db('GET', 'hr_places?select=id&site=eq.' + B + '&removed_at=is.null')).length - pB.length) && o.places.every(p => p.id && p.name && !('lat' in p) && !('points' in p)), 'the office of A sees the NAMES of B\'s work places – no map point of them');
  ok(!(m0.others || []).some(x => x.site === A) && (m0.people.find(e => e.id === emp.id).guest || []).length === 0, 'A itself is not among the "other sites"; he has none of another site yet');
  await no(AT.ACT.placeGuest(supA, { employee_id: emp.id, places: [b1.id] }), 'no reason'); await no(AT.ACT.placeGuest(usrA, { employee_id: emp.id, places: [b1.id], reason: 'visit' }), 'an HR User');
  await no(AT.ACT.placeGuest(supA, { employee_id: empB.id, places: [b1.id], reason: 'visit' }), 'an employee of another site (only his own site gives it)');
  const ownPlace = ((await db('GET', 'hr_places?select=id&site=eq.' + A + '&removed_at=is.null&limit=1')) || [])[0]; await no(AT.ACT.placeGuest(supA, { employee_id: emp.id, places: [ownPlace.id], reason: 'visit' }), 'a place of his OWN site through this door');
  const r1 = await AT.ACT.placeGuest(supA, { employee_id: emp.id, places: [b1.id, b2.id], reason: 'two weeks at the other site' });
  ok(r1.changed === 2 && r1.people.find(e => e.id === emp.id).guest.slice().sort().join() === [b1.id, b2.id].sort().join(), 'given: two work places of B');
  const after = await names(); ok(after === own.split(' | ').concat([b1.name, b2.name]).filter(Boolean).sort().join(' | '), 'he may mark at his own places AND at the two of B');
  ok(JSON.stringify(await db('GET', 'hr_places?select=*&site=eq.' + B + '&order=id')) === before, 'nothing of B\'s work places is changed');
  // B's own office: its list and its "who is where" do not show him; saving its place's people keeps him
  const mB = await AT.ACT.placeMap(supB), lB = await AT.ACT.placeList(supB); ok(!mB.people.some(e => e.id === emp.id) && lB.places.every(p => (p.people || []).indexOf(emp.id) < 0), 'B\'s own lists hold only B\'s people');
  if (b1.scope === 'people') { const own1 = lB.places.find(p => p.id === b1.id).people; if (own1.length) { await AT.ACT.placePeople(supB, { place_id: b1.id, add: [own1[0]] }); ok((await rowsB()).some(r => r.place_id === b1.id && r.employee_id === emp.id), 'B changes its own people of the place: the guest of A stays'); } }
  else ok((await names()).indexOf(b1.name) > -1, 'a place of B that is for "everybody of B" counts for him because he was given it');
  // only one of the two now; then none
  const r2 = await AT.ACT.placeGuest(supA, { employee_id: emp.id, places: [b2.id], reason: 'only the office now' }); ok(r2.changed === 1 && (await names()).indexOf(b1.name) < 0 && (await names()).indexOf(b2.name) > -1, 'changed to one: the other is taken back');
  const same = await AT.ACT.placeGuest(supA, { employee_id: emp.id, places: [b2.id], reason: 'again the same' }); ok(same.changed === 0, 'the same again: nothing is changed');
  await db('PATCH', 'hr_places?id=eq.' + b2.id, { active: false }, 'return=minimal'); ok((await names()).indexOf(b2.name) < 0, 'B switches its place off: he cannot mark there'); await db('PATCH', 'hr_places?id=eq.' + b2.id, { active: true }, 'return=minimal');
  const r3 = await AT.ACT.placeGuest(supA, { employee_id: emp.id, places: [], reason: 'he is back' }); ok(r3.changed === 1 && await names() === own, 'taken back: exactly his own places again');
  ok(JSON.stringify(await rowsB()) === JSON.stringify(had) && JSON.stringify(await db('GET', 'hr_places?select=*&site=eq.' + B + '&order=id')) === before, '(the rig is as before)');
  const log = (await db('GET', 'hr_audit?select=action,detail&site=eq.' + A + '&action=eq.' + encodeURIComponent('Work places of another site: changed for a person') + '&order=id.desc&limit=1'))[0]; ok(log && /he is back/.test(JSON.stringify(log.detail)), 'written in A\'s record with the reason');
  console.log((n - bad) + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('STOPPED', e && e.stack || e); process.exit(1); });
