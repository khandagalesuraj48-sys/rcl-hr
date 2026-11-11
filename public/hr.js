/* HR – the pages (Phase 1, 12-11-2026): Employees (list, one employee, add / change, transfer, exit, import from Excel), Departments,
 * Designations. The sign-in is index.html's; it calls HR.open(me, page). Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var S = { me: null, init: null, page: 'employees', q: '', status: '', category: '', rows: [], open: null, imp: null };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('-') : ''; };
  var STATUS = { incomplete: 'Incomplete', pending: 'Waiting for OTP', active: 'Active', left: 'Left' };
  var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
  var isAdmin = function () { return S.me && (S.me.user.role === 'admin' || S.me.user.role === 'super'); };
  var nameOf = function (list, id) { var r = (list || []).filter(function (x) { return x.id === id; })[0]; return r ? r.name : ''; };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function busy(btn, on) { if (btn) { btn.disabled = !!on; } }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }

  // ---------- the frame of the pages ----------
  function tabs() {
    var t = $('tabs'); t.textContent = '';
    [['employees', 'Employees', true], ['departments', 'Departments', isAdmin()], ['designations', 'Designations', isAdmin()]].forEach(function (p) {
      if (!p[2]) return; var b = el('button', 'tab' + (S.page === p[0] ? ' on' : ''), p[1]); b.type = 'button'; b.onclick = function () { go(p[0]); }; t.appendChild(b);
    });
  }
  function go(page) {
    if ((page === 'departments' || page === 'designations') && !isAdmin()) page = 'employees';
    S.page = page === 'departments' || page === 'designations' ? page : 'employees'; tabs();
    $('p_emp').hidden = S.page !== 'employees'; $('p_mast').hidden = S.page === 'employees';
    try { history.replaceState(null, '', location.pathname + location.search + '#page=' + S.page); } catch (e) { /* the page still works */ }
    if (S.page === 'employees') list(); else masters();
  }

  // ---------- Employees: the list ----------
  function list() {
    api('empList', { q: S.q, status: S.status, category: S.category }).then(function (r) {
      S.rows = r.rows; var c = r.counts, chips = $('chips'); chips.textContent = '';
      [['', 'On the rolls', c.incomplete + c.pending + c.active], ['incomplete', 'Incomplete', c.incomplete], ['pending', 'Waiting for OTP', c.pending], ['active', 'Active', c.active], ['left', 'Left', c.left]].forEach(function (k) {
        var b = el('button', 'chip' + (S.status === k[0] ? ' on' : '') + (k[0] ? ' s-' + k[0] : '')); b.type = 'button'; b.appendChild(el('b', '', k[2])); b.appendChild(el('span', '', k[1])); b.onclick = function () { S.status = k[0]; list(); }; chips.appendChild(b);
      });
      var tb = $('emp_rows'); tb.textContent = '';
      r.rows.forEach(function (e) {
        var tr = el('tr'); tr.tabIndex = 0;
        [e.code, e.name, CAT[e.category] || e.category, nameOf(S.init.designations, e.designation_id), nameOf(S.init.departments, e.department_id), e.mobile].forEach(function (v, i) { var td = el('td', i === 1 ? 'nm' : '', v || '–'); tr.appendChild(td); });
        var td = el('td'); td.appendChild(el('span', 'st s-' + e.status, STATUS[e.status])); tr.appendChild(td);
        tr.onclick = function () { openEmp(e.id); }; tr.onkeydown = function (ev) { if (ev.key === 'Enter') openEmp(e.id); };
        tb.appendChild(tr);
      });
      $('emp_none').hidden = r.rows.length > 0; $('emp_none').textContent = S.q || S.status || S.category ? 'Nobody matches.' : 'No employee yet – add one, or import the Excel list.';
      $('emp_more').hidden = !r.more;
    }, fail);
  }

  // ---------- one employee ----------
  function row(dl, k, v) { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v || '–')); }
  function openEmp(id) {
    api('empGet', { id: id }).then(function (r) {
      var e = r.employee; S.open = r; $('d_title').textContent = e.name; $('d_code').textContent = e.code + ' · ' + (CAT[e.category] || '') + ' · ' + STATUS[e.status];
      var dl = $('d_list'); dl.textContent = '';
      row(dl, 'Designation', nameOf(S.init.designations, e.designation_id)); row(dl, 'Department', nameOf(S.init.departments, e.department_id));
      row(dl, 'Reports to', r.boss ? r.boss.name + ' (' + r.boss.code + ')' : ''); row(dl, 'Mobile', e.mobile); row(dl, 'E-mail', e.email + (e.email ? (e.email_verified_at ? ' ✓ verified' : ' – not verified yet') : ''));
      row(dl, 'Date of birth', dmy(e.dob)); row(dl, 'Gender', e.gender ? e.gender.charAt(0).toUpperCase() + e.gender.slice(1) : ''); row(dl, 'Joined', dmy(e.joined_on));
      if (e.status === 'left') { row(dl, 'Left on', dmy(e.left_on)); row(dl, 'Reason', e.left_reason); }
      var miss = []; if (!e.dob) miss.push('Date of birth'); if (!e.email) miss.push('E-mail'); if (!e.mobile) miss.push('Mobile');
      $('d_miss').hidden = !miss.length || e.status === 'left'; $('d_miss').textContent = 'Incomplete – still needed: ' + miss.join(', ') + '. He cannot be activated until then.';
      var h = $('d_hist'); h.textContent = '';
      r.history.forEach(function (x) { var li = el('li'); li.appendChild(el('b', '', dmy(x.valid_from) + ' → ' + (x.valid_to ? dmy(x.valid_to) : 'today'))); li.appendChild(el('span', '', ' ' + x.site + ' · ' + (nameOf(S.init.designations, x.designation_id) || '–') + ' · ' + (nameOf(S.init.departments, x.department_id) || '–') + (x.note ? ' · ' + x.note : ''))); h.appendChild(li); });
      var left = e.status === 'left'; $('d_edit').hidden = left; $('d_tr').hidden = left || !isAdmin(); $('d_exit').hidden = left || !isAdmin();
      show('dlg_emp');
    }, fail);
  }

  // ---------- add / change ----------
  function fill(sel, list, val, none) { sel.textContent = ''; var o = el('option', '', none); o.value = ''; sel.appendChild(o); list.forEach(function (x) { if (!x.active && x.id !== val) return; var p = el('option', '', x.name); p.value = x.id; sel.appendChild(p); }); sel.value = val || ''; }
  function form(e, boss) {
    e = e || {}; $('f_title').textContent = e.id ? 'Change ' + e.code : 'Add employee'; $('f_id').value = e.id || '';
    $('f_name').value = e.name || ''; $('f_cat').value = e.category || ''; $('f_gender').value = e.gender || ''; $('f_mobile').value = e.mobile || ''; $('f_email').value = e.email || '';
    $('f_dob').value = e.dob || ''; $('f_join').value = e.joined_on || '';
    fill($('f_dep'), S.init.departments, e.department_id, '– none –'); fill($('f_des'), S.init.designations, e.designation_id, '– none –');
    $('f_boss').value = boss ? boss.name + ' (' + boss.code + ')' : ''; $('f_boss').dataset.id = boss ? boss.id : ''; $('f_err').hidden = true;
    hide('dlg_emp'); show('dlg_form'); $('f_name').focus();
  }
  function pickBoss() {
    var inp = $('f_boss'), box = $('f_boss_list'); inp.dataset.id = '';
    api('empPick', { q: inp.value }).then(function (r) {
      box.textContent = ''; r.rows.filter(function (x) { return x.id !== $('f_id').value; }).forEach(function (x) { var b = el('button', '', x.name + ' (' + x.code + ')'); b.type = 'button'; b.onclick = function () { inp.value = x.name + ' (' + x.code + ')'; inp.dataset.id = x.id; box.hidden = true; }; box.appendChild(b); });
      box.hidden = !box.childNodes.length;
    }, function () { box.hidden = true; });
  }
  function save(ev) {
    ev.preventDefault(); var b = $('f_save'); if ($('f_boss').value && !$('f_boss').dataset.id) { $('f_err').textContent = 'Reporting person: choose a name from the list, or leave it empty.'; $('f_err').hidden = false; return; }
    busy(b, true);
    api('empSave', { id: $('f_id').value, name: $('f_name').value, category: $('f_cat').value, gender: $('f_gender').value, mobile: $('f_mobile').value, email: $('f_email').value, dob: $('f_dob').value, joined_on: $('f_join').value,
      department_id: $('f_dep').value, designation_id: $('f_des').value, reports_to: $('f_boss').dataset.id }).then(function (r) {
      busy(b, false); hide('dlg_form'); toast(r.code + ' saved' + (r.missing.length ? ' – incomplete: ' + r.missing.join(', ') + ' still needed.' : '.')); list();
    }, function (e) { busy(b, false); $('f_err').textContent = e.message; $('f_err').hidden = false; });
  }

  // ---------- transfer, exit ----------
  function transfer() {
    var e = S.open.employee, sel = $('t_site'); sel.textContent = '';
    (S.init.sites.length ? S.init.sites : [{ code: S.me.site, name: S.me.siteName }]).forEach(function (x) { var o = el('option', '', x.name + ' (' + x.code + ')'); o.value = x.code; sel.appendChild(o); }); sel.value = e.site;
    fill($('t_dep'), S.init.departments, e.department_id, '– none –'); fill($('t_des'), S.init.designations, e.designation_id, '– none –'); $('t_from').value = ''; $('t_note').value = ''; $('t_err').hidden = true;
    $('t_title').textContent = 'Transfer ' + e.name + ' (' + e.code + ')'; hide('dlg_emp'); show('dlg_tr');
  }
  function transferSave(ev) {
    ev.preventDefault(); var e = S.open.employee, b = $('t_save'); busy(b, true);
    api('empTransfer', { id: e.id, site: $('t_site').value, department_id: $('t_dep').value, designation_id: $('t_des').value, reports_to: $('t_site').value === e.site ? e.reports_to : '', from: $('t_from').value, note: $('t_note').value })
      .then(function () { busy(b, false); hide('dlg_tr'); toast(e.code + ' transferred.'); list(); }, function (x) { busy(b, false); $('t_err').textContent = x.message; $('t_err').hidden = false; });
  }
  function exit() { var e = S.open.employee; $('x_title').textContent = e.name + ' (' + e.code + ') has left'; $('x_on').value = ''; $('x_reason').value = ''; $('x_err').hidden = true; hide('dlg_emp'); show('dlg_exit'); }
  function exitSave(ev) {
    ev.preventDefault(); var e = S.open.employee, b = $('x_save'); busy(b, true);
    api('empExit', { id: e.id, on: $('x_on').value, reason: $('x_reason').value }).then(function () { busy(b, false); hide('dlg_exit'); toast(e.code + ' marked as left. Nothing was deleted.'); list(); }, function (x) { busy(b, false); $('x_err').textContent = x.message; $('x_err').hidden = false; });
  }

  // ---------- import from Excel ----------
  var HEAD = { name: /^(employee\s*)?name$|^नाव$/i, category: /^(employee\s*)?(category|type)$/i, mobile: /^(mobile|phone|contact)(\s*(no|number))?\.?$/i, email: /^e-?mail(\s*(id|address))?$/i, dob: /^(dob|date\s*of\s*birth|birth\s*date)$/i,
    joined_on: /^(doj|date\s*of\s*joining|joining(\s*date)?|joined(\s*on)?)$/i, gender: /^(gender|sex)$/i, department: /^(department|dept)\.?$/i, designation: /^(designation|post)$/i };
  function mapRows(table) {
    if (!table.length) return { rows: [], cols: [] };
    var head = table[0].map(function (h) { return String(h === null || h === undefined ? '' : h).trim(); }), map = {}, cols = [];
    Object.keys(HEAD).forEach(function (k) { for (var i = 0; i < head.length; i++) if (HEAD[k].test(head[i])) { map[k] = i; cols.push(head[i] + ' → ' + k); break; } });
    var rows = table.slice(1).filter(function (r) { return r.some(function (c) { return c !== null && c !== undefined && String(c).trim() !== ''; }); }).map(function (r) { var o = {}; Object.keys(map).forEach(function (k) { o[k] = r[map[k]] === undefined ? '' : r[map[k]]; }); return o; });
    return { rows: rows, cols: cols, hasName: 'name' in map, hasCat: 'category' in map };
  }
  function csv(text) { var out = [], row = [], cur = '', q = false; for (var i = 0; i < text.length; i++) { var c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; } else cur += c; } if (cur !== '' || row.length) { row.push(cur); out.push(row); } return out; }
  function xlsxLib() { return new Promise(function (ok) { if (window.XLSX) return ok(true); var s = document.createElement('script'); s.src = '/vendor/xlsx-0.18.5.full.min.js'; s.onload = function () { ok(!!window.XLSX); }; s.onerror = function () { ok(false); }; document.head.appendChild(s); }); }
  function importFile(file) {
    if (!file) return; $('i_err').hidden = true; $('i_res').hidden = true; $('i_save').hidden = true; S.imp = null;
    var done = function (table) {
      var m = mapRows(table);
      if (!m.hasName || !m.hasCat) { $('i_err').textContent = 'The first row of the file must have the column names. Needed: Name and Category (Staff / Operator / Driver / Labour). Also read: Mobile, Email, DOB, Joining Date, Gender, Department, Designation.'; $('i_err').hidden = false; return; }
      if (m.rows.length > 1000) { $('i_err').textContent = 'The file has ' + m.rows.length + ' rows – at most 1000 in one file. Split it.'; $('i_err').hidden = false; return; }
      S.imp = m.rows; api('empImport', { rows: m.rows, check: 1 }).then(function (r) { importShow(r, m.cols); }, function (e) { $('i_err').textContent = e.message; $('i_err').hidden = false; });
    };
    if (/\.csv$/i.test(file.name)) { file.text().then(function (t) { done(csv(t.replace(/^﻿/, ''))); }); return; }
    xlsxLib().then(function (ok) {
      if (!ok) { $('i_err').textContent = 'An Excel file can be read only when HR is opened inside the ERP (oneclicksolution.online). Or save the sheet as CSV and choose that.'; $('i_err').hidden = false; return; }
      file.arrayBuffer().then(function (buf) { var wb = window.XLSX.read(buf, { type: 'array' }), sh = wb.Sheets[wb.SheetNames[0]]; done(window.XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' })); }, function () { $('i_err').textContent = 'The file could not be read.'; $('i_err').hidden = false; });
    });
  }
  function importShow(r, cols) {
    var box = $('i_res'); box.textContent = '';
    box.appendChild(el('p', 'sum', r.checked ? r.rows + ' rows read · ' + r.toSave + ' can be saved (' + r.incomplete + ' of them incomplete – DOB / e-mail / mobile missing) · ' + r.faults + ' with a fault (not saved).' : r.saved + ' employees saved · ' + r.incomplete + ' incomplete · ' + r.faults + ' not saved.'));
    if (cols && cols.length) box.appendChild(el('p', 'muted', 'Columns read: ' + cols.join(', ')));
    if (r.made && r.made.length) box.appendChild(el('p', 'muted', 'Added to the lists: ' + r.made.join(', ')));
    if (r.lines.length) { var ul = el('ul', 'faults'); r.lines.slice(0, 200).forEach(function (l) { var li = el('li'); li.appendChild(el('b', '', 'Line ' + l.line + (l.name ? ' – ' + l.name : '') + ': ')); li.appendChild(el('span', '', l.why)); ul.appendChild(li); }); box.appendChild(ul); if (r.lines.length > 200) box.appendChild(el('p', 'muted', '… and ' + (r.lines.length - 200) + ' more lines with a fault.')); }
    box.hidden = false; $('i_save').hidden = !(r.checked && r.toSave > 0); $('i_save').textContent = 'Save ' + r.toSave + ' employees';
  }
  function importSave() { var b = $('i_save'); if (!S.imp) return; busy(b, true); api('empImport', { rows: S.imp }).then(function (r) { busy(b, false); S.imp = null; $('i_file').value = ''; importShow(r, null); toast(r.saved + ' employees saved.'); api('init').then(function (i) { S.init = i; list(); }); }, function (e) { busy(b, false); $('i_err').textContent = e.message; $('i_err').hidden = false; }); }

  // ---------- Departments / Designations ----------
  function masters() {
    var kind = S.page === 'departments' ? 'department' : 'designation', listOf = S.init[S.page]; $('m_title').textContent = S.page === 'departments' ? 'Departments' : 'Designations'; $('m_name').value = ''; $('m_name').placeholder = 'New ' + kind + ' – its name';
    var ul = $('m_rows'); ul.textContent = '';
    listOf.forEach(function (x) {
      var li = el('li', x.active ? '' : 'off'), inp = el('input'); inp.value = x.name; inp.maxLength = 60; inp.setAttribute('aria-label', 'Name'); li.appendChild(inp);
      var sv = el('button', 'sm', 'Save'); sv.type = 'button'; sv.onclick = function () { mSave(kind, { id: x.id, name: inp.value }, sv); }; li.appendChild(sv);
      var tg = el('button', 'sm ghost', x.active ? 'Switch off' : 'Switch on'); tg.type = 'button'; tg.onclick = function () { mSave(kind, { id: x.id, name: x.name, active: !x.active }, tg); }; li.appendChild(tg);
      if (!x.active) li.appendChild(el('span', 'muted', 'off – not offered for a new employee'));
      ul.appendChild(li);
    });
    $('m_none').hidden = listOf.length > 0; $('m_add').onclick = function () { mSave(kind, { name: $('m_name').value }, $('m_add')); };
  }
  function mSave(kind, x, btn) { busy(btn, true); api('masterSave', Object.assign({ kind: kind }, x)).then(function (r) { busy(btn, false); S.init.departments = r.departments; S.init.designations = r.designations; toast('Saved.'); masters(); }, function (e) { busy(btn, false); fail(e); }); }

  function show(id) { $(id).hidden = false; } function hide(id) { $(id).hidden = true; }

  window.HR = {
    open: function (me, page) {
      S.me = me; if (S.init) return; 
      api('init').then(function (i) {
        S.init = i; $('app').hidden = false;
        var t; $('q').oninput = function () { clearTimeout(t); t = setTimeout(function () { S.q = $('q').value; list(); }, 300); };
        $('cat').onchange = function () { S.category = $('cat').value; list(); };
        $('b_add').onclick = function () { form(null, null); }; $('b_imp').onclick = function () { $('i_file').value = ''; $('i_err').hidden = true; $('i_res').hidden = true; $('i_save').hidden = true; show('dlg_imp'); };
        $('d_edit').onclick = function () { form(S.open.employee, S.open.boss); }; $('d_tr').onclick = transfer; $('d_exit').onclick = exit;
        $('f_form').onsubmit = save; $('t_form').onsubmit = transferSave; $('x_form').onsubmit = exitSave;
        var bt; $('f_boss').oninput = function () { clearTimeout(bt); bt = setTimeout(pickBoss, 250); };
        $('i_file').onchange = function () { importFile($('i_file').files[0]); }; $('i_save').onclick = importSave;
        Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.onclick = function () { hide(b.dataset.close); }; });
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') ['dlg_form', 'dlg_tr', 'dlg_exit', 'dlg_imp', 'dlg_emp'].some(function (d) { if (!$(d).hidden) { hide(d); return true; } return false; }); });
        go(page || 'employees');
      }, function (e) { window.HRMSG(e.message); });
    },
    _mapRows: mapRows, _csv: csv
  };
})();
