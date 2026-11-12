/* HR – THE MUSTER, REQUESTS, SHIFTS & RULES, the HR office's pages (step 5, 12-11-2026). hr.js opens them: HRMUS.open(page, me, init).
 *   Muster          – the month of everybody: a letter a day (P, HD, A, WO, H …); a day opens with its punches, what was entered
 *                     for it and by whom; a day is entered by hand or corrected there – always a new row, the punches stay.
 *   Requests        – people's requests to set an old day right: approve / refuse.
 *   Shifts & rules  – shifts, holidays, the rules with their date, and (Super Admin) the HR Admin's powers.
 * Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var M = { me: null, init: null, month: '', cat: '', data: null, cfg: null, reg: 'pending', sel: null, wrap: null, side: null };
  var PAGES = [['muster', 'Muster'], ['requests', 'Requests'], ['rules', 'Shifts & rules']];
  var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
  var CODE = { P: 'Present', HD: 'Half day', A: 'Absent', WO: 'Weekly off', H: 'Holiday', WOP: 'Worked on a weekly off', HP: 'Worked on a holiday', IN: 'At work now', MIS: 'IN without OUT – to be set right', L: 'Leave' };
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var role = function () { return M.me ? M.me.user.role : ''; };
  var isAdmin = function () { return role() === 'admin' || role() === 'super'; };
  var may = function (p) { return role() === 'super' || (role() === 'admin' && (!M.cfg || M.cfg.powers[p] !== false)); };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('-') : ''; };
  var stamp = function (iso) { var t = Date.parse(iso); return isNaN(t) ? '' : dmy(new Date(t + 19800000).toISOString()) + ' ' + new Date(t + 19800000).toISOString().slice(11, 16); };
  function face(td, key) { if (window.HRDASH && window.HRDASH.face) td.insertBefore(window.HRDASH.face(td.textContent, key), td.firstChild); return td; }      // the letters of his name before it
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function opt(sel, value, text, on) { var o = el('option', '', text); o.value = value; if (on) o.selected = true; sel.appendChild(o); return o; }
  function field(parent, label, input, full) { var d = el('div', full ? 'full' : ''), l = el('label', '', label); d.appendChild(l); d.appendChild(input); parent.appendChild(d); return input; }
  function inp(type, value, attrs) { var i = el(type === 'select' ? 'select' : 'input'); if (type !== 'select') i.type = type; if (value !== undefined && value !== null) i.value = value; Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); }); return i; }
  function table(heads) { var box = el('div', 'box'), t = el('table'), h = el('thead'), r = el('tr'); heads.forEach(function (x) { r.appendChild(typeof x === 'string' ? el('th', '', x) : x); }); h.appendChild(r); t.appendChild(h); var b = el('tbody'); t.appendChild(b); box.appendChild(t); return { box: box, body: b, table: t }; }
  // a dialog made here: { body, err(e), acts, close() }
  function sheet(title, sub, wide) {
    var d = el('div', 'dlg'), s = el('div', 'sheet' + (wide ? ' wide' : '')); s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.appendChild(el('h2', '', title)); if (sub) s.appendChild(el('p', 'sub', sub));
    var body = el('div'), er = el('p', 'err'), acts = el('div', 'acts'); er.hidden = true; er.setAttribute('role', 'alert'); s.appendChild(body); s.appendChild(er); s.appendChild(acts); d.appendChild(s); document.body.appendChild(d);
    var key = function (ev) { if (ev.key === 'Escape') o.close(); };
    var o = { body: body, acts: acts, err: function (e) { er.textContent = e ? (e.message || String(e)) : ''; er.hidden = !e; }, close: function () { document.removeEventListener('keydown', key); if (d.parentNode) d.parentNode.removeChild(d); } };
    document.addEventListener('keydown', key); acts.appendChild(btn('sec', 'Close', o.close)); return o;
  }
  function whomFields(grid, cur) {
    var sc = field(grid, 'For whom', inp('select'), true), box = el('div', 'vals full'), st = { values: (cur && cur.scope_values || []).slice(), people: [] }; grid.appendChild(box);
    [['all', 'Everybody of the site'], ['category', 'Some categories'], ['department', 'Some departments'], ['people', 'Chosen people']].forEach(function (o) { opt(sc, o[0], o[1], cur ? cur.scope === o[0] : o[0] === 'all'); });
    var find = inp('text', '', { placeholder: 'Type a name or code to add a person', autocomplete: 'off' }), pick = el('div', 'pick full'), list = el('div'); list.hidden = true; pick.appendChild(find); pick.appendChild(list); grid.appendChild(pick);
    function draw() {
      box.textContent = ''; box.hidden = sc.value === 'all'; pick.hidden = sc.value !== 'people';
      var checks = function (items) { items.forEach(function (x) { var l = el('label', 'ck'), c = inp('checkbox'); c.checked = st.values.indexOf(x.id) > -1; c.onchange = function () { st.values = st.values.filter(function (v) { return v !== x.id; }); if (c.checked) st.values.push(x.id); }; l.appendChild(c); l.appendChild(document.createTextNode(' ' + x.name)); box.appendChild(l); }); };
      if (sc.value === 'category') checks(Object.keys(CAT).map(function (k) { return { id: k, name: CAT[k] }; }));
      if (sc.value === 'department') checks(M.init.departments.filter(function (d) { return d.active; }));
      if (sc.value === 'people') { st.people.forEach(function (x) { var t = el('span', 'tag', x.name + ' (' + x.code + ') '); t.appendChild(btn('x', '×', function () { st.people = st.people.filter(function (y) { return y.id !== x.id; }); draw(); })); box.appendChild(t); }); if (!st.people.length) box.appendChild(el('span', 'muted', 'Nobody chosen yet – type a name below.')); }
    }
    sc.onchange = function () { st.values = []; draw(); }; var tm;
    find.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { api('empPick', { q: find.value }).then(function (r) { list.textContent = ''; r.rows.filter(function (x) { return !st.people.some(function (y) { return y.id === x.id; }); }).forEach(function (x) { list.appendChild(btn('', x.name + ' (' + x.code + ')', function () { st.people.push(x); find.value = ''; list.hidden = true; draw(); })); }); list.hidden = !list.childNodes.length; }, function () { list.hidden = true; }); }, 250); };
    if (cur && cur.scope === 'people' && cur.people.length) api('empList', { q: '' }).then(function (r) { st.people = r.rows.filter(function (e) { return cur.people.indexOf(e.id) > -1; }).map(function (e) { return { id: e.id, code: e.code, name: e.name }; }); draw(); }, draw); else draw();
    return { get: function () { return { scope: sc.value, scope_values: st.values, people: st.people.map(function (x) { return x.id; }) }; } };
  }

  /* ───────────── Muster ───────────── (the look he approved, 12-11-2026: colour cells; a day opens in a panel on the right) */
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function muster() {
    var root = $('p_mus'); root.textContent = '';
    var top = el('div', 'dz-top'), tt = el('div'), sub = el('small', '', MON[+M.month.slice(5) - 1] + ' ' + M.month.slice(0, 4) + (M.me ? ' · ' + (M.me.siteName || M.me.site) : '')); tt.appendChild(el('h2', '', 'Muster · हजेरीपट')); tt.appendChild(sub); top.appendChild(tt);
    var pills = el('div', 'dz-pills'), mo = inp('month', M.month, { 'aria-label': 'Month' }), cat = inp('select', null, { 'aria-label': 'Category' }); mo.className = 'dz-pill'; cat.className = 'dz-pill';
    opt(cat, '', 'All categories', !M.cat); Object.keys(CAT).forEach(function (k) { opt(cat, k, CAT[k], M.cat === k); });
    mo.onchange = function () { if (mo.value) { M.month = mo.value; M.sel = null; muster(); } }; cat.onchange = function () { M.cat = cat.value; M.sel = null; muster(); };
    var dlb = btn('dz-pill dark', 'Download (CSV)', function () { csv(); });
    if (window.HRHEAD) window.HRHEAD.set('Muster · हजेरीपट', sub.textContent, [cat, mo, dlb]); else { pills.appendChild(cat); pills.appendChild(mo); pills.appendChild(dlb); top.appendChild(pills); root.appendChild(top); }
    var wrap = el('div', 'mz-wrap mz'), card = el('div', 'dz-card'), side = el('div', 'mz-side'); side.hidden = true; wrap.appendChild(card); wrap.appendChild(side); root.appendChild(wrap); M.wrap = wrap; M.side = side;
    api('muster', { month: M.month, category: M.cat }).then(function (r) {
      M.data = r; var free = function (d) { return r.week_off.indexOf(new Date(d + 'T00:00:00Z').getUTCDay()) > -1 || r.holidays.some(function (h) { return h.day === d; }); };
      var work = r.days.filter(function (d) { return d <= r.today && !free(d); }).length, h = el('h3', '', r.rows.length + (r.rows.length === 1 ? ' employee' : ' employees') + ' · ' + work + (work === 1 ? ' working day' : ' working days') + ' so far');
      var lg = el('span', 'dz-leg'); lg.style.marginTop = '0'; [['p', 'Present'], ['l', 'Late'], ['h', 'Half day'], ['a', 'Absent'], ['v', 'Leave'], ['o', 'Weekly off / holiday']].forEach(function (k) { var s = el('span'); s.appendChild(el('i', k[0])); s.appendChild(document.createTextNode(k[1])); lg.appendChild(s); }); h.appendChild(lg); card.appendChild(h);
      var heads = [el('th', '', 'Employee')];
      r.days.forEach(function (d) { var wd = new Date(d + 'T00:00:00Z').getUTCDay(), th = el('th', (d === r.today ? 'today' : '') + (free(d) ? ' free' : '')); th.appendChild(el('div', '', WD[wd].slice(0, 1))); th.appendChild(el('div', '', +d.slice(8))); heads.push(th); });
      ['P', 'HD', 'A', 'Late', 'Days'].forEach(function (x) { heads.push(el('th', 'mt', x)); });
      var t = table(heads); t.table.className = 'mz'; t.box.style.border = '0'; t.box.style.borderRadius = '0';
      r.rows.forEach(function (w) {
        var tr = el('tr'), nm = el('td'); nm.appendChild(el('b', '', w.name)); nm.appendChild(el('small', '', w.code + ' · ' + (CAT[w.category] || ''))); tr.appendChild(nm);
        w.codes.forEach(function (c, i) {
          var d = r.days[i], late = !!w.late[i], blue = late && c === 'P', td = el('td'), b = el('button', 'mz-c ' + (blue ? 'L' : c === 'L' ? 'LV' : c || 'none'), blue ? 'L' : c === 'L' ? 'LV' : c || ''), marks = (late && !blue ? '•' : '') + (w.fix[i] ? '✎' : '') + (w.wait[i] ? '?' : '');
          b.type = 'button'; if (marks) b.appendChild(el('sup', '', marks)); b.dataset.k = w.id + '|' + d;
          b.title = w.name + ' – ' + dmy(d) + (c ? ': ' + CODE[c] : '') + (late ? ', late' : '') + (w.fix[i] ? ', entered or corrected by hand' : '') + (w.wait[i] ? ', a punch waits to be looked at' : ''); b.setAttribute('aria-label', b.title);
          b.onclick = function () { M.sel = { id: w.id, d: d }; day(w, d); }; td.appendChild(b); tr.appendChild(td);
        });
        [w.total.P, w.total.HD, w.total.A + w.total.MIS, w.total.late, w.total.paid].forEach(function (v) { tr.appendChild(el('td', 'mt', v)); }); t.body.appendChild(tr);
      });
      if (!r.rows.length) t.box.appendChild(el('p', 'none', 'No employee in this month.'));
      card.appendChild(t.box);
      card.appendChild(el('p', 'muted', 'L = present, came late   LV = leave   IN = at work now   MIS = IN without OUT, to be set right   • late   ✎ entered or corrected by hand   ? a punch waits to be looked at. Press a day to open it.'));
      card.appendChild(el('p', 'muted', '"Days" = present + half days × ½ + weekly offs + holidays − the half days for late coming (when the rule is set). A day with IN but no OUT is counted as absent until it is set right.'));
      if (M.sel) { var w = r.rows.filter(function (x) { return x.id === M.sel.id; })[0]; if (w && r.days.indexOf(M.sel.d) > -1) day(w, M.sel.d); else M.sel = null; }
    }, fail);
  }
  function csv() {
    var r = M.data; if (!r) return; var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['Code', 'Name', 'Category'].concat(r.days.map(function (d) { return d.slice(8); }), ['P', 'HD', 'A', 'WO', 'H', 'IN without OUT', 'Late days', 'Days']).map(q).join(',')];
    r.rows.forEach(function (w) { lines.push([w.code, w.name, CAT[w.category] || ''].concat(w.codes, [w.total.P, w.total.HD, w.total.A, w.total.WO, w.total.H, w.total.MIS, w.total.late, w.total.paid]).map(q).join(',')); });
    var a = el('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' })); a.download = 'Muster_' + r.month + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  // one day of one person – the panel on the right
  function day(w, d) {
    var side = M.side, sky = el('div', 'mz-sky none'), bd = el('div', 'mz-bd'), er = el('p', 'err'), wd = new Date(d + 'T00:00:00Z').getUTCDay(); side.textContent = ''; side.hidden = false; M.wrap.classList.add('open');
    var unsel = function () { Array.prototype.forEach.call(M.wrap.querySelectorAll('.mz-c.sel'), function (b) { b.classList.remove('sel'); }); };
    unsel(); Array.prototype.forEach.call(M.wrap.querySelectorAll('.mz-c'), function (b) { if (b.dataset.k === w.id + '|' + d) b.classList.add('sel'); });
    var x = btn('mz-x', '×', function () { M.sel = null; side.hidden = true; M.wrap.classList.remove('open'); unsel(); }); x.setAttribute('aria-label', 'Close this day'); sky.appendChild(x);
    sky.appendChild(el('small', '', WD[wd] + ', ' + dmy(d))); sky.appendChild(el('h3', '', w.name)); sky.appendChild(el('small', '', w.code + ' · ' + (CAT[w.category] || ''))); var chip = el('em', '', '…'); sky.appendChild(chip);
    er.hidden = true; er.setAttribute('role', 'alert'); side.appendChild(sky); side.appendChild(bd); bd.appendChild(el('p', 'muted', 'Opening…'));
    var s = { sky: sky, chip: chip, body: bd, err: function (e) { er.textContent = e ? (e.message || String(e)) : ''; er.hidden = !e; if (e) bd.appendChild(er); } };
    api('dayGet', { id: w.id, day: d }).then(function (r) { if (M.sel && (M.sel.id !== w.id || M.sel.d !== d)) return; fillDay(s, w, d, r); }, function (e) { bd.textContent = ''; s.err(e); });
  }
  function fillDay(s, w, d, r) {
    var b = s.body, x = r.day; b.textContent = ''; s.err(null);
    s.sky.className = 'mz-sky ' + (x.code || 'none'); s.chip.textContent = (x.code ? CODE[x.code] : 'Nothing yet') + (x.in && x.out ? ' · ' + x.hours + ' h' : '') + (x.late_min ? ' · late ' + x.late_min + ' m' : '');
    r.punches.forEach(function (p) {
      var c = el('div', 'mz-pun'), t = el('div'), kind = p.kind === 'in' ? 'IN' : 'OUT', line = el('div');
      if (window.HRDASH) { var th = window.HRDASH.thumb(p.id, w.name + ' – ' + kind + ' ' + p.time, true); th.className += ' big'; c.appendChild(th); }
      line.appendChild(el('span', 'dz-chip ' + (p.kind === 'in' ? 'g' : 'y'), kind)); line.appendChild(document.createTextNode(' ')); line.appendChild(el('b', '', p.time)); t.appendChild(line);
      t.appendChild(el('small', '', [p.place, p.offline ? 'sent later' : '', p.status === 'review' ? 'to be looked at' : ''].filter(Boolean).join(' · ') || '–')); c.appendChild(t); b.appendChild(c);
    });
    if (!r.punches.length) b.appendChild(el('p', 'muted', 'No punch on this day.'));
    r.requests.filter(function (q) { return q.status === 'pending'; }).forEach(function (q) {
      var c = el('div', 'mz-req'); c.appendChild(el('b', '', 'Request waiting · विनंती बाकी')); c.appendChild(el('p', '', 'IN ' + (q.in_time || '–') + ' · OUT ' + (q.out_time || '–') + ' – "' + q.reason + '"'));
      if (q.level === 1 && role() !== 'super') c.appendChild(el('small', '', 'It still waits for the reporting person.'));
      else if (may('regularize')) {
        var note = inp('text', '', { maxlength: 200, placeholder: 'Why it is refused', 'aria-label': 'Why it is refused' }); note.hidden = true; c.appendChild(note);
        var send = function (dec) { api('regDecide', { id: q.id, decision: dec, note: note.value }).then(function () { toast(dec === 'approved' ? 'Approved.' : 'Refused.'); muster(); }, function (e) { s.err(e); }); };
        c.appendChild(btn('mz-ok', 'Approve', function () { send('approved'); })); c.appendChild(btn('mz-no', 'Refuse', function () { if (note.hidden) { note.hidden = false; note.focus(); } else send('refused'); }));
      }
      b.appendChild(c);
    });
    b.appendChild(el('label', '', 'How this day was counted')); var dl = el('dl'), row = function (k, v) { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v || '–')); };
    row('Counts as', x.code ? x.code + ' – ' + CODE[x.code] : 'Nothing yet'); row('IN', x.in); row('OUT', x.out + (x.next_day ? ' (next day)' : '')); row('Hours', x.in && x.out ? x.hours : ''); if (x.late_min) row('Late', x.late_min + ' min'); if (x.early_min) row('Left early', x.early_min + ' min');
    row('Shift', x.shift); if (x.holiday) row('Holiday', x.holiday); row('From', x.src === 'punch' ? 'His punches' : x.src === 'manual' ? 'Entered by hand' : x.src === 'correction' ? 'Corrected' : x.src === 'regularized' ? 'His request, approved' : ''); b.appendChild(dl);
    if (r.entries.length) { b.appendChild(el('label', '', 'Entered for this day (the newest counts)')); var u2 = el('ul', 'hist'); r.entries.forEach(function (e, i) { u2.appendChild(el('li', i ? 'off' : '', (e.in || e.out ? 'IN ' + (e.in || '–') + ' · OUT ' + (e.out || '–') : 'No attendance') + ' — was IN ' + (e.old_in || '–') + ' · OUT ' + (e.old_out || '–') + ' — ' + e.reason + ' — ' + e.by + ', ' + stamp(e.at))); }); b.appendChild(u2); }
    var old = r.requests.filter(function (q) { return q.status !== 'pending'; });
    if (old.length) { b.appendChild(el('label', '', 'His requests')); var u3 = el('ul', 'hist'); old.forEach(function (q) { u3.appendChild(el('li', '', 'IN ' + (q.in_time || '–') + ' · OUT ' + (q.out_time || '–') + ' — ' + q.reason + ' — ' + q.status)); }); b.appendChild(u3); }
    var has = x.punches > 0 || (x.src && x.src !== 'punch'), can = d <= r.today && may(has ? 'correct' : 'manual');
    var form = el('div'), top = el('div', 'acts'), ti = inp('time', x.in), to = inp('time', x.out); form.hidden = true;
    if (can) top.appendChild(btn('pri', has ? 'Correct this day' : 'Enter this day by hand', function () { form.hidden = !form.hidden; if (!form.hidden) ti.focus(); }));
    top.appendChild(btn('sec', 'Open employee', function () { if (window.HR && window.HR.emp) window.HR.emp(w.id); })); b.appendChild(top); b.appendChild(form);
    if (!can) return;
    var g = el('div', 'grid'); g.style.marginTop = '12px'; field(g, 'IN', ti); field(g, 'OUT', to);
    var nx = inp('checkbox'), l = el('label', 'ck'); nx.checked = !!x.next_day; l.appendChild(nx); l.appendChild(document.createTextNode(' OUT is on the next day (night)')); var d1 = el('div', 'full'); d1.appendChild(l); g.appendChild(d1);
    var why = field(g, 'Reason *', inp('text', '', { maxlength: 200 }), true); form.appendChild(g);
    var save = function (body) { api('daySet', Object.assign({ id: w.id, day: d, reason: why.value }, body)).then(function () { toast('Saved.'); muster(); }, function (e) { s.err(e); }); };
    var acts = el('div', 'acts'); acts.appendChild(btn('pri', 'Save', function () { save({ in_time: ti.value, out_time: to.value, out_next_day: nx.checked }); })); if (has) acts.appendChild(btn('danger', 'No attendance on this day', function () { save({ none: true }); })); form.appendChild(acts);
  }

  /* ───────────── Requests ───────────── */
  function requests() {
    var root = $('p_mus'); root.textContent = ''; var tools = el('div', 'tools');
    [['pending', 'Waiting'], ['approved', 'Approved'], ['refused', 'Refused']].forEach(function (k) { tools.appendChild(btn(M.reg === k[0] ? 'pri' : 'sec', k[1], function () { M.reg = k[0]; requests(); })); }); root.appendChild(tools);
    var note = el('p', 'muted', 'A person asks to set an old day right (he forgot IN or OUT, the phone was dead). It counts only when approved – as a new entry of that day, with his reason and who approved.'); note.style.margin = '0 0 10px'; root.appendChild(note);
    api('regList', { status: M.reg }).then(function (r) {
      var t = table(['Code', 'Name', 'Day', 'IN', 'OUT', 'Reason', 'Asked', 'Where it stands', '']);
      r.rows.forEach(function (q) {
        var tr = el('tr'); tr.style.cursor = 'default'; [q.code, q.name, dmy(q.day), q.in_time || '–', (q.out_time || '–') + (q.out_next_day ? ' (next day)' : '')].forEach(function (v, i) { var td = el('td', i === 1 ? 'nm' : '', v); if (i === 1) face(td, q.code); tr.appendChild(td); });
        var why = el('td', '', q.reason); why.style.whiteSpace = 'normal'; tr.appendChild(why); tr.appendChild(el('td', '', stamp(q.asked_at)));
        var st = el('td'); st.style.whiteSpace = 'normal'; st.appendChild(el('span', 'st ' + (q.status === 'pending' ? 's-incomplete' : q.status === 'approved' ? 's-active' : 's-left'), q.status === 'pending' ? (q.level === 1 ? 'With the reporting person' : 'With the HR office') : q.status === 'approved' ? 'Approved' : 'Refused'));
        q.steps.forEach(function (p) { st.appendChild(el('div', 'muted', (p.level === 1 ? 'Reporting person' : 'HR office') + ': ' + p.decision + ' – ' + p.by + (p.note ? ' – ' + p.note : ''))); }); tr.appendChild(st);
        var a = el('td'); if (q.status === 'pending' && r.can && (q.level === 2 || role() === 'super')) { a.appendChild(btn('sm', 'Approve', function () { decide(q, 'approved'); })); var no = btn('sm ghost', 'Refuse', function () { decide(q, 'refused'); }); no.style.marginLeft = '6px'; a.appendChild(no); } tr.appendChild(a); t.body.appendChild(tr);
      });
      if (!r.rows.length) t.box.appendChild(el('p', 'none', M.reg === 'pending' ? 'Nothing is waiting.' : 'None.')); root.appendChild(t.box);
    }, fail);
  }
  function decide(q, what) {
    var s = sheet((what === 'approved' ? 'Approve' : 'Refuse') + ': ' + q.name + ' – ' + dmy(q.day), 'IN ' + (q.in_time || '–') + ' · OUT ' + (q.out_time || '–') + ' — ' + q.reason), note = field(s.body, what === 'approved' ? 'Note (if any)' : 'Reason *', inp('text', '', { maxlength: 200 }));
    s.acts.appendChild(btn(what === 'approved' ? 'pri' : 'danger', what === 'approved' ? 'Approve' : 'Refuse', function () { api('regDecide', { id: q.id, decision: what, note: note.value }).then(function () { s.close(); toast(what === 'approved' ? 'Approved – the day is set.' : 'Refused.'); requests(); }, function (e) { s.err(e); }); })); note.focus();
  }

  /* ───────────── Shifts & rules ───────────── */
  function rules() { api('attSetup').then(function (c) { M.cfg = c; drawRules(); }, fail); }
  function head(root, text, action) { var h = el('div', 'tools'); h.style.margin = '18px 0 8px'; var t = el('h3', '', text); t.style.margin = '0'; t.style.fontSize = '17px'; t.style.flex = '1'; h.appendChild(t); (action || []).forEach(function (b) { h.appendChild(b); }); root.appendChild(h); }
  function whomText(p) { return p.scope === 'all' ? 'Everybody of the site' : p.scope === 'category' ? p.scope_values.map(function (c) { return CAT[c] || c; }).join(', ') : p.scope === 'department' ? p.scope_values.map(function (d) { var r = M.init.departments.filter(function (x) { return x.id === d; })[0]; return r ? r.name : '?'; }).join(', ') : p.people.length + ' chosen people'; }
  function drawRules() {
    var root = $('p_mus'), c = M.cfg, can = may('shifts'); root.textContent = '';
    // shifts
    head(root, 'Shifts', can ? [btn('pri', '+ Add shift', function () { shiftForm(null); })] : []);
    var t = table(['Shift', 'From – to', 'Break', 'For whom', 'From', 'Status']);
    c.shifts.forEach(function (sh) { var tr = el('tr'); tr.tabIndex = 0; [sh.name, sh.start_time + ' – ' + sh.end_time + (sh.end_time < sh.start_time ? ' (next day)' : ''), sh.break_min ? sh.break_min + ' min' : '–', whomText(sh), dmy(sh.valid_from)].forEach(function (v, i) { tr.appendChild(el('td', i ? '' : 'nm', v)); }); var st = el('td'); st.appendChild(el('span', 'st ' + (sh.active ? 's-active' : 's-left'), sh.active ? 'On' : 'Off')); tr.appendChild(st); tr.onclick = function () { shiftForm(sh); }; t.body.appendChild(tr); });
    if (!c.shifts.length) t.box.appendChild(el('p', 'none', 'No shift yet. Without a shift nobody is "late" – only the hours are counted.')); root.appendChild(t.box);
    // rules
    head(root, 'Attendance rules' + (c.rules_from ? ' – valid from ' + dmy(c.rules_from) : ' – none set yet'), []);
    var box = el('div', 'box'); box.style.padding = '16px'; var g = el('div', 'grid'), r = c.rules, num = function (v) { return v === undefined ? '' : v; };
    var f = { full_hours: field(g, 'Hours for a full day', inp('number', num(r.full_hours), { min: 1, max: 24, step: 0.5 })), half_hours: field(g, 'Hours for a half day (below: absent)', inp('number', num(r.half_hours), { min: 0.5, max: 24, step: 0.5 })),
      grace_min: field(g, 'Late after the shift\'s start + minutes', inp('number', num(r.grace_min), { min: 0, max: 240 })), early_min: field(g, 'Left early before the shift\'s end − minutes', inp('number', num(r.early_min), { min: 0, max: 240 })),
      late_to_half: field(g, 'So many late days in a month = one half day (empty = never)', inp('number', num(r.late_to_half), { min: 0, max: 31 })), reg_levels: field(g, 'Who decides a request', inp('select')) };
    opt(f.reg_levels, '1', 'The HR office', r.reg_levels !== 2); opt(f.reg_levels, '2', 'First the reporting person, then the HR office', r.reg_levels === 2);
    var wo = el('div', 'full'); wo.appendChild(el('label', '', 'Weekly off')); var days = []; WD.forEach(function (n, i) { var l = el('label', 'ck'), cb = inp('checkbox'); cb.checked = (r.week_off || []).indexOf(i) > -1; days.push(cb); l.appendChild(cb); l.appendChild(document.createTextNode(' ' + n)); wo.appendChild(l); }); g.appendChild(wo);
    var from = field(g, 'These rules count from (empty = today)', inp('date', '')); box.appendChild(g);
    box.appendChild(el('p', 'muted', 'A rule left empty is not applied. Saving makes a NEW version from that date – the days before it keep the rules they had.'));
    var er = el('p', 'err'); er.hidden = true; box.appendChild(er);
    if (can) { var acts = el('div', 'acts'); acts.style.justifyContent = 'flex-start'; acts.appendChild(btn('pri', 'Save the rules', function () { var b = { valid_from: from.value, week_off: days.map(function (cb, i) { return cb.checked ? i : -1; }).filter(function (i) { return i > -1; }) }; Object.keys(f).forEach(function (k) { b[k] = f[k].value; });
      api('rulesSave', b).then(function (n) { M.cfg = n; toast('Rules saved.'); drawRules(); }, function (e) { er.textContent = e.message; er.hidden = false; }); })); box.appendChild(acts); }
    else Array.prototype.forEach.call(box.querySelectorAll('input,select'), function (i) { i.disabled = true; });
    if (c.versions.length > 1) { box.appendChild(el('label', '', 'Earlier versions')); var ul = el('ul', 'hist'); c.versions.slice(1, 12).forEach(function (v) { ul.appendChild(el('li', 'off', 'From ' + dmy(v.valid_from) + ' — ' + (Object.keys(v.rules).map(function (k) { return k + ': ' + (Array.isArray(v.rules[k]) ? v.rules[k].map(function (i) { return WD[i]; }).join('/') : v.rules[k]); }).join(', ') || 'no rule') + ' — ' + v.by + ', ' + stamp(v.at))); }); box.appendChild(ul); }
    root.appendChild(box);
    // holidays
    head(root, 'Holidays', can ? [btn('sec', 'Add many (a list)', holidayMany), btn('pri', '+ Add holiday', holidayForm)] : []);
    var th = table(['Day', '', 'Holiday', '']);
    c.holidays.slice().reverse().forEach(function (h) { var tr = el('tr'); tr.style.cursor = 'default'; tr.appendChild(el('td', 'nm', dmy(h.day))); tr.appendChild(el('td', '', WD[new Date(h.day + 'T00:00:00Z').getUTCDay()])); tr.appendChild(el('td', '', h.name)); var a = el('td'); if (can) a.appendChild(btn('sm ghost', 'Remove', function () { api('holidayRemove', { id: h.id }).then(function (n) { M.cfg = n; toast('Removed.'); drawRules(); }, fail); })); tr.appendChild(a); th.body.appendChild(tr); });
    if (!c.holidays.length) th.box.appendChild(el('p', 'none', 'No holiday yet.')); root.appendChild(th.box);
    // the HR Admin's powers
    head(root, 'What the HR Admin may do on this site', []);
    var pb = el('div', 'box'); pb.style.padding = '8px 16px';
    c.power_list.forEach(function (p) { var l = el('label', 'ck'), cb = inp('checkbox'); l.style.display = 'flex'; l.style.padding = '8px 0'; cb.checked = c.powers[p.key] !== false; cb.disabled = role() !== 'super'; cb.onchange = function () { api('powerSet', { power: p.key, allowed: cb.checked }).then(function (n) { M.cfg = n; toast(cb.checked ? 'Given.' : 'Taken.'); }, function (e) { cb.checked = !cb.checked; fail(e); }); }; l.appendChild(cb); l.appendChild(document.createTextNode(' ' + p.name)); pb.appendChild(l); });
    pb.appendChild(el('p', 'muted', role() === 'super' ? 'Untick what the HR Admin of this site should not do. The Super Admin can always do everything.' : 'Only the Super Admin changes these.')); root.appendChild(pb);
  }
  function shiftForm(sh) {
    var can = may('shifts'), s = sheet(sh ? sh.name : 'New shift', 'A change counts for the days from its date – a person\'s most exact shift wins: chosen for him, then his department, his category, everybody.'), g = el('div', 'grid'); s.body.appendChild(g);
    var name = field(g, 'Name *', inp('text', sh ? sh.name : '', { maxlength: 40 })), st = field(g, 'Starts at *', inp('time', sh ? sh.start_time : '09:00')), en = field(g, 'Ends at * (earlier than the start = next day)', inp('time', sh ? sh.end_time : '18:00')), br = field(g, 'Break, minutes (not counted as work)', inp('number', sh ? sh.break_min : 0, { min: 0, max: 240 })), from = field(g, 'From which date (empty = today)', inp('date', sh ? sh.valid_from : ''));
    var who = whomFields(g, sh), on = inp('checkbox'), l = el('label', 'ck'); on.checked = sh ? sh.active : true; l.appendChild(on); l.appendChild(document.createTextNode(' On')); var d = el('div', 'full'); d.appendChild(l); g.appendChild(d);
    if (!can) { Array.prototype.forEach.call(g.querySelectorAll('input,select'), function (i) { i.disabled = true; }); return; }
    if (sh) { var why = inp('text', '', { maxlength: 200, placeholder: 'Why is it removed?' }); why.hidden = true; var wd = el('div', 'full'); wd.appendChild(why); g.appendChild(wd); var del = btn('danger', 'Remove…', function () { if (why.hidden) { why.hidden = false; why.focus(); return; } api('shiftRemove', { id: sh.id, reason: why.value }).then(function (n) { M.cfg = n; s.close(); toast('Removed.'); drawRules(); }, function (e) { s.err(e); }); }); del.style.marginRight = 'auto'; s.acts.insertBefore(del, s.acts.firstChild); }
    s.acts.appendChild(btn('pri', 'Save', function () { api('shiftSave', Object.assign({ id: sh ? sh.id : '', name: name.value, start_time: st.value, end_time: en.value, break_min: br.value, valid_from: from.value, active: on.checked }, who.get())).then(function (n) { M.cfg = n; s.close(); toast('Saved.'); drawRules(); }, function (e) { s.err(e); }); }));
  }
  function holidayForm() {
    var s = sheet('New holiday', 'A holiday of this site. Whoever works on it is shown as "worked on a holiday".'), g = el('div', 'grid'); s.body.appendChild(g); var day = field(g, 'Day *', inp('date', '')), name = field(g, 'Name *', inp('text', '', { maxlength: 60 }));
    s.acts.appendChild(btn('pri', 'Save', function () { api('holidaySave', { day: day.value, name: name.value }).then(function (n) { M.cfg = n; s.close(); toast('Saved.'); drawRules(); }, function (e) { s.err(e); }); }));
  }
  function holidayMany() {
    var s = sheet('Add many holidays', 'One line a holiday: date, name – for example: 26-01-2027, Republic Day. All lines are saved, or none.'), ta = el('textarea'); ta.style.height = '180px'; ta.style.width = '100%'; s.body.appendChild(ta); var res = el('div'); s.body.appendChild(res);
    s.acts.appendChild(btn('pri', 'Check and save', function () { var rows = ta.value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { var i = l.search(/[,;\t]/); return i < 0 ? { day: l, name: '' } : { day: l.slice(0, i).trim(), name: l.slice(i + 1).trim() }; });
      api('holidaySave', { rows: rows }).then(function (n) { if (n.saved) { M.cfg = n; s.close(); toast(n.saved + ' holidays added.'); drawRules(); return; } res.textContent = ''; res.appendChild(el('p', 'sum', 'Nothing was saved – set these lines right first:')); var ul = el('ul', 'faults'); n.lines.forEach(function (x) { ul.appendChild(el('li', '', 'Line ' + x.line + ': ' + x.error)); }); res.appendChild(ul); }, function (e) { s.err(e); }); }));
  }

  window.HRMUS = {
    pages: PAGES,
    has: function (page) { return PAGES.some(function (p) { return p[0] === page; }); },
    open: function (page, me, init) {
      M.me = me; M.init = init; if (!M.month) M.month = new Date(Date.now() + 19800000).toISOString().slice(0, 7);
      var go = function () { if (page === 'requests') requests(); else if (page === 'rules') rules(); else muster(); };
      if (M.cfg || page === 'rules') go(); else api('attSetup').then(function (c) { M.cfg = c; go(); }, function () { go(); });      // (the powers: which buttons to show – the server decides anyway)
    },
    _code: CODE
  };
})();
