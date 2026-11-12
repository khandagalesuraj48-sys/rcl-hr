/* HR – THE MONTH: verified by the site's HR, approved by the HO HR (step 10, 12-11-2026). hr.js opens it: HRMONTH.open(page, me).
 *   This site – everybody of the month with his counts (present, half, absent, leave, extra days, late, days for pay): the site's
 *               HR ticks people and verifies them; the HO HR sends people back or approves the month.
 *   All sites – (HO HR) where every site's month stands.
 *   HO HR     – (Super Admin) who is HO HR.
 * Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var prev = function () { var d = new Date(Date.now() + 19800000); d.setUTCDate(0); return d.toISOString().slice(0, 7); };      // the month before this one
  var V = { me: null, view: 'site', month: prev(), picked: {}, data: null };
  var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
  var STATE = { open: ['Not verified', '#566589', '#EEF2F8'], verified: ['Verified', '#0B6B3A', '#DDF5E6'], changed: ['Changed since verified', '#8A5A00', '#FFF1CC'], returned: ['Sent back', '#B42318', '#FDECEC'] };
  var when = function (t) { return t ? new Date(Date.parse(t) + 19800000).toISOString().slice(0, 16).split('T').map(function (p, i) { return i ? p : p.split('-').reverse().join('-'); }).join(' ') : ''; };
  var mName = function (m) { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m.slice(5) - 1] + ' ' + m.slice(0, 4); };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 9000 : 3500); }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function table(heads) { var box = el('div', 'box'), t = el('table'), h = el('thead'), r = el('tr'); heads.forEach(function (x) { r.appendChild(typeof x === 'string' ? el('th', '', x) : x); }); h.appendChild(r); t.appendChild(h); var b = el('tbody'); t.appendChild(b); box.appendChild(t); return { box: box, body: b }; }
  function note(text, kind) { var p = el('p', '', text); p.style.cssText = 'margin:0 0 12px;padding:11px 14px;border-radius:14px;font-size:14.5px;' + (kind === 'ok' ? 'background:#DDF5E6;color:#0B6B3A' : kind === 'warn' ? 'background:#FFF1CC;color:#6B4700' : 'background:#E9F2FF;color:#0B3A6B'); return p; }
  function monthPick() { var i = el('input'); i.type = 'month'; i.value = V.month; i.max = new Date(Date.now() + 19800000).toISOString().slice(0, 7); i.style.flex = '0 0 180px'; i.onchange = function () { if (/^\d{4}-\d{2}$/.test(i.value)) { V.month = i.value; V.picked = {}; draw(); } }; return i; }

  function draw() {
    var root = $('p_month'); root.textContent = ''; var d = V.data, tools = el('div', 'tools');
    var views = [['site', 'This site']]; if (d && d.can.ho) views.push(['sites', 'All sites']); if (V.me && V.me.user && V.me.user.role === 'super') views.push(['ho', 'HO HR']);
    if (views.length > 1) views.forEach(function (k) { tools.appendChild(btn(V.view === k[0] ? 'pri' : 'sec', k[1], function () { V.view = k[0]; draw(); })); });
    if (V.view !== 'ho') tools.appendChild(monthPick());
    root.appendChild(tools); var body = el('div'); root.appendChild(body);
    if (V.view === 'sites') return sites(body); if (V.view === 'ho') return hoPeople(body);
    api('monthList', { month: V.month }).then(function (r) { var first = !V.data; V.data = r; if (first && (r.can.ho || (V.me && V.me.user && V.me.user.role === 'super'))) return draw(); site(body, r); }, function (e) { body.appendChild(el('p', 'none', e.message)); });
  }
  function site(root, r) {
    var chips = el('div', 'chips'); [['People', r.sum.people], ['Verified', r.sum.verified], ['Changed since', r.sum.changed], ['Sent back', r.sum.returned], ['Not verified', r.sum.open]].forEach(function (c) { var x = el('div', 'chip'); x.style.cursor = 'default'; x.appendChild(el('b', '', c[1])); x.appendChild(el('span', '', c[0])); chips.appendChild(x); }); root.appendChild(chips);
    if (r.approved) root.appendChild(note(mName(r.month) + ' is approved by the HO HR (' + r.approved.by + ', ' + when(r.approved.at) + ')' + (r.approved.note ? ' – ' + r.approved.note : '') + '. No day of this month is changed any more.', 'ok'));
    else if (!r.ended) root.appendChild(note(mName(r.month) + ' is still running – a month is verified after its last day. The counts below are as of today.', 'warn'));
    else if (r.reopened) root.appendChild(note('This month was opened again by the Super Admin (' + r.reopened.by + ', ' + when(r.reopened.at) + '): ' + r.reopened.reason, 'warn'));
    else root.appendChild(note('The site\'s HR verifies each person; a verified person is with the HO HR at once. Until the HO HR approves the month, a day can still be set right – then verify that person again.'));
    var all = el('input'); all.type = 'checkbox'; var thAll = el('th'); thAll.appendChild(all);
    var may = r.can.verify || (r.can.ho && !r.approved);
    var t = table((may ? [thAll] : []).concat(['Code', 'Name', 'Present', 'Half day', 'Absent', 'Leave', 'Extra days', 'Late days', 'Weekly off', 'Holiday', 'Days for pay', 'Where it stands']));
    var boxes = [];
    r.rows.forEach(function (w) {
      var tr = el('tr'), c = w.counts;
      if (may) { var td = el('td'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!V.picked[w.id]; cb.onchange = function () { if (cb.checked) V.picked[w.id] = 1; else delete V.picked[w.id]; count(); }; td.appendChild(cb); tr.appendChild(td); boxes.push([cb, w]); }
      tr.appendChild(el('td', '', w.code)); var nm = el('td', '', w.name); nm.appendChild(el('small', '', ' ' + (CAT[w.category] || ''))); nm.lastChild.style.color = '#8592AD'; tr.appendChild(nm);
      [c.present, c.half, c.absent, c.leave, c.extra, c.late, c.week_off, c.holiday].forEach(function (v) { var x = el('td', '', v || '–'); x.style.textAlign = 'center'; tr.appendChild(x); });
      var pay = el('td', '', c.paid); pay.style.cssText = 'text-align:center;font-weight:700'; tr.appendChild(pay);
      var st = el('td'), s = STATE[w.state], tag = el('span', '', s[0]); tag.style.cssText = 'display:inline-block;border-radius:999px;padding:4px 11px;font-size:13px;font-weight:600;color:' + s[1] + ';background:' + s[2]; st.appendChild(tag);
      var sub = w.returned ? 'Sent back by ' + w.returned.by + ': ' + w.returned.reason : w.blocked ? w.blocked : w.verified ? w.verified.by + ', ' + when(w.verified.at) : '';
      if (sub) { var sm = el('div', '', sub); sm.style.cssText = 'font-size:12.5px;margin-top:3px;color:' + (w.blocked && w.state !== 'verified' ? '#B42318' : '#8592AD'); st.appendChild(sm); }
      tr.appendChild(st); t.body.appendChild(tr);
    });
    if (!r.rows.length) t.box.appendChild(el('p', 'none', 'No employee on this site in ' + mName(r.month) + '.'));
    var acts = el('div', 'tools'), n = el('span', 'muted', ''); n.style.alignSelf = 'center';
    function ids() { return Object.keys(V.picked); }
    function count() { n.textContent = ids().length ? ids().length + ' chosen' : ''; }
    all.onchange = function () { boxes.forEach(function (b) { b[0].checked = all.checked; if (all.checked) V.picked[b[1].id] = 1; else delete V.picked[b[1].id]; }); count(); };
    function done(msg) { return function (x) { V.picked = {}; V.data = x; toast(msg(x), !!(x.skipped && x.skipped.length)); draw(); }; }
    if (r.can.verify) {
      acts.appendChild(btn('pri', 'Verify the chosen people', function () { if (!ids().length) return toast('Tick the people first.', true); api('monthVerify', { month: r.month, ids: ids() }).then(done(function (x) { return x.saved + ' verified.' + (x.skipped.length ? ' Not verified: ' + x.skipped.slice(0, 4).map(function (k) { return (k.code || '') + ' ' + (k.name || '') + ' – ' + k.reason; }).join(' ') : ''); }), fail); }));
      acts.appendChild(btn('sec', 'Tick everybody not verified', function () { boxes.forEach(function (b) { var on = b[1].state !== 'verified' && !b[1].blocked; b[0].checked = on; if (on) V.picked[b[1].id] = 1; else delete V.picked[b[1].id]; }); count(); }));
    }
    if (r.can.ho && !r.approved && r.ended) {
      var why = el('input'); why.placeholder = 'Why it is sent back'; why.hidden = true;
      acts.appendChild(btn('sec', 'Send back the chosen…', function () { if (!ids().length) return toast('Tick the people first.', true); if (why.hidden) { why.hidden = false; why.focus(); return; } api('monthReturn', { month: r.month, ids: ids(), reason: why.value }).then(done(function () { return 'Sent back to the site\'s HR.'; }), fail); }));
      acts.appendChild(why);
      var ok = btn('pri', 'Approve ' + mName(r.month) + ' (HO HR)', function () { if (!ok.dataset.sure) { ok.dataset.sure = '1'; ok.textContent = 'Sure? After this no day of ' + mName(r.month) + ' is changed – press again'; return; } api('monthApprove', { month: r.month }).then(done(function () { return 'Approved.'; }), function (e) { delete ok.dataset.sure; ok.textContent = 'Approve ' + mName(r.month) + ' (HO HR)'; fail(e); }); });
      ok.style.background = '#0B6B3A'; acts.appendChild(ok);
    }
    if (r.can.reopen) { var rw = el('input'); rw.placeholder = 'Why the month is opened again'; rw.hidden = true; acts.appendChild(btn('sec', 'Open the month again…', function () { if (rw.hidden) { rw.hidden = false; rw.focus(); return; } api('monthReopen', { month: r.month, reason: rw.value }).then(done(function () { return 'Opened again.'; }), fail); })); acts.appendChild(rw); }
    acts.appendChild(n); count(); root.appendChild(acts); root.appendChild(t.box);
  }
  function sites(root) {
    api('monthSites', { month: V.month }).then(function (r) {
      var t = table(['Site', 'People', 'Verified', 'Sent back', 'Where it stands']);
      r.sites.forEach(function (s) { var tr = el('tr'); tr.appendChild(el('td', '', s.name + ' (' + s.code + ')' + (s.code === r.here ? ' – open now' : ''))); [s.people, s.verified, s.returned].forEach(function (v) { var x = el('td', '', v || '–'); x.style.textAlign = 'center'; tr.appendChild(x); });
        tr.appendChild(el('td', '', s.approved ? 'Approved – ' + s.approved.by + ', ' + when(s.approved.at) : !s.people ? '–' : s.verified >= s.people ? 'All verified – waits for your approval' : (s.people - s.verified) + ' not verified yet')); t.body.appendChild(tr); });
      root.appendChild(note('To check and approve a site, choose it at the top right (the site) and open "This site".')); root.appendChild(t.box);
    }, function (e) { root.appendChild(el('p', 'none', e.message)); });
  }
  function hoPeople(root) {
    api('hoList').then(function (r) {
      var card = el('div', 'dz-card'); card.style.maxWidth = '760px'; card.appendChild(el('h3', '', 'Who is HO HR'));
      card.appendChild(el('p', 'muted', 'The HO HR checks and approves a site\'s month. Give the e-mail the person signs in with; in the Portal he also needs HR on every site he is to see.'));
      var row = el('div', 'tools'), mail = el('input'); mail.type = 'email'; mail.placeholder = 'e-mail of the sign-in'; row.appendChild(mail);
      row.appendChild(btn('pri', 'Give HO HR', function () { api('hoSet', { email: mail.value, on: true }).then(function () { toast('Saved.'); draw(); }, fail); })); card.appendChild(row);
      var t = table(['E-mail', 'Since', 'Given by', '']);
      r.rows.forEach(function (w) { var tr = el('tr'); tr.appendChild(el('td', '', w.email)); tr.appendChild(el('td', '', w.active ? when(w.given_at) : 'Taken ' + when(w.taken_at))); tr.appendChild(el('td', '', w.active ? w.given_by : w.taken_by)); var a = el('td');
        a.appendChild(btn('sm ghost', w.active ? 'Take' : 'Give again', function () { api('hoSet', { email: w.email, on: !w.active }).then(function () { toast('Saved.'); draw(); }, fail); })); tr.appendChild(a); t.body.appendChild(tr); });
      if (!r.rows.length) t.box.appendChild(el('p', 'none', 'Nobody yet – the Super Admin himself can approve a month.'));
      card.appendChild(t.box); root.appendChild(card);
    }, function (e) { root.appendChild(el('p', 'none', e.message)); });
  }
  window.HRMONTH = { pages: [['month', 'Month verification']], has: function (page) { return page === 'month'; }, open: function (page, me) { V.me = me; V.data = null; V.picked = {}; draw(); } };
})();
