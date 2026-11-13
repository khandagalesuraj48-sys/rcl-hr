/* THE SIDEWAYS SCROLL BAR AT THE BOTTOM OF THE SCREEN (asked 14-11-2026: "web madhe … khali slider de roller patti ji slide krta
 * yeil" – for the wide tables). A wide table (the muster, the pay sheet, a list) has its own scroll bar at its END – far below
 * the screen when the table is long. While that end is below the screen, a bar is shown at the bottom of the screen: its handle
 * is slid (or the track pressed) and the table moves; when the table's own bar comes into sight this one goes. Drawn by the page
 * itself, so it looks the same in every browser. Nothing of the table is changed; no data is read. */
(function () {
  'use strict';
  if (window.HSB) return; window.HSB = true;
  var bar = document.createElement('div'), knob = document.createElement('div'), cur = null, due = 0, drag = null;
  bar.id = 'hsb'; bar.hidden = true; bar.setAttribute('aria-hidden', 'true'); bar.appendChild(knob); knob.id = 'hsb_knob';
  var css = document.createElement('style');
  css.textContent = '#hsb{position:fixed;bottom:0;z-index:40;height:20px;background:rgba(238,242,249,.97);border-top:1px solid #D7E0EF;box-shadow:0 -4px 12px rgba(20,30,60,.10);cursor:pointer;touch-action:none}#hsb[hidden]{display:none}' +
    '#hsb_knob{position:absolute;top:4px;height:12px;min-width:44px;border-radius:6px;background:#7F95BF;cursor:grab}#hsb_knob:hover,#hsb.on #hsb_knob{background:#4F6BA6}#hsb.on #hsb_knob{cursor:grabbing}@media print{#hsb{display:none!important}}';
  // the box a table scrolls sideways in (the table's parent, or one above it)
  function boxOf(t) { for (var e = t.parentElement, i = 0; e && i < 3 && e !== document.body; e = e.parentElement, i++) { if (e.scrollWidth > e.clientWidth + 2) { var o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') return e; } } return null; }
  function pick() {
    var h = window.innerHeight, list = document.querySelectorAll('table'), seen = [];
    for (var i = 0; i < list.length; i++) { var b = boxOf(list[i]); if (!b || seen.indexOf(b) > -1 || !b.offsetParent || b.closest('[hidden]')) continue; seen.push(b); var r = b.getBoundingClientRect(); if (r.top < h - 80 && r.bottom > h + 2 && r.width > 200) return b; }
    return null;
  }
  // the track's width, the handle's width and how far the handle can go, for the table in hand
  function size() { var w = bar.clientWidth, k = Math.max(44, Math.round(w * cur.clientWidth / cur.scrollWidth)); return { w: w, k: k, run: Math.max(1, w - k), far: Math.max(1, cur.scrollWidth - cur.clientWidth) }; }
  function sync() {
    due = 0; var b = drag ? cur : pick(); cur = b; if (!b) { bar.hidden = true; return; }
    var r = b.getBoundingClientRect(), left = Math.max(0, r.left); bar.style.left = left + 'px'; bar.style.width = Math.min(r.width, window.innerWidth - left) + 'px'; bar.hidden = false;
    var z = size(); knob.style.width = z.k + 'px'; knob.style.left = Math.round(z.run * Math.min(1, b.scrollLeft / z.far)) + 'px';
  }
  function soon() { if (!due) due = window.requestAnimationFrame ? requestAnimationFrame(sync) : setTimeout(sync, 30); }
  function to(x) { if (!cur) return; var z = size(); cur.scrollLeft = Math.round(Math.max(0, Math.min(1, x / z.run)) * z.far); soon(); }
  bar.addEventListener('pointerdown', function (e) {
    if (!cur) return; e.preventDefault(); var k = knob.getBoundingClientRect(), onKnob = e.clientX >= k.left && e.clientX <= k.right;
    drag = { off: onKnob ? e.clientX - k.left : k.width / 2 }; bar.classList.add('on'); try { bar.setPointerCapture(e.pointerId); } catch (x) { /* it still slides */ }
    to(e.clientX - bar.getBoundingClientRect().left - drag.off);
  });
  bar.addEventListener('pointermove', function (e) { if (drag) to(e.clientX - bar.getBoundingClientRect().left - drag.off); });
  function end() { drag = null; bar.classList.remove('on'); soon(); }
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  function start() {
    document.head.appendChild(css); document.body.appendChild(bar);
    window.addEventListener('scroll', soon, true); window.addEventListener('resize', soon);
    if (window.MutationObserver) new MutationObserver(function (m) { for (var i = 0; i < m.length; i++) if (m[i].target !== bar && m[i].target !== knob) return soon(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    soon();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
