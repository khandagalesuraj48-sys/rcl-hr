/* HR – LEAVE, the HR office's page (step 7, 12-11-2026). hr.js opens it: HRLEAVE.open(page, me).
 *   Requests – people's leave requests: approve / refuse (after the reporting person, when the policy has two levels).
 *   Balances – everybody's leave as of today; the HR office adds to or takes from one balance, with the reason.
 *   Policy   – the site's policy with its date: leaves a month, carry on or lapse, an absent day takes one, who approves.
 * Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var V = { me: null, view: 'requests', status: 'pending' };
  var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' }, PART = { full: '', first: ' · first half', second: ' · second half' };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('-') : ''; };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function table(heads) { var box = el('div', 'box'), t = el('table'), h = el('thead'), r = el('tr'); heads.forEach(function (x) { r.appendChild(el('th', '', x)); }); h.appendChild(r); t.appendChild(h); var b = el('tbody'); t.appendChild(b); box.appendChild(t); return { box: box, body: b }; }
  function face(td, key) { if (window.HRDASH && window.HRDASH.face) td.insertBefore(window.HRDASH.face(td.textContent, key), td.firstChild); return td; }
  function field(parent, label, input) { var d = el('div'), l = el('label', '', label); d.appendChild(l); d.appendChild(input); parent.appendChild(d); return input; }

  function draw() {
    var root = $('p_leave'); root.textContent = ''; var tools = el('div', 'tools');
    [['requests', 'Requests'], ['balances', 'Balances'], ['policy', 'Policy']].forEach(function (k) { tools.appendChild(btn(V.view === k[0] ? 'pri' : 'sec', k[1], function () { V.view = k[0]; draw(); })); }); root.appendChild(tools);
    var body = el('div'); root.appendChild(body);
    if (V.view === 'balances') balances(body); else if (V.view === 'policy') policy(body); else requests(body);
  }
  function requests(root) {
    var tools = el('div', 'tools'); [['pending', 'Waiting'], ['approved', 'Approved'], ['refused', 'Refused'], ['cancelled', 'Taken back']].forEach(function (k) { tools.appendChild(btn(V.status === k[0] ? 'sm' : 'sm ghost', k[1], function () { V.status = k[0]; draw(); })); }); root.appendChild(tools);
    api('leaveList', { status: V.status }).then(function (r) {
      var t = table(['Code', 'Name', 'Days', 'How many', 'Reason', 'Asked', 'Where it stands', '']);
      r.rows.forEach(function (q) {
        var tr = el('tr'); tr.style.cursor = 'default'; tr.appendChild(el('td', '', q.code)); tr.appendChild(face(el('td', 'nm', q.name), q.code));
        tr.appendChild(el('td', '', dmy(q.from) + (q.to !== q.from ? ' – ' + dmy(q.to) : '') + PART[q.part])); tr.appendChild(el('td', '', q.days)); var why = el('td', '', q.reason); why.style.whiteSpace = 'normal'; tr.appendChild(why);
        tr.appendChild(el('td', '', dmy(String(q.asked_at).slice(0, 10))));
        tr.appendChild(el('td', '', q.status === 'pending' ? (q.stage ? (q.stage === 'verify' ? 'Waits for verify' : 'Waits for approval') : q.level === 1 ? 'With the reporting person' : 'With the HR office') : q.status === 'refused' ? 'Refused: ' + q.note : q.status === 'approved' ? 'Approved' : 'Taken back'));
        var a = el('td');
        if (q.status === 'pending' && (q.can !== undefined ? q.can : (r.can && (q.level === 2 || (V.me && V.me.user.role === 'super'))))) {      // (step 13) q.can: his leave policy of the Rule Book says who does this step
          var note = el('input'); note.type = 'text'; note.maxLength = 200; note.placeholder = 'Why it is refused'; note.setAttribute('aria-label', 'Why it is refused'); note.hidden = true; note.style.cssText = 'height:38px;border:1px solid #D7E0EF;border-radius:10px;padding:0 10px;margin-right:6px';
          var send = function (dec) { api('leaveDecide', { id: q.id, decision: dec, note: note.value }).then(function () { toast(dec === 'approved' ? 'Approved.' : 'Refused.'); draw(); }, fail); };
          a.appendChild(note); a.appendChild(btn('mz-ok', q.stage === 'verify' ? 'Verify' : 'Approve', function () { send('approved'); })); a.appendChild(btn('mz-no', 'Refuse', function () { if (note.hidden) { note.hidden = false; note.focus(); } else send('refused'); }));
        }
        if (q.files !== undefined && window.HRBOOK && window.HRBOOK.papers && q.status !== 'cancelled') a.appendChild(btn(q.files ? 'sm' : 'sm ghost', q.files ? 'Papers (' + q.files + ')' : 'Attach paper', function () { window.HRBOOK.papers(q, draw); }));      // (step 13) the papers of the request – never compulsory
        tr.appendChild(a); t.body.appendChild(tr);
      });
      if (!r.rows.length) t.box.appendChild(el('p', 'none', V.status === 'pending' ? 'Nothing is waiting.' : 'Nothing here.'));
      // (13-11-2026, the picture he approved) the counts of the list shown – nothing new is asked
      if (window.HRDASH && window.HRDASH.cards) {
        var days = Math.round(r.rows.reduce(function (a, q) { return a + (+q.days || 0); }, 0) * 10) / 10, who = {}; r.rows.forEach(function (q) { who[q.code] = 1; }); var word = { pending: 'Waiting', approved: 'Approved', refused: 'Refused', cancelled: 'Taken back' }[V.status];
        var list = [['▤', V.status === 'pending' ? 'amber' : V.status === 'approved' ? 'green' : V.status === 'refused' ? 'red' : 'grey', word, r.rows.length, '', 'requests in this list'], ['◉', 'violet', 'People', Object.keys(who).length, '', 'who asked'], ['☾', 'blue', 'Days', days, '', 'asked in these requests']];
        if (V.status === 'pending') { list.push(['↑', 'cyan', 'With the reporting person', r.rows.filter(function (q) { return q.level === 1; }).length, '', 'first step']); list.push(['✓', 'green', 'With the HR office', r.rows.filter(function (q) { return q.level !== 1; }).length, '', 'to decide here']); }
        root.appendChild(window.HRDASH.cards(list));
      }
      root.appendChild(t.box);
    }, function (e) { root.appendChild(el('p', 'none', e.message)); });
  }
  function balances(root) {
    api('leaveBalances').then(function (r) {
      if (!r.policy) root.appendChild(el('p', 'warn', 'No leave policy is set for this site yet – set it under Policy. Until then every balance is 0.'));
      else root.appendChild(el('p', 'muted', r.policy.per_month + ' leaves a month · ' + (r.policy.carry ? 'unused leaves go on' : 'unused leaves lapse at the month\'s end') + ' · ' + (r.policy.auto_absent ? 'an absent day takes one leave' : 'an absent day takes nothing') + ' · as of ' + dmy(r.today)));
      var t = table(['Code', 'Name', 'Category', 'Balance', 'This month: added', 'used', 'Booked', 'Asked', '']);
      r.rows.forEach(function (w) {
        var tr = el('tr'); tr.style.cursor = 'default'; tr.appendChild(el('td', '', w.code)); tr.appendChild(face(el('td', 'nm', w.name), w.id)); tr.appendChild(el('td', '', CAT[w.category] || ''));
        var b = el('td', 'nm', w.balance); b.style.fontWeight = '800'; tr.appendChild(b); tr.appendChild(el('td', '', w.credit + (w.added ? ' ' + (w.added > 0 ? '+' : '') + w.added : ''))); tr.appendChild(el('td', '', w.used)); tr.appendChild(el('td', '', w.booked || '–')); tr.appendChild(el('td', '', w.pending || '–'));
        var a = el('td');
        if (r.can && r.policy) {
          var n = el('input'), why = el('input'); n.type = 'number'; n.step = '0.5'; n.placeholder = '+ / −'; n.setAttribute('aria-label', 'Days to add or take'); why.type = 'text'; why.maxLength = 200; why.placeholder = 'Reason'; why.setAttribute('aria-label', 'Reason');
          [n, why].forEach(function (i) { i.hidden = true; i.style.cssText = 'height:38px;border:1px solid #D7E0EF;border-radius:10px;padding:0 10px;margin-right:6px;width:' + (i === n ? '84px' : '180px'); a.appendChild(i); });
          a.appendChild(btn('sm ghost', 'Add / take', function () { if (n.hidden) { n.hidden = false; why.hidden = false; n.focus(); return; } api('leaveAdjust', { id: w.id, days: n.value, reason: why.value }).then(function () { toast('Saved.'); draw(); }, fail); }));
        }
        tr.appendChild(a); t.body.appendChild(tr);
      });
      if (!r.rows.length) t.box.appendChild(el('p', 'none', 'No employee on this site yet.'));
      root.appendChild(t.box);
    }, function (e) { root.appendChild(el('p', 'none', e.message)); });
  }
  function policy(root) {
    api('leavePolicy').then(function (r) {
      var card = el('div', 'dz-card'), p = r.policy || { per_month: '', carry: true, auto_absent: true, levels: 2 }; card.style.maxWidth = '760px';
      card.appendChild(el('h3', '', r.policy ? 'Leave policy – valid from ' + dmy(r.policy.valid_from) : 'Leave policy – not set yet'));
      var g = el('div', 'grid'), num = el('input'), from = el('input'), carry = el('select'), auto = el('select'), lev = el('select'); num.type = 'number'; num.min = '0'; num.max = '31'; num.step = '0.5'; num.value = p.per_month; from.type = 'date';
      var opt = function (s, v, t, on) { var o = el('option', '', t); o.value = v; o.selected = !!on; s.appendChild(o); };
      opt(carry, 'yes', 'Go on to the next month', p.carry); opt(carry, 'no', 'Lapse at the month\'s end', !p.carry);
      opt(auto, 'yes', 'Takes one leave by itself (while there is one)', p.auto_absent); opt(auto, 'no', 'Takes nothing – it stays absent', !p.auto_absent);
      opt(lev, '2', 'The reporting person, then the HR office', p.levels === 2); opt(lev, '1', 'The HR office only', p.levels === 1);
      [num, from, carry, auto, lev].forEach(function (i) { i.style.cssText = 'width:100%;height:44px;border:1px solid #D7E0EF;border-radius:12px;padding:0 12px;background:#fff'; i.disabled = !r.can; });
      field(g, 'Leaves added every month', num); field(g, 'Counts from (empty = today)', from); field(g, 'Unused leaves', carry); field(g, 'An absent day', auto); field(g, 'Who approves a request', lev); card.appendChild(g);
      card.appendChild(el('p', 'muted', 'Saving makes a NEW version from that date – the days before it keep the policy they had. A weekly off and a holiday (Shifts & rules) never take a leave.'));
      if (r.can) { var a = el('div', 'acts'); a.style.justifyContent = 'flex-start'; a.appendChild(btn('pri', 'Save the policy', function () { api('leavePolicySave', { per_month: num.value, valid_from: from.value, carry: carry.value === 'yes', auto_absent: auto.value === 'yes', levels: +lev.value }).then(function () { toast('Saved.'); draw(); }, fail); })); card.appendChild(a); }
      if (r.versions.length) { card.appendChild(el('label', '', 'Versions')); var ul = el('ul', 'hist'); r.versions.forEach(function (v) { ul.appendChild(el('li', '', 'From ' + dmy(v.valid_from) + ' — ' + v.per_month + ' a month · ' + (v.carry ? 'go on' : 'lapse') + ' · absent ' + (v.auto_absent ? 'takes one' : 'takes nothing') + ' · ' + (v.levels === 2 ? 'two levels' : 'HR office only') + ' — ' + v.by)); }); card.appendChild(ul); }
      root.appendChild(card);
    }, function (e) { root.appendChild(el('p', 'none', e.message)); });
  }
  window.HRLEAVE = { pages: [['leave', 'Leave']], has: function (page) { return page === 'leave'; }, open: function (page, me) { V.me = me; draw(); } };
})();
