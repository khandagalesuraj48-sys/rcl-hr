/* HR – PAYROLL (step 12, 12-11-2026): only the HO HR and the Super Admin. hr.js opens it: HRROLL.open(page, me).
 *   Pay sheet – a site's month after its attendance was approved: everybody with his days, pay, deductions and net; ticks for PF /
 *               ESIC / PT; a month's own additions; LOCK (never changed afterwards).
 *   Advances  – salary advances: given, taken back a month, what is left.
 *   Settings  – PF, ESIC, Profession Tax as the accountant gives them, each version with its date.
 * Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var prev = function () { var d = new Date(Date.now() + 19800000); d.setUTCDate(0); return d.toISOString().slice(0, 7); };
  var V = { view: 'sheet', month: prev() };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('-') : ''; };
  var when = function (t) { return t ? dmy(new Date(Date.parse(t) + 19800000).toISOString()) : ''; };
  var rs = function (n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
  var mName = function (m) { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m.slice(5) - 1] + ' ' + m.slice(0, 4); };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 9000 : 3500); }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function table(heads) { var box = el('div', 'box'), t = el('table'), h = el('thead'), r = el('tr'); heads.forEach(function (x) { var th = el('th', '', x); r.appendChild(th); }); h.appendChild(r); t.appendChild(h); var b = el('tbody'); t.appendChild(b); box.appendChild(t); return { box: box, body: b, table: t }; }
  function note(text, kind) { var p = el('p', '', text); p.style.cssText = 'margin:0 0 12px;padding:11px 14px;border-radius:14px;font-size:14.5px;' + (kind === 'ok' ? 'background:#DDF5E6;color:#0B6B3A' : kind === 'warn' ? 'background:#FFF1CC;color:#6B4700' : 'background:#E9F2FF;color:#0B3A6B'); return p; }
  function field(parent, label, input, full) { var d = el('div', full ? 'full' : ''), l = el('label', '', label); d.appendChild(l); d.appendChild(input); parent.appendChild(d); return input; }
  function input(ph, val) { var i = el('input'); i.type = 'text'; i.inputMode = 'decimal'; if (ph) i.placeholder = ph; if (val !== undefined && val !== null && val !== '') i.value = val; return i; }
  function num(td, v, bold) { var c = el('td', '', v ? rs(v) : '–'); c.style.textAlign = 'right'; if (bold) c.style.fontWeight = '700'; td.appendChild(c); return c; }
  function dialog(title, sub) {
    var d = el('div', 'dlg'), s = el('div', 'sheet'), body = el('div'), er = el('p', 'err'), acts = el('div', 'acts'); s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.appendChild(el('h2', '', title)); if (sub) s.appendChild(el('p', 'sub', sub));
    er.hidden = true; er.setAttribute('role', 'alert'); s.appendChild(body); s.appendChild(er); s.appendChild(acts); d.appendChild(s); document.body.appendChild(d);
    var o = { body: body, acts: acts, err: function (e) { er.textContent = e ? (e.message || String(e)) : ''; er.hidden = !e; }, close: function () { document.removeEventListener('keydown', key); if (d.parentNode) d.parentNode.removeChild(d); } };
    var key = function (ev) { if (ev.key === 'Escape') o.close(); }; document.addEventListener('keydown', key); acts.appendChild(btn('sec', 'Close', o.close)); return o;
  }

  function draw() {
    var root = $('p_roll'); root.textContent = ''; var tools = el('div', 'tools');
    [['sheet', 'Pay sheet'], ['adv', 'Advances'], ['set', 'PF · ESIC · PT']].forEach(function (k) { tools.appendChild(btn(V.view === k[0] ? 'pri' : 'sec', k[1], function () { V.view = k[0]; draw(); })); });
    if (V.view === 'sheet') { var i = el('input'); i.type = 'month'; i.value = V.month; i.style.flex = '0 0 180px'; i.onchange = function () { if (/^\d{4}-\d{2}$/.test(i.value)) { V.month = i.value; draw(); } }; tools.appendChild(i); }
    root.appendChild(tools); var body = el('div'); root.appendChild(body);
    if (V.view === 'adv') return advances(body); if (V.view === 'set') return settings(body);
    api('payList', { month: V.month }).then(function (r) { sheet(body, r); }, function (e) { body.appendChild(el('p', 'none', e.message)); });
  }
  function sheet(root, r) {
    root.textContent = '';
    if (!r.ready) { root.appendChild(note(r.reason, 'warn')); return; }
    // (13-11-2026, the picture he approved) the totals as the cards of the other pages – the same numbers
    var ded = r.totals.pf + r.totals.esic + r.totals.pt + r.totals.advance + r.totals.other_ded, tiles = [['◉', 'blue', 'People', r.rows.length, '', r.problems ? r.problems + ' cannot be paid yet' : 'in the pay sheet'], ['₹', 'green', 'Gross ₹', rs(r.totals.gross), '', 'earned + extra'], ['−', 'red', 'Deductions ₹', rs(ded), '', 'PF · ESIC · PT · advance · other'], ['=', 'violet', 'Net pay ₹', rs(r.totals.net), '', 'to the bank'], [r.locked ? '■' : '□', r.locked ? 'grey' : 'amber', 'Month', r.locked ? 'Locked' : 'Open', '', mName(r.month)]];
    if (window.HRDASH && window.HRDASH.cards) root.appendChild(window.HRDASH.cards(tiles)); else { var chips = el('div', 'chips'); tiles.slice(0, 4).forEach(function (c) { var x = el('div', 'chip'); x.style.cursor = 'default'; x.appendChild(el('b', '', c[3])); x.appendChild(el('span', '', c[2])); chips.appendChild(x); }); root.appendChild(chips); }
    if (r.locked) { root.appendChild(note('The pay of ' + mName(r.month) + ' is LOCKED (' + r.locked.by + ', ' + when(r.locked.at) + ') – it is never counted again. A mistake is set right in the next month.', 'ok'));
      var lt = el('div', 'tools'); lt.appendChild(btn('pri', 'Bank list (Excel)', function () { bank(r.month); })); lt.appendChild(el('span', 'muted', 'Name, bank, IFSC, account number and net pay – for the bank. A payslip: the button of each line.')); lt.lastChild.style.alignSelf = 'center'; root.appendChild(lt); }
    else { root.appendChild(note('Counted from the approved attendance and each person\'s approved salary. A day\'s pay = the month\'s salary ÷ ' + r.month_days + ' days; an extra day = one day\'s pay.' + (r.settings ? ' PF / ESIC / PT: the settings from ' + dmy(r.settings.valid_from) + '.' : ' PF / ESIC / PT: no settings yet – nothing is deducted for them.')));
      if (r.problems) root.appendChild(note(r.problems + ' people cannot be paid yet – see the red line of each.', 'warn')); }
    var t = table(['Code', 'Name', 'Salary', 'Pay days', 'Extra', 'Earned', 'Extra pay', 'Other +', 'Gross', 'PF', 'ESIC', 'PT', 'Advance', 'Other −', 'Net pay', '']);
    r.rows.forEach(function (w) {
      var tr = el('tr'); tr.style.cursor = 'default'; tr.appendChild(el('td', '', w.code)); var nm = el('td', '', w.name);
      if (w.problem) { var p = el('div', '', w.problem); p.style.cssText = 'font-size:12.5px;color:#B42318'; nm.appendChild(p); } tr.appendChild(nm);
      tr.appendChild(el('td', '', w.rate ? rs(w.rate) + (w.pay_type === 'daily' ? ' a day' : ' a month') : '–'));
      [w.pay_days, w.extra_days].forEach(function (v) { var c = el('td', '', v || '–'); c.style.textAlign = 'center'; tr.appendChild(c); });
      num(tr, w.earned); num(tr, w.extra); num(tr, w.other_earn); num(tr, w.gross, true); num(tr, w.pf); num(tr, w.esic); num(tr, w.pt); num(tr, w.advance); num(tr, w.other_ded); num(tr, w.net, true);
      var a = el('td'); if (!r.locked) a.appendChild(btn('sm ghost', 'Set…', function () { person(r, w); })); else a.appendChild(btn('sm ghost', 'Payslip', function () { slip(r.month, w.id); })); tr.appendChild(a); t.body.appendChild(tr);
    });
    if (!r.rows.length) t.box.appendChild(el('p', 'none', 'Nobody is verified in ' + mName(r.month) + '.'));
    if (!r.locked && r.rows.length) { var acts = el('div', 'tools'), ok = btn('pri', 'Lock the pay of ' + mName(r.month), function () {
        if (!ok.dataset.sure) { ok.dataset.sure = '1'; ok.textContent = 'Sure? A locked month is never changed – press again'; return; }
        api('payLock', { month: r.month, without: r.problems > 0 }).then(function (x) { toast('Locked.'); sheet(root, x); }, function (e) { delete ok.dataset.sure; ok.textContent = 'Lock the pay of ' + mName(r.month); fail(e); }); });
      ok.style.background = '#0B6B3A'; acts.appendChild(ok); if (r.problems) acts.appendChild(el('span', 'muted', 'The ' + r.problems + ' people who cannot be paid are left out.')); root.appendChild(acts); }
    root.appendChild(t.box);
  }
  // one person of the sheet: for whom PF / ESIC / PT, this month's additions, the advance of this month
  function person(r, w) {
    var d = dialog(w.name + ' (' + w.code + ') – ' + mName(r.month), 'The ticks stay for the months to come; the additions are for this month only.');
    var row = el('div'); row.style.cssText = 'display:flex;gap:18px;margin:4px 0 14px'; var ck = {};
    [['pf', 'PF'], ['esic', 'ESIC'], ['pt', 'Profession Tax']].forEach(function (k) { var l = el('label', 'ck'), c = el('input'); c.type = 'checkbox'; c.checked = !!w.flags[k[0]]; c.style.cssText = 'width:18px;height:18px;margin-right:6px'; l.style.cssText = 'display:flex;align-items:center;font-size:15px'; l.appendChild(c); l.appendChild(document.createTextNode(k[1])); row.appendChild(l); ck[k[0]] = c; });
    d.body.appendChild(el('label', '', 'Deducted for him')); d.body.appendChild(row);
    var g = el('div', 'grid'), e = input('0', w.adjust.other_earn || ''), en = el('input'), dd = input('0', w.adjust.other_ded || ''), dn = el('input'); en.value = w.adjust.earn_note || ''; dn.value = w.adjust.ded_note || ''; en.maxLength = dn.maxLength = 120;
    field(g, 'Another earning (₹)', e); field(g, 'What for', en); field(g, 'Another deduction (₹)', dd); field(g, 'What for', dn);
    var av = null; if (w.advance_of) av = field(g, 'Advance taken back this month (₹) – left ' + rs(w.advance_of.left) + ', usual ' + rs(w.advance_of.monthly), input('usual', w.adjust.advance === null ? '' : w.adjust.advance), true);
    d.body.appendChild(g);
    d.acts.appendChild(btn('pri', 'Save', function () {
      api('payFlags', { id: w.id, pf: ck.pf.checked, esic: ck.esic.checked, pt: ck.pt.checked }).then(function () { return api('payAdjust', { month: r.month, id: w.id, other_earn: e.value, earn_note: en.value, other_ded: dd.value, ded_note: dn.value, advance: av ? av.value : '' }); })
        .then(function () { d.close(); toast('Saved.'); draw(); }, d.err);
    }));
  }
  /* (12-11-2026) a LOCKED month: one person's payslip to print (the browser's own Print → "Save as PDF"), and the bank list as Excel */
  function slip(month, id) {
    api('paySlipOf', { month: month, id: id }).then(function (r) {
      var w = window.open('', '_blank'); if (!w) return toast('The browser stopped the new window – allow pop-ups for this page.', true);
      var d = w.document, s = r.slip, e = r.employee, add = function (parent, tag, text, css) { var x = d.createElement(tag); if (text !== undefined) x.textContent = String(text); if (css) x.style.cssText = css; parent.appendChild(x); return x; };
      d.title = 'Payslip ' + e.code + ' ' + mName(month);
      var st = d.createElement('style'); st.textContent = 'body{font:14px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:28px;max-width:760px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:2px 0 14px;font-weight:normal;color:#444}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border:1px solid #bbb;padding:6px 9px;text-align:left}td.n,th.n{text-align:right}th{background:#f1f1f1}.two{display:flex;gap:16px}.two>div{flex:1}.net{font-size:17px;font-weight:bold}small{color:#555}@media print{button{display:none}body{margin:10mm}}'; d.head.appendChild(st);
      var b = d.body; add(b, 'h1', r.site_name); add(b, 'h2', 'Payslip – ' + mName(month));
      var info = add(b, 'table'); [['Employee', e.name + ' (' + e.code + ')'], ['Designation / Department', [e.designation, e.department].filter(Boolean).join(' / ') || '–'], ['Salary', rs(s.rate) + (s.pay_type === 'daily' ? ' a day' : ' a month')], ['Days', s.pay_days + ' paid of ' + s.month_days + (s.extra_days ? ' · ' + s.extra_days + ' extra' : '')]].forEach(function (x) { var tr = add(info, 'tr'); add(tr, 'th', x[0], 'width:34%'); add(tr, 'td', x[1]); });
      var c = s.counts || {}; add(b, 'small', 'Present ' + (c.present || 0) + ' · Half day ' + (c.half || 0) + ' · Absent ' + (c.absent || 0) + ' · Leave ' + (c.leave || 0) + ' · Weekly off ' + (c.week_off || 0) + ' · Holiday ' + (c.holiday || 0) + ' · Extra ' + (c.extra || 0));
      var two = add(b, 'div'); two.className = 'two';
      [['Earnings', s.earnings, 'Gross', s.gross], ['Deductions', s.deductions, 'Total deductions', s.total_deductions]].forEach(function (g) { var box = add(two, 'div'), t = add(box, 'table'), h = add(t, 'tr'); add(h, 'th', g[0]); add(h, 'th', '₹').className = 'n';
        g[1].forEach(function (l) { var tr = add(t, 'tr'); add(tr, 'td', l.label); add(tr, 'td', rs(l.amount)).className = 'n'; }); if (!g[1].length) { var n = add(t, 'tr'); add(n, 'td', '–'); add(n, 'td', '').className = 'n'; }
        var f = add(t, 'tr'); add(f, 'th', g[2]); add(f, 'th', rs(g[3])).className = 'n'; });
      add(b, 'p', 'Net pay: ₹ ' + rs(s.net)).className = 'net';
      add(b, 'small', 'Made from the attendance approved by the HO HR and locked by ' + r.locked.by + ' on ' + when(r.locked.at) + '. This is a computer-made payslip.');
      var pb = add(b, 'p'); var bt = add(pb, 'button', 'Print / Save as PDF', 'padding:9px 16px;font-size:14px;margin-top:14px'); bt.onclick = function () { w.print(); };
    }, fail);
  }
  function xlsxLib() { return new Promise(function (ok) { if (window.XLSX) return ok(true); var s = document.createElement('script'); s.src = '/vendor/xlsx-0.18.5.full.min.js'; s.onload = function () { ok(!!window.XLSX); }; s.onerror = function () { ok(false); }; document.head.appendChild(s); }); }
  function bank(month) {
    api('payBank', { month: month }).then(function (r) {
      var head = ['Code', 'Name', 'Name as on bank', 'Bank', 'IFSC', 'Account number', 'Net pay'], rows = [head].concat(r.rows.map(function (x) { return [x.code, x.name, x.holder, x.bank, x.ifsc, x.account, x.net]; })); rows.push(['', 'Total', '', '', '', '', r.total]);
      var name = 'Bank_list_' + r.site + '_' + month, save = function (blob, ext) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + ext; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
      xlsxLib().then(function (ok) {
        if (ok) { try { var ws = window.XLSX.utils.aoa_to_sheet(rows), wb = window.XLSX.utils.book_new(); ws['!cols'] = [10, 26, 26, 22, 14, 20, 12].map(function (n) { return { wch: n }; });
            r.rows.forEach(function (x, i) { var c = ws['F' + (i + 2)]; if (c) { c.t = 's'; c.v = String(x.account); } });      // (an account number is text – Excel must not round it)
            window.XLSX.utils.book_append_sheet(wb, ws, 'Bank list'); window.XLSX.writeFile(wb, name + '.xlsx'); } catch (e) { ok = false; } }
        if (!ok) { var q = function (v) { return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"'; }; save(new Blob(['﻿' + rows.map(function (x) { return x.map(function (v, i) { return i === 5 && v ? '="' + String(v) + '"' : q(v); }).join(','); }).join('\r\n')], { type: 'text/csv' }), '.csv'); }
        toast(r.missing ? 'Saved. ' + r.missing + ' people have no bank account / IFSC in their profile – their lines are empty there.' : 'Saved.', !!r.missing);
      });
    }, fail);
  }
  function advances(root) {
    api('advList').then(function (r) {
      var card = el('div', 'dz-card'); card.style.marginBottom = '14px'; card.appendChild(el('h3', '', 'Give an advance'));
      var g = el('div', 'grid'), who = el('select'), amt = input('e.g. 10000'), mon = input('e.g. 2000'), on = el('input'), nt = el('input'); on.type = 'date'; nt.maxLength = 200;
      [who, amt, mon, on, nt].forEach(function (i) { i.style.cssText = 'width:100%;height:44px;border:1px solid #D7E0EF;border-radius:12px;padding:0 12px;background:#fff'; });
      who.appendChild(el('option', '', 'Choose the employee…')); who.firstChild.value = '';
      api('empList', {}).then(function (x) { (x.rows || []).filter(function (p) { return p.status !== 'left'; }).forEach(function (p) { var o = el('option', '', p.name + ' (' + p.code + ')'); o.value = p.id; who.appendChild(o); }); }, function () {});
      field(g, 'Employee', who); field(g, 'Advance (₹)', amt); field(g, 'Taken back every month (₹)', mon); field(g, 'Given on (empty = today)', on); field(g, 'Note', nt, true); card.appendChild(g);
      var a = el('div', 'acts'); a.style.justifyContent = 'flex-start'; a.appendChild(btn('pri', 'Save the advance', function () { api('advGive', { id: who.value, amount: amt.value, monthly: mon.value, given_on: on.value, note: nt.value }).then(function () { toast('Saved.'); draw(); }, fail); })); card.appendChild(a); root.appendChild(card);
      var t = table(['Code', 'Name', 'Given on', 'Advance ₹', 'A month ₹', 'Taken back ₹', 'Left ₹', 'Where it stands', '']);
      r.rows.forEach(function (w) { var tr = el('tr'); tr.style.cursor = 'default'; [w.code, w.name, dmy(w.given_on)].forEach(function (v) { tr.appendChild(el('td', '', v)); }); num(tr, w.amount); num(tr, w.monthly); num(tr, w.recovered); num(tr, w.left, true);
        tr.appendChild(el('td', '', w.status === 'active' ? 'Running' : 'Closed' + (w.close_reason ? ' – ' + w.close_reason : ''))); var c = el('td');
        if (w.status === 'active') { var why = el('input'); why.placeholder = 'Why it is closed'; why.hidden = true; why.style.cssText = 'height:40px;border:1px solid #D7E0EF;border-radius:10px;padding:0 10px;margin-right:6px'; c.appendChild(why); c.appendChild(btn('sm ghost', 'Close…', function () { if (why.hidden) { why.hidden = false; why.focus(); return; } api('advClose', { id: w.id, reason: why.value }).then(function () { toast('Closed.'); draw(); }, fail); })); }
        tr.appendChild(c); t.body.appendChild(tr); });
      if (!r.rows.length) t.box.appendChild(el('p', 'none', 'No advance on this site yet.'));
      root.appendChild(t.box);
    }, function (e) { root.appendChild(el('p', 'none', e.message)); });
  }
  function settings(root) {
    api('paySettings').then(function (r) {
      var s = r.settings || {}, card = el('div', 'dz-card'); card.style.maxWidth = '820px';
      card.appendChild(el('h3', '', r.valid_from ? 'PF · ESIC · Profession Tax – valid from ' + dmy(r.valid_from) : 'PF · ESIC · Profession Tax – not set yet'));
      card.appendChild(el('p', 'muted', 'These are the company\'s own numbers – take them from your accountant. Nothing of them is fixed in the program. A field left empty is not applied. They are for every site.'));
      var g = el('div', 'grid'), pf = input('', s.pf_pct), cap = input('', s.pf_cap), es = input('', s.esic_pct), lim = input('', s.esic_limit), from = el('input'); from.type = 'date';
      [pf, cap, es, lim, from].forEach(function (i) { i.style.cssText = 'width:100%;height:44px;border:1px solid #D7E0EF;border-radius:12px;padding:0 12px;background:#fff'; });
      field(g, 'PF – employee\'s share, % of the earned pay', pf); field(g, 'PF – counted on at most (₹ a month; empty = no limit)', cap); field(g, 'ESIC – employee\'s share, % of the gross', es); field(g, 'ESIC – only up to this month\'s salary (₹; empty = everybody ticked)', lim); card.appendChild(g);
      card.appendChild(el('label', '', 'Profession Tax – by the month\'s gross')); var slabs = el('div'), rows = [];
      function addSlab(v) { var line = el('div'); line.style.cssText = 'display:flex;gap:10px;margin-bottom:8px;align-items:center'; var f = input('gross from ₹', v ? v.from : ''), a = input('tax ₹', v ? v.amount : ''); [f, a].forEach(function (i) { i.style.cssText = 'flex:1;height:44px;border:1px solid #D7E0EF;border-radius:12px;padding:0 12px;background:#fff'; }); line.appendChild(el('span', '', 'Gross from')); line.appendChild(f); line.appendChild(el('span', '', '→ tax')); line.appendChild(a); slabs.appendChild(line); rows.push([f, a]); }
      (s.pt_slabs || []).forEach(addSlab); addSlab(null); card.appendChild(slabs); card.appendChild(btn('sm ghost', '+ another line', function () { addSlab(null); }));
      var gf = el('div', 'grid'); gf.style.marginTop = '12px'; field(gf, 'Counts from (empty = today)', from); card.appendChild(gf);
      card.appendChild(el('p', 'muted', 'Saving makes a NEW version from that date – a month already locked keeps what it was paid with.'));
      var a = el('div', 'acts'); a.style.justifyContent = 'flex-start'; a.appendChild(btn('pri', 'Save the settings', function () { api('paySettingsSave', { pf_pct: pf.value, pf_cap: cap.value, esic_pct: es.value, esic_limit: lim.value, valid_from: from.value, pt_slabs: rows.map(function (x) { return { from: x[0].value, amount: x[1].value }; }) }).then(function () { toast('Saved.'); draw(); }, fail); })); card.appendChild(a);
      if (r.versions.length) { card.appendChild(el('label', '', 'Versions')); var ul = el('ul', 'hist'); r.versions.forEach(function (v) { var x = v.settings || {}; ul.appendChild(el('li', '', 'From ' + dmy(v.valid_from) + ' — PF ' + (x.pf_pct === undefined ? '–' : x.pf_pct + ' %') + ' · ESIC ' + (x.esic_pct === undefined ? '–' : x.esic_pct + ' %') + ' · PT ' + ((x.pt_slabs || []).length ? (x.pt_slabs || []).map(function (p) { return p.from + '→' + p.amount; }).join(', ') : '–') + ' — ' + v.by)); }); card.appendChild(ul); }
      root.appendChild(card);
    }, function (e) { root.appendChild(el('p', 'none', e.message)); });
  }
  window.HRROLL = { pages: [['payroll', 'Payroll']], has: function (page) { return page === 'payroll'; }, open: function () { draw(); } };
})();
