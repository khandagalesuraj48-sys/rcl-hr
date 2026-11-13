/* HR – THE RULE BOOK (step 13, 13-11-2026). hr.js opens it: HRBOOK.open(page, me).
 * His words: "super admin kade ek main rule book haway … ek hun anek policy banwayta yeil … employee la site la ho la asign
 * krta yetil … banwaleli policy edit and delet krta yetil … authorization … kon verify krel kon approval krel".
 *   The kinds down the left (Attendance, Late & early, Weekly off, Leave, Comp-off, Overtime); on the right the policies of the
 *   kind as cards – what each says today in plain words, who verifies and who approves, its versions, how many people have it.
 *   The Super Admin makes a policy, changes it (a NEW VERSION FROM A DATE) and closes it. The HR Admin of the site, the HO HR
 *   and the Super Admin GIVE it: to the whole site ("the site's own"), or to chosen people from a date.
 * Every text of a person is put in as TEXT, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  var api = function (action, body) { return window.HRAPI('api/hr', Object.assign({ action: action }, body || {})); };
  var V = { me: null, kind: 'attendance', data: null, view: 'policies', people: null, picked: {}, q: '' };
  var WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], NTH = ['1st', '2nd', '3rd', '4th', '5th'];
  var HINT = { attendance: 'How many hours make a full day and a half day.', late: 'From when a person is late or gone early, and what that costs.', weekoff: 'Which days of the week are off – also only the 2nd and 4th Saturday.',
    leave: 'How leave is earned, whether it is carried on, what happens when he is relieved.', compoff: 'What work on a weekly off or a holiday gives.', overtime: 'From when extra time counts and what it gives.' };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('-') : ''; };
  var today = function () { return new Date(Date.now() + 19800000).toISOString().slice(0, 10); };
  function toast(t, bad) { var e = $('toast'); e.textContent = t; e.className = bad ? 'bad' : ''; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, bad ? 8000 : 3500); }
  function fail(e) { toast(e && e.message ? e.message : 'HR did not answer – try again.', true); }
  function done(title, sub) { if (window.HRPROF && window.HRPROF.saved) window.HRPROF.saved(title, sub || ''); else toast(title); }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  var nameOf = function (id) { var p = (V.data.policies || []).filter(function (x) { return x.id === id; })[0]; return p ? p.name : ''; };
  var roleName = function (k) { var r = (V.data.roles || []).filter(function (x) { return x.key === k; })[0]; return r ? r.name : k; };

  /* what a policy says, in plain words – one line for each thing that is filled (nothing filled: "nothing is applied") */
  function lines(kind, b) {
    b = b || {}; var o = [];
    if (kind === 'attendance') { if (b.full_hours !== undefined) o.push(['Full day', b.full_hours + ' hours or more']); if (b.half_hours !== undefined) o.push(['Half day', b.half_hours + ' hours or more – less is absent']); if (b.once) o.push(['Punch', 'one IN and one OUT a day']); }
    else if (kind === 'late') {
      if (b.grace_min !== undefined) o.push(['Late', 'IN more than ' + b.grace_min + ' min after the shift starts']); if (b.early_min !== undefined) o.push(['Early', 'OUT more than ' + b.early_min + ' min before the shift ends']);
      if (b.free !== undefined) o.push(['In a month', b.free + ' late / early days are only marked – every one after them is a half day']);
      if (b.half_after_min !== undefined) o.push(['Half day at once', 'IN more than ' + b.half_after_min + ' min late']); if (b.half_before_min !== undefined) o.push(['Half day at once', 'OUT more than ' + b.half_before_min + ' min early']);
    } else if (kind === 'weekoff') {
      var d = (b.days || []).map(function (w) { return 'every ' + WD[w]; }); Object.keys(b.nth || {}).forEach(function (w) { d.push('the ' + b.nth[w].map(function (n) { return NTH[n - 1]; }).join(' and ') + ' ' + WD[w]); });
      o.push(['Off', d.length ? d.join(', ') : 'no weekly off – every day is a working day']);
    } else if (kind === 'leave') {
      o.push(['Earned', b.earn === 'sunday' ? 'one leave for each Sunday worked – at most ' + b.per_month + ' a month' : b.per_month + ' leave(s) at the start of every month']);
      o.push(['Unused leave', b.carry === false ? 'lapses at the month\'s end' : 'goes on to the next month']); o.push(['Absent without a request', b.auto_absent ? 'takes one leave by itself' : 'the balance stays – the day is unpaid']);
      if (b.exit) o.push(['When relieved', b.exit === 'pay' ? 'unused leave is paid' + (b.exit_max !== undefined ? ' – at most ' + b.exit_max + ' days' : '') : 'unused leave is not paid']);
    } else if (kind === 'compoff') { o.push(['Work on a day off', b.result === 'leave' ? 'one day added to the Comp-off balance' : b.result === 'pay' ? 'paid as an extra day' : 'gives nothing']); if (b.result !== 'none') o.push(['Counts when', b.full_shift === false ? 'he worked at all' : 'he worked a whole shift']); }
    else if (kind === 'overtime') {
      if (b.after_min !== undefined) o.push(['Counted', 'when OUT is ' + b.after_min + ' min or more after the shift ends']); if (b.round_min !== undefined) o.push(['In steps of', b.round_min + ' min']);
      o.push(['Overtime gives', b.result === 'pay' ? 'pay' + (b.rate !== undefined ? ' – ' + b.rate + ' × the hourly rate' : '') : b.result === 'leave' ? 'leave – a shift\'s hours make one day' : 'nothing']);
    }
    return o;
  }
  function who(list) { return (list || []).map(function (p) { return p.role ? roleName(p.role) : p.email + (p.stand_in ? ' (or ' + p.stand_in + ')' : ''); }).join(' or '); }

  /* ───────── the page ───────── */
  function load() { api('rbList').then(function (r) { V.data = r; draw(); }, function (e) { var root = $('p_book'); root.textContent = ''; root.appendChild(el('p', 'none', e && e.message ? e.message : 'HR did not answer – try again.')); }); }
  function draw() {
    var r = V.data, root = $('p_book'); root.textContent = '';
    if (window.HRHEAD && !root.hidden) window.HRHEAD.set('Rule Book · नियम पुस्तक', 'Every policy of attendance, leave, weekly off, comp-off and overtime – with its date, who verifies and who approves, and for whom it counts.', r && r.ready && r.can.make ? [btn('st-btn red', '+ New policy', function () { form(null); })] : []);
    if (!r.ready) { var n = el('div', 'rb-off'); n.appendChild(el('b', '', 'The Rule Book is not set up yet')); n.appendChild(el('p', '', r.note || '')); n.appendChild(el('p', 'muted', 'Until then attendance, leave and pay go on exactly as they do today.')); root.appendChild(n); return; }
    var wrap = el('div', 'rb'), side = el('aside', 'rb-side'), main = el('div', 'rb-main');
    r.kinds.forEach(function (k) {
      var n = r.policies.filter(function (p) { return p.kind === k.key; }).length, b = btn('rb-k' + (V.kind === k.key ? ' on' : ''), '', function () { V.kind = k.key; V.view = 'policies'; V.people = null; V.picked = {}; draw(); });
      var t = el('span'); t.appendChild(el('b', '', k.name)); t.appendChild(el('small', '', HINT[k.key])); b.appendChild(t); b.appendChild(el('em', '', n)); if (V.kind === k.key) b.setAttribute('aria-current', 'true'); side.appendChild(b);
    });
    wrap.appendChild(side); wrap.appendChild(main); root.appendChild(wrap);
    var tabs = el('div', 'rb-tabs'); [['policies', 'Policies'], ['people', 'Who has which']].forEach(function (x) { var b = btn(V.view === x[0] ? 'on' : '', x[1], function () { V.view = x[0]; draw(); }); tabs.appendChild(b); }); main.appendChild(tabs);
    if (V.view === 'people') people(main); else policies(main);
  }
  function policies(main) {
    var r = V.data, list = r.policies.filter(function (p) { return p.kind === V.kind; }), def = r.defaults[V.kind] || {};
    // what this site gives to everybody
    var top = el('div', 'rb-site'), t = el('div'); t.appendChild(el('small', '', 'This site gives to everybody')); t.appendChild(el('b', '', def.policy_id ? nameOf(def.policy_id) || 'a policy not open for this site' : 'No policy of the Rule Book – the site\'s rules of before count'));
    if (def.policy_id) t.appendChild(el('span', '', 'since ' + dmy(def.valid_from))); if (def.next) t.appendChild(el('span', 'next', 'from ' + dmy(def.next.valid_from) + ': ' + (def.next.policy_id ? nameOf(def.next.policy_id) : 'none')));
    top.appendChild(t); if (r.can.give) top.appendChild(btn('st-btn', 'Change…', function () { giveSite(); })); main.appendChild(top);
    if (!list.length) { main.appendChild(el('p', 'none', r.can.make ? 'No policy of this kind yet – press "+ New policy".' : 'No policy of this kind is open for this site yet – the Super Admin makes them.')); return; }
    var grid = el('div', 'rb-grid');
    list.forEach(function (p) {
      var c = el('div', 'rb-card' + (p.active ? '' : ' closed')), h = el('div', 'rb-h'), nm = el('div'); nm.appendChild(el('b', '', p.name));
      nm.appendChild(el('small', '', p.valid_from ? 'version of ' + dmy(p.valid_from) + (p.versions.length > 1 ? ' · ' + p.versions.length + ' versions' : '') : 'starts ' + dmy((p.versions[p.versions.length - 1] || {}).valid_from)));
      h.appendChild(nm); var tags = el('div', 'rb-tags'); if (!p.active) tags.appendChild(el('span', 'st s-left', 'Closed')); if (def.policy_id === p.id) tags.appendChild(el('span', 'st s-active', 'The site\'s own')); if (p.people) tags.appendChild(el('span', 'st s-pending', p.people + (p.people === 1 ? ' person' : ' people'))); h.appendChild(tags); c.appendChild(h);
      var body = p.body || (p.versions[p.versions.length - 1] || {}).body, au = p.auth || (p.versions[p.versions.length - 1] || {}).auth || {}, dl = el('dl'), ls = lines(p.kind, body);
      ls.forEach(function (x) { dl.appendChild(el('dt', '', x[0])); dl.appendChild(el('dd', '', x[1])); }); if (!ls.length) { dl.appendChild(el('dt', '', 'Says')); dl.appendChild(el('dd', '', 'nothing is applied')); }
      c.appendChild(dl);
      var a = el('div', 'rb-auth'); if ((au.verify || []).length) { a.appendChild(el('span', '', 'Verify')); a.appendChild(el('b', '', who(au.verify))); a.appendChild(el('i', '', '→')); } a.appendChild(el('span', '', 'Approve')); a.appendChild(el('b', '', who(au.approve) || '–')); c.appendChild(a);
      c.appendChild(el('p', 'rb-for', p.sites.length ? 'Open for: ' + p.sites.join(', ') : 'Open for every site'));
      var f = el('div', 'rb-do');
      if (r.can.give && p.active && p.open) f.appendChild(btn('st-btn', 'Give to people…', function () { V.view = 'people'; V.want = p.id; draw(); }));
      if (r.can.make) { f.appendChild(btn('st-btn', 'Change from a date…', function () { form(p); })); f.appendChild(btn('st-btn', p.active ? 'Close' : 'Open again', function () { api('rbClose', { id: p.id, active: !p.active }).then(function () { done(p.active ? 'Closed' : 'Open again', p.name); load(); }, fail); }));
        if (!p.people && def.policy_id !== p.id) f.appendChild(btn('st-btn del', 'Delete', function () { if (!window.confirm('Delete "' + p.name + '"? Only a policy that was never given to anybody can be deleted.')) return; api('rbDelete', { id: p.id }).then(function () { done('Deleted', p.name); load(); }, fail); })); }
      c.appendChild(f);
      if (p.versions.length > 1) { var d = el('details', 'rb-ver'); d.appendChild(el('summary', '', 'Earlier and coming versions')); p.versions.forEach(function (v) { var row = el('p'); row.appendChild(el('b', '', 'From ' + dmy(v.valid_from))); row.appendChild(document.createTextNode(' – ' + (lines(p.kind, v.body).map(function (x) { return x[0] + ': ' + x[1]; }).join('; ') || 'nothing is applied') + ' · by ' + v.by)); d.appendChild(row); }); c.appendChild(d); }
      grid.appendChild(c);
    });
    main.appendChild(grid);
  }

  /* ───────── who has which: the people of the site, tick some, give them a policy from a date ───────── */
  function people(main) {
    var r = V.data, list = r.policies.filter(function (p) { return p.kind === V.kind && p.active && p.open; });
    if (!V.people) { main.appendChild(el('p', 'none', 'Reading…')); api('rbPeople', { kind: V.kind }).then(function (x) { V.people = x.rows || []; draw(); }, fail); return; }
    var tools = el('div', 'tools'), q = el('input'); q.type = 'search'; q.placeholder = 'Search name or code'; q.value = V.q; q.setAttribute('aria-label', 'Search'); q.oninput = function () { V.q = q.value; rows(); }; tools.appendChild(q);
    var sel = el('select'); sel.setAttribute('aria-label', 'Policy to give'); var o0 = el('option', '', '– the site\'s own policy –'); o0.value = ''; sel.appendChild(o0); list.forEach(function (p) { var o = el('option', '', p.name); o.value = p.id; sel.appendChild(o); }); if (V.want) sel.value = V.want;
    var from = el('input'); from.type = 'date'; from.value = today(); from.setAttribute('aria-label', 'From which day'); var why = el('input'); why.type = 'text'; why.maxLength = 200; why.placeholder = 'Reason (optional)'; why.setAttribute('aria-label', 'Reason');
    var give = btn('pri', 'Give to the ticked', function () {
      var ids = Object.keys(V.picked).filter(function (k) { return V.picked[k]; }); if (!ids.length) { toast('Tick at least one employee.', true); return; } if (!from.value) { toast('From: choose the day.', true); return; }
      give.disabled = true; api('rbAssign', { kind: V.kind, policy_id: sel.value ? +sel.value : null, valid_from: from.value, employees: ids, reason: why.value }).then(function (x) { done('Given', x.given + (x.given === 1 ? ' employee' : ' employees') + ' · from ' + dmy(from.value)); V.people = null; V.picked = {}; V.want = null; load(); }, function (e) { give.disabled = false; fail(e); });
    });
    if (r.can.give) { tools.appendChild(sel); tools.appendChild(from); tools.appendChild(why); tools.appendChild(give); } main.appendChild(tools);
    var box = el('div', 'box'), t = el('table'), th = el('thead'), hr = el('tr'), all = el('input'); all.type = 'checkbox'; all.setAttribute('aria-label', 'Tick everybody shown');
    var h0 = el('th'); if (r.can.give) h0.appendChild(all); hr.appendChild(h0); ['Employee', 'Category', 'Policy today', 'From'].forEach(function (x) { hr.appendChild(el('th', '', x)); }); th.appendChild(hr); t.appendChild(th); var tb = el('tbody'); t.appendChild(tb); box.appendChild(t); main.appendChild(box);
    var CAT = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
    function rows() {
      tb.textContent = ''; var f = V.q.trim().toLowerCase(), shown = V.people.filter(function (e) { return !f || e.name.toLowerCase().indexOf(f) > -1 || String(e.code).toLowerCase().indexOf(f) > -1; });
      shown.forEach(function (e) {
        var tr = el('tr'), c = el('td'), ck = el('input'); ck.type = 'checkbox'; ck.checked = !!V.picked[e.id]; ck.setAttribute('aria-label', 'Tick ' + e.name); ck.onchange = function () { V.picked[e.id] = ck.checked; count(); }; if (r.can.give) c.appendChild(ck); tr.appendChild(c);
        var nm = el('td', 'nm pwho'), bx = el('div'); bx.appendChild(el('b', '', e.name)); bx.appendChild(el('small', '', e.code)); nm.appendChild(bx); tr.appendChild(nm);
        var ct = el('td'); ct.appendChild(el('span', 'cat c-' + e.category, CAT[e.category] || e.category)); tr.appendChild(ct);
        tr.appendChild(el('td', '', e.policy_id ? nameOf(e.policy_id) || 'a policy not open for this site' : 'None – the rules of before'));
        var fr = el('td'); fr.appendChild(el('span', 'st ' + (e.from === 'person' ? 's-pending' : e.from === 'site' ? 's-active' : 's-left'), e.from === 'person' ? 'His own · since ' + dmy(e.since) : e.from === 'site' ? 'The site\'s' : 'None')); tr.appendChild(fr);
        tr.style.cursor = 'default'; tb.appendChild(tr);
      });
      all.checked = shown.length > 0 && shown.every(function (e) { return V.picked[e.id]; }); all.onchange = function () { shown.forEach(function (e) { V.picked[e.id] = all.checked; }); rows(); count(); };
      if (!shown.length) { var tr0 = el('tr'), td0 = el('td', 'none', 'Nobody matches.'); td0.colSpan = 5; tr0.appendChild(td0); tb.appendChild(tr0); }
    }
    function count() { var n = Object.keys(V.picked).filter(function (k) { return V.picked[k]; }).length; give.textContent = n ? 'Give to ' + n + ' ticked' : 'Give to the ticked'; }
    rows(); count();
  }
  // the site's own policy of this kind, from a date
  function giveSite() {
    var r = V.data, list = r.policies.filter(function (p) { return p.kind === V.kind && p.active && p.open; }), d = sheet('The site\'s own policy · ' + (r.kinds.filter(function (k) { return k.key === V.kind; })[0] || {}).name, 'Everybody of this site who has no policy of his own gets it – also every new employee. The days before the date keep what they had.');
    var g = el('div', 'grid'), sel = el('select'); var o0 = el('option', '', '– none: the site\'s rules of before –'); o0.value = ''; sel.appendChild(o0); list.forEach(function (p) { var o = el('option', '', p.name); o.value = p.id; sel.appendChild(o); }); sel.value = (r.defaults[V.kind] || {}).policy_id || '';
    var from = el('input'); from.type = 'date'; from.value = today(); field(g, 'Policy', sel); field(g, 'From which day', from); d.body.appendChild(g);
    d.acts.appendChild(btn('sec', 'Cancel', d.close)); var ok = btn('pri', 'Save', function () { ok.disabled = true; api('rbDefault', { kind: V.kind, policy_id: sel.value ? +sel.value : null, valid_from: from.value }).then(function () { d.close(); done('Saved', 'The site\'s own policy · from ' + dmy(from.value)); V.people = null; load(); }, function (e) { ok.disabled = false; d.err(e.message); }); }); d.acts.appendChild(ok);
  }

  /* ───────── a new policy / a new version of one (Super Admin) ───────── */
  function field(parent, label, input, hint) { var d = el('div'), l = el('label', '', label); d.appendChild(l); d.appendChild(input); if (hint) d.appendChild(el('small', 'rb-hint', hint)); parent.appendChild(d); return input; }
  function sheet(title, sub) {
    var d = el('div', 'dlg'), s = el('div', 'sheet wide'); s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.appendChild(el('h2', '', title)); if (sub) s.appendChild(el('p', 'sub', sub));
    var body = el('div'), err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); var acts = el('div', 'acts'); s.appendChild(body); s.appendChild(err); s.appendChild(acts); d.appendChild(s);
    var close = function () { document.removeEventListener('keydown', key); if (d.parentNode) d.parentNode.removeChild(d); }, key = function (ev) { if (ev.key === 'Escape') close(); }; document.addEventListener('keydown', key); document.body.appendChild(d);
    return { body: body, acts: acts, close: close, err: function (t) { err.textContent = t; err.hidden = false; } };
  }
  function numIn(v, ph) { var i = el('input'); i.type = 'number'; i.step = 'any'; i.min = '0'; if (v !== undefined && v !== null) i.value = v; i.placeholder = ph || 'leave empty = not applied'; return i; }
  function pickIn(list, v) { var s = el('select'); list.forEach(function (x) { var o = el('option', '', x[1]); o.value = x[0]; s.appendChild(o); }); if (v !== undefined) s.value = String(v); return s; }
  function form(p) {
    var r = V.data, kind = p ? p.kind : V.kind, b = (p && (p.body || (p.versions[0] || {}).body)) || {}, au = (p && (p.auth || (p.versions[0] || {}).auth)) || { verify: [], approve: [] }, kn = (r.kinds.filter(function (k) { return k.key === kind; })[0] || {}).name;
    var d = sheet(p ? 'Change "' + p.name + '" from a date' : 'New policy · ' + kn, p ? 'What is saved here counts FROM THE DATE below. The days before it keep the version they had.' : HINT[kind] + ' Anything left empty is not applied.');
    var g = el('div', 'grid g3'), name = el('input'); name.maxLength = 60; name.value = p ? p.name : ''; var from = el('input'); from.type = 'date'; from.value = today();
    var sites = el('input'); sites.value = p ? p.sites.join(', ') : ''; sites.placeholder = 'empty = every site';
    field(g, 'Name *', name); field(g, 'Counts from *', from); field(g, 'Open for these sites', sites, 'site codes with a comma – e.g. ' + r.site); d.body.appendChild(g);
    d.body.appendChild(el('p', 'fs', 'What it says'));
    var f = el('div', 'grid g3'), get = {}; d.body.appendChild(f);
    var N = function (key, label, hint) { var i = field(f, label, numIn(b[key]), hint); get[key] = function () { return i.value; }; }, P = function (key, label, list, hint) { var s = field(f, label, pickIn(list, b[key]), hint); get[key] = function () { return s.value; }; }, Y = function (key, label, def) { var s = field(f, label, pickIn([['yes', 'Yes'], ['no', 'No']], (b[key] === undefined ? def : b[key]) ? 'yes' : 'no')); get[key] = function () { return s.value === 'yes'; }; };
    if (kind === 'attendance') { N('full_hours', 'Hours for a full day'); N('half_hours', 'Hours for a half day', 'less than this is absent'); Y('once', 'One IN and one OUT a day', false); }
    else if (kind === 'late') { N('grace_min', 'Late after (minutes)', 'after the shift starts'); N('early_min', 'Early before (minutes)', 'before the shift ends'); N('free', 'Late / early days allowed in a month', 'every one after them is a half day'); N('half_after_min', 'Half day when later than (minutes)'); N('half_before_min', 'Half day when gone earlier than (minutes)'); }
    else if (kind === 'weekoff') {
      var grid = el('div', 'rb-wo'), state = {}; WD.forEach(function (w, i) {
        var row = el('div'), nth = (b.nth || {})[i] || (b.nth || {})[String(i)] || [], every = (b.days || []).indexOf(i) > -1; state[i] = every ? [1, 2, 3, 4, 5] : nth.slice(); row.appendChild(el('b', '', w));
        NTH.forEach(function (n, k) { var l = el('label'), c = el('input'); c.type = 'checkbox'; c.checked = state[i].indexOf(k + 1) > -1; c.onchange = function () { state[i] = state[i].filter(function (x) { return x !== k + 1; }); if (c.checked) state[i].push(k + 1); }; l.appendChild(c); l.appendChild(document.createTextNode(' ' + n)); row.appendChild(l); });
        grid.appendChild(row);
      });
      f.className = ''; f.appendChild(el('p', 'rb-hint', 'Tick the weeks of the month in which the day is off. All five ticked = every week. Nothing ticked anywhere = no weekly off (a road site).')); f.appendChild(grid);
      get.days = function () { return Object.keys(state).filter(function (k) { return state[k].length === 5; }).map(Number); }; get.nth = function () { var o = {}; Object.keys(state).forEach(function (k) { if (state[k].length && state[k].length < 5) o[k] = state[k].slice().sort(); }); return o; };
    } else if (kind === 'leave') { P('earn', 'How leave is earned *', [['month', 'So many at the start of every month'], ['sunday', 'One for each Sunday worked']]); N('per_month', 'Leaves a month *', 'by a Sunday worked: at most so many'); Y('carry', 'Unused leave goes on to the next month', true); Y('auto_absent', 'An absent day takes one leave by itself', false); P('exit', 'Unused leave when he is relieved', [['', '– not decided –'], ['pay', 'It is paid'], ['none', 'It is not paid']]); N('exit_max', 'Relieving: at most so many days are paid'); }
    else if (kind === 'compoff') { P('result', 'Work on a day off gives *', [['leave', 'A day in the Comp-off balance'], ['pay', 'Pay for an extra day'], ['none', 'Nothing']]); Y('full_shift', 'Only when he worked a whole shift', true); }
    else if (kind === 'overtime') { N('after_min', 'Counted when later than the shift\'s end by (minutes)'); N('round_min', 'Counted in steps of (minutes)', '30 = 50 minutes count as 30'); P('result', 'Overtime gives *', [['pay', 'Pay'], ['leave', 'Leave (a shift\'s hours = one day)'], ['none', 'Nothing']]); N('rate', 'Pay: times the hourly rate', '1 = the plain rate'); }
    // who verifies, who approves
    d.body.appendChild(el('p', 'fs', 'Who verifies and who approves'));
    var ag = el('div', 'grid'), step = function (label, list, hint) {
      var box = el('div', 'rb-step'), picked = (list || []).map(function (x) { return Object.assign({}, x); }), chips = el('div', 'rb-chips'), add = el('div', 'rb-add');
      var paint = function () { chips.textContent = ''; picked.forEach(function (x, i) { var c = el('span', 'rb-chip', x.role ? roleName(x.role) : x.email + (x.stand_in ? ' (or ' + x.stand_in + ')' : '')); var rm = btn('', '×', function () { picked.splice(i, 1); paint(); }); rm.setAttribute('aria-label', 'Remove'); c.appendChild(rm); chips.appendChild(c); }); if (!picked.length) chips.appendChild(el('small', 'muted', hint)); };
      var role = pickIn([['', '+ a role…']].concat(r.roles.map(function (x) { return [x.key, x.name]; }))); role.onchange = function () { if (role.value && !picked.some(function (x) { return x.role === role.value; })) picked.push({ role: role.value }); role.value = ''; paint(); };
      var mail = el('input'); mail.type = 'email'; mail.placeholder = 'or a person\'s e-mail'; var sub = el('input'); sub.type = 'email'; sub.placeholder = 'stand-in (optional)';
      var plus = btn('sm ghost', 'Add', function () { var m = mail.value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(m)) { toast('A person: his e-mail.', true); return; } var o = { email: m }; if (sub.value.trim()) o.stand_in = sub.value.trim().toLowerCase(); picked.push(o); mail.value = ''; sub.value = ''; paint(); });
      add.appendChild(role); add.appendChild(mail); add.appendChild(sub); add.appendChild(plus); box.appendChild(el('label', '', label)); box.appendChild(chips); box.appendChild(add); ag.appendChild(box); paint(); return function () { return picked; };
    };
    var ver = step('Verify (may be left empty)', au.verify, 'nobody – it goes straight to approval'), app = step('Approve *', au.approve, 'choose at least one'); d.body.appendChild(ag);
    d.acts.appendChild(btn('sec', 'Cancel', d.close));
    var ok = btn('pri', p ? 'Save the new version' : 'Save', function () {
      var body = {}; Object.keys(get).forEach(function (k) { body[k] = get[k](); });
      ok.disabled = true; var t0 = ok.textContent; ok.textContent = 'Saving…';
      api('rbSave', { id: p ? p.id : undefined, kind: kind, name: name.value, valid_from: from.value, sites: sites.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), body: body, auth: { verify: ver(), approve: app() } }).then(function () { d.close(); done('Saved', name.value + ' · from ' + dmy(from.value)); V.kind = kind; load(); }, function (e) { ok.disabled = false; ok.textContent = t0; d.err(e.message); });
    }); d.acts.appendChild(ok); name.focus();
  }

  /* ───────── APPROVALS: what waits for "verify" and "approve" – overtime, comp-off, extra leave ───────── */
  var A = { status: 'pending', view: 'asks', month: '', found: null, picked: {} };
  var KIND = { overtime: 'Overtime', compoff: 'Comp-off', leave_credit: 'Leave days', att_import: 'Attendance correction' }, CATN = { staff: 'Staff', operator: 'Operator', driver: 'Driver', labour: 'Labour' };
  function what(r) {
    var b = r.body || {};
    if (r.kind === 'overtime') return (Math.round(b.minutes / 6) / 10) + ' h extra → ' + (b.result === 'leave' ? b.days + ' day(s) in the Comp-off balance' : b.result === 'pay' ? 'pay (' + b.rate + ' × the hourly rate)' : 'nothing');
    if (r.kind === 'compoff') return 'worked ' + b.hours + ' h on a day off → ' + (b.result === 'leave' ? b.days + ' day in the Comp-off balance' : 'pay for an extra day');
    if (r.kind === 'leave_credit') return (b.days > 0 ? '+' : '') + b.days + ' day(s) · ' + (b.bucket === 'comp' ? 'Comp-off' : 'Paid leave') + (b.source === 'opening' ? ' · opening balance' : '') + ' – ' + (b.reason || '');
    return '';
  }
  function approvals() {
    var root = $('p_book'); root.textContent = '';
    if (window.HRHEAD && !root.hidden) window.HRHEAD.set('Approvals · मंजुरी', 'Overtime, comp-off and extra leave count only after they are verified and approved – by whom each policy says.', []);
    var tabs = el('div', 'rb-tabs'); [['asks', 'Requests'], ['extras', 'Overtime & comp-off of the month']].forEach(function (x) { tabs.appendChild(btn(A.view === x[0] ? 'on' : '', x[1], function () { A.view = x[0]; approvals(); })); }); root.appendChild(tabs);
    var body = el('div'); root.appendChild(body); if (A.view === 'extras') extras(body); else asks(body);
  }
  function asks(root) {
    var tools = el('div', 'tools'); [['pending', 'Waiting'], ['approved', 'Approved'], ['refused', 'Refused']].forEach(function (k) { tools.appendChild(btn(A.status === k[0] ? 'sm' : 'sm ghost', k[1], function () { A.status = k[0]; approvals(); })); }); root.appendChild(tools);
    api('askList', { status: A.status }).then(function (r) {
      if (!r.ready) { root.appendChild(el('p', 'none', r.note)); return; }
      var box = el('div', 'box'), t = el('table'), th = el('thead'), hr = el('tr'); ['Employee', 'What', 'Day', 'It is', 'Where it stands', ''].forEach(function (x) { hr.appendChild(el('th', '', x)); }); th.appendChild(hr); t.appendChild(th); var tb = el('tbody'); t.appendChild(tb); box.appendChild(t);
      r.rows.forEach(function (q) {
        var tr = el('tr'); tr.style.cursor = 'default'; var nm = el('td', 'nm pwho'), bx = el('div'); bx.appendChild(el('b', '', q.name || '–')); bx.appendChild(el('small', '', q.code + (q.category ? ' · ' + CATN[q.category] : ''))); nm.appendChild(bx); tr.appendChild(nm);
        tr.appendChild(el('td', '', KIND[q.kind] || q.kind)); tr.appendChild(el('td', '', dmy(q.day))); var w = el('td', '', what(q)); w.style.whiteSpace = 'normal'; tr.appendChild(w);
        var last = (q.steps || [])[q.steps.length - 1], st = el('td'); st.style.whiteSpace = 'normal';
        st.appendChild(el('span', 'st ' + (q.status === 'approved' ? 's-active' : q.status === 'refused' ? 's-left' : 's-incomplete'), q.status === 'pending' ? (q.stage === 'verify' ? 'Waits for verify' : 'Waits for approval') : q.status === 'approved' ? 'Approved' : 'Refused'));
        st.appendChild(el('small', 'rb-hint', q.status === 'pending' ? who((q.auth || {})[q.stage]) : (last ? 'by ' + last.by + (last.note ? ' – ' + last.note : '') : ''))); tr.appendChild(st);
        var a = el('td');
        if (q.can) {
          var note = el('input'); note.type = 'text'; note.maxLength = 200; note.placeholder = 'Why it is refused'; note.setAttribute('aria-label', 'Why it is refused'); note.hidden = true; note.style.cssText = 'height:38px;border:1px solid #ECECEE;border-radius:10px;padding:0 10px;margin-right:6px';
          var send = function (ok) { api('askDecide', { id: q.id, ok: ok, note: note.value }).then(function (x) { done(ok ? (x.status === 'approved' ? 'Approved' : 'Verified') : 'Refused', (q.name || '') + ' · ' + (KIND[q.kind] || '')); approvals(); }, fail); };
          a.appendChild(note); a.appendChild(btn('mz-ok', q.stage === 'verify' ? 'Verify' : 'Approve', function () { send(true); })); a.appendChild(btn('mz-no', 'Refuse', function () { if (note.hidden) { note.hidden = false; note.focus(); } else send(false); }));
        }
        tr.appendChild(a); tb.appendChild(tr);
      });
      root.appendChild(box); if (!r.rows.length) root.appendChild(el('p', 'none', A.status === 'pending' ? 'Nothing waits. · काही बाकी नाही.' : 'Nothing here.'));
    }, fail);
  }
  function extras(root) {
    var tools = el('div', 'tools'), m = el('input'); m.type = 'month'; m.value = A.month || today().slice(0, 7); m.setAttribute('aria-label', 'Month'); m.onchange = function () { A.month = m.value; A.picked = {}; approvals(); }; tools.appendChild(m);
    var send = btn('pri', 'Send the ticked for approval', function () { var rows = Object.keys(A.picked).filter(function (k) { return A.picked[k]; }).map(function (k) { var p = k.split('|'); return { employee_id: p[0], kind: p[1], day: p[2] }; }); if (!rows.length) { toast('Tick at least one.', true); return; } send.disabled = true; api('extraAsk', { month: m.value, rows: rows }).then(function (x) { done('Sent for approval', x.sent + (x.sent === 1 ? ' day' : ' days')); A.picked = {}; A.view = 'asks'; A.status = 'pending'; approvals(); }, function (e) { send.disabled = false; fail(e); }); });
    tools.appendChild(send); root.appendChild(tools);
    api('extraFind', { month: m.value }).then(function (r) {
      if (!r.ready) { root.appendChild(el('p', 'none', r.note)); return; }
      var box = el('div', 'box'), t = el('table'), th = el('thead'), hr = el('tr'), all = el('input'); all.type = 'checkbox'; all.setAttribute('aria-label', 'Tick all that can be sent'); var h0 = el('th'); h0.appendChild(all); hr.appendChild(h0);
      ['Employee', 'Day', 'What', 'It is', 'Where it stands'].forEach(function (x) { hr.appendChild(el('th', '', x)); }); th.appendChild(hr); t.appendChild(th); var tb = el('tbody'); t.appendChild(tb); box.appendChild(t);
      var free = r.rows.filter(function (q) { return q.status !== 'pending' && q.status !== 'approved'; });
      r.rows.forEach(function (q) {
        var k = q.employee_id + '|' + q.kind + '|' + q.day, can = q.status !== 'pending' && q.status !== 'approved', tr = el('tr'), c = el('td'); tr.style.cursor = 'default';
        if (can) { var ck = el('input'); ck.type = 'checkbox'; ck.checked = !!A.picked[k]; ck.setAttribute('aria-label', 'Tick ' + q.name + ' ' + dmy(q.day)); ck.onchange = function () { A.picked[k] = ck.checked; }; c.appendChild(ck); } tr.appendChild(c);
        var nm = el('td', 'nm pwho'), bx = el('div'); bx.appendChild(el('b', '', q.name)); bx.appendChild(el('small', '', q.code + ' · ' + (CATN[q.category] || ''))); nm.appendChild(bx); tr.appendChild(nm);
        tr.appendChild(el('td', '', dmy(q.day))); tr.appendChild(el('td', '', KIND[q.kind])); var w = el('td', '', what(q)); w.style.whiteSpace = 'normal'; tr.appendChild(w);
        var st = el('td'); st.appendChild(el('span', 'st ' + (q.status === 'approved' ? 's-active' : q.status === 'pending' ? 's-incomplete' : 's-left'), q.status === 'approved' ? 'Approved' : q.status === 'pending' ? (q.stage === 'verify' ? 'Waits for verify' : 'Waits for approval') : q.status === 'refused' ? 'Refused – can be sent again' : 'Not sent yet')); tr.appendChild(st); tb.appendChild(tr);
      });
      all.onchange = function () { free.forEach(function (q) { A.picked[q.employee_id + '|' + q.kind + '|' + q.day] = all.checked; }); approvals(); };
      root.appendChild(box); if (!r.rows.length) root.appendChild(el('p', 'none', 'No overtime and no work on a day off in this month – or no policy of the Rule Book gives anything for it.'));
    }, fail);
  }

  /* ───────── a person's LEAVE on his page: the two balances, the ledger (where every day came from), "add / take days" ───────── */
  var SRC = { month: 'Leave of the month', sunday: 'Sunday worked', opening: 'Opening balance', hr: 'HR office', overtime: 'Overtime', compoff: 'Work on a day off', leave: 'Leave taken', absent: 'Absent', lapse: 'Lapsed' };
  function ledger(id, card, box, live, canAsk) {
    card.hidden = true; box.textContent = '';
    api('leaveLedger', { id: id }).then(function (r) {
      if (!live() || !r.book) return;      // no leave policy of the Rule Book for him: his page stays as it was
      card.hidden = false; var top = el('div', 'lg-top');
      [['Paid leave', r.paid, 'k-p'], ['Comp-off', r.comp, 'k-v'], ['Booked ahead', r.booked, 'k-o'], ['Asked, not decided', r.pending, 'k-l']].forEach(function (x) { var d = el('div', x[2]); d.appendChild(el('b', '', x[1])); d.appendChild(el('span', '', x[0])); top.appendChild(d); }); box.appendChild(top);
      var list = el('div', 'lg-list'); r.ledger.slice(0, 14).forEach(function (x) { var row = el('div'); row.appendChild(el('b', x.days > 0 ? 'plus' : 'minus', (x.days > 0 ? '+' : '') + x.days)); var t = el('span'); t.appendChild(el('i', '', (SRC[x.source] || x.source) + (x.bucket === 'comp' ? ' · Comp-off' : ''))); t.appendChild(el('small', '', dmy(x.day) + (x.text && x.text !== SRC[x.source] ? ' – ' + x.text : ''))); row.appendChild(t); list.appendChild(row); });
      if (!r.ledger.length) list.appendChild(el('p', 'muted', 'Nothing in his ledger yet.')); box.appendChild(list); if (r.ledger.length > 14) box.appendChild(el('p', 'muted', '+ ' + (r.ledger.length - 14) + ' earlier lines'));
      var ab = Object.keys(r.absent || {}); if (ab.length) { var n = { none: 0, refused: 0, nobalance: 0 }; ab.forEach(function (k) { n[r.absent[k]]++; }); box.appendChild(el('p', 'warn', 'Absent: ' + [n.none ? n.none + ' with no request' : '', n.refused ? n.refused + ' although the leave was refused' : '', n.nobalance ? n.nobalance + ' – the balance had no more' : ''].filter(Boolean).join(' · ') + '.')); }
      if (canAsk) { var a = el('div', 'ep-row'); a.appendChild(btn('sec', 'Add or take days…', function () { askDays(id, function () { ledger(id, card, box, live, canAsk); }); })); box.appendChild(a); }
    }, function () { /* not set up, or not his to see: the card stays away */ });
  }
  function askDays(id, after) {
    var d = sheet('Add or take leave days', 'It is ASKED here and added to his balance when it is approved – by whom his leave policy says (the HO HR when he has none).');
    var g = el('div', 'grid g3'), bucket = pickIn([['paid', 'Paid leave'], ['comp', 'Comp-off']], 'paid'), days = el('input'); days.type = 'number'; days.step = '0.5'; days.placeholder = '2 or -1 or 0.5'; var day = el('input'); day.type = 'date'; day.value = today();
    var why = el('input'); why.maxLength = 200; var open = pickIn([['no', 'No'], ['yes', 'Yes – his opening balance']], 'no');
    field(g, 'Balance', bucket); field(g, 'Days *', days, 'a minus takes days away'); field(g, 'On which day', day); d.body.appendChild(g); var g2 = el('div', 'grid'); field(g2, 'Reason *', why); field(g2, 'Is this his opening balance?', open); d.body.appendChild(g2);
    d.acts.appendChild(btn('sec', 'Cancel', d.close)); var ok = btn('pri', 'Send for approval', function () { ok.disabled = true; api('leaveCreditAsk', { id: id, bucket: bucket.value, days: +days.value, day: day.value, reason: why.value, opening: open.value === 'yes' }).then(function (x) { d.close(); done('Sent for approval', x.stage === 'verify' ? 'It waits for "verify" first' : 'It waits for approval'); if (after) after(); }, function (e) { ok.disabled = false; d.err(e.message); }); }); d.acts.appendChild(ok); days.focus();
  }

  window.HRBOOK = {
    ledger: ledger,
    pages: [['rulebook', 'Rule Book'], ['approvals', 'Approvals']],
    has: function (page) { return page === 'rulebook' || page === 'approvals'; },
    open: function (page, me) { V.me = me; var root = $('p_book'); if (page === 'approvals') { root.textContent = ''; root.appendChild(el('p', 'none', 'Opening… · उघडत आहे…')); if (!V.data) api('rbList').then(function (r) { V.data = r; approvals(); }, function () { V.data = { roles: [], policies: [] }; approvals(); }); else approvals(); return; } if (window.HRHEAD) window.HRHEAD.set('Rule Book · नियम पुस्तक', 'Every policy of attendance, leave, weekly off, comp-off and overtime.', []); if (!V.data) { root.textContent = ''; root.appendChild(el('p', 'none', 'Opening… · उघडत आहे…')); } else draw(); load(); },
    _lines: lines
  };
})();
