/* THE FACE OF AN EMPLOYEE – measured and compared here, on our own server (step 9, 12-11-2026; decided: "स्वतःची तपासणी" – nothing
 * is sent to another company). His rule: the geofence AND the face – without both, no attendance; "90 percentage jri face match
 * zala tr sign in".
 *   The model: dlib's face recognition network (public domain, CC0) as shipped by @vladmandic/face-api (MIT), run by TensorFlow.js
 *   on WebAssembly – no native part, no service. A face becomes 128 numbers ("descriptor"); two pictures of one person lie near
 *   each other, two persons far (the model's own line: a distance of 0.6).
 *   The percentage shown is OURS, made from that distance so that it reads the way he said it:
 *       distance 0.30 → 99 %   0.45 → 90 %   0.50 → 81 %   0.60 → 50 %   0.70 → 19 %
 *   (a curve through "0.6 = half" and "0.45 = 90"). The site's rule "face_min" (percent, dated – 90 unless set) decides.
 * What this cannot do – said plainly: one picture cannot tell a living face from a photo of it (the app asks for the turn of
 * the head at registration and for a blink at every attendance – on the phone); identical twins are not told apart for sure.
 * No code of any other HR product is used. */
'use strict';
const path = require('path');
const HALF = 0.6, SPREAD = 0.15 / Math.log(9);                       // 0.6 → 50 %, 0.45 → 90 %
const pct = d => Math.max(0, Math.min(100, Math.round(100 / (1 + Math.exp((d - HALF) / SPREAD)))));
// the widest distance that still reads as [p] percent
const distOf = p => { p = Math.max(1, Math.min(99, p)); return HALF + SPREAD * Math.log(100 / p - 1); };
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const v = a[i] - b[i]; s += v * v; } return Math.sqrt(s); };
// the nearest of the registered pictures: { distance, pct }
const nearest = (list, d) => { let best = Infinity; (list || []).forEach(x => { if (Array.isArray(x) && x.length === d.length) best = Math.min(best, dist(x, d)); }); return { distance: best, pct: best === Infinity ? 0 : pct(best) }; };
const MIN_DEFAULT = 90;
const minOf = rules => { const v = rules && rules.face_min; return typeof v === 'number' && v >= 50 && v <= 99 ? v : MIN_DEFAULT; };

/* the model – read once for a server instance (about half a second), then kept */
let ready = null;
function load() {
  if (ready) return ready;
  ready = (async () => {
    const tf = require('@tensorflow/tfjs'), wasm = require('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths(path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist') + path.sep);
    await tf.setBackend('wasm'); await tf.ready();
    const api = require('@vladmandic/face-api/dist/face-api.node-wasm.js'), dir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
    await api.nets.ssdMobilenetv1.loadFromDisk(dir); await api.nets.faceLandmark68Net.loadFromDisk(dir); await api.nets.faceRecognitionNet.loadFromDisk(dir);
    return { tf: tf, api: api };
  })().catch(e => { ready = null; throw e; });
  return ready;
}
/* ONE PICTURE (a JPEG) → { result: 'ok' | 'noface' | 'manyfaces', descriptor (128 numbers) }.
 * One person only: a second face of real size in the picture is refused (somebody else's face held beside his own). */
async function describe(jpg) {
  const m = await load(), j = require('jpeg-js').decode(jpg, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 256, maxResolutionInMP: 12 });
  const img = m.tf.tensor3d(j.data, [j.height, j.width, 3], 'int32'); let found;
  try { found = await m.api.detectAllFaces(img, new m.api.SsdMobilenetv1Options({ minConfidence: 0.6 })).withFaceLandmarks().withFaceDescriptors(); } finally { img.dispose(); }
  const faces = (found || []).map(f => ({ area: f.detection.box.width * f.detection.box.height, descriptor: Array.from(f.descriptor) })).sort((a, b) => b.area - a.area);
  if (!faces.length) return { result: 'noface', descriptor: null };
  if (faces.length > 1 && faces[1].area > faces[0].area * 0.35) return { result: 'manyfaces', descriptor: null };
  return { result: 'ok', descriptor: faces[0].descriptor.map(v => Math.round(v * 1e5) / 1e5) };
}
module.exports = { pct, distOf, dist, nearest, minOf, MIN_DEFAULT, describe, load, HALF };
