/* HR – the pages (Phase 1, 12-11-2026): Employees (list, one employee, add / change, transfer, exit, import from Excel), Departments,
 * Designations. The sign-in is index.html's; it calls HR.open(me, page). Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var S = { me: null, init: null, page: 'employees', q: '', status: '', category: '', rows: [], open: null, imp: null };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  // a date as DD-MM-YYYY; a moment (…T…Z) is shown as its day in India
  var dmy = function (d) { if (!d) return ''; d = String(d); if (d.indexOf('T') > 0) { var t = Date.parse(d); if (!isNaN(t)) d = new Date(t + 19800000).toISOString(); } return d.slice(0, 10).split('-').reverse().join('-'); };
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
      $('d_docs_miss').hidden = true; api('privGet', { id: e.id }).then(function (p) { S.open.priv = p; var m = p.docsMissing; $('d_docs_miss').hidden = !m.length || e.status === 'left'; $('d_docs_miss').textContent = 'Documents still to attach: ' + m.join(', ') + '.'; }, function () { /* the details are asked again when their page is opened */ });
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

  // ---------- his own details (Aadhaar, PAN, numbers, addresses) ----------
  function kyc() {
    var e = S.open.employee; api('privGet', { id: e.id }).then(function (r) {
      var p = r.personal; $('k_title').textContent = e.name + ' (' + e.code + ') – personal details'; $('k_aadhaar').value = p.aadhaar || p.aadhaar_mask || ''; $('k_pan').value = p.pan; $('k_mobile2').value = p.mobile2; $('k_fmobile').value = p.family_mobile; $('k_fname').value = p.family_name;
      var sel = $('k_frel'); sel.textContent = ''; var o = el('option', '', '–'); o.value = ''; sel.appendChild(o); r.relations.forEach(function (x) { var q = el('option', '', x.charAt(0).toUpperCase() + x.slice(1)); q.value = x; sel.appendChild(q); }); sel.value = p.family_relation;
      $('k_addr').value = p.address_current; $('k_addr2').value = p.address_permanent; $('k_same').checked = false; $('k_err').hidden = true;
      var left = e.status === 'left'; $('k_save').hidden = left; hide('dlg_emp'); show('dlg_kyc');
    }, fail);
  }
  function kycSave(ev) {
    ev.preventDefault(); var e = S.open.employee, b = $('k_save'); busy(b, true);
    api('privSave', { id: e.id, aadhaar: $('k_aadhaar').value, pan: $('k_pan').value, mobile2: $('k_mobile2').value, family_mobile: $('k_fmobile').value, family_name: $('k_fname').value, family_relation: $('k_frel').value, address_current: $('k_addr').value, address_permanent: $('k_same').checked ? $('k_addr').value : $('k_addr2').value })
      .then(function () { busy(b, false); hide('dlg_kyc'); toast('Details of ' + e.code + ' saved.'); }, function (x) { busy(b, false); $('k_err').textContent = x.message; $('k_err').hidden = false; });
  }

  // ---------- his papers ----------
  function docs() {
    var e = S.open.employee; api('docList', { id: e.id }).then(function (r) {
      S.docs = r; $('o_title').textContent = e.name + ' (' + e.code + ') – documents'; $('o_err').hidden = true; $('o_number').value = ''; $('o_exp').value = ''; $('o_file').value = '';
      $('o_miss').hidden = !r.docsMissing.length || e.status === 'left'; $('o_miss').textContent = 'Still to attach: ' + r.docsMissing.join(', ') + '.';
      var sel = $('o_kind'), keep = sel.value; sel.textContent = ''; r.kinds.forEach(function (k) { var o = el('option', '', k.name); o.value = k.key; sel.appendChild(o); }); if (keep) sel.value = keep; sel.onchange = function () { var k = r.kinds.filter(function (x) { return x.key === sel.value; })[0]; $('o_exp_box').hidden = !(k && k.expires); }; sel.onchange();
      var ul = $('o_rows'); ul.textContent = '';
      r.docs.forEach(function (d) {
        var k = r.kinds.filter(function (x) { return x.key === d.kind; })[0], li = el('li', d.active ? '' : 'off');
        li.appendChild(el('b', '', (k ? k.name : d.kind) + (d.number ? ' · ' + d.number : '') + (d.expires_on ? ' · valid up to ' + dmy(d.expires_on) : '')));
        li.appendChild(el('span', '', ' · ' + dmy(d.created_at) + ' · ' + d.created_by + (d.active ? '' : ' · removed by ' + d.removed_by + ': ' + d.removed_reason)));
        if (d.active && isAdmin()) { var rm = el('button', 'sm ghost', 'Remove'); rm.type = 'button'; rm.onclick = function () { docRemove(d); }; li.appendChild(rm); }
        if (d.canOpen) { var op = el('button', 'sm', 'Open'); op.type = 'button'; op.onclick = function () { busy(op, true); api('docLink', { doc: d.id }).then(function (x) { busy(op, false); window.open(x.url, '_blank', 'noopener'); }, function (x) { busy(op, false); fail(x); }); }; li.appendChild(op); }
        else if (d.active) li.appendChild(el('span', 'muted', ' · opened only by the HR Admin'));
        ul.appendChild(li);
      });
      $('o_none').hidden = r.docs.length > 0; $('o_add').parentNode.hidden = e.status === 'left'; hide('dlg_emp'); show('dlg_docs');
    }, fail);
  }
  function docAdd() {
    var e = S.open.employee, f = $('o_file').files[0], b = $('o_add'), bad = function (t) { busy(b, false); $('o_err').textContent = t; $('o_err').hidden = false; };
    $('o_err').hidden = true; if (!f) return bad('Choose the file first.');
    busy(b, true);
    api('docUploadUrl', { id: e.id, kind: $('o_kind').value, type: f.type, bytes: f.size }).then(function (u) {
      return fetch(u.url, { method: 'PUT', headers: { 'Content-Type': f.type, 'x-upsert': 'false' }, body: f }).then(function (r) { if (!r.ok) throw new Error('"' + f.name + '" was not kept (' + r.status + ') – try again.'); return api('docAdd', { id: e.id, kind: $('o_kind').value, path: u.path, bytes: f.size, number: $('o_number').value, expires_on: $('o_exp_box').hidden ? '' : $('o_exp').value }); }, function () { throw new Error('"' + f.name + '" could not be sent – check the internet and try again.'); });
    }).then(function () { busy(b, false); toast('Attached.'); docs(); }, function (x) { bad(x.message); });
  }
  function docRemove(d) { var why = window.prompt('Why is this document removed? (It stays in the record.)'); if (why === null) return; api('docRemove', { doc: d.id, reason: why }).then(function () { toast('Removed – kept in the record.'); docs(); }, fail); }

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
        $('d_kyc').onclick = kyc; $('d_docs').onclick = docs; $('k_form').onsubmit = kycSave; $('o_add').onclick = docAdd;
        $('f_form').onsubmit = save; $('t_form').onsubmit = transferSave; $('x_form').onsubmit = exitSave;
        var bt; $('f_boss').oninput = function () { clearTimeout(bt); bt = setTimeout(pickBoss, 250); };
        $('i_file').onchange = function () { importFile($('i_file').files[0]); }; $('i_save').onclick = importSave;
        Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.onclick = function () { hide(b.dataset.close); }; });
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') ['dlg_form', 'dlg_tr', 'dlg_exit', 'dlg_imp', 'dlg_kyc', 'dlg_docs', 'dlg_emp'].some(function (d) { if (!$(d).hidden) { hide(d); return true; } return false; }); });
        go(page || 'employees');
      }, function (e) { window.HRMSG(e.message); });
    },
    _mapRows: mapRows, _csv: csv, _dmy: dmy
  };
})();
