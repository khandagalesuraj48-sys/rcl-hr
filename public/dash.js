/* HR – THE ATTENDANCE DASHBOARD of the HR office (asked 12-11-2026: "web sathi pn attendance modual design … ekdam proffesional
 * dashbord … premium feel"; the pictures he approved: "hech design final aahe web sathi"). hr.js opens it: HRDASH.open(me, go).
 *   The sky   – who is at work right now, the day's arc (06:00 → 22:00) with the sun at this moment and the arrivals by time,
 *               four counts beside it.
 *   Who is in – everybody of today: IN, where, the photo of the punch, how he stands.
 *   By work place · This week · Needs you (what waits for the office – each opens its own page).
 * It only READS (action attDash) and asks again every minute while it is on the screen. Every text of a person is put in as
 * TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var sv = function (tag, attrs, text) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (text !== undefined) e.textContent = String(text); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var Z = { me: null, go: null, data: null, all: false, timer: null, links: {} };
  var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TINT = ['#0B5FA5', '#7A3B6E', '#1F9D57', '#D0553B', '#0F1F3D', '#E0A21B', '#5B6F96', '#2B8C9E'];
  var SHOW = 6;      // rows of "Who is in" before "See all"
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  var minOf = function (hm) { return +String(hm).slice(0, 2) * 60 + +String(hm).slice(3, 5); };
  var dayText = function (d) { var t = new Date(d + 'T00:00:00Z'); return WD[t.getUTCDay()] + ', ' + t.getUTCDate() + ' ' + MON[t.getUTCMonth()] + ' ' + t.getUTCFullYear(); };
  var initials = function (name) { var p = String(name || '').trim().split(/\s+/); return ((p[0] || '').slice(0, 1) + (p.length > 1 ? p[p.length - 1].slice(0, 1) : '')).toUpperCase(); };
  var tintOf = function (id) { var n = 0, s = String(id || ''); for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 9973; return TINT[n % TINT.length]; };

  /* ───────────── the photo of a punch (a short link of the private store – asked again when it is older than 90 s) ───────────── */
  function link(id) { var c = Z.links[id]; if (c && Date.now() - c.at < 90000) return c.p; var p = api('punchSelfie', { id: id }).then(function (x) { return x.url; }); Z.links[id] = { at: Date.now(), p: p }; p.catch(function () { delete Z.links[id]; }); return p; }
  function photo(id, title) {
    link(id).then(function (url) {
      var d = el('div', 'dlg'), s = el('div', 'sheet'); s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.appendChild(el('h2', '', title)); s.appendChild(el('p', 'sub', 'The photo taken with the punch – kept as proof for 90 days.'));
      var im = el('img', 'dz-photo'); im.alt = 'Photo of the punch'; im.src = url; s.appendChild(im);
      var close = function () { document.removeEventListener('keydown', key); if (d.parentNode) d.parentNode.removeChild(d); }, key = function (ev) { if (ev.key === 'Escape') close(); };
      var a = el('div', 'acts'); a.appendChild(btn('pri', 'Close', close)); s.appendChild(a); d.appendChild(s); d.onclick = function (ev) { if (ev.target === d) close(); }; document.addEventListener('keydown', key); document.body.appendChild(d);
    }, fail);
  }
  // the small picture of a punch: a button; "now" = the picture is fetched at once, otherwise on the first click
  function thumb(id, title, now) {
    var b = el('button', 'dz-th'); b.type = 'button'; b.title = 'Photo – ' + title; b.setAttribute('aria-label', 'Photo of the punch – ' + title); b.onclick = function () { photo(id, title); };
    if (now) link(id).then(function (url) { var im = el('img'); im.alt = ''; im.onload = function () { b.textContent = ''; b.appendChild(im); }; im.src = url; }, function () { /* the photo is not there any more: the empty tile stays */ });
    return b;
  }

  /* ───────────── the page ───────────── */
  function load(first) {
    api('attDash').then(function (r) { Z.data = r; draw(); }, function (e) { if (first) { var root = $('p_dash'); root.textContent = ''; root.appendChild(el('p', 'none', e && e.message ? e.message : 'HR did not answer – try again.')); } });
  }
  // "Good morning, <first name>." – by the server's clock of the site
  function hello(now) { var h = +String(now || '').slice(0, 2), n = Z.me && Z.me.user && Z.me.user.name ? String(Z.me.user.name).trim().split(/\s+/)[0] : ''; n = n ? n.charAt(0).toUpperCase() + n.slice(1) : ''; return (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (n ? ', ' + n : '') + '.'; }
  function draw() {
    var r = Z.data, root = $('p_dash'), c = r.count; root.textContent = '';
    var live = btn('dz-pill dz-live', 'Live · ' + r.now, function () { load(false); }); live.title = 'Asked again every minute – press to ask now';
    /* (13-11-2026, his Stitch screens: "same as it is") the head: the name, "Live", and on the right the two things done most */
    var mark = btn('st-btn', 'Mark attendance', function () { Z.go('attendance'); }), add = btn('st-btn red', '+ Add employee', function () { Z.go('employees'); var b = $('b_add'); if (b && !b.hidden && !b.disabled) b.click(); });
    if (window.HRHEAD && !$('p_dash').hidden) window.HRHEAD.set('HR Dashboard · हजेरी', 'Who is at work right now, today’s count and what waits for the office.', [live, mark, add]);
    root.appendChild(quick());      // (13-11-2026, asked: "quick action khali nahi re warti astat") the quick ways are the first row
    var ra = el('div', 'dk-r a'); ra.appendChild(hero(r)); ra.appendChild(ring(r)); root.appendChild(ra);
    var rb = el('div', 'dk-r b'); rb.appendChild(who(r)); rb.appendChild(week(r)); rb.appendChild(coming()); root.appendChild(rb);
    var rc = el('div', 'dk-r c'); rc.appendChild(needs(r)); rc.appendChild(places(r)); root.appendChild(rc);
    window.HRBADGE = { requests: r.needs.requests, phones: r.needs.phones, attendance: r.needs.review }; if (window.HR && window.HR.badges) window.HR.badges();
    if (!c.total) root.appendChild(el('p', 'muted', 'No employee on this site yet – add them in Employees.'));
  }
  /* the red card: the greeting, the day and the site, one line of what is true right now, and the four counts of today */
  function hero(r) {
    var c = r.count, lv = c.leave || 0, ab = c.absent || 0, open = Math.max(0, c.none - lv - ab), h = el('div', 'st-hero'), top = el('div', 'st-htop');
    var site = Z.me && (Z.me.siteName || Z.me.site) ? String(Z.me.siteName || Z.me.site) : ''; top.appendChild(el('small', 'st-eye', site || 'Today'));
    top.appendChild(el('h2', '', hello(r.now).replace(/\.$/, ''))); top.appendChild(el('span', 'st-hday', dayText(r.today)));
    var bits = [c.on + ' of ' + c.total + ' on duty right now']; if (open) bits.push(open + ' not marked yet'); if (c.first_in) bits.push('first IN ' + c.first_in); if (r.arc.shift) bits.push('shift ' + r.arc.shift);
    top.appendChild(el('p', '', bits.join(' · ') + '.')); h.appendChild(top);
    var row = el('div', 'st-hk');
    [['Present · हजर', c.present, pct(c.present, c.total) ? pct(c.present, c.total) + ' of the site' : c.out + ' already out', 'attendance'],
      ['Late · उशीर', c.late, r.arc.shift ? 'after shift ' + r.arc.shift : 'today', 'attendance'],
      ['Absent · गैरहजर', ab, 'Yesterday: ' + c.absent_yesterday, 'muster'],
      ['On leave · रजा', lv, c.off ? c.off + ' off today' : 'today', 'leave']].forEach(function (x) {
      var k = btn('', '', function () { Z.go(x[3]); }); k.appendChild(el('small', '', x[0])); k.appendChild(el('b', '', x[1])); k.appendChild(el('span', '', x[2])); row.appendChild(k);
    });
    h.appendChild(row); return h;
  }
  var pct = function (n, of) { return of ? (Math.round(n * 1000 / of) / 10) + '%' : ''; };
  /* the counts on top of a page as cards: [mark, background, colour, word, number, small pill, line below] – for every page (HRDASH.cards) */
  var TONE = { blue: ['#F1F3F7', '#3B4256'], green: ['#E3F6EA', '#12A150'], amber: ['#FFF1D6', '#B56A00'], red: ['#FDE8E6', '#D92D20'], violet: ['#EEEAFE', '#6B4EE6'], cyan: ['#E6F4FB', '#0E7FB8'], grey: ['#EEF1F7', '#55607c'] };
  function cards(list) {
    var k = el('div', 'dk'); k.style.gridTemplateColumns = 'repeat(' + list.length + ',minmax(0,1fr))'; k.className = 'dk dk-' + list.length;
    list.forEach(function (x) {
      var tn = TONE[x[1]] || TONE.blue, d = el('div', 'dk-c'), i = el('i', '', x[0]), t = el('div'), b = el('b', '', x[3]); i.style.background = tn[0]; i.style.color = tn[1]; i.setAttribute('aria-hidden', 'true'); t.style.minWidth = '0';
      if (x[4]) { var u = el('u', '', x[4]); u.style.background = tn[0]; u.style.color = tn[1]; b.appendChild(u); } t.appendChild(el('span', '', x[2])); t.appendChild(b); t.appendChild(el('small', '', x[5] || '')); d.appendChild(i); d.appendChild(t); k.appendChild(d);
    });
    return k;
  }
  // today's roll call: one ring of who came, and each category below it – counted from the same list as "Who is in"
  function ring(r) {
    var c = r.count, cd = card('Today’s roll call · आजची हजेरी', c.present + ' of ' + c.total), w = el('div', 'st-roll'), R = 58, C = 2 * Math.PI * R, part = c.total ? c.present / c.total : 0;
    var s = sv('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': 'Present today: ' + (pct(c.present, c.total) || '0%') }); s.appendChild(sv('circle', { cx: 75, cy: 75, r: R, fill: 'none', stroke: '#F3F4F6', 'stroke-width': 13 }));
    if (part > 0) s.appendChild(sv('circle', { cx: 75, cy: 75, r: R, fill: 'none', stroke: '#D2001A', 'stroke-width': 13, 'stroke-linecap': 'round', transform: 'rotate(-90 75 75)', 'stroke-dasharray': (part * C).toFixed(2) + ' ' + C.toFixed(2) }));
    s.appendChild(sv('text', { x: 75, y: 76, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 700, fill: '#1A1A1A' }, pct(c.present, c.total) || '–')); s.appendChild(sv('text', { x: 75, y: 95, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, 'letter-spacing': '.6', fill: '#6B7280' }, 'PRESENT')); w.appendChild(s);
    var lg = el('div', 'st-cat'), tone = { staff: '#D2001A', operator: '#A80015', driver: '#4B5563', labour: '#8C6A5D' };
    Object.keys(CAT).forEach(function (k) {
      var all = r.who.filter(function (x) { return x.category === k; }), on = all.filter(function (x) { return x.state === 'on' || x.state === 'out'; }).length; if (!all.length) return;
      var d = el('div'), t = el('p'), i = el('i'); i.style.background = tone[k]; t.appendChild(i); t.appendChild(document.createTextNode(CAT[k])); t.appendChild(el('b', '', Math.round(on * 100 / all.length) + '% (' + on + '/' + all.length + ')')); d.appendChild(t);
      var tr = el('u'), f = el('s'); f.style.width = Math.round(on * 100 / all.length) + '%'; f.style.background = tone[k]; tr.appendChild(f); d.appendChild(tr); lg.appendChild(d);
    });
    if (!lg.childNodes.length) lg.appendChild(el('p', 'none', 'No employee on this site yet.'));
    w.appendChild(lg); cd.appendChild(w); return cd;
  }
  // the quick ways: each opens the page; an action presses that page's own button (shown only when the person has it)
  function quick() {
    var row = el('div', 'st-quick'), q = el('div', 'st-q'), press = function (id) { var b = $(id); if (b && !b.hidden && !b.disabled) b.click(); };
    row.appendChild(el('h3', '', 'Quick actions'));
    [['M15 19c0-2.8-2.7-5-6-5s-6 2.2-6 5M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M16 11h6', 'Add employee', 'a new person of this site', 'employees', 'b_add'],
      ['M12 3v12M7 8l5-5 5 5M4 17v3h16v-3', 'Import Excel', 'many employees at once', 'employees', 'b_imp'],
      ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', 'Attendance', 'today’s punches', 'attendance', ''],
      ['M5 4h14v16H5zM9 9h6M9 13h6M9 17h4', 'Open muster', 'the month, day by day', 'muster', ''],
      ['M5 4h14v12H9l-4 4zM9 9h6M9 12h4', 'Requests', 'days to set right', 'requests', ''],
      ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'Work places', 'where a punch counts', 'places', '']].forEach(function (x) {
      var b = btn('', '', function () { Z.go(x[3]); if (x[4]) press(x[4]); }), i = el('i'), g = sv('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }); g.appendChild(sv('path', { d: x[0] })); i.appendChild(g); b.appendChild(i); b.appendChild(el('b', '', x[1])); b.appendChild(el('small', '', x[2])); q.appendChild(b);
    });
    row.appendChild(q); return row;
  }
  function card(title, side, fn) { var c = el('div', 'dz-card'), h = el('h3', '', title); if (side) { var b = fn ? btn('dz-link', side, fn) : el('span', 'dz-link', side); h.appendChild(b); } c.appendChild(h); return c; }
  function chip(w) {
    if (w.state === 'on') return w.late_min > 0 ? el('span', 'dz-chip y', 'Late ' + w.late_min + ' m') : el('span', 'dz-chip g', 'On duty');
    if (w.state === 'out') return el('span', 'dz-chip b', 'Out ' + w.out);
    if (w.state === 'check') return el('span', 'dz-chip b', 'To be checked');
    if (w.state === 'off') return el('span', 'dz-chip s', 'Off today');
    if (w.mark === 'leave') return el('span', 'dz-chip v', 'On leave');
    if (w.mark === 'absent') return el('span', 'dz-chip r', 'Absent');
    return el('span', 'dz-chip s', 'Not marked');
  }
  function who(r) {
    var n = r.who.length, c = card('Who is in now · आत्ता कोण कामावर', n > SHOW ? (Z.all ? 'Show less' : 'See all ' + n) : '', function () { Z.all = !Z.all; draw(); }), wrap = el('div', 'dz-scroll st-who' + (Z.all ? ' all' : ''));
    (Z.all ? r.who : r.who.slice(0, SHOW)).forEach(function (w, i) {
      var row = el('div', 'st-w'), av = el('span', 'dz-av', initials(w.name)), bx = el('div', 'st-wn'), nm = el('b', '', w.name); av.style.background = tintOf(w.id); row.appendChild(av);
      if (CAT[w.category]) nm.appendChild(el('em', 'c-' + w.category, CAT[w.category])); bx.appendChild(nm); bx.appendChild(el('small', '', w.code + (w.place ? ' · ' + w.place : ''))); row.appendChild(bx);
      if (w.punch) row.appendChild(thumb(w.punch, w.name + ' – IN ' + w.in, i < SHOW));
      var t = el('div', 'st-wt'); t.appendChild(el('b', '', w.in || '– –')); t.appendChild(chip(w)); row.appendChild(t); wrap.appendChild(row);
    });
    c.appendChild(wrap); if (!n) c.appendChild(el('p', 'none', 'Nobody here yet.')); return c;
  }
  function places(r) {
    var c = card('Work places · जागेनुसार', r.count.on ? r.count.on + ' on duty' : '', function () { Z.go('places'); }), max = Math.max.apply(null, r.places.map(function (p) { return p.on; }).concat([1]));
    r.places.slice(0, 8).forEach(function (p) { var row = el('div', 'st-pl'), t = el('p'); t.appendChild(el('b', '', p.name)); t.appendChild(el('span', '', p.on + ' on duty')); row.appendChild(t); var tr = el('u'), f = el('s'); f.style.width = Math.max(4, Math.round(p.on * 100 / max)) + '%'; tr.appendChild(f); row.appendChild(tr); c.appendChild(row); });
    if (!r.places.length) c.appendChild(el('p', 'none', 'Nobody is at a work place right now.')); return c;
  }
  function week(r) {
    var days = r.week.map(function (d) { var all = d.P + d.HD + d.A; return { day: d.day, all: all, part: all ? (d.P + d.HD) / all : null, d: d }; }), had = days.filter(function (d) { return d.part !== null; });
    var avg = had.length ? Math.round(had.reduce(function (a, d) { return a + d.part; }, 0) * 1000 / had.length) / 10 + '%' : '';
    var c = card('This week · हा आठवडा', 'Muster', function () { Z.go('muster'); }); if (avg) c.appendChild(el('p', 'st-sub', 'Present of those marked – average ' + avg));
    var W = 420, H = 150, x0 = 24, x1 = 396, top = 18, base = 128, n = days.length, xOf = function (i) { return n > 1 ? x0 + i * (x1 - x0) / (n - 1) : (x0 + x1) / 2; }, yOf = function (v) { return base - v * (base - top); };
    var s = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'st-line', role: 'img', 'aria-label': 'Share present, day by day' });
    [0, 0.5, 1].forEach(function (v) { s.appendChild(sv('line', { x1: x0, y1: yOf(v), x2: x1, y2: yOf(v), stroke: '#ECECEE', 'stroke-width': 1 })); });
    var pts = []; days.forEach(function (d, i) { if (d.part !== null) pts.push([xOf(i), yOf(d.part), d]); });
    if (pts.length > 1) { var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '); s.appendChild(sv('path', { d: line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + base + ' L' + pts[0][0].toFixed(1) + ' ' + base + ' Z', fill: '#D2001A', 'fill-opacity': '.10' })); s.appendChild(sv('path', { d: line, fill: 'none', stroke: '#D2001A', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })); }
    pts.forEach(function (p) { var k = sv('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 3.5, fill: '#D2001A' }); k.appendChild(sv('title', {}, p[2].d.P + ' present, ' + p[2].d.HD + ' half day, ' + p[2].d.A + ' absent')); s.appendChild(k); });
    c.appendChild(s); var w = el('div', 'st-days');
    days.forEach(function (d) { var b = el('div', d.day === r.today ? 'on' : ''); b.appendChild(el('span', '', WD[new Date(d.day + 'T00:00:00Z').getUTCDay()].slice(0, 1))); b.appendChild(el('b', '', d.part === null ? '--' : Math.round(d.part * 100) + '%')); w.appendChild(b); });
    c.appendChild(w); if (!had.length) c.appendChild(el('p', 'none', 'No day of this week is marked yet.')); return c;
  }
  /* (12-11-2026) what comes up on this site: papers whose date runs out (30 days, or run out already), birthdays and years at work
   * of the coming week – read on its own, so the dashboard does not wait for it */
  function coming() {
    var c = card('Coming up · पुढे येणारे', ''); var box = el('div'); box.appendChild(el('p', 'none', 'Reading…')); c.appendChild(box);
    var dm = function (d) { return String(d).slice(8, 10) + '-' + String(d).slice(5, 7); }, line = function (cls, n, title, sub) { var d = el('div', 'st-need ' + cls); d.appendChild(el('span', 'n', n)); var t = el('div'); t.appendChild(el('b', '', title)); t.appendChild(el('small', '', sub)); d.appendChild(t); return d; };
    window.HRAPI('api/hr', { action: 'hrComing' }).then(function (r) {
      box.textContent = '';
      r.papers.slice(0, 8).forEach(function (p) { box.appendChild(line(p.left < 0 ? 'r' : 'y', p.left < 0 ? '!' : p.left, p.name + ' – ' + p.paper, p.left < 0 ? 'ran out on ' + dm(p.expires_on) + '-' + String(p.expires_on).slice(0, 4) : p.left === 0 ? 'runs out today' : 'runs out in ' + p.left + (p.left === 1 ? ' day' : ' days') + ' (' + dm(p.expires_on) + ')')); });
      if (r.papers.length > 8) box.appendChild(el('p', 'muted', '+ ' + (r.papers.length - 8) + ' more papers'));
      r.days.slice(0, 8).forEach(function (d) { box.appendChild(line(d.what === 'birthday' ? 'v' : 'b', d.in === 0 ? '★' : d.in, d.name, (d.what === 'birthday' ? 'Birthday' : d.years + (d.years === 1 ? ' year' : ' years') + ' with us') + ' – ' + (d.in === 0 ? 'today' : d.in === 1 ? 'tomorrow' : 'on ' + dm(d.day)))); });
      if (!r.papers.length && !r.days.length) box.appendChild(el('p', 'none', 'Nothing in the coming days. · पुढच्या दिवसांत काही नाही.'));
    }, function () { box.textContent = ''; box.appendChild(el('p', 'none', 'Could not be read – open the page again.')); });
    return c;
  }
  function needs(r) {
    var n = r.needs, days = n.oldest ? Math.max(0, Math.floor((Date.now() - Date.parse(n.oldest)) / 86400000)) : 0;
    var rows = [[n.requests, 'y', 'Requests to set a day right', 'forgot IN / OUT' + (n.requests ? ' · oldest ' + (days ? days + (days === 1 ? ' day' : ' days') : 'today') : ''), 'Open', 'requests'],
      [n.review, 'b', 'Punches to check', 'taken with no network – clock or place in doubt', 'Check', 'attendance'],
      [n.phones, 'r', 'Another phone', 'tried with a phone that is not theirs – last 7 days', 'Open', 'phones'],
      [n.no_phone, 'v', 'No phone – by hand', 'not marked today and no phone tied – enter in the muster', 'Enter', 'muster']].filter(function (x) { return x[0] > 0; });
    var total = rows.reduce(function (a, x) { return a + x[0]; }, 0), c = card('Needs your attention · तुमच्याकडे बाकी', total ? total + (total === 1 ? ' item' : ' items') : '');
    rows.forEach(function (x) { var d = el('div', 'st-need line ' + x[1]); d.appendChild(el('span', 'n', x[0])); var t = el('div'); t.appendChild(el('b', '', x[2])); t.appendChild(el('small', '', x[3])); d.appendChild(t); d.appendChild(btn('st-go', x[4] + ' →', function () { Z.go(x[5]); })); c.appendChild(d); });
    if (!rows.length) c.appendChild(el('p', 'none', 'Nothing waits for you. · काही बाकी नाही.')); return c;
  }

  window.HRDASH = {
    pages: [['dashboard', 'Dashboard']],
    has: function (page) { return page === 'dashboard'; },
    open: function (me, go) {
      Z.me = me; Z.go = go; if (window.HRHEAD) window.HRHEAD.set('HR Dashboard · हजेरी', 'Who is at work right now, today’s count and what waits for the office.', []);
      if (!Z.data) { var root = $('p_dash'); root.textContent = ''; root.appendChild(el('p', 'none', 'Opening… · उघडत आहे…')); } else draw();
      load(true); clearInterval(Z.timer);
      Z.timer = setInterval(function () { if ($('p_dash').hidden) { clearInterval(Z.timer); return; } if (!document.hidden) load(false); }, 60000);
    },
    photo: photo, thumb: thumb, cards: cards, face: function (name, key) { var a = el('span', 'dz-av', initials(name)); a.style.background = tintOf(key || name); a.setAttribute('aria-hidden', 'true'); return a; }, _initials: initials, _minOf: minOf
  };
})();
