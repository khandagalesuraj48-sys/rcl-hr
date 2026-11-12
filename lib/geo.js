/* WHERE A PERSON IS, against a work place (12-11-2026: "GEOFENCE BAHER KAHICH NHI HONAR"). A work place is
 *   a circle   – a point and a radius in metres,
 *   a polygon  – an area drawn on the map (its corners),
 *   a corridor – a line along the road with so many metres on each side.
 * Plain arithmetic, no outside service. Distances in metres (good to well under a metre at these sizes). */
'use strict';
const RAD = Math.PI / 180, EARTH = 6371008.8;
const num = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const okLat = v => Number.isFinite(v) && v >= -90 && v <= 90, okLng = v => Number.isFinite(v) && v >= -180 && v <= 180;
function dist(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * RAD, dLng = (bLng - aLng) * RAD, s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}
// metres east / north of a point, seen from an origin (flat – right for a few kilometres)
const xy = (oLat, oLng, lat, lng) => [(lng - oLng) * RAD * EARTH * Math.cos(oLat * RAD), (lat - oLat) * RAD * EARTH];
// the distance of a point from the piece of line a–b
function distSeg(lat, lng, a, b) {
  const [bx, by] = xy(a[0], a[1], b[0], b[1]), [px, py] = xy(a[0], a[1], lat, lng), len = bx * bx + by * by;
  const t = len ? Math.max(0, Math.min(1, (px * bx + py * by) / len)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}
function inPolygon(lat, lng, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// the points of a polygon / corridor as typed: [[lat, lng], …] – checked; null = not usable
function points(v, min) {
  if (!Array.isArray(v) || v.length < min || v.length > 500) return null;
  const out = []; for (const p of v) { const la = num(Array.isArray(p) ? p[0] : p && p.lat), lo = num(Array.isArray(p) ? p[1] : p && p.lng); if (!okLat(la) || !okLng(lo)) return null; out.push([Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6]); }
  return out;
}
/* { inside, distance } of a point for one place. distance = metres to its edge (0 when inside); a point the phone is not sure of
 * (accuracy) is NOT given the benefit of the doubt: the reading itself must be inside. */
function check(place, lat, lng) {
  if (place.shape === 'circle') { const d = dist(lat, lng, place.lat, place.lng); return { inside: d <= place.radius_m, distance: Math.max(0, Math.round(d - place.radius_m)) }; }
  const pts = place.points || [];
  if (place.shape === 'polygon') {
    if (inPolygon(lat, lng, pts)) return { inside: true, distance: 0 };
    let m = Infinity; for (let i = 0; i < pts.length; i++) m = Math.min(m, distSeg(lat, lng, pts[i], pts[(i + 1) % pts.length]));
    return { inside: false, distance: Math.round(m) };
  }
  let m = Infinity; for (let i = 0; i + 1 < pts.length; i++) m = Math.min(m, distSeg(lat, lng, pts[i], pts[i + 1]));      // corridor
  return { inside: m <= place.radius_m, distance: Math.max(0, Math.round(m - place.radius_m)) };
}
// the best of his places: the one he is inside (the nearest centre first), else the nearest edge
function nearest(places, lat, lng) {
  let best = null;
  for (const p of places) { const c = check(p, lat, lng); if (!best || (c.inside && !best.inside) || (c.inside === best.inside && c.distance < best.distance)) best = Object.assign({ place: p }, c); }
  return best;
}
module.exports = { num, okLat, okLng, dist, distSeg, inPolygon, points, check, nearest };
