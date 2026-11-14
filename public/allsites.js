/* "ALL SITES" (asked 14-11-2026: "hr portal madhe site wise bghta yet but ek as ek option banaw ki all site saglech ekdam sagle disel";
 * and: "hr admin tithunch badal pn kru shaktil"). Chosen in the site switch on top. The page that is open – Dashboard, Employees,
 * Attendance, Muster, Leave, Requests, Approvals – is then shown for EVERY site of the person, one under the other, each under its
 * site's name. Each one IS that site's own page (the very same page, opened for that site): everything works in it as on the site
 * itself – a change is made on the site it stands under, with the role the person has THERE (the server checks it: lib/session.js
 * "as"). Only sites the Portal gave him with a role are shown. The other pages belong to one site: a site is chosen for them. */
(function () {
  'use strict';
  var PAGES = { dashboard: 1, employees: 1, attendance: 1, muster: 1, leave: 1, requests: 1, approvals: 1 };
  var ROLE = { super: 'Super Admin', admin: 'HR Admin', user: 'HR User' };
  var me = null, on = false, page = '', frames = [], timer = 0;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function sites() { return ((me && me.sites) || []).filter(function (x) { return x && x.code && x.role; }); }
  function can() { return sites().length > 1; }
  function url(code, pg) { return location.pathname + '?as=' + encodeURIComponent(code) + '#page=' + encodeURIComponent(pg); }
  function keep(v) { try { if (v) sessionStorage.setItem('rcl_hr_all', '1'); else sessionStorage.removeItem('rcl_hr_all'); } catch (e) { /* asked again next time */ } }
  function kept() { try { return sessionStorage.getItem('rcl_hr_all') === '1'; } catch (e) { return false; } }
  // each site's page is as high as what it shows (and high enough for a window that is open in it)
  function fit() {
    frames.forEach(function (f) {
      try { var d = f.el.contentDocument, m = d && d.querySelector('.mn'); if (!m) return; var open = d.querySelector('.dlg:not([hidden])'), h = Math.max(m.scrollHeight + 6, open ? 680 : 0, 140);
        if (Math.abs(h - f.h) > 2) { f.h = h; f.el.style.height = h + 'px'; }
        // where this part is on the screen: its windows and its message stand there (index.html: html.as .dlg, #toast)
        var r = f.el.getBoundingClientRect(), top = Math.max(0, HEAD - r.top), vh = Math.max(320, Math.min(window.innerHeight - Math.max(r.top, HEAD), h - top)), key = Math.round(top) + '/' + Math.round(vh);
        if (key !== f.v) { f.v = key; d.documentElement.style.setProperty('--vt', Math.round(Math.min(top, Math.max(0, h - vh))) + 'px'); d.documentElement.style.setProperty('--vh', Math.round(vh) + 'px'); }
        // a window was opened in a part that is below the screen: the part comes up
        if (open && !f.open && (r.top > window.innerHeight - 200 || r.bottom < HEAD + 200)) f.el.scrollIntoView({ block: 'start' }); f.open = !!open;
      } catch (e) { /* not there yet */ }
    });
  }
  var HEAD = 76;      // the bar on top of the page stays over what scrolls
  function draw() {
    var box = $('all_box'); if (!box) return; box.textContent = ''; frames = []; var list = sites();
    if (!PAGES[page]) { box.appendChild(el('p', 'none', 'This page belongs to one site. Choose a site on top to open it – or open Dashboard, Employees, Attendance, Muster, Leave, Requests or Approvals for all sites.')); return; }
    box.appendChild(el('p', 'all-note', 'All sites – ' + list.length + ' sites, one under the other. Each part is that site\'s own page: a change is made on the site it stands under.'));
    list.forEach(function (x) {
      var w = el('div', 'all-site'), h = el('div', 'all-h'); h.appendChild(el('b', '', x.name || x.code)); h.appendChild(el('span', '', x.code + ' · ' + (ROLE[x.role] || x.role)));
      var f = el('iframe', 'all-f'); f.title = 'HR of ' + (x.name || x.code); f.setAttribute('data-site', x.code); f.src = url(x.code, page); f.loading = 'eager';
      w.appendChild(h); w.appendChild(f); box.appendChild(w); frames.push({ el: f, code: x.code, h: 0, v: '', open: false });
    });
    fit();
  }
  window.addEventListener('scroll', function () { if (on) fit(); }, true); window.addEventListener('resize', function () { if (on) fit(); });
  function enter() { if (!can()) return; on = true; keep(true); document.body.classList.add('all'); var b = $('all_box'); if (b) b.hidden = false; draw(); clearInterval(timer); timer = setInterval(fit, 400); var s = $('site_pick'); if (s) s.value = '*'; }
  function leave() { on = false; keep(false); clearInterval(timer); timer = 0; document.body.classList.remove('all'); var b = $('all_box'); if (b) { b.hidden = true; b.textContent = ''; } frames = []; }
  window.HRALL = {
    set: function (m) { me = m; }, can: can, on: function () { return on; }, enter: enter, leave: leave, pages: PAGES,
    // the menu chose another page: every site's page goes there (no page is loaded anew when it is already open)
    page: function (pg) {
      page = pg; if (!on) return;
      if (!PAGES[pg] || !frames.length) { draw(); return; }
      frames.forEach(function (f) { try { f.el.contentWindow.location.replace(url(f.code, pg)); } catch (e) { f.el.src = url(f.code, pg); } }); fit();
    },
    // after the sign-in is read: "All sites" stays chosen through a page read again
    start: function (pg) { page = pg || page; if (!on && kept() && can()) enter(); }
  };
})();
