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
  var STATUS = { incomplete: 'Incomplete', pending: 'Waiting for OTP', active: 'Active', left: 'Relieved' };
  var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
  var isAdmin = function () { return S.me && (S.me.user.role === 'admin' || S.me.user.role === 'super'); };
  var nameOf = function (list, id) { var r = (list || []).filter(function (x) { return x.id === id; })[0]; return r ? r.name : ''; };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function busy(btn, on) { if (btn) { btn.disabled = !!on; } }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }

  // ---------- the frame of the pages ----------
  function face(td, key) { if (window.HRDASH && window.HRDASH.face) td.insertBefore(window.HRDASH.face(td.textContent, key), td.firstChild); return td; }      // the letters of his name before it
  var PAGE_HEAD = { employees: ['Employees · कर्मचारी', 'The Employee Master of this site – press a person to open his page.'], attendance: ['Attendance · आजची हजेरी', 'Every punch of a day as it was taken – and the doubtful ones to be looked at.'], places: ['Work places · कामाच्या जागा', 'Where attendance can be marked: the place, how many metres, for whom.'],
    phones: ['Phones · फोन', 'One phone a person – only attendance is tied to it.'], requests: ['Requests · विनंत्या', 'People ask to set an old day right – it counts only when approved.'], rules: ['Shifts & rules · शिफ्ट व नियम', 'Shifts, holidays and the rules of the muster – each with its date.'],
    departments: ['Departments · विभाग', 'The list offered in an employee\'s form.'], designations: ['Designations · पदे', 'The list offered in an employee\'s form.'], leave: ['Leave · रजा', 'Requests to decide, everybody\'s balance, and the site\'s leave policy.'], payroll: ['Payroll · पगार', 'The HO HR makes a month\'s pay from the approved attendance and the approved salaries – then locks it.'], month: ['Month verification · महिन्याची पडताळणी', 'After the month ends: the site\'s HR verifies each person\'s days, the HO HR approves the month.'], lists: ['Lists · याद्या', 'Every pick-list of the profile, and which details are compulsory – yours to change.'] };
  function tabs() {
    var t = $('tabs'); t.textContent = '';
    (window.HRDASH ? window.HRDASH.pages.map(function (p) { return [p[0], p[1], true]; }) : []).concat([['employees', 'Employees', true]]).concat((window.HRATT ? window.HRATT.pages : []).concat(window.HRMUS ? window.HRMUS.pages : []).map(function (p) { return [p[0], p[1], true]; }), (window.HRLEAVE ? window.HRLEAVE.pages : []).map(function (p) { return [p[0], p[1], true]; }), (window.HRMONTH ? window.HRMONTH.pages : []).map(function (p) { return [p[0], p[1], true]; }), (window.HRROLL ? window.HRROLL.pages : []).map(function (p) { return [p[0], p[1], !!(S.init && S.init.ho)]; }), (window.HRPROF ? window.HRPROF.pages : []).map(function (p) { return [p[0], p[1], isAdmin()]; }), [['departments', 'Departments', isAdmin()], ['designations', 'Designations', isAdmin()]]).forEach(function (p) {
      if (!p[2]) return; var b = el('button', 'tab' + (S.page === p[0] ? ' on' : ''), p[1]); b.type = 'button'; b.onclick = function () { go(p[0]); }; t.appendChild(b);
    });
  }
  // the head of every page: its name, one line about it, and on the right the page's own controls beside the site
  function head(title, sub, nodes) { $('p_title').textContent = title; $('p_sub').textContent = sub || ''; var t = $('p_tools'); t.textContent = ''; (nodes || []).forEach(function (n) { t.appendChild(n); }); }
  window.HRHEAD = { set: head };
  function go(page) {
    if ((page === 'departments' || page === 'designations' || page === 'lists') && !isAdmin()) page = 'employees';
    var att = !!window.HRATT && window.HRATT.has(page);      // (step 4) Attendance, Work places, Phones – att.js
    var mus = !!window.HRMUS && window.HRMUS.has(page);      // (step 5) Muster, Requests, Shifts & rules – mus.js
    var dash = !!window.HRDASH && window.HRDASH.has(page);      // the attendance dashboard – dash.js
    var lv = !!window.HRLEAVE && window.HRLEAVE.has(page);      // (step 7) leave – leave.js
    var mon = !!window.HRMONTH && window.HRMONTH.has(page);      // (step 10) the month's verification – month.js
    var roll = !!window.HRROLL && window.HRROLL.has(page) && !!(S.init && S.init.ho);      // (step 12) payroll – payroll.js, the HO HR only
    var prof = !!window.HRPROF && window.HRPROF.has(page);      // (step 6) the lists of the profile – prof.js
    S.page = att || mus || dash || prof || lv || mon || roll || page === 'departments' || page === 'designations' ? page : 'employees'; tabs();
    $('p_emp').hidden = S.page !== 'employees'; $('p_att').hidden = !att; $('p_mus').hidden = !mus; $('p_dash').hidden = !dash; $('p_prof').hidden = !prof; $('p_leave').hidden = !lv; $('p_month').hidden = !mon; $('p_roll').hidden = !roll; $('p_mast').hidden = att || mus || dash || prof || lv || mon || roll || S.page === 'employees';
    var hd = PAGE_HEAD[S.page]; if (hd) head(hd[0], hd[1], []);      // the dashboard and the muster fill the head themselves (HRHEAD.set)
    try { history.replaceState(null, '', location.pathname + location.search + '#page=' + S.page); } catch (e) { /* the page still works */ }
    if (dash) window.HRDASH.open(S.me, go); else if (prof) window.HRPROF.open(S.page, S.me); else if (lv) window.HRLEAVE.open(S.page, S.me); else if (mon) window.HRMONTH.open(S.page, S.me); else if (roll) window.HRROLL.open(S.page, S.me); else if (att) window.HRATT.open(S.page, S.me, S.init); else if (mus) window.HRMUS.open(S.page, S.me, S.init); else if (S.page === 'employees') list(); else masters();
  }

  // ---------- Employees: the list ----------
  /* (12-11-2026, asked: "user swatacha photo pn set karu shakel profile picture") THE FACES: where an employee has a photo (he
   * sets it in the app, or the office attaches the paper "Photo") it is shown instead of his letters – in the list and on his
   * page. The links are asked once for the rows shown and kept in the page's memory only, 8 minutes (they work for 10). */
  function pic(span, url) { if (!url) return; var im = document.createElement('img'); im.alt = ''; im.onload = function () { span.textContent = ''; span.appendChild(im); }; im.src = url; }
  function faces() {
    if (!S.photos || Date.now() - S.photosAt > 8 * 60000) { S.photos = {}; S.photosAt = Date.now(); }
    var paint = function () { Array.prototype.forEach.call(document.querySelectorAll('#emp_rows [data-face]'), function (f) { pic(f, S.photos[f.dataset.face]); }); if (S.open && !$('dlg_emp').hidden) pic($('d_face'), S.photos[S.open.employee.id]); };
    var ask = S.rows.map(function (r) { return r.id; }).filter(function (i) { return !(i in S.photos); });
    if (!ask.length) return paint();
    api('empPhotos', { ids: ask }).then(function (r) { ask.forEach(function (i) { S.photos[i] = r.photos[i] || ''; }); paint(); }, function () { /* the letters stay */ });
  }
  function list() {
    api('empList', { q: S.q, status: S.status, category: S.category }).then(function (r) {
      S.rows = r.rows; var c = r.counts, chips = $('chips'); chips.textContent = '';
      [['', 'On the rolls', c.incomplete + c.pending + c.active], ['incomplete', 'Incomplete', c.incomplete], ['pending', 'Waiting for OTP', c.pending], ['active', 'Active', c.active], ['left', 'Relieved', c.left]].forEach(function (k) {
        var b = el('button', 'chip' + (S.status === k[0] ? ' on' : '') + (k[0] ? ' s-' + k[0] : '')); b.type = 'button'; b.appendChild(el('b', '', k[2])); b.appendChild(el('span', '', k[1])); b.onclick = function () { S.status = k[0]; list(); }; chips.appendChild(b);
      });
      var tb = $('emp_rows'); tb.textContent = '';
      r.rows.forEach(function (e) {
        var tr = el('tr'); tr.tabIndex = 0;
        var nm = el('td', 'nm pwho'), box = el('div'); box.appendChild(el('b', '', e.name)); box.appendChild(el('small', '', e.code)); nm.appendChild(box); if (window.HRDASH && window.HRDASH.face) { var fa = window.HRDASH.face(e.name, e.id); fa.dataset.face = e.id; nm.insertBefore(fa, box); } tr.appendChild(nm);
        [CAT[e.category] || e.category, nameOf(S.init.designations, e.designation_id), nameOf(S.init.departments, e.department_id), e.mobile, dmy(e.joined_on), dmy(e.left_on)].forEach(function (v) { tr.appendChild(el('td', '', v || '–')); });
        var td = el('td'); td.appendChild(el('span', 'st s-' + e.status, STATUS[e.status])); tr.appendChild(td);
        tr.onclick = function () { openEmp(e.id); }; tr.onkeydown = function (ev) { if (ev.key === 'Enter') openEmp(e.id); };
        tb.appendChild(tr);
      });
      $('emp_none').hidden = r.rows.length > 0; $('emp_none').textContent = S.q || S.status || S.category ? 'Nobody matches.' : 'No employee yet – add one, or import the Excel list.';
      $('emp_more').hidden = !r.more; faces();
    }, fail);
  }

  // ---------- one employee ----------
  function row(dl, k, v) { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v || '–')); }
  function sites() { return S.init.sites.length ? S.init.sites : [{ code: S.me.site, name: S.me.siteName }]; }
  function siteName(code) { var x = sites().filter(function (y) { return y.code === code; })[0]; return x && x.name && x.name !== code ? x.name + ' (' + code + ')' : code; }
  // his attendance at a glance: work places, shift, phone, this month, today, what waits (asked apart – the page opens at once)
  function around(id) {
    var dl = $('d_att'), lab = $('d_att_lab'); dl.textContent = ''; dl.hidden = true; lab.hidden = true;
    api('empAround', { id: id }).then(function (a) {
      if (!S.open || S.open.employee.id !== id) return; var t = a.total, d = a.today;
      row(dl, 'Work places', a.places.length ? a.places.map(function (p) { return p.name; }).join(', ') : 'None is set for him – he cannot mark attendance');
      row(dl, 'Shift', a.shift); row(dl, 'Phone', a.phone ? (a.phone.model || 'Phone') + (a.phone.os ? ' · ' + a.phone.os : '') + ' – since ' + dmy(String(a.phone.since).slice(0, 10)) : 'None tied yet');
      row(dl, 'Today', d && d.code ? d.code + (d.in ? ' · IN ' + d.in : '') + (d.out ? ' · OUT ' + d.out : '') : 'Nothing yet');
      row(dl, 'This month', 'Present ' + t.P + ' · Half day ' + t.HD + ' · Absent ' + t.A + ' · Late ' + t.late + ' · Days ' + t.paid + (t.MIS ? ' · IN without OUT ' + t.MIS : ''));
      if (a.requests_waiting) row(dl, 'Requests waiting', a.requests_waiting);
      dl.hidden = false; lab.hidden = false;
    }, function () { /* attendance is not set up yet, or not his to see: the page stays as it is */ });
  }
  /* (12-11-2026, asked: "line la click kel ki lawkar te open pn hot nahiye … hr modual slow ahe") THE PAGE OPENS AT ONCE with what
   * the list already has of him (the same details – they were read with the list); his history, the person he reports to, his
   * attendance and his papers come a moment later, each by itself. Until the server has answered nothing of him can be changed
   * here (the buttons wait) – so a change always starts from the server's own answer, never from the list. */
  function openEmp(id) {
    var seq = S.seq = (S.seq || 0) + 1, had = (S.rows || []).filter(function (x) { return x.id === id; })[0];
    if (had) { drawEmp({ employee: had, history: [], boss: null }, false); show('dlg_emp'); }
    api('empGet', { id: id }).then(function (r) {
      if (seq !== S.seq || (had && $('dlg_emp').hidden)) return;      // he opened another, or closed the page meanwhile
      drawEmp(r, true); show('dlg_emp');
    }, function (x) { if (seq === S.seq) { if (had) hide('dlg_emp'); fail(x); } });
    $('d_docs_miss').hidden = true;
    api('privGet', { id: id }).then(function (p) { if (seq !== S.seq || !S.open) return; var e = S.open.employee, m = p.docsMissing; $('d_docs_miss').hidden = !m.length || e.status === 'left'; $('d_docs_miss').textContent = 'Documents still to attach: ' + m.join(', ') + '.'; }, function () { /* the details are asked again when their page is opened */ });
    around(id);
  }
  function drawEmp(r, full) {
      var e = r.employee; S.open = r; $('d_title').textContent = e.name; $('d_code').textContent = e.code + ' · ' + (CAT[e.category] || '');
      var fc = $('d_face'), st = $('d_st'); fc.textContent = e.name.trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase(); st.className = 'st ep-st s-' + e.status; st.textContent = STATUS[e.status]; pic(fc, S.photos && S.photos[e.id]);
      var dl = $('d_list'), dl2 = $('d_list2'); dl.textContent = ''; dl2.textContent = '';
      row(dl, 'Site', siteName(e.site)); row(dl, 'Designation', nameOf(S.init.designations, e.designation_id)); row(dl, 'Department', nameOf(S.init.departments, e.department_id));
      row(dl, 'Reports to', r.boss ? r.boss.name + ' (' + r.boss.code + ')' : !full && e.reports_to ? '…' : ''); row(dl, 'Active from', dmy(e.joined_on)); row(dl, 'Relieving date', e.status === 'left' ? dmy(e.left_on) : ''); if (e.status === 'left') row(dl, 'Reason', e.left_reason);
      row(dl2, 'Mobile', e.mobile); row(dl2, 'E-mail', e.email + (e.email ? (e.email_verified_at ? ' ✓ verified' : ' – not verified yet') : '')); row(dl2, 'Date of birth', dmy(e.dob)); row(dl2, 'Gender', e.gender ? e.gender.charAt(0).toUpperCase() + e.gender.slice(1) : '');
      var miss = []; if (!e.dob) miss.push('Date of birth'); if (!e.email) miss.push('E-mail'); if (!e.mobile) miss.push('Mobile');
      $('d_miss').hidden = !miss.length || e.status === 'left'; $('d_miss').textContent = 'Incomplete – still needed: ' + miss.join(', ') + '. He cannot be activated until then.';
      var h = $('d_hist'); h.textContent = '';
      r.history.forEach(function (x) { var li = el('li'); li.appendChild(el('b', '', dmy(x.valid_from) + ' → ' + (x.valid_to ? dmy(x.valid_to) : 'today'))); li.appendChild(el('span', '', ' ' + x.site + ' · ' + (nameOf(S.init.designations, x.designation_id) || '–') + ' · ' + (nameOf(S.init.departments, x.department_id) || '–') + (x.note ? ' · ' + x.note : ''))); h.appendChild(li); });
      var left = e.status === 'left'; $('d_edit').hidden = left; $('d_tr').hidden = left || !isAdmin(); $('d_exit').hidden = left || !isAdmin(); $('d_del').hidden = !isAdmin();
      $('d_salary').hidden = !isAdmin();      // (step 11) his salary: the HR Admin's or the Super Admin's to see and propose
      $('d_login').hidden = left || !isAdmin();      // his sign-in: the HR Admin's or the Super Admin's to give
      if (!full) h.appendChild(el('li', '', '…'));
      // nothing of him is opened or changed before the server's own answer is here
      ['d_prof', 'd_kyc', 'd_docs', 'd_login', 'd_facebtn', 'd_salary', 'd_del', 'd_exit', 'd_tr', 'd_edit'].forEach(function (b) { $(b).disabled = !full; });
  }

  /* ---------- his sign-in for the app (12-11-2026: "ADMIN … LA EK TEMP PASSWORD DEU SHAKEL NANTR USER SWATACHA PASS SET KRU SHAKEL") ----------
   * Given by the Portal (its api/hrlogin) to the HR Admin of the site or the Super Admin: a one-time password, and "My HR" only. */
  function login() {
    var e = S.open.employee; $('lg_title').textContent = 'Sign-in for ' + e.name + ' (' + e.code + ')'; $('lg_email').textContent = e.email || '– none: put his e-mail in his record first –';
    $('lg_done').hidden = true; $('lg_pw').textContent = ''; $('lg_err').hidden = true; $('lg_go').hidden = !e.email; $('lg_go').disabled = false; $('lg_go').textContent = 'Give a one-time password';
    hide('dlg_emp'); show('dlg_login');
  }
  function loginGive() {
    var e = S.open.employee, b = $('lg_go'); b.disabled = true; $('lg_err').hidden = true;
    window.HRPORTAL('api/hrlogin', { site: e.site, email: e.email, name: e.name }).then(function (r) {
      $('lg_pw').textContent = r.password; $('lg_done').hidden = false; b.disabled = false; b.textContent = 'Give another one';
    }, function (x) { b.disabled = false; $('lg_err').textContent = x.message; $('lg_err').hidden = false; });
  }

  // ---------- add / change ----------
  function fill(sel, list, val, none) { sel.textContent = ''; var o = el('option', '', none); o.value = ''; sel.appendChild(o); list.forEach(function (x) { if (!x.active && x.id !== val) return; var p = el('option', '', x.name); p.value = x.id; sel.appendChild(p); }); sel.value = val || ''; }
  function form(e, boss) {
    e = e || {}; $('f_title').textContent = e.id ? 'Change ' + e.code : 'Add employee'; $('f_id').value = e.id || ''; $('f_code').value = e.code || '';
    $('f_name').value = e.name || ''; $('f_cat').value = e.category || ''; $('f_gender').value = e.gender || ''; $('f_mobile').value = e.mobile || ''; $('f_email').value = e.email || '';
    $('f_dob').value = e.dob || ''; $('f_join').value = e.joined_on || ''; $('f_left').value = e.left_on ? dmy(e.left_on) : '';
    fill($('f_dep'), S.init.departments, e.department_id, '– none –'); fill($('f_des'), S.init.designations, e.designation_id, '– none –');
    // his site: one of the sites where this person has HR; for an employee of today another site = a transfer from today (HR Admin)
    var fs = $('f_site'); fs.textContent = ''; sites().forEach(function (x) { var o = el('option', '', (x.name || x.code) + (x.name && x.name !== x.code ? ' (' + x.code + ')' : '')); o.value = x.code; fs.appendChild(o); }); fs.value = e.site || S.me.site; fs.disabled = !!e.id && !isAdmin();
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
    api('empSave', { id: $('f_id').value, code: $('f_code').value, name: $('f_name').value, category: $('f_cat').value, gender: $('f_gender').value, mobile: $('f_mobile').value, email: $('f_email').value, dob: $('f_dob').value, joined_on: $('f_join').value, site: $('f_site').value,
      department_id: $('f_dep').value, designation_id: $('f_des').value, reports_to: $('f_boss').dataset.id }).then(function (r) {
      busy(b, false); hide('dlg_form'); toast(r.code + ' saved' + (r.site && r.site !== S.me.site ? ' at ' + siteName(r.site) + ' – choose that site (top right) to see him' : '') + (r.missing.length ? ' – incomplete: ' + r.missing.join(', ') + ' still needed.' : '.')); list();
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
  function exit() { var e = S.open.employee; $('x_title').textContent = 'Relieve ' + e.name + ' (' + e.code + ')'; $('x_on').value = ''; $('x_reason').value = ''; $('x_err').hidden = true; hide('dlg_emp'); show('dlg_exit'); }
  function exitSave(ev) {
    ev.preventDefault(); var e = S.open.employee, b = $('x_save'); busy(b, true);
    api('empExit', { id: e.id, on: $('x_on').value, reason: $('x_reason').value }).then(function () { busy(b, false); hide('dlg_exit'); toast(e.code + ' relieved. Nothing was deleted.'); list(); }, function (x) { busy(b, false); $('x_err').textContent = x.message; $('x_err').hidden = false; });
  }

  // (asked 12-11-2026) delete: only an employee added by mistake – the server refuses when anything hangs on him
  function del() { var e = S.open.employee; $('del_title').textContent = 'Delete ' + e.name + ' (' + e.code + ')'; $('del_reason').value = ''; $('del_err').hidden = true; hide('dlg_emp'); show('dlg_del'); $('del_reason').focus(); }
  function delSave(ev) {
    ev.preventDefault(); var e = S.open.employee, b = $('del_save'); busy(b, true);
    api('empDelete', { id: e.id, reason: $('del_reason').value }).then(function () { busy(b, false); hide('dlg_del'); toast(e.code + ' deleted.'); list(); }, function (x) { busy(b, false); $('del_err').textContent = x.message; $('del_err').hidden = false; });
  }
  // the list as an Excel file: the people the list shows now (all of them); the column names are the ones the import reads
  function exportList() {
    var b = $('b_exp'); busy(b, true);
    api('empExport', { q: S.q, status: S.status, category: S.category }).then(function (r) {
      var head = ['Code', 'Name', 'Category', 'Designation', 'Department', 'Mobile', 'E-mail', 'Date of birth', 'Gender', 'Joining date', 'Relieving date', 'Reason', 'Status'];
      var rows = [head].concat(r.rows.map(function (e) { return [e.code, e.name, CAT[e.category] || e.category, e.designation, e.department, e.mobile, e.email, dmy(e.dob), e.gender, dmy(e.joined_on), dmy(e.left_on), e.left_reason, STATUS[e.status] || e.status]; })), name = 'Employees_' + r.site + '_' + new Date(Date.now() + 19800000).toISOString().slice(0, 10);
      var save = function (blob, ext) { var a = el('a'); a.href = URL.createObjectURL(blob); a.download = name + ext; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); busy(b, false); toast(r.rows.length + ' employees in the file.'); };
      xlsxLib().then(function (ok) {
        if (ok) { try { var ws = window.XLSX.utils.aoa_to_sheet(rows), wb = window.XLSX.utils.book_new(); ws['!cols'] = head.map(function (h, i) { return { wch: i === 1 || i === 6 ? 28 : 16 }; }); window.XLSX.utils.book_append_sheet(wb, ws, 'Employees'); return save(new Blob([window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '.xlsx'); } catch (e) { /* the plain file below */ } }
        var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        save(new Blob(['\ufeff' + rows.map(function (x) { return x.map(q).join(','); }).join('\r\n')], { type: 'text/csv' }), '.csv');      // Excel opens it too
      });
    }, function (e) { busy(b, false); fail(e); });
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
      // "My HR" (an employee for himself): his attendance is in the phone app – the office's pages are not his
      if (me && me.user && me.user.role === 'self') { window.HRMSG('Your attendance is marked in the phone app (One Click Solution → HR). These pages are for the HR office. · तुमची हजेरी phone app मध्ये लावायची आहे. ही pages HR office साठी आहेत. · आपकी हाज़िरी phone app में लगानी है। ये pages HR office के लिए हैं।'); return; }
      api('init').then(function (i) {
        S.init = i; $('app').hidden = false;
        var t; $('q').oninput = function () { clearTimeout(t); t = setTimeout(function () { S.q = $('q').value; list(); }, 300); };
        $('cat').onchange = function () { S.category = $('cat').value; list(); };
        $('b_add').onclick = function () { form(null, null); }; $('b_imp').onclick = function () { $('i_file').value = ''; $('i_err').hidden = true; $('i_res').hidden = true; $('i_save').hidden = true; show('dlg_imp'); };
        $('d_edit').onclick = function () { form(S.open.employee, S.open.boss); }; $('d_tr').onclick = transfer; $('d_exit').onclick = exit; $('d_del').onclick = del; $('d_prof').onclick = function () { var id = S.open.employee.id; hide('dlg_emp'); if (window.HRPROF) window.HRPROF.profile(id, function () { openEmp(id); }); }; $('del_form').onsubmit = delSave; $('b_exp').onclick = exportList;
        $('d_login').onclick = login; $('lg_go').onclick = loginGive; $('d_salary').onclick = function () { if (window.HRPAY) window.HRPAY.sheet(S.open.employee); }; $('d_facebtn').onclick = function () { if (window.HRMUS && window.HRMUS.face) window.HRMUS.face(S.open.employee); };
        $('d_kyc').onclick = kyc; $('d_docs').onclick = docs; $('k_form').onsubmit = kycSave; $('o_add').onclick = docAdd;
        $('f_form').onsubmit = save; $('t_form').onsubmit = transferSave; $('x_form').onsubmit = exitSave;
        var bt; $('f_boss').oninput = function () { clearTimeout(bt); bt = setTimeout(pickBoss, 250); };
        $('i_file').onchange = function () { importFile($('i_file').files[0]); }; $('i_save').onclick = importSave;
        Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.onclick = function () { hide(b.dataset.close); if (b.dataset.close === 'dlg_login') { $('lg_pw').textContent = ''; $('lg_done').hidden = true; } }; });      // (the one-time password leaves the page with its box)
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') ['dlg_form', 'dlg_tr', 'dlg_exit', 'dlg_del', 'dlg_login', 'dlg_imp', 'dlg_kyc', 'dlg_docs', 'dlg_emp'].some(function (d) { if (!$(d).hidden) { hide(d); return true; } return false; }); });
        go(page || (window.HRDASH ? 'dashboard' : 'employees'));
      }, function (e) { window.HRMSG(e.message); });
    },
    emp: function (id) { go('employees'); openEmp(id); },      // an employee's page, from the muster's day panel
    _mapRows: mapRows, _csv: csv, _dmy: dmy
  };
})();
