/* ATTENDANCE – the rules of a punch, in one place (his decisions of 12-11-2026):
 *   • each person for himself, TODAY only – the day is the server's (India); an old or a coming day is never marked;
 *   • inside one of HIS work places only – outside nothing is saved ("GEOFENCE BAHER KAHICH NHI HONAR");
 *   • one phone a person; another phone works only after the HR Admin / Super Admin released the old one;
 *   • Developer Options or a made-up location: no punch (only attendance is stopped – the rest of the app works);
 *   • a selfie with every punch – PROOF only, never checked by a machine;
 *   • no network: the phone keeps the punch exactly as taken and sends it later; it counts by itself only when the phone's own
 *     untouchable clock, its place and its phone are in order – anything doubtful is kept for the HR Admin to look at ("review"). */
'use strict';
const G = require('./geo');
const R = require('./rules');
const KINDS = ['office', 'site_office', 'site', 'camp', 'plant', 'workshop', 'other'];
const KIND_NAME = { office: 'Head office', site_office: 'Site office', site: 'Construction site', camp: 'Labour camp', plant: 'Plant', workshop: 'Workshop', other: 'Other work place' };
const MAX_ACCURACY = 100, OFFLINE_MAX_MS = 72 * 3600000, CLOCK_SLACK_MS = 120000;

// a work place as typed → { row, errors }
function place(x) {
  x = x || {}; const errors = [], row = {};
  row.name = R.str(x.name, 60); if (row.name.length < 2) errors.push('Name: at least 2 letters.');
  row.kind = KINDS.indexOf(x.kind) > -1 ? x.kind : 'site';
  row.shape = ['circle', 'polygon', 'corridor'].indexOf(x.shape) > -1 ? x.shape : 'circle';
  const rad = Math.round(G.num(x.radius_m));
  if (row.shape === 'circle') {
    row.lat = G.num(x.lat); row.lng = G.num(x.lng); row.points = [];
    if (!G.okLat(row.lat) || !G.okLng(row.lng)) errors.push('Place it on the map (latitude and longitude).');
    else { row.lat = Math.round(row.lat * 1e6) / 1e6; row.lng = Math.round(row.lng * 1e6) / 1e6; }
    if (!(rad >= 20 && rad <= 5000)) errors.push('Radius: 20 to 5000 metres.'); row.radius_m = rad;
  } else if (row.shape === 'polygon') {
    row.points = G.points(x.points, 3); row.lat = null; row.lng = null; row.radius_m = null;
    if (!row.points) { errors.push('Area: draw at least 3 corners on the map.'); row.points = []; }
  } else {
    row.points = G.points(x.points, 2); row.lat = null; row.lng = null;
    if (!row.points) { errors.push('Along the road: mark at least 2 points of the road.'); row.points = []; }
    if (!(rad >= 20 && rad <= 5000)) errors.push('Metres on each side: 20 to 5000.'); row.radius_m = rad;
  }
  row.scope = ['all', 'category', 'department', 'people'].indexOf(x.scope) > -1 ? x.scope : 'all';
  const vals = Array.isArray(x.scope_values) ? x.scope_values.map(v => String(v)).slice(0, 60) : [];
  if (row.scope === 'category') { row.scope_values = vals.filter(v => R.CATS.indexOf(v) > -1); if (!row.scope_values.length) errors.push('For whom: choose at least one category.'); }
  else if (row.scope === 'department') { row.scope_values = vals.filter(v => /^[0-9a-f-]{36}$/.test(v)); if (!row.scope_values.length) errors.push('For whom: choose at least one department.'); }
  else row.scope_values = [];
  const from = R.date(x.valid_from); if (from === null) errors.push('From which date: a date as DD-MM-YYYY.'); row.valid_from = from || R.today();
  return { row, errors };
}
// is this place for this employee on this day?
function applies(p, emp, day, chosen) {
  if (!p.active || p.removed_at || p.valid_from > day) return false;
  if (p.scope === 'all') return true;
  if (p.scope === 'category') return (p.scope_values || []).indexOf(emp.category) > -1;
  if (p.scope === 'department') return (p.scope_values || []).indexOf(emp.department_id) > -1;
  return !!(chosen && chosen[p.id]);
}
// what the phone needs of a place (to know by itself, also without a network, whether he is inside)
const forPhone = p => ({ id: p.id, name: p.name, kind: p.kind, shape: p.shape, lat: p.lat, lng: p.lng, radius_m: p.radius_m, points: p.points || [] });

/* THE MOMENT of a punch. Online: the server's clock, nothing of the phone is believed. Offline (sent later): the phone noted, at
 * its last contact, the server's time AND its own counter since it was switched on (a counter the person cannot set); the moment
 * of the punch = that server time + what the counter moved. In order when: the counter did not start again (no restart between),
 * it agrees with the phone's wall clock within 2 minutes, it is not in the future and not older than 72 hours. */
function moment(x, now) {
  now = now || Date.now();
  if (!x.offline) return { at: now, ok: true, why: [] };
  const anchorServer = G.num(x.anchor_server), anchorEl = G.num(x.anchor_elapsed), el = G.num(x.elapsed), wall = Date.parse(String(x.at_device || '')), why = [];
  if (![anchorServer, anchorEl, el].every(Number.isFinite) || isNaN(wall)) return { at: isNaN(wall) ? now : Math.min(wall, now), ok: false, why: ['no proper clock data'] };
  if (el < anchorEl) why.push('the phone was restarted');
  const at = anchorServer + (el - anchorEl);
  if (Math.abs(at - wall) > CLOCK_SLACK_MS) why.push('the phone\'s clock does not agree');
  if (at > now + 60000) why.push('in the future');
  if (now - at > OFFLINE_MAX_MS) why.push('older than 72 hours');
  if (anchorServer > now + 60000 || now - anchorServer > 30 * 86400000) why.push('no recent contact with the server');
  return { at: why.indexOf('in the future') > -1 ? now : at, ok: !why.length, why: why };
}
module.exports = { KINDS, KIND_NAME, MAX_ACCURACY, place, applies, forPhone, moment };
