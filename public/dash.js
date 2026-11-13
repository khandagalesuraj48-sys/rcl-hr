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
  var SHOW = 8;      // rows of "Who is in" before "See all"
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
    if (window.HRHEAD && !$('p_dash').hidden) window.HRHEAD.set('Attendance Dashboard · हजेरी', hello(r.now) + ' Who is at work right now, today’s count and what waits for the office.', [el('span', 'dz-pill', dayText(r.today)), live]);
    /* (13-11-2026, the picture he approved) six counts on top; the day's sky, today's ring and what waits; then who is in, the
     * places and what comes up, the week and the quick ways. The same numbers of attDash as before – nothing new is asked. */
    root.appendChild(quick());      // (13-11-2026, asked: "quick action khali nahi re warti astat") the quick ways are the first row
    root.appendChild(kpis(r));
    var ra = el('div', 'dk-r a'); ra.appendChild(hero(r)); ra.appendChild(ring(r)); root.appendChild(ra);
    var rb = el('div', 'dk-r b'); rb.appendChild(who(r)); rb.appendChild(week(r)); rb.appendChild(coming()); root.appendChild(rb);
    var rc = el('div', 'dk-r c'); rc.appendChild(needs(r)); rc.appendChild(places(r)); root.appendChild(rc);
    window.HRBADGE = { requests: r.needs.requests, phones: r.needs.phones, attendance: r.needs.review }; if (window.HR && window.HR.badges) window.HR.badges();
    if (!c.total) root.appendChild(el('p', 'muted', 'No employee on this site yet – add them in Employees.'));
  }
  function hero(r) {
    var c = r.count, h = el('div', 'dz-hero'), big = el('div', 'dz-big');
    big.appendChild(el('small', '', 'On duty right now · आत्ता कामावर')); var b = el('b', '', c.on); b.appendChild(el('span', '', ' / ' + c.total)); big.appendChild(b);
    var bits = []; if (c.total) bits.push(Math.round(c.on * 100 / c.total) + '% on duty'); bits.push(c.late + ' late'); if (c.first_in) bits.push('first IN ' + c.first_in); if (r.arc.shift) bits.push('shift ' + r.arc.shift); bits.forEach(function (t) { big.appendChild(el('em', '', t)); }); h.appendChild(big);
    h.appendChild(arc(r));
    return h;
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
  function kpis(r) {
    var c = r.count, lv = c.leave || 0, ab = c.absent || 0, open = Math.max(0, c.none - lv - ab);
    return cards([['◉', 'blue', 'Total employees', c.total, '', 'On this site'],
      ['✓', 'green', 'Present today', c.present, pct(c.present, c.total), 'हजर · ' + c.out + ' already out'],
      ['✕', 'red', 'Absent today', ab, pct(ab, c.total), 'Yesterday: ' + c.absent_yesterday],
      ['◷', 'amber', 'Late today', c.late, pct(c.late, c.total), 'उशीर' + (r.arc.shift ? ' · shift ' + r.arc.shift : '')],
      ['☾', 'violet', 'On leave', lv, '', 'रजा' + (c.off ? ' · ' + c.off + ' off today' : '')],
      ['?', 'cyan', 'Not marked yet', open, pct(open, c.total), 'अजून हजेरी नाही']]);
  }
  // today's ring: on time, late, not marked, off – of everybody on the rolls
  function ring(r) {
    var c = r.count, on = Math.max(0, c.present - c.late), lv = c.leave || 0, ab = c.absent || 0, parts = [['On time', on, '#12A150'], ['Late', c.late, '#E08A00'], ['Absent', ab, '#D92D20'], ['On leave', lv, '#6B4EE6'], ['Not marked', Math.max(0, c.none - lv - ab), '#B8C2D8'], ['Off today', c.off || 0, '#8A94AD']], sum = parts.reduce(function (a, x) { return a + x[1]; }, 0);
    var cd = card('Today’s attendance · आजची हजेरी', ''), w = el('div', 'dk-ring'), R = 58, C = 2 * Math.PI * R, at = 0;
    var s = sv('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': 'Present today: ' + (pct(c.present, c.total) || '0%') }); s.appendChild(sv('circle', { cx: 75, cy: 75, r: R, fill: 'none', stroke: '#EEF2FA', 'stroke-width': 16 }));
    var g = sv('g', { fill: 'none', 'stroke-width': 16, transform: 'rotate(-90 75 75)' });
    if (sum) parts.forEach(function (x) { if (!x[1]) return; var len = x[1] / sum * C; g.appendChild(sv('circle', { cx: 75, cy: 75, r: R, stroke: x[2], 'stroke-dasharray': len.toFixed(2) + ' ' + C.toFixed(2), 'stroke-dashoffset': (-at).toFixed(2) })); at += len; });
    s.appendChild(g); s.appendChild(sv('text', { x: 75, y: 74, 'text-anchor': 'middle', 'font-size': 25, 'font-weight': 800, fill: '#0F1F3D' }, pct(c.present, c.total) || '–')); s.appendChild(sv('text', { x: 75, y: 93, 'text-anchor': 'middle', 'font-size': 11.5, fill: '#6B7690' }, 'present')); w.appendChild(s);
    var lg = el('div', 'dk-lg'); parts.forEach(function (x) { var d = el('div'), i = el('i'); i.style.background = x[2]; d.appendChild(i); d.appendChild(document.createTextNode(x[0])); d.appendChild(el('b', '', x[1])); d.appendChild(el('em', '', pct(x[1], sum) || '–')); lg.appendChild(d); });
    w.appendChild(lg); cd.appendChild(w); return cd;
  }
  // the quick ways: each opens the page; an action presses that page's own button (shown only when the person has it)
  function quick() {
    var row = el('div', 'dk-qrow'), h = el('h3'), ic = sv('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }); ic.appendChild(sv('path', { d: 'M13 2L4 14h7l-1 8 9-12h-7z' })); h.appendChild(ic); h.appendChild(document.createTextNode('Quick actions')); row.appendChild(h);
    var q = el('div', 'dk-q'), press = function (id) { var b = $(id); if (b && !b.hidden && !b.disabled) b.click(); };
    [['+', 'Add employee', 'employees', 'b_add'], ['⇅', 'Import Excel', 'employees', 'b_imp'], ['◷', 'Attendance', 'attendance', ''], ['▦', 'Muster', 'muster', ''], ['✉', 'Requests', 'requests', ''], ['◉', 'Employee list', 'employees', '']].forEach(function (x) {
      var b = btn('', '', function () { Z.go(x[2]); if (x[3]) press(x[3]); }); var i = el('i', '', x[0]); i.setAttribute('aria-hidden', 'true'); b.appendChild(i); b.appendChild(document.createTextNode(x[1])); q.appendChild(b);
    });
    row.appendChild(q); return row;
  }
  /* the day's arc: 06:00 on the left, 22:00 on the right; the sun stands where the clock is; the bars = how many came in each half hour */
  function arc(r) {
    var W = 560, H = 252, base = 204, x0 = 44, x1 = 532, top = 78, from = minOf(r.arc.from), to = minOf(r.arc.to), slots = r.arc.slots, n = slots.length, step = (x1 - x0) / n;
    var xOf = function (m) { return x0 + (m - from) / (to - from) * (x1 - x0); }, max = Math.max.apply(null, slots.concat([1])), yOf = function (v) { return base - v / max * (base - top); };
    var pts = [[x0, base]].concat(slots.map(function (v, i) { return [x0 + (i + 0.5) * step, yOf(v)]; })).concat([[x1, base]]);
    // a smooth line through the points (each bend held between its neighbours – it never dips under the ground)
    var d = 'M' + pts[0][0] + ' ' + pts[0][1]; for (var i = 0; i < pts.length - 1; i++) { var a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2; d += ' C' + mx.toFixed(1) + ' ' + a[1].toFixed(1) + ' ' + mx.toFixed(1) + ' ' + b[1].toFixed(1) + ' ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1); }
    var s = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'dz-arc', role: 'img', 'aria-label': 'Arrivals of today by time' });
    var defs = sv('defs'), gr = sv('linearGradient', { id: 'dz_area', x1: 0, y1: 0, x2: 0, y2: 1 }); gr.appendChild(sv('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.42' })); gr.appendChild(sv('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '.03' })); defs.appendChild(gr); s.appendChild(defs);
    s.appendChild(sv('line', { x1: x0, y1: base, x2: x1, y2: base, stroke: '#fff', 'stroke-opacity': '.45', 'stroke-width': 1.5 }));
    s.appendChild(sv('path', { d: d + ' Z', fill: 'url(#dz_area)' })); s.appendChild(sv('path', { d: d, fill: 'none', stroke: '#fff', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    slots.forEach(function (v, i) { if (!v) return; var c = sv('circle', { cx: (x0 + (i + 0.5) * step).toFixed(1), cy: yOf(v).toFixed(1), r: 3.5, fill: '#fff' }); c.appendChild(sv('title', {}, v + ' came in')); s.appendChild(c); });
    if (r.arc.shift) { var sx = xOf(minOf(r.arc.shift)); if (sx >= x0 && sx <= x1) { s.appendChild(sv('line', { x1: sx, y1: base, x2: sx, y2: 64, stroke: '#fff', 'stroke-opacity': '.8', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' })); s.appendChild(sv('text', { x: sx, y: 54, fill: '#fff', 'font-size': 12, 'font-weight': 600, 'text-anchor': 'middle' }, 'Shift ' + r.arc.shift)); } }
    var nm = minOf(r.now), nx = Math.min(x1, Math.max(x0, xOf(nm)));
    if (nm >= from && nm <= to) {
      s.appendChild(sv('line', { x1: nx, y1: base, x2: nx, y2: 40, stroke: '#fff', 'stroke-width': 2 })); s.appendChild(sv('circle', { cx: nx, cy: base, r: 6, fill: '#fff' })); s.appendChild(sv('circle', { cx: nx, cy: base, r: 11, fill: '#fff', opacity: '.3' }));
      var lw = 84, lx = Math.min(W - lw - 4, Math.max(4, nx - lw / 2)); s.appendChild(sv('rect', { x: lx, y: 12, width: lw, height: 26, rx: 13, fill: '#fff' })); s.appendChild(sv('text', { x: lx + lw / 2, y: 30, fill: '#1B2130', 'font-size': 12.5, 'font-weight': 700, 'text-anchor': 'middle' }, r.now + ' Now'));
    }
    var g = sv('g', { fill: '#fff', 'font-size': 12, opacity: '.95', 'text-anchor': 'middle' }); ['06:00', '10:00', '14:00', '18:00', '22:00'].forEach(function (t) { g.appendChild(sv('text', { x: xOf(minOf(t)), y: 228 }, t)); }); s.appendChild(g);
    return s;
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
    var n = r.who.length, c = card('Who is in · आत्ता कोण कामावर', n > SHOW ? (Z.all ? 'Show less' : 'See all ' + n) : '', function () { Z.all = !Z.all; draw(); }), wrap = el('div', 'dz-scroll' + (Z.all ? ' all' : '')), t = el('table', 'dz-who'), hd = el('tr');
    ['Employee', 'IN', 'Work place', 'Photo', 'Status'].forEach(function (x) { hd.appendChild(el('th', '', x)); }); var th = el('thead'); th.appendChild(hd); t.appendChild(th); var tb = el('tbody');
    (Z.all ? r.who : r.who.slice(0, SHOW)).forEach(function (w, i) {
      var tr = el('tr'), nm = el('td', 'nm pwho'), av = el('span', 'dz-av', initials(w.name)), bx = el('div'); av.style.background = tintOf(w.id); nm.appendChild(av); bx.appendChild(el('b', '', w.name)); bx.appendChild(el('small', '', w.code + ' · ' + (CAT[w.category] || ''))); nm.appendChild(bx); tr.appendChild(nm);
      tr.appendChild(el('td', 'dz-t', w.in || '– –')); tr.appendChild(el('td', '', w.place || '– –'));
      var ph = el('td'); if (w.punch) ph.appendChild(thumb(w.punch, w.name + ' – IN ' + w.in, i < SHOW)); else ph.appendChild(el('span', 'dz-th none')); tr.appendChild(ph);
      var st = el('td'); st.appendChild(chip(w)); tr.appendChild(st); tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); c.appendChild(wrap); if (!n) c.appendChild(el('p', 'none', 'Nobody here yet.')); c.className += ' dz-wide'; return c;
  }
  function places(r) {
    var c = card('By work place · जागेनुसार', r.count.on ? r.count.on + ' on duty' : ''), max = Math.max.apply(null, r.places.map(function (p) { return p.on; }).concat([1])), col = ['#0B5FA5', '#3FA9E0', '#7A3B6E', '#F29E4C', '#1F9D57', '#5B6F96'];
    r.places.slice(0, 8).forEach(function (p, i) { var row = el('div', 'dz-bar'); row.appendChild(el('b', '', p.name)); var tr = el('i'), u = el('u'); u.style.width = Math.max(4, Math.round(p.on * 100 / max)) + '%'; u.style.background = col[i % col.length]; tr.appendChild(u); row.appendChild(tr); row.appendChild(el('span', '', p.on)); c.appendChild(row); });
    if (!r.places.length) c.appendChild(el('p', 'muted', 'Nobody is at a work place right now.')); return c;
  }
  function week(r) {
    var c = card('This week · हा आठवडा', 'Muster', function () { Z.go('muster'); }), w = el('div', 'dz-week'), max = Math.max.apply(null, r.week.map(function (d) { return d.P + d.HD + d.A; }).concat([1]));
    r.week.forEach(function (d) {
      var col = el('div'), bar = function (n, cls, word) { if (!n) return; var i = el('i', cls); i.style.height = Math.max(3, Math.round(n * 84 / max)) + 'px'; i.title = n + ' ' + word; col.appendChild(i); };
      bar(d.A, 'a', 'absent'); bar(d.HD, 'h', 'half day'); bar(d.P, 'p', 'present'); if (!(d.A + d.HD + d.P)) col.appendChild(el('i', 'e'));
      col.appendChild(el('span', d.day === r.today ? 'on' : '', WD[new Date(d.day + 'T00:00:00Z').getUTCDay()])); w.appendChild(col);
    });
    c.appendChild(w); var lg = el('div', 'dz-leg'); [['p', 'Present'], ['h', 'Half day'], ['a', 'Absent']].forEach(function (k) { var s = el('span'); s.appendChild(el('i', k[0])); s.appendChild(document.createTextNode(k[1])); lg.appendChild(s); }); c.appendChild(lg); return c;
  }
  /* (12-11-2026) what comes up on this site: papers whose date runs out (30 days, or run out already), birthdays and years at work
   * of the coming week – read on its own, so the dashboard does not wait for it */
  function coming() {
    var c = card('Coming up · पुढे येणारे', ''); var box = el('div'); box.appendChild(el('p', 'none', 'Reading…')); c.appendChild(box);
    var dm = function (d) { return String(d).slice(8, 10) + '-' + String(d).slice(5, 7); }, line = function (cls, n, title, sub) { var d = el('div', 'dz-need ' + cls); d.appendChild(el('span', 'n', n)); var t = el('div'); t.appendChild(el('b', '', title)); t.appendChild(el('small', '', sub)); d.appendChild(t); return d; };
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
    var c = card('Needs you · तुमच्याकडे बाकी', rows.length ? rows.length + (rows.length === 1 ? ' kind' : ' kinds') : '');
    rows.forEach(function (x) { var d = el('div', 'dz-need ' + x[1]); d.appendChild(el('span', 'n', x[0])); var t = el('div'); t.appendChild(el('b', '', x[2])); t.appendChild(el('small', '', x[3])); d.appendChild(t); d.appendChild(btn('dz-go', x[4], function () { Z.go(x[5]); })); c.appendChild(d); });
    if (!rows.length) c.appendChild(el('p', 'none', 'Nothing waits for you. · काही बाकी नाही.')); return c;
  }

  window.HRDASH = {
    pages: [['dashboard', 'Dashboard']],
    has: function (page) { return page === 'dashboard'; },
    open: function (me, go) {
      Z.me = me; Z.go = go; if (window.HRHEAD) window.HRHEAD.set('Attendance Dashboard · हजेरी', 'Who is at work right now, today’s count and what waits for the office.', []);
      if (!Z.data) { var root = $('p_dash'); root.textContent = ''; root.appendChild(el('p', 'none', 'Opening… · उघडत आहे…')); } else draw();
      load(true); clearInterval(Z.timer);
      Z.timer = setInterval(function () { if ($('p_dash').hidden) { clearInterval(Z.timer); return; } if (!document.hidden) load(false); }, 60000);
    },
    photo: photo, thumb: thumb, cards: cards, face: function (name, key) { var a = el('span', 'dz-av', initials(name)); a.style.background = tintOf(key || name); a.setAttribute('aria-hidden', 'true'); return a; }, _initials: initials, _minOf: minOf
  };
})();
