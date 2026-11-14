/* THE LANGUAGE OF THE HR WEB (asked 14-11-2026: "web warti language fix english hawey ani user wise … web la war ek option de
 * language selection cha web sathi fkt"; "purn hr web la same erp sarkhe lagu kr") – the same way as Mechanical's page (its
 * update-110 / update-244):
 *   The page's own code stays English. The web shows English until the person chooses मराठी or हिंदी on top of the page; the
 *   choice is his own, kept with his sign-in (lib/lang.js) – the same on every computer and at every site of his. The phone app
 *   has its own language and is not touched.
 *   In मराठी / हिंदी every text is turned as it appears on the screen, from i18n/mr.json / i18n/hi.json (English → the language;
 *   a text with {0}, {1}… is a pattern whose parts the page fills in). A text without a translation stays English. Never turned:
 *   what is typed, anything marked data-noi18n, and files that go out (Excel, PDF, prints).
 *   tools/i18n/extract.js collects the texts. Before the sign-in the page uses the language last used on this computer. */
(function () {
  'use strict';
  var I = { lang: '', want: '', map: null, tpl: null, word: null, seen: new Map(), done: new WeakMap(), obs: null, todo: new Set(), raf: 0 };
  var SKIP = 'script, style, textarea, code, pre, svg, [data-noi18n], [contenteditable="true"]';
  var KEEP = 'rcl_hr_lang';
  var ok = function (l) { return l === 'mr' || l === 'hi' ? l : ''; };
  function index(d) {
    var map = new Map(), tpl = new Map(), word = function (w) { return String(w || '').replace(/[^A-Za-z0-9'-]/g, '').toLowerCase(); };
    Object.keys(d).forEach(function (k) {
      if (!/\{\d+\}/.test(k)) { map.set(k, d[k]); return; }
      var parts = k.split(/(\{\d+\})/), lits = parts.filter(function (p, i) { return i % 2 === 0; });
      var first = lits.map(function (x) { return x.trim().split(/\s+/).map(word).find(function (w) { return /[a-z]{2}/.test(w); }); }).find(Boolean); if (!first) return;
      // a part put right after a word: an English ending ("day" + "" / "s" – left out of the translation) and / or more words
      // after a space or a sign (carried over), or nothing
      var end = function (i) { return /[A-Za-z]$/.test(parts[i - 1]) && !/^[A-Za-z]/.test(parts[i + 1] || ''); };
      var re; try { re = new RegExp('^' + parts.map(function (p, i) { return i % 2 ? (end(i) ? '((?:ies|es|s|y)?(?:[^A-Za-z][\\s\\S]*?)?)' : '([\\s\\S]+?)') : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('') + '$'); } catch (e) { return; }
      var list = tpl.get(first); if (!list) { list = []; tpl.set(first, list); }
      list.push({ re: re, ids: parts.filter(function (p, i) { return i % 2; }).map(function (p) { return p.slice(1, -1); }), end: parts.map(function (p, i) { return i % 2 && end(i) ? p.slice(1, -1) : null; }).filter(Boolean), to: d[k], n: lits.join('').length });
    });
    tpl.forEach(function (l) { l.sort(function (a, b) { return b.n - a.n; }); });      // the longest pattern first (the most exact)
    return { map: map, tpl: tpl, word: word };
  }
  // one text → the chosen language; null = keep it as it is
  function str(s) {
    if (!I.map || typeof s !== 'string') return null;
    var t = s.trim(); if (!t || t.length > 3000 || !/[A-Za-z]{2}/.test(t)) return null;
    var v = I.map.get(t);
    if (v === undefined && I.seen.has(t)) v = I.seen.get(t);      // a text worked out before (a list drawn again)
    else if (v === undefined) {
      var tried = new Set(), words = t.split(/\s+/).slice(0, 10);
      for (var a = 0; a < words.length && v === undefined; a++) {
        var w = I.word(words[a]); if (!w || tried.has(w)) continue; tried.add(w);
        var L = I.tpl.get(w); if (!L) continue;
        for (var b = 0; b < L.length; b++) { var x = L[b], m = x.re.exec(t); if (!m) continue;
          v = x.to.replace(/\{(\d+)\}/g, (function (x, m) { return function (all, n) { var j = x.ids.indexOf(n); return j < 0 ? all : x.end.indexOf(n) > -1 ? m[j + 1].replace(/^(ies|es|s|y)/, '') : m[j + 1]; }; })(x, m)); break; }
      }
      if (I.seen.size > 20000) I.seen.clear(); I.seen.set(t, v);
    }
    if (v === undefined || v === t) return null;
    var at = s.indexOf(t); return s.slice(0, at) + v + s.slice(at + t.length);
  }
  function text(n, inside) {      // inside: reached by the walk below, which already left out the typing boxes
    var p = n.parentElement; if (!p) return;
    var was = I.done.get(n); if (was !== undefined && was === n.nodeValue) return;      // (already turned by us)
    if (!inside && p.closest(SKIP)) return;
    var v = str(n.nodeValue); if (v === null) return;
    if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', p.value);      // the drop-down keeps its English value
    n.nodeValue = v; I.done.set(n, v);
  }
  var ATTR = ['placeholder', 'title', 'aria-label'];
  function el(e, inside) {
    if (e.nodeType !== 1) return; if (!e.hasAttribute('placeholder') && !e.hasAttribute('title') && !e.hasAttribute('aria-label')) return;
    var sk = inside && e.tagName !== 'TEXTAREA' ? null : e.closest(SKIP);
    if (sk && !(sk === e && e.tagName === 'TEXTAREA' && !(e.parentElement && e.parentElement.closest(SKIP)))) return;      // a typing box: its hint only, never what is typed
    ATTR.forEach(function (a) { var x = e.getAttribute(a); if (!x || e['__i18n_' + a] === x) return; var v = str(x); if (v !== null) { e['__i18n_' + a] = v; e.setAttribute(a, v); } });
  }
  function tree(root) {
    if (!root) return;
    if (root.nodeType === 3) { text(root); return; }
    if (root.nodeType !== 1) return;
    el(root); if (root.closest(SKIP)) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: function (x) { if (x.nodeType === 1 && x.matches(SKIP)) { if (x.tagName === 'TEXTAREA') el(x); return NodeFilter.FILTER_REJECT; } return NodeFilter.FILTER_ACCEPT; } });
    var x; while ((x = w.nextNode())) { if (x.nodeType === 3) text(x, true); else el(x, true); }
  }
  function flush() { I.raf = 0; var l = Array.from(I.todo); I.todo.clear(); try { l.forEach(tree); } catch (e) { /* a text that cannot be turned stays as it is */ } }
  function watch(on) {
    if (I.obs) { I.obs.disconnect(); I.obs = null; }
    if (!on || !document.body) return;
    I.obs = new MutationObserver(function (ms) {
      ms.forEach(function (m) { if (m.type === 'childList') m.addedNodes.forEach(function (x) { I.todo.add(x); }); else I.todo.add(m.target); });
      if (!I.raf) I.raf = requestAnimationFrame(flush);
    });
    I.obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
    tree(document.body);
  }
  function dict(l) {
    return fetch('i18n/' + l + '.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('The ' + (l === 'mr' ? 'Marathi' : 'Hindi') + ' words could not be loaded (' + r.status + ').'); return r.json(); });
  }
  var kept = function () { try { return ok(localStorage.getItem(KEEP)); } catch (e) { return ''; } };
  var keep = function (l) { try { localStorage.setItem(KEEP, l); } catch (e) { /* this page only */ } };
  var again = function () { try { location.reload(); } catch (e) { /* stays as it is */ } };
  // the language to show: '' (English), 'mr', 'hi'. Another one than the page already shows = the page is drawn again from English
  function set(lang) {
    lang = ok(lang); keep(lang);
    if (lang === I.want) return Promise.resolve(); I.want = lang;
    document.documentElement.lang = lang || 'en';
    if (!lang) { if (I.lang) { watch(false); again(); } return Promise.resolve(); }
    if (I.lang && I.lang !== lang) { watch(false); again(); return Promise.resolve(); }
    return dict(lang).then(function (d) { if (I.want !== lang) return; var x = index(d); I.map = x.map; I.tpl = x.tpl; I.word = x.word; I.lang = lang; watch(true); })
      .catch(function (e) { I.want = ''; try { console.warn(String((e && e.message) || e)); } catch (er) { /* fine */ } });
  }
  window.HRLANG = {
    set: set, lang: function () { return I.want; }, kept: kept,
    as: function (s) { var v = str(s); return v === null ? s : v; },      // for a box of the browser's own (confirm)
    _index: index, _use: function (d) { var x = index(d); I.map = x.map; I.tpl = x.tpl; I.word = x.word; I.seen.clear(); }, _str: str
  };
  // before the sign-in: the language last used on this computer
  var l0 = kept(); if (l0) { if (document.body) set(l0); else document.addEventListener('DOMContentLoaded', function () { set(l0); }); }
})();
