/* HR – ATTENDANCE, the HR office's pages (step 4, 12-11-2026): Attendance (the day's punches, the doubtful ones), Work places
 * (the geofences: where, how many metres, for whom – one by one or many at once) and Phones (which phone is tied to whom).
 * hr.js opens them: HRATT.open(page, me, init). Every text of a person is put in as TEXT, never as HTML.
 * The map is Leaflet (BSD licence, public/vendor/leaflet) with the map pictures of OpenStreetMap. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var A = { me: null, init: null, page: 'attendance', data: null, sel: {}, proj: '', day: '', review: false, map: null, draw: null, edit: null, people: [] };
  var PAGES = [['attendance', 'Attendance'], ['places', 'Work places'], ['phones', 'Phones']];
  var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
  var isAdmin = function () { return A.me && (A.me.user.role === 'admin' || A.me.user.role === 'super'); };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('-') : ''; };
  var stamp = function (iso) { var t = Date.parse(iso); return isNaN(t) ? '' : dmy(new Date(t + 19800000).toISOString()) + ' ' + new Date(t + 19800000).toISOString().slice(11, 16); };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }
  function err(id, e) { var b = $(id); b.textContent = e ? (e.message || String(e)) : ''; b.hidden = !e; }
  function show(id) { $(id).hidden = false; } function hide(id) { $(id).hidden = true; }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function opt(sel, value, text, on) { var o = el('option', '', text); o.value = value; if (on) o.selected = true; sel.appendChild(o); return o; }
  function table(heads) { var box = el('div', 'box'), t = el('table'), h = el('thead'), r = el('tr'); heads.forEach(function (x) { r.appendChild(typeof x === 'string' ? el('th', '', x) : x); }); h.appendChild(r); t.appendChild(h); var b = el('tbody'); t.appendChild(b); box.appendChild(t); return { box: box, body: b }; }
  function face(td, key) { if (window.HRDASH && window.HRDASH.face) td.insertBefore(window.HRDASH.face(td.textContent, key), td.firstChild); return td; }      // the letters of his name before it
  var nameOf = function (list, id) { var r = (list || []).filter(function (x) { return x.id === id; })[0]; return r ? r.name : ''; };
  function whom(p) {
    if (p.scope === 'all') return 'Everybody of the site';
    if (p.scope === 'category') return (p.scope_values || []).map(function (c) { return CAT[c] || c; }).join(', ');
    if (p.scope === 'department') return (p.scope_values || []).map(function (d) { return nameOf(A.init.departments, d) || '?'; }).join(', ');
    return (p.people || []).length + ' chosen people';
  }
  var size = function (p) { return p.shape === 'circle' ? p.radius_m + ' m around a point' : p.shape === 'corridor' ? p.radius_m + ' m each side of the road' : 'Area drawn on the map'; };

  /* ───────────── Attendance: the day ───────────── */
  function attendance() {
    var root = $('p_att'); root.textContent = '';
    var tools = el('div', 'tools'), day = el('input'); day.type = 'date'; day.value = A.day; day.setAttribute('aria-label', 'Day'); day.style.flex = '0 0 170px'; day.onchange = function () { A.day = day.value; A.review = false; attendance(); };
    tools.appendChild(day); tools.appendChild(btn(A.review ? 'sec' : 'pri', 'The day', function () { A.review = false; attendance(); })); var rb = btn(A.review ? 'pri' : 'sec', 'To be looked at', function () { A.review = true; attendance(); }); tools.appendChild(rb); root.appendChild(tools);
    var note = el('p', 'muted', A.review ? 'Punches sent later (no network) whose clock or order was doubtful. Accept = it counts; Refuse = it does not. The punch itself is never changed.' : 'Every punch of the day, as it was taken: inside the work place, with a photo as proof. Nothing here can be changed.'); note.style.margin = '0 0 10px'; root.appendChild(note);
    api('punchDay', A.review ? { review: 1 } : { day: A.day }).then(function (r) {
      var t = table(['Code', 'Name', A.review ? 'Day' : 'Category', 'IN / OUT', 'Time', 'Work place', 'How', 'Photo', '']);
      var shown = 0;      // the first 30 photos are fetched at once, the rest when pressed
      r.punches.forEach(function (p) {
        var tr = el('tr'); tr.style.cursor = 'default'; tr.appendChild(el('td', '', p.code)); tr.appendChild(face(el('td', 'nm', p.name), p.code)); tr.appendChild(el('td', '', A.review ? dmy(p.day) : CAT[p.category] || ''));
        var k = el('td'); k.appendChild(el('span', 'st ' + (p.kind === 'in' ? 's-active' : 's-left'), p.kind === 'in' ? 'IN' : 'OUT')); tr.appendChild(k); tr.appendChild(el('td', '', p.time)); tr.appendChild(el('td', '', p.place));
        var how = el('td'); how.style.whiteSpace = 'normal'; how.appendChild(el('span', 'st ' + (p.status === 'review' ? 's-incomplete' : p.offline ? 's-pending' : 's-active'), p.status === 'review' ? (p.decided ? (p.decided.decision === 'accepted' ? 'Accepted' : 'Refused') : 'To be looked at') : p.offline ? 'Sent later' : 'On the spot'));
        if (p.why && p.why.length) how.appendChild(el('div', 'muted', p.why.join('; ') + (p.decided ? ' — ' + p.decided.by + (p.decided.note ? ': ' + p.decided.note : '') : ''))); tr.appendChild(how);
        var ph = el('td'), see = function () { api('punchSelfie', { id: p.id }).then(function (x) { $('ph_img').src = x.url; $('ph_title').textContent = p.name + ' – ' + (p.kind === 'in' ? 'IN' : 'OUT') + ' ' + p.time; show('dlg_photo'); }, fail); };
        if (window.HRDASH && window.HRDASH.thumb) ph.appendChild(window.HRDASH.thumb(p.id, p.name + ' – ' + (p.kind === 'in' ? 'IN' : 'OUT') + ' ' + p.time, shown++ < 30)); else ph.appendChild(btn('sm ghost', 'See', see)); tr.appendChild(ph);
        var act = el('td'); if (A.review && isAdmin()) { act.appendChild(btn('sm', 'Accept', function () { decide(p, 'accepted'); })); var no = btn('sm ghost', 'Refuse', function () { decide(p, 'refused'); }); no.style.marginLeft = '6px'; act.appendChild(no); } tr.appendChild(act);
        t.body.appendChild(tr);
      });
      if (!r.punches.length) t.box.appendChild(el('p', 'none', A.review ? 'Nothing is waiting.' : 'No punch on ' + dmy(r.day) + ' yet.'));
      root.appendChild(t.box);
    }, fail);
  }
  function decide(p, what) {
    $('dc_title').textContent = (what === 'accepted' ? 'Accept' : 'Refuse') + ': ' + p.name + ' – ' + (p.kind === 'in' ? 'IN' : 'OUT') + ' ' + dmy(p.day) + ' ' + p.time; $('dc_note').value = ''; err('dc_err', null);
    $('dc_lab').textContent = what === 'accepted' ? 'Note (if any)' : 'Reason *'; $('dc_save').textContent = what === 'accepted' ? 'Accept' : 'Refuse'; $('dc_save').className = what === 'accepted' ? 'pri' : 'danger';
    $('dc_save').onclick = function () { api('punchReview', { id: p.id, decision: what, note: $('dc_note').value }).then(function () { hide('dlg_decide'); toast(what === 'accepted' ? 'Accepted.' : 'Refused.'); attendance(); }, function (e) { err('dc_err', e); }); };
    show('dlg_decide'); $('dc_note').focus();
  }

  /* ───────────── Work places ───────────── */
  function places() {
    if (A.pview && A.pview !== 'list') { api('placeMap').then(function (r) { A.who = r; drawMap(); }, fail); return; }
    api('placeList').then(function (r) { A.data = r; drawPlaces(); }, fail);
  }
  /* (13-11-2026, his words: "konta user konte location war sign in kartoy … konte location sathi konte user aahet … ek employee
   * aso ki bulk employee") THREE VIEWS of the page: the work places themselves (as it was) · by place – who is there · by person
   * – where each one may mark and where he marked last, with many people added to / taken from a place at once. */
  function viewBar(root) {
    var bar = el('div', 'tools'); bar.id = 'pv_bar';
    [['list', 'Work places'], ['place', 'By place – who is there'], ['person', 'By person – who marks where']].forEach(function (v) {
      var b = btn((A.pview || 'list') === v[0] ? 'pri' : 'sec', v[1], function () { A.pview = v[0]; A.ask = null; places(); }); b.id = 'pv_' + v[0]; bar.appendChild(b); });
    root.appendChild(bar);
  }
  function whomMap(p) {
    if (p.scope === 'all') return 'Everybody of the site';
    if (p.scope === 'category') return p.scope_values.map(function (c) { return CAT[c] || c; }).join(', ');
    if (p.scope === 'department') return p.scope_values.map(function (d) { return nameOf(A.init.departments, d) || '?'; }).join(', ');
    return 'Chosen people';
  }
  function redTag(text) { var x = el('span', 'st', text); x.style.background = '#FFE6E3'; x.style.color = '#C22A1B'; return x; }
  function lastText(e, d) {
    var l = e.last; if (!l) return '–';
    return (nameOf(d.places, l.place_id) || 'a place') + ' · ' + (l.day === d.today ? 'today' : dmy(l.day)) + ' ' + l.time + ' ' + (l.kind === 'in' ? 'IN' : 'OUT');
  }
  function sendPeople(body) {
    api('placePeople', body).then(function (r) { A.who = r; A.psel = {}; A.ask = null; toast('Done – ' + r.people_now + ' people are at this work place now.'); drawMap(); },
      function (e) { if (e && e.code === 'scope' && !body.convert) { A.ask = { text: e.message, body: Object.assign({}, body, { convert: true }) }; drawMap(); } else fail(e); });
  }
  function drawMap() {
    var root = $('p_att'), d = A.who; root.textContent = ''; viewBar(root); A.psel = A.psel || {}; A.open = A.open || {};
    if (A.ask) {      // a place for everybody / categories / departments: said plainly before it is changed
      var w = el('div', 'box'); w.id = 'pm_ask'; w.style.padding = '14px 16px'; w.style.marginBottom = '12px'; w.style.borderColor = '#F0C36A'; w.style.background = '#FFF8E6';
      w.appendChild(el('p', '', A.ask.text)); var wb = el('div', 'tools'); wb.style.margin = '10px 0 0';
      wb.appendChild(btn('pri', 'Yes – make it "Chosen people"', function () { sendPeople(A.ask.body); })); wb.appendChild(btn('sec', 'No', function () { A.ask = null; drawMap(); })); w.appendChild(wb); root.appendChild(w);
    }
    if (A.pview === 'place') {
      if (!d.places.length) { var n0 = el('div', 'box'); n0.appendChild(el('p', 'none', 'No work place yet – add the first one under "Work places".')); root.appendChild(n0); return; }
      d.places.forEach(function (p) {
        var who = d.people.filter(function (e) { return e.places.indexOf(p.id) > -1; }), card = el('div', 'box'); card.className = 'box pm-card'; card.style.padding = '14px 16px'; card.style.marginBottom = '12px';
        var top = el('div', ''); top.style.display = 'flex'; top.style.alignItems = 'center'; top.style.gap = '12px';
        var left = el('div', ''); left.style.flex = '1'; var nm = el('div', '', p.name); nm.style.fontWeight = '700'; nm.style.fontSize = '16px'; left.appendChild(nm); left.appendChild(el('div', 'muted', 'For: ' + whomMap(p) + (p.on ? '' : ' · Off – nobody can mark here now')));
        var num = el('div', ''); num.style.textAlign = 'right'; var b = el('b', '', String(who.length)); b.style.fontSize = '24px'; if (!who.length) b.style.color = '#C22A1B'; num.appendChild(b); num.appendChild(el('div', 'muted', who.length === 1 ? 'person' : 'people'));
        top.appendChild(left); top.appendChild(num); card.appendChild(top);
        var list = el('div', ''); list.style.margin = '10px 0 0';
        if (!who.length) { list.appendChild(redTag(p.on ? 'Nobody yet – nobody can mark here' : 'Nobody')); }
        (A.open[p.id] ? who : who.slice(0, 10)).forEach(function (e) { var t = el('span', 'tag', e.name + ' (' + e.code + ')'); t.style.paddingRight = '12px'; list.appendChild(t); });
        if (who.length > 10) list.appendChild(btn('sec', A.open[p.id] ? 'Show fewer' : '+ ' + (who.length - 10) + ' more', function () { A.open[p.id] = !A.open[p.id]; drawMap(); }));
        card.appendChild(list);
        if (isAdmin()) { var tb = el('div', 'tools'); tb.style.margin = '12px 0 0'; tb.appendChild(btn('pri', '+ Add people', function () { A.pview = 'person'; A.target = p.id; A.pnone = false; drawMap(); })); card.appendChild(tb); }
        root.appendChild(card);
      });
      return;
    }
    // ---- by person
    var tools = el('div', 'tools'), q = el('input'); q.id = 'pm_q'; q.placeholder = 'Search name or code'; q.setAttribute('aria-label', 'Search'); q.value = A.pq || ''; q.style.flex = '1';
    q.oninput = function () { A.pq = q.value; clearTimeout(drawMap.t); drawMap.t = setTimeout(function () { drawMap(); var n = document.getElementById('pm_q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); };
    var cat = el('select'); cat.setAttribute('aria-label', 'Category'); opt(cat, '', 'All categories', !A.pcat); Object.keys(CAT).forEach(function (k) { opt(cat, k, CAT[k], A.pcat === k); }); cat.onchange = function () { A.pcat = cat.value; drawMap(); };
    var nl = el('label', ''); nl.style.display = 'inline-flex'; nl.style.alignItems = 'center'; nl.style.gap = '8px'; nl.style.fontSize = '14px'; nl.style.cursor = 'pointer'; var nc = el('input'); nc.type = 'checkbox'; nc.id = 'pm_none'; nc.style.width = '18px'; nc.style.height = '18px'; nc.style.padding = '0'; nc.style.boxShadow = 'none'; nc.style.flex = 'none'; nc.style.minWidth = '0'; nc.style.margin = '0'; nl.style.whiteSpace = 'nowrap'; nc.checked = !!A.pnone; nc.onchange = function () { A.pnone = nc.checked; drawMap(); }; nl.appendChild(nc); nl.appendChild(document.createTextNode('Without a place only'));
    tools.appendChild(q); tools.appendChild(cat); tools.appendChild(nl); root.appendChild(tools);
    var find = (A.pq || '').trim().toLowerCase(), rows = d.people.filter(function (e) { return (!find || (e.name + ' ' + e.code).toLowerCase().indexOf(find) > -1) && (!A.pcat || e.category === A.pcat) && (!A.pnone || !e.places.length); });
    var ids = Object.keys(A.psel).filter(function (k) { return A.psel[k] && d.people.some(function (e) { return e.id === k; }); });
    if (isAdmin()) {
      // many at once: tick them (or paste their codes – a column of Excel), choose the place, add or take
      var bar = el('div', 'tools'); bar.id = 'pm_bulk'; var cnt = el('b', '', ids.length + ' chosen'); cnt.style.alignSelf = 'center'; bar.appendChild(cnt);
      var codes = el('input'); codes.id = 'pm_codes'; codes.placeholder = 'Paste codes (from Excel) to tick them'; codes.setAttribute('aria-label', 'Paste employee codes'); codes.style.flex = '1';
      bar.appendChild(codes); bar.appendChild(btn('sec', 'Tick these', function () { var want = codes.value.split(/[\s,;]+/).map(function (c) { return c.trim().toLowerCase(); }).filter(Boolean), hit = 0; d.people.forEach(function (e) { if (want.indexOf(String(e.code).toLowerCase()) > -1) { A.psel[e.id] = true; hit++; } }); toast(hit + ' of ' + want.length + ' codes found and ticked.', hit < want.length); drawMap(); }));
      var ps = el('select'); ps.id = 'pm_place'; ps.setAttribute('aria-label', 'Work place'); opt(ps, '', 'Choose a work place…', !A.target); d.places.forEach(function (p) { opt(ps, p.id, p.name + (p.on ? '' : ' (off)'), A.target === p.id); }); ps.onchange = function () { A.target = ps.value; };
      bar.appendChild(ps);
      var go = function (key) { return function () { if (!ids.length) return toast('Tick at least one employee first.', true); if (!A.target) return toast('Choose the work place first.', true); var b = { place_id: A.target }; b[key] = ids; sendPeople(b); }; };
      var ba = btn('pri', 'Add to this place', go('add')); ba.id = 'pm_add'; var br = btn('sec', 'Take from this place', go('remove')); br.id = 'pm_take'; bar.appendChild(ba); bar.appendChild(br); root.appendChild(bar);
    }
    var all = el('th'), ca = el('input'); ca.type = 'checkbox'; ca.setAttribute('aria-label', 'Choose all shown'); ca.checked = rows.length > 0 && rows.every(function (e) { return A.psel[e.id]; }); ca.onchange = function () { rows.forEach(function (e) { A.psel[e.id] = ca.checked; }); drawMap(); }; all.appendChild(ca);
    var t = table((isAdmin() ? [all] : []).concat(['Employee', 'Category', 'Can mark at', 'Last marked at']));
    rows.forEach(function (e) {
      var tr = el('tr'); tr.style.cursor = 'default';
      if (isAdmin()) { var c = el('td'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!A.psel[e.id]; cb.setAttribute('aria-label', 'Choose ' + e.name); cb.onchange = function () { A.psel[e.id] = cb.checked; drawMap(); }; c.appendChild(cb); tr.appendChild(c); }
      tr.appendChild(face(el('td', 'nm', e.name + ' · ' + e.code), e.code)); tr.appendChild(el('td', '', CAT[e.category] || ''));
      var at = el('td'); at.style.whiteSpace = 'normal';
      if (!e.places.length) at.appendChild(redTag('No place – cannot mark'));
      e.places.forEach(function (pid) { var sp = el('span', 'st s-active', nameOf(d.places, pid)); sp.style.marginRight = '6px'; sp.style.display = 'inline-block'; sp.style.marginBottom = '3px'; at.appendChild(sp); });
      tr.appendChild(at); tr.appendChild(el('td', 'muted', lastText(e, d))); t.body.appendChild(tr);
    });
    if (!rows.length) t.box.appendChild(el('p', 'none', d.people.length ? 'Nobody matches.' : 'No employee on this site yet.'));
    root.appendChild(t.box);
    var nonePlace = d.people.filter(function (e) { return !e.places.length; }).length;
    root.appendChild(el('p', 'muted', nonePlace ? nonePlace + ' of ' + d.people.length + ' employees have no work place – they cannot mark attendance.' : 'Every employee has a work place.'));
  }
  function drawPlaces() {
    var root = $('p_att'), d = A.data; root.textContent = ''; viewBar(root); var ids = Object.keys(A.sel).filter(function (k) { return A.sel[k] && d.places.some(function (p) { return p.id === k; }); });
    var tools = el('div', 'tools'), pf = el('select'); pf.setAttribute('aria-label', 'Project'); opt(pf, '', 'All projects', !A.proj); d.projects.forEach(function (p) { opt(pf, p.id, p.name + (p.active ? '' : ' (off)'), A.proj === p.id); }); pf.onchange = function () { A.proj = pf.value; drawPlaces(); }; tools.appendChild(pf);
    var gap = el('span'); gap.style.flex = '1'; tools.appendChild(gap);
    if (isAdmin()) {
      if (ids.length) tools.appendChild(btn('pri', 'Change the ' + ids.length + ' chosen…', function () { bulk(ids); }));
      tools.appendChild(btn('sec', 'Projects', projects)); tools.appendChild(btn('sec', 'Add many (a list)', many)); tools.appendChild(btn('pri', '+ Add work place', function () { place(null); }));
    }
    root.appendChild(tools);
    var rows = d.places.filter(function (p) { return !A.proj || p.project_id === A.proj; });
    var all = el('th'), ca = el('input'); ca.type = 'checkbox'; ca.setAttribute('aria-label', 'Choose all'); ca.checked = rows.length > 0 && rows.every(function (p) { return A.sel[p.id]; }); ca.onchange = function () { rows.forEach(function (p) { A.sel[p.id] = ca.checked; }); drawPlaces(); }; all.appendChild(ca);
    var t = table((isAdmin() ? [all] : []).concat(['Work place', 'Kind', 'Project', 'How big', 'For whom', 'From', 'Status']));
    rows.forEach(function (p) {
      var tr = el('tr'); tr.tabIndex = 0;
      if (isAdmin()) { var c = el('td'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!A.sel[p.id]; cb.setAttribute('aria-label', 'Choose ' + p.name); cb.onclick = function (ev) { ev.stopPropagation(); }; cb.onchange = function () { A.sel[p.id] = cb.checked; drawPlaces(); }; c.appendChild(cb); c.onclick = function (ev) { ev.stopPropagation(); }; tr.appendChild(c); }
      tr.appendChild(el('td', 'nm', p.name)); tr.appendChild(el('td', '', nameOf(d.kinds.map(function (k) { return { id: k.key, name: k.name }; }), p.kind))); tr.appendChild(el('td', '', nameOf(d.projects, p.project_id)));
      tr.appendChild(el('td', '', size(p))); var w = el('td', '', whom(p)); w.style.whiteSpace = 'normal'; tr.appendChild(w); tr.appendChild(el('td', '', dmy(p.valid_from)));
      var s = el('td'); s.appendChild(el('span', 'st ' + (p.active ? 's-active' : 's-left'), p.active ? 'On' : 'Off')); tr.appendChild(s);
      tr.onclick = function () { place(p); }; tr.onkeydown = function (ev) { if (ev.key === 'Enter') place(p); }; t.body.appendChild(tr);
    });
    if (!rows.length) t.box.appendChild(el('p', 'none', 'No work place yet. Attendance can be marked only inside a work place – add the first one.'));
    root.appendChild(t.box);
  }
  // ---- the map of one work place ----
  function mapStart(p) {
    if (A.map) { A.map.remove(); A.map = null; }
    var L = window.L, box = $('wp_map'); if (!L) { box.textContent = 'The map did not load – type the latitude and longitude.'; return; }
    var m = A.map = L.map(box, { zoomControl: true, attributionControl: true }); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    A.draw = L.layerGroup().addTo(m); var others = L.layerGroup().addTo(m), pts = [];
    (A.data.places || []).forEach(function (o) { if (p && o.id === p.id) return; var g = shapeOf(o, { color: '#8A94A8', weight: 1, fillOpacity: 0.08 }); if (g) { g.addTo(others); g.bindTooltip(o.name); (o.shape === 'circle' ? [[o.lat, o.lng]] : o.points).forEach(function (q) { pts.push(q); }); } });
    var own = p ? (p.shape === 'circle' ? [[p.lat, p.lng]] : p.points) : [];
    if (own.length) m.fitBounds(L.latLngBounds(own).pad(0.6), { maxZoom: 17 }); else if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 15 }); else m.setView([20.6, 78.9], 5);
    m.on('click', function (ev) { if (!isAdmin()) return; var la = Math.round(ev.latlng.lat * 1e6) / 1e6, lo = Math.round(ev.latlng.lng * 1e6) / 1e6; if ($('wp_shape').value === 'circle') { $('wp_lat').value = la; $('wp_lng').value = lo; } else { A.edit.points.push([la, lo]); } redraw(); });
    setTimeout(function () { m.invalidateSize(); redraw(); }, 60);
  }
  function shapeOf(o, style) {
    var L = window.L;
    if (o.shape === 'circle') return isFinite(o.lat) && isFinite(o.lng) && o.radius_m > 0 ? L.circle([o.lat, o.lng], Object.assign({ radius: o.radius_m }, style)) : null;
    if (!o.points || !o.points.length) return null;
    if (o.shape === 'polygon') return o.points.length > 2 ? L.polygon(o.points, style) : L.polyline(o.points, style);
    var g = L.layerGroup(); L.polyline(o.points, style).addTo(g);      // along the road: the line and its width (drawn to scale as circles on its points)
    if (o.radius_m > 0) o.points.forEach(function (q) { L.circle(q, Object.assign({ radius: o.radius_m }, style, { weight: 0 })).addTo(g); });
    return g;
  }
  function now() { return { shape: $('wp_shape').value, lat: parseFloat($('wp_lat').value), lng: parseFloat($('wp_lng').value), radius_m: parseInt($('wp_rad').value, 10), points: A.edit.points }; }
  function redraw() {
    var sh = $('wp_shape').value; $('wp_pt').hidden = sh !== 'circle'; $('wp_rad_box').hidden = sh === 'polygon'; $('wp_pts').hidden = sh === 'circle';
    $('wp_rad_lab').textContent = sh === 'corridor' ? 'Metres on each side *' : 'Radius in metres *';
    $('wp_help').textContent = sh === 'circle' ? 'Click the map on the middle of the place (or type / paste the latitude and longitude).' : sh === 'polygon' ? 'Click the corners of the area on the map, one after the other.' : 'Click along the road on the map, from one end to the other.';
    $('wp_count').textContent = A.edit.points.length + ' points';
    if (!A.map) return; A.draw.clearLayers(); var o = now(), g = shapeOf(o, { color: '#1570EF', weight: 2, fillOpacity: 0.18 }); if (g) g.addTo(A.draw);
    if (sh === 'circle' && isFinite(o.lat) && isFinite(o.lng)) window.L.circleMarker([o.lat, o.lng], { radius: 5, color: '#0A1B44', fillOpacity: 1 }).addTo(A.draw);
    if (sh !== 'circle') o.points.forEach(function (q) { window.L.circleMarker(q, { radius: 4, color: '#0A1B44', fillOpacity: 1 }).addTo(A.draw); });
  }
  function whomBox() {
    var sc = $('wp_scope').value, box = $('wp_vals'); box.textContent = ''; box.hidden = sc === 'all'; $('wp_people').hidden = sc !== 'people';
    var checks = function (list) { list.forEach(function (x) { var l = el('label', 'ck'), c = el('input'); c.type = 'checkbox'; c.value = x.id; c.checked = (A.edit.values || []).indexOf(x.id) > -1; c.onchange = function () { var v = A.edit.values = (A.edit.values || []).filter(function (y) { return y !== x.id; }); if (c.checked) v.push(x.id); }; l.appendChild(c); l.appendChild(document.createTextNode(' ' + x.name)); box.appendChild(l); }); };
    if (sc === 'category') checks(Object.keys(CAT).map(function (k) { return { id: k, name: CAT[k] }; }));
    if (sc === 'department') { checks(A.init.departments.filter(function (d) { return d.active; })); if (!box.childNodes.length) box.appendChild(el('span', 'muted', 'No department in the list yet.')); }
    if (sc === 'people') { A.people.forEach(function (x) { var b = el('span', 'tag', x.name + ' (' + x.code + ') '); b.appendChild(btn('x', '×', function () { A.people = A.people.filter(function (y) { return y.id !== x.id; }); whomBox(); })); box.appendChild(b); }); if (!A.people.length) box.appendChild(el('span', 'muted', 'Nobody chosen yet – type a name below.')); }
  }
  function pickPeople() {
    var inp = $('wp_find'), box = $('wp_find_list');
    api('empPick', { q: inp.value }).then(function (r) { box.textContent = ''; r.rows.filter(function (x) { return !A.people.some(function (y) { return y.id === x.id; }); }).forEach(function (x) { box.appendChild(btn('', x.name + ' (' + x.code + ')', function () { A.people.push(x); inp.value = ''; box.hidden = true; whomBox(); })); }); box.hidden = !box.childNodes.length; }, function () { box.hidden = true; });
  }
  function place(p) {
    var d = A.data, adm = isAdmin(); A.edit = { id: p ? p.id : '', points: p && p.shape !== 'circle' ? p.points.slice() : [], values: p ? (p.scope_values || []).slice() : [] }; A.people = [];
    $('wp_title').textContent = p ? p.name : 'New work place'; err('wp_err', null); $('wp_name').value = p ? p.name : '';
    var k = $('wp_kind'); k.textContent = ''; d.kinds.forEach(function (x) { opt(k, x.key, x.name, p ? p.kind === x.key : x.key === 'site'); });
    var pr = $('wp_proj'); pr.textContent = ''; opt(pr, '', '– none –'); d.projects.filter(function (x) { return x.active || (p && p.project_id === x.id); }).forEach(function (x) { opt(pr, x.id, x.name, p ? p.project_id === x.id : A.proj === x.id); });
    $('wp_shape').value = p ? p.shape : 'circle'; $('wp_lat').value = p && p.shape === 'circle' ? p.lat : ''; $('wp_lng').value = p && p.shape === 'circle' ? p.lng : ''; $('wp_rad').value = p && p.radius_m ? p.radius_m : 100;
    $('wp_scope').value = p ? p.scope : 'all'; $('wp_from').value = p ? p.valid_from : ''; $('wp_on').checked = p ? p.active : true; $('wp_find').value = ''; $('wp_find_list').hidden = true;
    $('wp_save').hidden = !adm; $('wp_del').hidden = !adm || !p; $('wp_del_box').hidden = true; $('wp_why').value = '';
    Array.prototype.forEach.call($('wp_form').querySelectorAll('input,select'), function (i) { if (i.id !== 'wp_why') i.disabled = !adm; });
    var open = function () { whomBox(); show('dlg_place'); mapStart(p); };
    if (p && p.scope === 'people' && p.people.length) api('empList', { q: '' }).then(function (r) { A.people = r.rows.filter(function (e) { return p.people.indexOf(e.id) > -1; }).map(function (e) { return { id: e.id, code: e.code, name: e.name }; }); open(); }, function () { open(); }); else open();
  }
  function placeSave(ev) {
    ev.preventDefault(); err('wp_err', null); var o = now(), sc = $('wp_scope').value;
    var body = { id: A.edit.id, name: $('wp_name').value, kind: $('wp_kind').value, project_id: $('wp_proj').value, shape: o.shape, lat: $('wp_lat').value, lng: $('wp_lng').value, radius_m: $('wp_rad').value, points: o.points,
      scope: sc, scope_values: A.edit.values, people: A.people.map(function (x) { return x.id; }), valid_from: $('wp_from').value, active: $('wp_on').checked };
    $('wp_save').disabled = true;
    api('placeSave', body).then(function (r) { $('wp_save').disabled = false; A.data = r; hide('dlg_place'); toast('Saved.'); drawPlaces(); }, function (e) { $('wp_save').disabled = false; err('wp_err', e); });
  }
  function placeRemove() {
    if ($('wp_del_box').hidden) { $('wp_del_box').hidden = false; $('wp_why').focus(); return; }
    api('placeRemove', { id: A.edit.id, reason: $('wp_why').value }).then(function (r) { A.data = r; hide('dlg_place'); toast('Removed. The punches taken there keep it.'); drawPlaces(); }, function (e) { err('wp_err', e); });
  }
  // ---- many at once ----
  function bulk(ids) {
    $('bk_title').textContent = 'Change ' + ids.length + ' work places together'; err('bk_err', null); $('bk_rad').value = ''; $('bk_on').value = ''; $('bk_scope').value = '';
    var pr = $('bk_proj'); pr.textContent = ''; opt(pr, '-', '– leave as it is –', true); opt(pr, '', 'No project'); A.data.projects.filter(function (x) { return x.active; }).forEach(function (x) { opt(pr, x.id, x.name); });
    var box = $('bk_vals'), fill = function () { box.textContent = ''; var sc = $('bk_scope').value; box.hidden = sc !== 'category' && sc !== 'department'; (sc === 'category' ? Object.keys(CAT).map(function (k) { return { id: k, name: CAT[k] }; }) : sc === 'department' ? A.init.departments.filter(function (d) { return d.active; }) : []).forEach(function (x) { var l = el('label', 'ck'), c = el('input'); c.type = 'checkbox'; c.value = x.id; l.appendChild(c); l.appendChild(document.createTextNode(' ' + x.name)); box.appendChild(l); }); };
    $('bk_scope').onchange = fill; fill();
    $('bk_save').onclick = function () {
      var b = { ids: ids }; if ($('bk_rad').value !== '') b.radius_m = $('bk_rad').value; if ($('bk_on').value) b.active = $('bk_on').value === 'on'; if ($('bk_proj').value !== '-') b.project_id = $('bk_proj').value;
      if ($('bk_scope').value) { b.scope = $('bk_scope').value; b.scope_values = Array.prototype.filter.call(box.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; }); }
      api('placeBulk', b).then(function (r) { A.data = r; A.sel = {}; hide('dlg_bulk'); toast(r.changed + ' work places changed.'); drawPlaces(); }, function (e) { err('bk_err', e); });
    };
    show('dlg_bulk');
  }
  function many() {
    err('mn_err', null); $('mn_text').value = ''; $('mn_res').hidden = true; var pr = $('mn_proj'); pr.textContent = ''; opt(pr, '', '– none –'); A.data.projects.filter(function (x) { return x.active; }).forEach(function (x) { opt(pr, x.id, x.name, A.proj === x.id); });
    $('mn_save').onclick = function () {
      var rows = $('mn_text').value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { var c = l.split(/\s*[,;\t]\s*/); return { name: c[0], lat: c[1], lng: c[2], radius_m: c[3] }; });
      api('placeImport', { rows: rows, project_id: $('mn_proj').value }).then(function (r) {
        if (r.saved) { A.data = r; hide('dlg_many'); toast(r.saved + ' work places added.'); drawPlaces(); return; }
        var res = $('mn_res'); res.textContent = ''; res.hidden = false; res.appendChild(el('p', 'sum', 'Nothing was saved – set these lines right first:')); var ul = el('ul', 'faults'); r.lines.forEach(function (x) { ul.appendChild(el('li', '', 'Line ' + x.line + (x.name ? ' (' + x.name + ')' : '') + ': ' + x.error)); }); res.appendChild(ul);
      }, function (e) { err('mn_err', e); });
    };
    show('dlg_many');
  }
  function projects() {
    var ul = $('pj_rows'); ul.textContent = ''; err('pj_err', null); $('pj_name').value = '';
    A.data.projects.forEach(function (p) { var li = el('li', p.active ? '' : 'off'), i = el('input'); i.value = p.name; i.maxLength = 60; i.setAttribute('aria-label', 'Project name'); li.appendChild(i);
      li.appendChild(btn('sm', 'Save', function () { api('projSave', { id: p.id, name: i.value, active: p.active }).then(function (r) { A.data = r; projects(); drawPlaces(); toast('Saved.'); }, function (e) { err('pj_err', e); }); }));
      li.appendChild(btn('sm ghost', p.active ? 'Switch off' : 'Switch on', function () { api('projSave', { id: p.id, name: p.name, active: !p.active }).then(function (r) { A.data = r; projects(); drawPlaces(); }, function (e) { err('pj_err', e); }); })); ul.appendChild(li); });
    $('pj_none').hidden = A.data.projects.length > 0;
    $('pj_add').onclick = function () { api('projSave', { name: $('pj_name').value }).then(function (r) { A.data = r; projects(); drawPlaces(); toast('Project added.'); }, function (e) { err('pj_err', e); }); };
    show('dlg_proj');
  }

  /* ───────────── Phones ───────────── */
  function phones() {
    var root = $('p_att'); root.textContent = '';
    var note = el('p', 'muted', 'A person marks attendance from ONE phone – the first he punches with. Another phone works only after this one is released here. Only attendance is tied to the phone; the rest of the app works on any phone.'); note.style.margin = '0 0 10px'; root.appendChild(note);
    api('devList').then(function (r) {
      var t = table(['Code', 'Name', 'Phone', 'Tied since', 'Status', '']);
      r.devices.forEach(function (d) {
        var tr = el('tr'); tr.style.cursor = 'default'; tr.appendChild(el('td', '', d.code)); tr.appendChild(face(el('td', 'nm', d.name), d.code)); tr.appendChild(el('td', '', (d.model || 'Phone') + (d.os ? ' · ' + d.os : '') + ' · …' + d.mark)); tr.appendChild(el('td', '', stamp(d.bound_at)));
        var s = el('td'); s.style.whiteSpace = 'normal'; s.appendChild(el('span', 'st ' + (d.active ? 's-active' : 's-left'), d.active ? 'In use' : 'Released')); if (!d.active) s.appendChild(el('div', 'muted', stamp(d.released_at) + ' · ' + d.released_by + ' · ' + d.release_reason)); tr.appendChild(s);
        var a = el('td'); if (d.active && isAdmin()) a.appendChild(btn('sm ghost', 'Release…', function () { release(d); })); tr.appendChild(a); t.body.appendChild(tr);
      });
      if (!r.devices.length) t.box.appendChild(el('p', 'none', 'No phone is tied yet – it happens by itself at a person\'s first punch.'));
      root.appendChild(t.box);
      if (r.tries.length) { var h = el('h3', '', 'Tries from another phone (last 30 days)'); h.style.margin = '18px 0 8px'; h.style.fontSize = '16px'; root.appendChild(h); var t2 = table(['When', 'Code', 'Name', 'Phone', 'Why refused']);
        r.tries.forEach(function (x) { var tr = el('tr'); tr.style.cursor = 'default'; [stamp(x.at), x.code, x.name, x.model || 'Phone', x.why === 'another phone' ? 'His attendance is tied to another phone' : 'This phone is tied to another employee'].forEach(function (v) { tr.appendChild(el('td', '', v)); }); t2.body.appendChild(tr); }); root.appendChild(t2.box); }
    }, fail);
  }
  function release(d) {
    $('dc_title').textContent = 'Release the phone of ' + d.name + ' (' + d.code + ')'; $('dc_note').value = ''; err('dc_err', null); $('dc_lab').textContent = 'Reason * (new phone, phone lost, …)'; $('dc_save').textContent = 'Release'; $('dc_save').className = 'danger';
    $('dc_save').onclick = function () { api('devRelease', { id: d.id, reason: $('dc_note').value }).then(function () { hide('dlg_decide'); toast('Released. His next punch ties the phone he uses then.'); phones(); }, function (e) { err('dc_err', e); }); };
    show('dlg_decide'); $('dc_note').focus();
  }

  var wired = false;
  function wire() {
    if (wired) return; wired = true;
    $('wp_form').onsubmit = placeSave; $('wp_del').onclick = placeRemove;
    ['wp_shape', 'wp_lat', 'wp_lng', 'wp_rad'].forEach(function (i) { $(i).oninput = redraw; $(i).onchange = redraw; });
    ['wp_lat', 'wp_lng'].forEach(function (i) { $(i).addEventListener('change', function () { var la = parseFloat($('wp_lat').value), lo = parseFloat($('wp_lng').value); if (A.map && isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) A.map.setView([la, lo], Math.max(A.map.getZoom(), 16)); }); });      // typed: the map goes there
    // "18.5204, 73.8567" pasted into the latitude (as a map gives it): both boxes are filled
    $('wp_lat').addEventListener('paste', function (ev) { var t = (ev.clipboardData || window.clipboardData).getData('text'), m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(t || ''); if (m) { ev.preventDefault(); $('wp_lat').value = m[1]; $('wp_lng').value = m[2]; redraw(); if (A.map) A.map.setView([+m[1], +m[2]], 17); } });
    $('wp_undo').onclick = function () { A.edit.points.pop(); redraw(); }; $('wp_clear').onclick = function () { A.edit.points = []; redraw(); };
    $('wp_scope').onchange = function () { A.edit.values = []; whomBox(); }; var pt; $('wp_find').oninput = function () { clearTimeout(pt); pt = setTimeout(pickPeople, 250); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-aclose]'), function (b) { b.onclick = function () { hide(b.dataset.aclose); if (b.dataset.aclose === 'dlg_photo') $('ph_img').removeAttribute('src'); }; });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') ['dlg_decide', 'dlg_photo', 'dlg_bulk', 'dlg_many', 'dlg_proj', 'dlg_place'].some(function (d) { if (!$(d).hidden) { hide(d); return true; } return false; }); });
  }
  window.HRATT = {
    pages: PAGES,
    has: function (page) { return PAGES.some(function (p) { return p[0] === page; }); },
    open: function (page, me, init) { A.me = me; A.init = init; A.page = page; if (!A.day) A.day = new Date(Date.now() + 19800000).toISOString().slice(0, 10); wire(); if (page === 'places') places(); else if (page === 'phones') phones(); else attendance(); },
    _size: size, _whom: function (p, init) { A.init = init; return whom(p); }, _last: lastText
  };
})();
