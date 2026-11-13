/* HR – THE EMPLOYEE'S FULL PROFILE and the LISTS page (step 6, 12-11-2026). hr.js opens them: HRPROF.profile(id, done) and
 * HRPROF.open(page, me).
 *   Full profile – how complete it is (the ring), what compulsory detail is still missing, and its parts: Profile, Job,
 *                  Statutory & bank, Family, Education, Experience, Skills. Every form is drawn from the server's own description
 *                  of the details (defs) – nothing is fixed here.
 *   Lists        – (HR Admin / Super Admin) every pick-list: add, rename, switch off; and which details are compulsory.
 * Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var sv = function (tag, attrs) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var P = { me: null, tab: 'profile', data: null, kind: 'prefix', lists: null };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('-') : ''; };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  var nameIn = function (list, id) { var r = (list || []).filter(function (x) { return x.id === id; })[0]; return r ? r.name : ''; };
  // what a kept value reads as
  function show(d, v, lists) { if (v === undefined || v === null || v === '') return ''; return d.type === 'list' ? nameIn(lists[d.list], v) : d.type === 'yesno' ? (v ? 'Yes' : 'No') : d.type === 'date' ? dmy(v) : String(v); }
  // the box of one detail → { box (label + input), get() }
  function input(d, v, lists) {
    var w = el('div'), l = el('label', '', d.label + (d.need ? ' *' : '')), i;
    if (d.type === 'list') { i = el('select'); var o = el('option', '', '– choose –'); o.value = ''; i.appendChild(o); (lists[d.list] || []).forEach(function (x) { if (!x.active && x.id !== v) return; var p = el('option', '', x.name + (x.active ? '' : ' (switched off)')); p.value = x.id; i.appendChild(p); }); i.value = v || ''; }
    else if (d.type === 'yesno') { i = el('select'); [['', '–'], ['yes', 'Yes'], ['no', 'No']].forEach(function (k) { var p = el('option', '', k[1]); p.value = k[0]; i.appendChild(p); }); i.value = v === true ? 'yes' : v === false ? 'no' : ''; }
    else { i = el('input'); i.type = d.type === 'date' ? 'date' : d.type === 'int' || d.type === 'num' ? 'number' : d.type === 'time' ? 'time' : d.type === 'email' ? 'email' : 'text'; if (d.type === 'num') { i.min = 0; i.step = '0.01'; } if (d.max && d.type !== 'int') i.maxLength = d.type === 'digits' ? d.max + 4 : d.max; if (d.type === 'int') { i.min = d.min; i.max = d.max; } if (d.type === 'digits' || d.type === 'mobile') i.inputMode = 'numeric'; if (d.type === 'ifsc') i.style.textTransform = 'uppercase'; i.autocomplete = 'off'; i.value = v === undefined || v === null ? '' : v; }
    var id = 'pf_' + d.key + '_' + Math.random().toString(36).slice(2, 7); i.id = id; l.htmlFor = id; w.appendChild(l); w.appendChild(i);
    return { box: w, get: function () { return i.value; } };
  }
  function form(fields, values, lists) { var g = el('div', 'grid g3'), ins = {}; fields.forEach(function (d) { var x = input(d, values[d.key], lists); ins[d.key] = x; g.appendChild(x.box); }); return { grid: g, get: function () { var o = {}; Object.keys(ins).forEach(function (k) { o[k] = ins[k].get(); }); return o; } }; }
  function ring(pct) {
    var s = sv('svg', { viewBox: '0 0 64 64', 'class': 'pf-ring', role: 'img', 'aria-label': 'Profile ' + pct + '% complete' }), c = 2 * Math.PI * 27;
    s.appendChild(sv('circle', { cx: 32, cy: 32, r: 27, fill: 'none', stroke: 'rgba(255,255,255,.25)', 'stroke-width': 6 }));
    s.appendChild(sv('circle', { cx: 32, cy: 32, r: 27, fill: 'none', stroke: '#FFC93C', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': (c * pct / 100).toFixed(1) + ' ' + c.toFixed(1), transform: 'rotate(-90 32 32)' }));
    var t = sv('text', { x: 32, y: 37, 'text-anchor': 'middle', fill: '#fff', 'font-size': 15, 'font-weight': 800 }); t.textContent = pct + '%'; s.appendChild(t); return s;
  }

  /* (13-11-2026, asked: "save mhanle ki ek pop up yewa confirmation cha ani lagech save pn hoyla pahije") A SAVE IS SEEN AT ONCE:
   * the button says "Saving…" the moment it is pressed (and cannot be pressed twice); when the server has saved, a window in the
   * middle says so – it goes by itself, or with OK / Esc / Enter. An error stays on the page as before, nothing is said saved. */
  function saved(title, sub) {
    var old = document.getElementById('pf_saved'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var d = el('div', 'dlg sv-dlg'), s = el('div', 'sheet sv-box'), ok = btn('pri', 'OK', function () { close(); }); d.id = 'pf_saved'; s.setAttribute('role', 'alertdialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-label', title);
    var t = setTimeout(function () { close(); }, 1800), key = function (ev) { if (ev.key === 'Escape' || ev.key === 'Enter') { ev.preventDefault(); ev.stopImmediatePropagation(); close(); } };
    function close() { clearTimeout(t); document.removeEventListener('keydown', key, true); if (d.parentNode) d.parentNode.removeChild(d); }
    var m = el('div', 'sv-ok', '✓'); m.setAttribute('aria-hidden', 'true'); s.appendChild(m); s.appendChild(el('h2', '', title)); if (sub) s.appendChild(el('p', 'sub', sub)); s.appendChild(ok); d.appendChild(s); d.onclick = function (ev) { if (ev.target === d) close(); };
    document.addEventListener('keydown', key, true); document.body.appendChild(d); ok.focus();
  }
  // a button that saves: "Saving…" at once, itself again when the answer is there
  function saving(b, run) { var was = b.textContent; b.disabled = true; b.textContent = 'Saving…'; var back = function () { b.disabled = false; b.textContent = was; }; run(back); }

  /* ───────────── one employee's full profile ───────────── */
  /* (13-11-2026, "ekach screen madhe sagle") `into` = the employee's own page takes the profile: { tabs, body, show(on), data(r), tab } –
   * its tabs are drawn there after "Overview", no window is opened; without `into` it is the window of before. */
  function profile(id, done, into) {
    var d = null, s, close = function () {};
    if (into) { s = into.body; s.textContent = ''; into.tabs.textContent = ''; P.tab = into.tab || 'overview'; into.show(P.tab === 'overview'); }
    else {
      d = el('div', 'dlg'); s = el('div', 'sheet wide pf'); s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); d.appendChild(s); document.body.appendChild(d);
      var key = function (ev) { if (ev.key === 'Escape') close(); }; close = function () { document.removeEventListener('keydown', key); if (d.parentNode) d.parentNode.removeChild(d); if (done) done(); };
      document.addEventListener('keydown', key); s.appendChild(el('p', 'none', 'Opening… · उघडत आहे…'));
    }
    var draw = function (r) {
      P.data = r; s.textContent = ''; var e = r.employee, L = r.lists;
      if (into && into.live && !into.live()) return;      // he opened another person meanwhile
      if (into) into.data(r); else {
      var hd = el('div', 'ep-head'), fc = el('span', 'dz-av ep-face', e.name.trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase()), tt = el('div'); tt.appendChild(el('h2', '', e.name)); tt.appendChild(el('p', 'sub', e.code + ' · full profile')); hd.appendChild(fc); hd.appendChild(tt);
        var rg = el('div', 'pf-pct'); rg.appendChild(ring(r.complete.pct)); rg.appendChild(el('small', '', r.complete.filled + ' of ' + r.complete.of + ' details')); hd.appendChild(rg); s.appendChild(hd);
        if (r.complete.missing.length) s.appendChild(el('p', 'warn', 'Compulsory, still missing: ' + r.complete.missing.join(', ') + '.'));
      }
      var tabs = into ? into.tabs : el('div', 'pf-tabs'), body = el('div'), er = el('p', 'err'); er.hidden = true; er.setAttribute('role', 'alert'); if (into) tabs.textContent = '';
      var err = function (x) { er.textContent = x ? (x.message || String(x)) : ''; er.hidden = !x; };
      var all = r.defs.groups.map(function (g) { return { key: g.key, name: g.name, group: g }; }).concat(r.defs.rows.map(function (w) { return { key: w.key, name: w.name + (r.rows[w.key].length ? ' · ' + r.rows[w.key].length : ''), rows: w }; }));
      if (into) all.unshift({ key: 'overview', name: 'Overview' });
      if (!all.some(function (t) { return t.key === P.tab; })) P.tab = all[0].key;
      // how many compulsory details of a tab are still missing (the names the server gave)
      var miss = r.complete.missing || [], left0 = function (t) { return t.group ? t.group.fields.filter(function (f) { return miss.indexOf(f.label) > -1; }).length : t.rows ? (miss.some(function (m) { return m.indexOf(t.rows.name) === 0; }) ? 1 : 0) : 0; };
      all.forEach(function (t) { var b = btn((into ? '' : 'tab') + (P.tab === t.key ? ' on' : ''), t.name, function () { P.tab = t.key; draw(P.data); }); if (into) { var n = left0(t); if (n) { var m = el('em', '', n); m.title = n + ' compulsory still missing'; b.appendChild(m); } b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', P.tab === t.key ? 'true' : 'false'); } tabs.appendChild(b); });
      if (into) { into.show(P.tab === 'overview'); s.appendChild(body); s.appendChild(er); if (P.tab === 'overview') return; } else { s.appendChild(tabs); s.appendChild(body); s.appendChild(er); }
      var cur = all.filter(function (t) { return t.key === P.tab; })[0], left = e.status === 'left';
      if (cur.group) {
        var vals = cur.key === 'secret' || cur.group.in === 'secret' ? r.secret : r.data, f = form(cur.group.fields, vals, L); body.appendChild(f.grid);
        if (cur.key === 'secret') body.appendChild(el('p', 'muted', r.masked ? 'The numbers are shown masked to you. A box you leave as it is keeps its number.' : 'These numbers are never in a list or an export.'));
        var a = el('div', 'acts'); if (!left) { var sb = btn('pri', 'Save ' + cur.name, function () { err(null); saving(sb, function (back) { api('profSave', { id: e.id, group: cur.key, data: f.get() }).then(function (n) { draw(n); saved('Saved', cur.name + ' of ' + e.name + ' (' + e.code + ')'); }, function (x) { back(); err(x); }); }); }); a.appendChild(sb); } if (!into) a.appendChild(btn('sec', 'Close', close)); body.appendChild(a);
      } else {
        var w = cur.rows, list = el('div', 'pf-rows'), edit = el('div');
        var open = function (row) {
          edit.textContent = ''; var f2 = form(w.fields, row ? row.data : {}, L), a2 = el('div', 'acts'); edit.appendChild(el('label', '', row ? 'Change this ' + w.one : 'Add a ' + w.one)); edit.appendChild(f2.grid);
          var rb = btn('pri', 'Save', function () { err(null); saving(rb, function (back) { api('profRowSave', { id: e.id, kind: w.key, row: row ? row.id : '', data: f2.get() }).then(function (n) { draw(n); saved('Saved', w.name + ' of ' + e.name + ' (' + e.code + ')'); }, function (x) { back(); err(x); }); }); }); a2.appendChild(rb); a2.appendChild(btn('sec', 'Cancel', function () { edit.textContent = ''; err(null); })); edit.appendChild(a2);
        };
        r.rows[w.key].forEach(function (row) {
          var c = el('div', 'pf-row'), t = el('div'), main = w.fields[0], rest = w.fields.slice(1).map(function (dd) { var v = show(dd, row.data[dd.key], L); return v ? dd.label + ': ' + v : ''; }).filter(Boolean);
          t.appendChild(el('b', '', show(main, row.data[main.key], L) || '–')); t.appendChild(el('small', '', rest.join(' · ') || '–')); c.appendChild(t);
          if (!left) {
            c.appendChild(btn('sm ghost', 'Change', function () { open(row); }));
            var why = el('input'); why.type = 'text'; why.maxLength = 200; why.placeholder = 'Why it is removed'; why.setAttribute('aria-label', 'Why it is removed'); why.hidden = true; c.appendChild(why);
            c.appendChild(btn('sm ghost', 'Remove', function () { if (why.hidden) { why.hidden = false; why.focus(); return; } api('profRowRemove', { row: row.id, reason: why.value }).then(function (n) { toast('Removed.'); draw(n); }, err); }));
          }
          list.appendChild(c);
        });
        if (!r.rows[w.key].length) list.appendChild(el('p', 'none', 'Nothing here yet.'));
        body.appendChild(list); body.appendChild(edit);
        var a3 = el('div', 'acts'); if (!left) a3.appendChild(btn('pri', '+ Add ' + w.one, function () { open(null); })); if (!into) a3.appendChild(btn('sec', 'Close', close)); body.appendChild(a3);
      }
    };
    api('profGet', { id: id }).then(draw, function (x) { if (into) { if (into.fail) into.fail(x); return; } s.textContent = ''; s.appendChild(el('p', 'err', x.message)); var a = el('div', 'acts'); a.appendChild(btn('sec', 'Close', close)); s.appendChild(a); });
    return { open: function (tab) { if (P.data && (!into || !into.live || into.live())) { P.tab = tab; draw(P.data); } } };
  }

  /* ───────────── the Lists page ───────────── */
  function lists() {
    var root = $('p_prof'); root.textContent = '';
    api('listAll').then(function (r) {
      P.lists = r; root.textContent = ''; var wrap = el('div', 'pf-two'), c1 = el('div', 'dz-card'), c2 = el('div', 'dz-card');
      c1.appendChild(el('h3', '', 'The lists of the profile · याद्या')); var sel = el('select', 'dz-pill'); sel.setAttribute('aria-label', 'List'); r.kinds.forEach(function (k) { var o = el('option', '', k.name + ' (' + r.lists[k.key].length + ')'); o.value = k.key; sel.appendChild(o); }); sel.value = P.kind; sel.onchange = function () { P.kind = sel.value; lists(); }; c1.appendChild(sel);
      var ul = el('ul', 'mrows'); ul.style.marginTop = '10px';
      r.lists[P.kind].forEach(function (x) {
        var li = el('li', x.active ? '' : 'off'), i = el('input'); i.value = x.name; i.maxLength = 60; i.setAttribute('aria-label', 'Name'); i.disabled = !r.can; li.appendChild(i);
        if (r.can) { li.appendChild(btn('sm', 'Save', function () { api('listSave', { kind: P.kind, id: x.id, name: i.value, active: x.active, sort: x.sort }).then(function () { toast('Saved.'); lists(); }, fail); })); li.appendChild(btn('sm ghost', x.active ? 'Switch off' : 'Switch on', function () { api('listSave', { kind: P.kind, id: x.id, name: x.name, active: !x.active, sort: x.sort }).then(function () { lists(); }, fail); })); }
        if (!x.active) li.appendChild(el('span', 'muted', 'off – not offered any more; it stays where it was chosen')); ul.appendChild(li);
      });
      if (!r.lists[P.kind].length) ul.appendChild(el('li', 'off', 'Nothing in this list yet.')); c1.appendChild(ul);
      if (r.can) { var t = el('div', 'tools'), ni = el('input'); ni.maxLength = 60; ni.placeholder = 'New value – its name'; ni.setAttribute('aria-label', 'New value'); t.style.marginTop = '10px'; var add = function () { api('listSave', { kind: P.kind, name: ni.value }).then(function () { toast('Added.'); lists(); }, fail); }; ni.onkeydown = function (ev) { if (ev.key === 'Enter') add(); }; t.appendChild(ni); t.appendChild(btn('pri', '+ Add', add)); c1.appendChild(t); }
      c2.appendChild(el('h3', '', 'Compulsory for "profile complete" · आवश्यक माहिती')); c2.appendChild(el('p', 'muted', 'Tick the details every employee of this site must have. A missing one is shown on his profile. Nothing is blocked by it.'));
      var boxes = [], grp = ''; r.items.forEach(function (it) { if (it.group !== grp) { grp = it.group; c2.appendChild(el('label', 'pf-g', grp)); } var l = el('label', 'ck'), c = el('input'); c.type = 'checkbox'; c.checked = r.required.indexOf(it.key) > -1; c.disabled = !r.can; c.value = it.key; boxes.push(c); l.appendChild(c); l.appendChild(document.createTextNode(' ' + it.label)); c2.appendChild(l); });
      if (r.can) { var a = el('div', 'acts'); a.style.justifyContent = 'flex-start'; a.appendChild(btn('pri', 'Save what is compulsory', function () { api('profRequiredSave', { keys: boxes.filter(function (c) { return c.checked; }).map(function (c) { return c.value; }) }).then(function () { toast('Saved.'); lists(); }, fail); })); c2.appendChild(a); }
      wrap.appendChild(c1); wrap.appendChild(c2); root.appendChild(wrap);
    }, function (e) { root.textContent = ''; root.appendChild(el('p', 'none', e && e.message ? e.message : 'HR did not answer – try again.')); });
  }

  window.HRPROF = {
    pages: [['lists', 'Lists']],
    has: function (page) { return page === 'lists'; },
    open: function (page, me) { P.me = me; lists(); },
    profile: profile, ring: ring, saved: saved, saving: saving, _show: show
  };
})();
