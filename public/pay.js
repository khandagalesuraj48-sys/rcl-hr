/* HR – AN EMPLOYEE'S SALARY (step 11, 12-11-2026): proposed by the site's HR, approved by the HO HR.
 *   HRPAY.sheet(emp)     – from the employee's page (HR Admin / Super Admin): what counts today, what waits, the earlier ones; propose
 *   HRPAY.waiting(root)  – (HO HR) every salary that waits on his sites: approve / send back. A new employee is said.
 * Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('-') : ''; };
  var when = function (t) { return t ? dmy(new Date(Date.parse(t) + 19800000).toISOString()) : ''; };
  var rs = function (n) { return '₹ ' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
  var TYPE = { monthly: 'a month', daily: 'a day' }, CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' }, ST = { pending: 'Waits for the HO HR', approved: 'Approved', returned: 'Sent back' };
  var pay = function (r) { return rs(r.amount) + ' ' + TYPE[r.pay_type]; };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function table(heads) { var box = el('div', 'box'), t = el('table'), h = el('thead'), r = el('tr'); heads.forEach(function (x) { r.appendChild(el('th', '', x)); }); h.appendChild(r); t.appendChild(h); var b = el('tbody'); t.appendChild(b); box.appendChild(t); return { box: box, body: b }; }
  function field(parent, label, input, full) { var d = el('div', full ? 'full' : ''), l = el('label', '', label); d.appendChild(l); d.appendChild(input); parent.appendChild(d); return input; }

  function sheet(emp) {
    var d = el('div', 'dlg'), s = el('div', 'sheet'), body = el('div'), er = el('p', 'err'), acts = el('div', 'acts'); s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true');
    s.appendChild(el('h2', '', 'Salary – ' + emp.name + ' (' + emp.code + ')')); s.appendChild(el('p', 'sub', 'Proposed by the site\'s HR; it counts only after the HO HR approved it. Seen by the HR Admin, the HO HR and the Super Admin only.'));
    er.hidden = true; er.setAttribute('role', 'alert'); s.appendChild(body); s.appendChild(er); s.appendChild(acts); d.appendChild(s); document.body.appendChild(d);
    var close = function () { document.removeEventListener('keydown', key); if (d.parentNode) d.parentNode.removeChild(d); }, key = function (ev) { if (ev.key === 'Escape') close(); }; document.addEventListener('keydown', key);
    var err = function (e) { er.textContent = e ? (e.message || String(e)) : ''; er.hidden = !e; };
    function draw(r) {
      body.textContent = ''; acts.textContent = ''; acts.appendChild(btn('sec', 'Close', close)); err(null);
      body.appendChild(el('p', '', r.current ? 'Today: ' + pay(r.current) + ' – from ' + dmy(r.current.valid_from) + ', approved by ' + r.current.decided_by + '.' : 'No approved salary yet.'));
      if (r.waiting) body.appendChild(el('p', '', 'Waits for the HO HR: ' + pay(r.waiting) + ' from ' + dmy(r.waiting.valid_from) + ' – proposed by ' + r.waiting.asked_by + ' on ' + when(r.waiting.asked_at) + '.'));
      if (r.can.ask) {
        var g = el('div', 'grid'), type = el('select'), amt = el('input'), from = el('input'), note = el('input');
        Object.keys(r.types).forEach(function (k) { var o = el('option', '', r.types[k]); o.value = k; o.selected = r.current ? r.current.pay_type === k : k === 'monthly'; type.appendChild(o); });
        amt.type = 'text'; amt.inputMode = 'decimal'; amt.placeholder = 'e.g. 18000'; from.type = 'date'; note.maxLength = 200; note.placeholder = 'optional';
        field(g, 'Salary type', type); field(g, 'Amount (₹) – the basic salary', amt); field(g, 'From (empty = his joining date)', from); field(g, 'Note', note); body.appendChild(g);
        acts.appendChild(btn('pri', r.current ? 'Propose the new salary' : 'Send to the HO HR for approval', function () { api('salaryAsk', { id: emp.id, pay_type: type.value, amount: amt.value, valid_from: from.value, note: note.value }).then(function (x) { toast('Sent to the HO HR.'); draw(x); }, err); }));
      }
      if (r.history.length) { body.appendChild(el('label', '', 'Every proposal')); var t = table(['From', 'Salary', 'Where it stands', 'Proposed by', 'Decided by']);
        r.history.forEach(function (h) { var tr = el('tr'); tr.style.cursor = 'default'; [dmy(h.valid_from), pay(h), ST[h.status] + (h.decide_note ? ' – ' + h.decide_note : ''), h.asked_by + ', ' + when(h.asked_at), h.decided_by ? h.decided_by + ', ' + when(h.decided_at) : '–'].forEach(function (v) { tr.appendChild(el('td', '', v)); }); t.body.appendChild(tr); }); body.appendChild(t.box); }
    }
    api('salaryGet', { id: emp.id }).then(draw, function (e) { acts.appendChild(btn('sec', 'Close', close)); err(e); });
  }
  function waiting(root) {
    root.textContent = '';
    api('salaryWaiting').then(function (r) {
      var t = table(['Site', 'Code', 'Name', 'Joined', 'Today', 'Proposed', 'From', 'Proposed by', '']);
      r.rows.forEach(function (w) {
        var tr = el('tr'); tr.style.cursor = 'default'; tr.appendChild(el('td', '', w.site_name)); tr.appendChild(el('td', '', w.code));
        var nm = el('td', '', w.name + ' '); nm.appendChild(el('small', '', (CAT[w.category] || '') + (w.is_new ? ' · NEW EMPLOYEE' : ''))); nm.lastChild.style.color = w.is_new ? '#0B6B3A' : '#8592AD'; tr.appendChild(nm);
        [dmy(w.joined_on) || '–', w.now ? pay(w.now) : '–', pay(w), dmy(w.valid_from), w.asked_by + (w.note ? ' – ' + w.note : '')].forEach(function (v, i) { var c = el('td', '', v); if (i === 2) c.style.fontWeight = '700'; tr.appendChild(c); });
        var a = el('td'); a.style.whiteSpace = 'nowrap';
        if (w.mine) a.appendChild(el('small', '', 'Your own proposal – another HO HR decides'));
        else { var why = el('input'); why.placeholder = 'Why it is sent back'; why.hidden = true; why.style.cssText = 'height:40px;border:1px solid #D7E0EF;border-radius:10px;padding:0 10px;margin-right:6px';
          var dec = function (d) { api('salaryDecide', { id: w.id, decision: d, note: why.value }).then(function () { toast(d === 'approved' ? 'Approved.' : 'Sent back.'); waiting(root); }, function (e) { toast(e.message, true); }); };
          a.appendChild(why); a.appendChild(btn('sm', 'Approve', function () { dec('approved'); })); a.appendChild(document.createTextNode(' ')); a.appendChild(btn('sm ghost', 'Send back…', function () { if (why.hidden) { why.hidden = false; why.focus(); return; } dec('returned'); })); }
        tr.appendChild(a); t.body.appendChild(tr);
      });
      if (!r.rows.length) t.box.appendChild(el('p', 'none', 'No salary waits for your approval.'));
      root.appendChild(t.box);
    }, function (e) { root.appendChild(el('p', 'none', e.message)); });
  }
  window.HRPAY = { sheet: sheet, waiting: waiting };
})();
