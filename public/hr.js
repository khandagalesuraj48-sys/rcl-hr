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
    var e = S.open.employee, any = !!(e.email || e.mobile); $('lg_title').textContent = 'Sign-in for ' + e.name + ' (' + e.code + ')'; $('lg_email').textContent = e.email || '– none –'; $('lg_mobile').textContent = e.mobile || '– none –';
    $('lg_done').hidden = true; $('lg_pw').textContent = ''; $('lg_err').hidden = any; if (!any) $('lg_err').textContent = 'He has no e-mail and no mobile number: put one of them in his record first – he signs in with it.';
    $('lg_go').hidden = !any; $('lg_go').disabled = false; $('lg_go').textContent = 'Give the password';
    hide('dlg_emp'); show('dlg_login');
  }
  function loginGive() {
    var e = S.open.employee, b = $('lg_go'); b.disabled = true; $('lg_err').hidden = true;
    // (13-11-2026) his e-mail, his mobile number, or both; `known` = the user ID the Portal gave him before (a number changed since)
    window.HRPORTAL('api/hrlogin', { site: e.site, email: e.email || '', mobile: e.mobile || '', name: e.name, known: e.portal_email || '' }).then(function (r) {
      $('lg_pw').textContent = r.password; $('lg_done').hidden = false; b.disabled = false; b.textContent = 'Give another one';
      if (r.id && r.id !== e.email && r.id !== e.portal_email) api('signinLinked', { rows: [{ id: e.id, portal: r.id }] }).then(function () { e.portal_email = r.id; }, function () { /* kept at the next time */ });
    }, function (x) { b.disabled = false; $('lg_err').textContent = x.message; $('lg_err').hidden = false; });
  }
  /* ---------- a sign-in for EVERYBODY at once (13-11-2026; the button is the Super Admin's, and an HR Admin's he gave the power) ----------
   * The Portal makes the users, 20 a call; only new ones – nobody's password is changed; the first password follows its rule. */
  function signinOpen() {
    $('sg_err').hidden = true; $('sg_res').hidden = true; $('sg_res').textContent = ''; $('sg_sum').textContent = 'Reading the employees…'; $('sg_go').hidden = true; show('dlg_signin');
    api('signinPeople').then(function (r) { S.sg = r.people; $('sg_sum').textContent = r.people.length + ' employees of this site have an e-mail or a mobile number' + (r.without ? ' · ' + r.without + ' have neither (no sign-in until one is put in their record)' : '') + '.'; $('sg_go').hidden = !r.people.length; $('sg_go').disabled = false; $('sg_go').textContent = 'Give the sign-ins'; $('sg_go').onclick = signinGo; },
      function (e) { $('sg_sum').textContent = ''; $('sg_err').textContent = e.message; $('sg_err').hidden = false; });
  }
  function signinGo() {
    var people = S.sg || [], b = $('sg_go'), made = 0, has = 0, bad = [], link = [], i = 0, site = S.init.site; b.disabled = true; $('sg_err').hidden = true;
    var end = function (err) {
      var box = $('sg_res'); box.textContent = ''; box.appendChild(el('p', 'sum', made + ' sign-ins given · ' + has + ' had one already (not changed) · ' + bad.length + ' not given.'));
      if (bad.length) { var ul = el('ul', 'faults'); bad.slice(0, 200).forEach(function (x) { var li = el('li'); li.appendChild(el('b', '', x.code + ' – ' + x.name + ': ')); li.appendChild(el('span', '', x.why)); ul.appendChild(li); }); box.appendChild(ul); }
      box.hidden = false; $('sg_sum').textContent = err ? 'Stopped after ' + i + ' of ' + people.length + '.' : 'Done – ' + people.length + ' employees.'; if (err) { $('sg_err').textContent = err; $('sg_err').hidden = false; b.disabled = false; b.textContent = 'Go on'; b.onclick = function () { b.disabled = true; $('sg_err').hidden = true; step(); }; } else b.hidden = true;      // (go on: from where it stopped)
    };
    var step = function () {
      if (i >= people.length) return end('');
      var part = people.slice(i, i + 20); $('sg_sum').textContent = 'Giving the sign-ins… ' + i + ' of ' + people.length;
      window.HRPORTAL('api/hrlogin', { site: site, people: part.map(function (p) { return { email: p.email, mobile: p.mobile, name: p.name, known: p.known }; }) }).then(function (r) {
        var rows = [];
        (r.people || []).forEach(function (x, k) { var p = part[k]; if (x.state === 'made') made++; else if (x.state === 'has') has++; else bad.push({ code: p.code, name: p.name, why: x.why || 'not given' }); if (x.id && x.id !== p.email && x.id !== p.known) rows.push({ id: p.id, portal: x.id }); });
        i += part.length;
        return rows.length ? api('signinLinked', { rows: rows }).then(step, step) : step();
      }, function (e) { end(e.message); });
    };
    step();
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
  // (13-11-2026) the list as an Excel file in THE EMPLOYEE SHEET's format – the same columns the import reads (the company's own
  // sheet first, then mobile, e-mail, Aadhaar, bank …). template: the same file without rows.
  function sheetFile(r, name, done) {
    var rows = [r.heads].concat(r.rows);
    var save = function (blob, ext) { var a = el('a'); a.href = URL.createObjectURL(blob); a.download = name + ext; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); done(); };
    xlsxLib().then(function (ok) {
      if (ok) { try { var ws = window.XLSX.utils.aoa_to_sheet(rows), wb = window.XLSX.utils.book_new(); ws['!cols'] = r.heads.map(function (h) { return { wch: Math.max(12, Math.min(30, h.length + 4)) }; }); window.XLSX.utils.book_append_sheet(wb, ws, 'Employees'); return save(new Blob([window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '.xlsx'); } catch (e) { /* the plain file below */ } }
      var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      save(new Blob(['﻿' + rows.map(function (x) { return x.map(q).join(','); }).join('\r\n')], { type: 'text/csv' }), '.csv');      // Excel opens it too
    });
  }
  function exportList() {
    var b = $('b_exp'); busy(b, true);
    api('sheetExport', { q: S.q, status: S.status, category: S.category }).then(function (r) {
      sheetFile(r, 'Employees_' + r.site + '_' + new Date(Date.now() + 19800000).toISOString().slice(0, 10), function () { busy(b, false); toast(r.rows.length + ' employees in the file.' + (r.full ? '' : ' Pay and the secret numbers are written only for the HR Admin.')); });
    }, function (e) { busy(b, false); fail(e); });
  }
  function formatFile() { var b = $('i_fmt'); busy(b, true); api('sheetExport', { template: 1 }).then(function (r) { sheetFile(r, 'Employee_sheet_format', function () { busy(b, false); toast('The format is in the file – fill it and choose it here.'); }); }, function (e) { busy(b, false); fail(e); }); }

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

  // ---------- import from Excel: THE EMPLOYEE SHEET (13-11-2026) ----------
  // the headings are matched with the sheet's columns (letters and digits only, any case). "Name of Company" and "Branch Name" stand
  // once for a group of rows in the company's sheet – they are carried down. A row without a code and a name (a total) is left out.
  var normH = function (v) { return String(v === undefined || v === null ? '' : v).toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, ''); };
  function mapRows(table, cols) {
    if (!table.length) return { rows: [], cols: [], unknown: [] };
    var head = table[0].map(function (h) { return String(h === null || h === undefined ? '' : h).trim(); }), map = {}, read = [], unknown = [];
    head.forEach(function (h, i) { var n = normH(h); if (!n) return; var c = cols.filter(function (x) { return x.names.indexOf(n) > -1; })[0]; if (c && !(c.key in map)) { map[c.key] = i; read.push(h); } else if (!c) unknown.push(h); });
    var keys = Object.keys(map), last = {}, rows = [];
    table.slice(1).forEach(function (r, i) {
      var o = { _line: i + 2 }, any = false;
      keys.forEach(function (k) { var v = r[map[k]]; v = v === undefined || v === null ? '' : v; var c = cols.filter(function (x) { return x.key === k; })[0]; if (c.fill) { if (String(v).trim() !== '') last[k] = v; else v = last[k] === undefined ? '' : last[k]; } o[k] = v; });
      ['code', 'name'].forEach(function (k) { if (o[k] !== undefined && String(o[k]).trim() !== '') any = true; });
      if (any) rows.push(o);
    });
    return { rows: rows, cols: read, unknown: unknown, hasName: 'name' in map, hasProject: 'project' in map };
  }
  function csv(text) { var out = [], row = [], cur = '', q = false; for (var i = 0; i < text.length; i++) { var c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; } else cur += c; } if (cur !== '' || row.length) { row.push(cur); out.push(row); } return out; }
  function xlsxLib() { return new Promise(function (ok) { if (window.XLSX) return ok(true); var s = document.createElement('script'); s.src = '/vendor/xlsx-0.18.5.full.min.js'; s.onload = function () { ok(!!window.XLSX); }; s.onerror = function () { ok(false); }; document.head.appendChild(s); }); }
  function importFile(file) {
    if (!file) return; $('i_err').hidden = true; $('i_res').hidden = true; $('i_save').hidden = true; S.imp = null;
    var bad = function (t) { $('i_err').textContent = t; $('i_err').hidden = false; };
    var done = function (table) {
      api('sheetCols').then(function (c) {
        var m = mapRows(table, c.cols);
        if (!m.hasName) return bad('The first row of the file must have the column names, and one of them "Employee Name". Press "Download the format" to get the file with every column.');
        if (!m.rows.length) return bad('The file has no employee rows.');
        // the company's sheet holds the people of several projects: which of them belong to THIS site is chosen here – the others wait
        var by = {}; if (m.hasProject) m.rows.forEach(function (r) { var k = String(r.project).trim(); by[k] = (by[k] || 0) + 1; });
        var names = Object.keys(by);
        if (names.length > 1) return projects(m, names, by);
        check(m, m.rows);
      }, function (e) { bad(e.message); });
    };
    if (/\.csv$/i.test(file.name)) { file.text().then(function (t) { done(csv(t.replace(/^﻿/, ''))); }); return; }
    xlsxLib().then(function (ok) {
      if (!ok) return bad('An Excel file can be read only when HR is opened inside the ERP (oneclicksolution.online). Or save the sheet as CSV and choose that.');
      file.arrayBuffer().then(function (buf) { var wb = window.XLSX.read(buf, { type: 'array' }), sh = wb.Sheets[wb.SheetNames[0]]; done(window.XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' })); }, function () { bad('The file could not be read.'); });
    });
  }
  function projects(m, names, by) {
    var box = $('i_res'); box.textContent = '';
    box.appendChild(el('p', 'sum', 'This file has the people of ' + names.length + ' projects. Tick the project(s) whose people belong to THIS site (' + S.init.site + ') – the others are not imported here.'));
    var ul = el('ul', 'faults'), ticks = [];
    names.sort(function (a, b) { return by[b] - by[a]; }).forEach(function (n) { var li = el('li'), lb = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.value = n; ticks.push(cb); lb.appendChild(cb); lb.appendChild(el('span', '', ' ' + (n || '(no project)') + ' – ' + by[n] + ' people')); li.appendChild(lb); ul.appendChild(li); });
    box.appendChild(ul);
    var go = el('button', 'pri', 'Check these people'); go.type = 'button'; go.id = 'i_proj';
    go.onclick = function () { var pick = ticks.filter(function (t) { return t.checked; }).map(function (t) { return t.value; }); if (!pick.length) { $('i_err').textContent = 'Tick at least one project.'; $('i_err').hidden = false; return; } $('i_err').hidden = true; check(m, m.rows.filter(function (r) { return pick.indexOf(String(r.project).trim()) > -1; }), m.rows.length); };
    box.appendChild(go); box.hidden = false;
  }
  function check(m, rows, of) {
    if (rows.length > 1000) { $('i_err').textContent = 'The file has ' + rows.length + ' rows – at most 1000 in one file. Split it.'; $('i_err').hidden = false; return; }
    S.imp = rows; var held = of ? of - rows.length : 0;
    api('sheetImport', { rows: rows, check: 1 }).then(function (r) { importShow(r, m, held); }, function (e) { $('i_err').textContent = e.message; $('i_err').hidden = false; });
  }
  function importShow(r, m, held) {
    var box = $('i_res'); box.textContent = '';
    box.appendChild(el('p', 'sum', r.checked ? r.rows + ' rows read · ' + r.toAdd + ' new employees' + (r.incomplete ? ' (' + r.incomplete + ' of them incomplete – the date of birth missing)' : '') + ' · ' + r.toChange + ' employees of today are changed · ' + r.faults + ' with a fault (not saved).'
      : r.added + ' employees added · ' + r.changed + ' changed · ' + r.faults + ' not saved' + (r.salaries ? ' · ' + r.salaries + ' salaries set' : '') + '.'));
    if (held) box.appendChild(el('p', 'muted', held + ' people of the other projects are not imported here.'));
    if (m && m.cols.length) box.appendChild(el('p', 'muted', 'Columns read (' + m.cols.length + '): ' + m.cols.join(', ')));
    if (m && m.unknown.length) box.appendChild(el('p', 'muted', 'Columns NOT read (not of the sheet): ' + m.unknown.join(', ')));
    (r.notes || []).forEach(function (n) { box.appendChild(el('p', 'muted', n)); });
    if (r.checked && r.willMake && r.willMake.length) box.appendChild(el('p', 'muted', 'Will be added to the lists: ' + r.willMake.join(', ')));
    if (r.made && r.made.length) box.appendChild(el('p', 'muted', 'Added to the lists: ' + r.made.join(', ')));
    if (r.lines.length) { var ul = el('ul', 'faults'); r.lines.slice(0, 200).forEach(function (l) { var li = el('li'); li.appendChild(el('b', '', 'Line ' + l.line + (l.code ? ' – ' + l.code : '') + (l.name ? ' – ' + l.name : '') + ': ')); li.appendChild(el('span', '', l.why)); ul.appendChild(li); }); box.appendChild(ul); if (r.lines.length > 200) box.appendChild(el('p', 'muted', '… and ' + (r.lines.length - 200) + ' more lines with a fault.')); }
    var n = r.toAdd + r.toChange; box.hidden = false; $('i_save').hidden = !(r.checked && n > 0); $('i_save').textContent = 'Save ' + n + ' employees';
  }
  function importSave() { var b = $('i_save'); if (!S.imp) return; busy(b, true); api('sheetImport', { rows: S.imp }).then(function (r) { busy(b, false); S.imp = null; $('i_file').value = ''; importShow(r, null, 0); toast(r.added + ' added, ' + r.changed + ' changed.'); api('init').then(function (i) { S.init = i; list(); }); }, function (e) { busy(b, false); $('i_err').textContent = e.message; $('i_err').hidden = false; }); }

  // ---------- Departments / Designations ----------
  function masters() {
    var kind = S.page === 'departments' ? 'department' : 'designation', listOf = S.init[S.page]; $('m_title').textContent = S.page === 'departments' ? 'Departments' : 'Designations'; $('m_name').value = ''; $('m_name').placeholder = 'New ' + kind + ' – its name';
    var ul = $('m_rows'); ul.textContent = '';
    listOf.forEach(function (x) {
      var li = el('li', x.active ? '' : 'off'), inp = el('input'); inp.value = x.name; inp.maxLength = 60; inp.setAttribute('aria-label', 'Name'); li.appendChild(inp);
      // (13-11-2026) a designation says which category its people are (Staff / Operator / Driver / Labour) – the sheet has no Category column
      var cat = null; if (kind === 'designation') { cat = el('select'); cat.setAttribute('aria-label', 'Category'); Object.keys(CAT).forEach(function (k) { var o = el('option', '', CAT[k]); o.value = k; cat.appendChild(o); }); cat.value = x.category || 'staff'; cat.disabled = !isAdmin(); li.appendChild(cat); }
      var sv = el('button', 'sm', 'Save'); sv.type = 'button'; sv.onclick = function () { mSave(kind, cat ? { id: x.id, name: inp.value, category: cat.value } : { id: x.id, name: inp.value }, sv); }; li.appendChild(sv);
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
        $('d_login').onclick = login; $('lg_go').onclick = loginGive; $('b_signin').hidden = !S.init.signin; $('b_signin').onclick = signinOpen; $('sg_go').onclick = signinGo; $('d_salary').onclick = function () { if (window.HRPAY) window.HRPAY.sheet(S.open.employee); }; $('d_facebtn').onclick = function () { if (window.HRMUS && window.HRMUS.face) window.HRMUS.face(S.open.employee); };
        $('d_kyc').onclick = kyc; $('d_docs').onclick = docs; $('k_form').onsubmit = kycSave; $('o_add').onclick = docAdd;
        $('f_form').onsubmit = save; $('t_form').onsubmit = transferSave; $('x_form').onsubmit = exitSave;
        var bt; $('f_boss').oninput = function () { clearTimeout(bt); bt = setTimeout(pickBoss, 250); };
        $('i_file').onchange = function () { importFile($('i_file').files[0]); }; $('i_save').onclick = importSave; $('i_fmt').onclick = formatFile;
        Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.onclick = function () { hide(b.dataset.close); if (b.dataset.close === 'dlg_login') { $('lg_pw').textContent = ''; $('lg_done').hidden = true; } }; });      // (the one-time password leaves the page with its box)
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') ['dlg_form', 'dlg_tr', 'dlg_exit', 'dlg_del', 'dlg_login', 'dlg_imp', 'dlg_kyc', 'dlg_docs', 'dlg_emp'].some(function (d) { if (!$(d).hidden) { hide(d); return true; } return false; }); });
        go(page || (window.HRDASH ? 'dashboard' : 'employees'));
      }, function (e) { window.HRMSG(e.message); });
    },
    emp: function (id) { go('employees'); openEmp(id); },      // an employee's page, from the muster's day panel
    _mapRows: mapRows, _csv: csv, _dmy: dmy
  };
})();
