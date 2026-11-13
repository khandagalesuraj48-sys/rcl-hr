/* HR – CTRL K (asked 13-11-2026: "ctrl k thew … all kahi hi serch krta yaw"): ONE box that finds
 *   a page of HR · an employee of this site (name, code, mobile, e-mail – the same search as the Employees page) ·
 *   a department or a designation · an action (Add employee, Import, Export, Give sign-in to all …).
 * It only opens what the person may open anyway: the pages are the ones of his menu, an action is offered only when its button
 * is on his screen, and the employees come from the server's own list (empList) with its own checks. Every text is put in as TEXT. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var F = { items: [], at: 0, seq: 0, timer: 0, people: [], q: '' };
  var ACTIONS = [['Add employee', 'employees', 'b_add', 'new person join'], ['Import Excel', 'employees', 'b_imp', 'upload sheet'], ['Export Excel', 'employees', 'b_exp', 'download sheet'], ['Give sign-in to all', 'employees', 'b_signin', 'login password']];
  var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
  var norm = function (t) { return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  // every word typed must be somewhere in the text; a text that STARTS with what was typed comes first
  function match(text, q) { var t = norm(text), w = q.split(' '); for (var i = 0; i < w.length; i++) if (t.indexOf(w[i]) === -1) return 0; return t.indexOf(q) === 0 ? 2 : 1; }
  function fixed(q) {
    var H = window.HR, out = [], rank = function (list) { return list.filter(function (x) { return x.m; }).sort(function (a, b) { return b.m - a.m; }); };
    var pg = (H && H.pages ? H.pages() : []).map(function (p) { return { kind: 'Pages', mark: '▤', title: p[1], sub: p[2] || 'HR', m: q ? match(p[1] + ' ' + p[2], q) : 1, run: function () { H.go(p[0]); } }; });
    out = out.concat(rank(pg));
    var ac = ACTIONS.filter(function (a) { var b = $(a[2]); return b && !b.hidden && (H && H.pages ? H.pages().some(function (p) { return p[0] === a[1]; }) : false); })
      .map(function (a) { return { kind: 'Actions', mark: '⚡', title: a[0], sub: 'Employees', m: q ? match(a[0] + ' ' + a[3], q) : 1, run: function () { H.go(a[1]); var b = $(a[2]); if (b && !b.hidden && !b.disabled) b.click(); } }; });
    out = out.concat(rank(ac));
    if (q && H && H.lists && H.lists()) {
      var L = H.lists(), can = function (k) { return H.pages().some(function (p) { return p[0] === k; }); };
      [['departments', 'Departments', L.departments], ['designations', 'Designations', L.designations]].forEach(function (k) {
        if (!can('departments')) return;      // (the two lists are one page)
        out = out.concat(rank((k[2] || []).map(function (x) { return { kind: k[1], mark: k[1].slice(0, 1), title: x.name, sub: x.active === false ? 'Inactive' : k[1].slice(0, -1), m: match(x.name, q), run: function () { H.go('departments'); } }; })).slice(0, 5));
      });
    }
    return out;
  }
  function draw() {
    var box = $('find_list'), last = ''; box.textContent = '';
    var q = norm($('find_q').value), items = fixed(q).concat(F.people); F.items = items; if (F.at >= items.length) F.at = 0;
    items.forEach(function (it, i) {
      if (it.kind !== last) { last = it.kind; box.appendChild(el('div', 'fd-h', it.kind)); }
      var b = el('button', 'fd-i' + (i === F.at ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', i === F.at ? 'true' : 'false');
      b.appendChild(el('i', '', it.mark)); var t = el('span'); t.appendChild(el('b', '', it.title)); if (it.sub) t.appendChild(el('small', '', it.sub)); b.appendChild(t); if (it.side) b.appendChild(el('em', '', it.side));
      b.onclick = function () { run(i); }; b.onmousemove = function () { if (F.at !== i) { F.at = i; mark(); } }; box.appendChild(b);
    });
    if (!items.length) box.appendChild(el('p', 'fd-none', q ? (F.wait ? 'Searching…' : 'Nothing found for “' + $('find_q').value.trim() + '”.') : 'Type to search.'));
  }
  function mark() { Array.prototype.forEach.call($('find_list').querySelectorAll('.fd-i'), function (b, i) { var on = i === F.at; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); if (on && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); }); }
  function run(i) { var it = F.items[i]; if (!it) return; close(); try { it.run(); } catch (e) { /* the page says what went wrong */ } }
  // the employees: asked from the server 250 ms after the last key (2 letters or more); an older answer never replaces a newer one
  function people() {
    var q = $('find_q').value.trim(), n = ++F.seq; clearTimeout(F.timer); F.people = []; F.wait = false;
    if (q.length < 2 || !window.HRAPI) return;
    F.wait = true;
    F.timer = setTimeout(function () {
      window.HRAPI('api/hr', { action: 'empList', q: q, status: '', category: '' }).then(function (r) {
        if (n !== F.seq) return; F.wait = false;
        F.people = (r.rows || []).slice(0, 8).map(function (e) { return { kind: 'Employees', mark: String(e.name || '?').slice(0, 1).toUpperCase(), title: e.name, sub: [e.code, CAT[e.category] || '', e.mobile || ''].filter(Boolean).join(' · '), side: e.status === 'left' ? 'Relieved' : '', run: function () { window.HR.emp(e.id); } }; });
        draw();
      }, function () { if (n === F.seq) { F.wait = false; draw(); } });
    }, 250);
  }
  function open() {
    if (!window.HR || !window.HR.pages || !window.HR.pages().length || !document.body.classList.contains('in')) return;
    F.back = document.activeElement; $('dlg_find').hidden = false; var q = $('find_q'); q.value = ''; F.people = []; F.at = 0; F.wait = false; draw(); q.focus();
  }
  function close() { if ($('dlg_find').hidden) return; $('dlg_find').hidden = true; F.seq++; clearTimeout(F.timer); if (F.back && F.back.focus) try { F.back.focus(); } catch (e) { /* the element is gone */ } }
  function start() {
    if (!$('dlg_find')) return;
    $('find_open').onclick = open;
    if (/Mac|iPhone|iPad/.test(navigator.platform || '')) Array.prototype.forEach.call(document.querySelectorAll('.fd-open kbd, .fd-foot span:last-child kbd'), function (k) { k.textContent = '⌘ K'; });
    $('find_q').oninput = function () { F.at = 0; people(); draw(); };
    $('dlg_find').onclick = function (ev) { if (ev.target === $('dlg_find')) close(); };
    document.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key).toLowerCase() === 'k') { ev.preventDefault(); if ($('dlg_find').hidden) open(); else close(); return; }
      if ($('dlg_find').hidden) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); close(); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); var n = F.items.length; if (n) { F.at = (F.at + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n; mark(); } }
      else if (ev.key === 'Enter') { ev.preventDefault(); run(F.at); }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.HRFIND = { open: open, close: close, _match: match, _norm: norm };
})();
