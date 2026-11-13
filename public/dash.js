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
  function draw() {
    var r = Z.data, root = $('p_dash'), c = r.count; root.textContent = '';
    var live = btn('dz-pill dz-live', 'Live · ' + r.now, function () { load(false); }); live.title = 'Asked again every minute – press to ask now';
    if (window.HRHEAD && !$('p_dash').hidden) window.HRHEAD.set('Attendance Dashboard · हजेरी', 'Who is at work right now, today’s count and what waits for the office.', [el('span', 'dz-pill', dayText(r.today)), live]);
    /* (13-11-2026, the picture he approved) six counts on top; the day's sky, today's ring and what waits; then who is in, the
     * places and what comes up, the week and the quick ways. The same numbers of attDash as before – nothing new is asked. */
    root.appendChild(kpis(r));
    var ra = el('div', 'dk-r a'); ra.appendChild(hero(r)); ra.appendChild(ring(r)); ra.appendChild(needs(r)); root.appendChild(ra);
    var rb = el('div', 'dk-r b'); rb.appendChild(who(r)); var mid = el('div', 'dz-col'); mid.appendChild(places(r)); mid.appendChild(coming()); rb.appendChild(mid); var right = el('div', 'dz-col'); right.appendChild(week(r)); right.appendChild(quick()); rb.appendChild(right); root.appendChild(rb);
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
  function kpis(r) {
    var c = r.count, k = el('div', 'dk');
    [['◉', '#EAF1FF', '#1E63E9', 'Total employees', c.total, '', 'On this site'],
      ['✓', '#E3F6EA', '#12A150', 'Present today', c.present, pct(c.present, c.total), 'हजर · ' + c.out + ' already out'],
      ['◷', '#FFF1D6', '#B56A00', 'Late today', c.late, pct(c.late, c.total), 'उशीर' + (r.arc.shift ? ' · shift ' + r.arc.shift : '')],
      ['?', '#E6F4FB', '#0E7FB8', 'Not marked yet', c.none, pct(c.none, c.total), 'अजून हजेरी नाही'],
      ['☾', '#EEEAFE', '#6B4EE6', 'Off today', c.off || 0, '', 'Weekly off · holiday'],
      ['✕', '#FDE8E6', '#D92D20', 'Absent yesterday', c.absent_yesterday, '', 'काल गैरहजर']].forEach(function (x) {
      var d = el('div', 'dk-c'), i = el('i', '', x[0]), t = el('div'), b = el('b', '', x[4]); i.style.background = x[1]; i.style.color = x[2]; i.setAttribute('aria-hidden', 'true');
      if (x[5]) { var u = el('u', '', x[5]); u.style.background = x[1]; u.style.color = x[2]; b.appendChild(u); } t.appendChild(el('span', '', x[3])); t.appendChild(b); t.appendChild(el('small', '', x[6])); d.appendChild(i); d.appendChild(t); k.appendChild(d);
    });
    return k;
  }
  // today's ring: on time, late, not marked, off – of everybody on the rolls
  function ring(r) {
    var c = r.count, on = Math.max(0, c.present - c.late), parts = [['On time', on, '#12A150'], ['Late', c.late, '#E08A00'], ['Not marked', c.none, '#B8C2D8'], ['Off today', c.off || 0, '#6B4EE6']], sum = parts.reduce(function (a, x) { return a + x[1]; }, 0);
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
    var cd = card('Quick actions', ''), q = el('div', 'dk-q'), press = function (id) { var b = $(id); if (b && !b.hidden && !b.disabled) b.click(); };
    [['+', 'Add employee', 'employees', 'b_add'], ['⇅', 'Import / Export', 'employees', ''], ['✎', 'Manual entry', 'muster', ''], ['▦', 'Muster', 'muster', '']].forEach(function (x) {
      var b = btn('', '', function () { Z.go(x[2]); if (x[3]) press(x[3]); }); var i = el('i', '', x[0]); i.setAttribute('aria-hidden', 'true'); b.appendChild(i); b.appendChild(document.createTextNode(x[1])); q.appendChild(b);
    });
    cd.appendChild(q); return cd;
  }
  /* the day's arc: 06:00 on the left, 22:00 on the right; the sun stands where the clock is; the bars = how many came in each half hour */
  function arc(r) {
    var W = 560, H = 232, base = 206, cx = 280, cy = 276, R = 250, a0 = Math.atan2(base - cy, 40 - cx), a1 = Math.atan2(base - cy, 520 - cx);
    var from = minOf(r.arc.from), to = minOf(r.arc.to), f = Math.min(1, Math.max(0, (minOf(r.now) - from) / (to - from))), a = a0 + f * (a1 - a0), sx = cx + R * Math.cos(a), sy = cy + R * Math.sin(a);
    var xOf = function (m) { return 60 + (m - from) / (to - from) * 440; };
    var s = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'dz-arc', role: 'img', 'aria-label': 'Arrivals of today by time' });
    var defs = sv('defs'), gr = sv('radialGradient', { id: 'dz_sun' }); gr.appendChild(sv('stop', { offset: '0', 'stop-color': '#FFF3B0' })); gr.appendChild(sv('stop', { offset: '.6', 'stop-color': '#FFC93C' })); gr.appendChild(sv('stop', { offset: '1', 'stop-color': '#FF9A3C' })); defs.appendChild(gr); s.appendChild(defs);
    s.appendChild(sv('path', { d: 'M40 ' + base + ' A' + R + ' ' + R + ' 0 0 1 520 ' + base, fill: 'none', stroke: '#fff', 'stroke-opacity': '.38', 'stroke-width': '3', 'stroke-dasharray': '3 9' }));
    if (f > 0) s.appendChild(sv('path', { d: 'M40 ' + base + ' A' + R + ' ' + R + ' 0 0 1 ' + sx.toFixed(1) + ' ' + sy.toFixed(1), fill: 'none', stroke: '#FFC93C', 'stroke-width': '4', 'stroke-linecap': 'round' }));
    var max = Math.max.apply(null, r.arc.slots.concat([1])), step = 440 / r.arc.slots.length;
    r.arc.slots.forEach(function (n, i) { var hh = n ? 6 + n / max * 82 : 4, x = 60 + i * step + (step - 8) / 2; var b = sv('rect', { x: x.toFixed(1), y: (base - hh).toFixed(1), width: 8, height: hh.toFixed(1), rx: 3, fill: '#fff', opacity: n ? '.95' : '.4' }); if (n) b.appendChild(sv('title', {}, n + ' came in')); s.appendChild(b); });
    if (r.arc.shift) { var x = xOf(minOf(r.arc.shift)); if (x >= 60 && x <= 500) { s.appendChild(sv('line', { x1: x, y1: base, x2: x, y2: 108, stroke: '#FFE9A8', 'stroke-width': 2, 'stroke-dasharray': '4 4' })); s.appendChild(sv('text', { x: x + 6, y: 118, fill: '#FFE9A8', 'font-size': '11.5', 'font-weight': '600' }, 'Shift ' + r.arc.shift)); } }
    s.appendChild(sv('circle', { cx: sx.toFixed(1), cy: sy.toFixed(1), r: 30, fill: '#FFC93C', opacity: '.25' })); s.appendChild(sv('circle', { cx: sx.toFixed(1), cy: sy.toFixed(1), r: 19, fill: 'url(#dz_sun)' }));
    s.appendChild(sv('text', { x: sx < 420 ? sx + 28 : sx - 28, y: Math.max(16, sy + 4), fill: '#fff', 'font-size': '12', 'font-weight': '700', 'text-anchor': sx < 420 ? 'start' : 'end' }, r.now + ' now'));
    var g = sv('g', { fill: '#fff', 'font-size': '11', opacity: '.92', 'text-anchor': 'middle' }); ['06:00', '10:00', '14:00', '18:00', '22:00'].forEach(function (t) { g.appendChild(sv('text', { x: xOf(minOf(t)), y: 224 }, t)); }); s.appendChild(g);
    return s;
  }
  function card(title, side, fn) { var c = el('div', 'dz-card'), h = el('h3', '', title); if (side) { var b = fn ? btn('dz-link', side, fn) : el('span', 'dz-link', side); h.appendChild(b); } c.appendChild(h); return c; }
  function chip(w) {
    if (w.state === 'on') return w.late_min > 0 ? el('span', 'dz-chip y', 'Late ' + w.late_min + ' m') : el('span', 'dz-chip g', 'On duty');
    if (w.state === 'out') return el('span', 'dz-chip b', 'Out ' + w.out);
    if (w.state === 'check') return el('span', 'dz-chip b', 'To be checked');
    if (w.state === 'off') return el('span', 'dz-chip s', 'Off today');
    return el('span', 'dz-chip r', 'Not marked');
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
    photo: photo, thumb: thumb, face: function (name, key) { var a = el('span', 'dz-av', initials(name)); a.style.background = tintOf(key || name); a.setAttribute('aria-hidden', 'true'); return a; }, _initials: initials, _minOf: minOf
  };
})();
