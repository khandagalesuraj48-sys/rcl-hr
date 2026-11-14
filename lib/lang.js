/* THE LANGUAGE OF THE HR WEB (asked 14-11-2026: "web warti language fix english hawey ani user wise … web sathi fkt"; "purn hr web
 * la same erp sarkhe lagu kr"). English until the person chooses मराठी or हिंदी on top of the page. The choice is the PERSON's (not
 * the site's): kept with his e-mail in hr_settings (site '*', key "web_lang" – the table of step 6; no new step), so it is
 * the same on every computer and at every site of his. Only the web reads it – the phone app has its own language.
 * The page turns its texts itself (public/i18n.js, public/i18n/mr.json, hi.json); the server's words stay English. */
'use strict';
const { db, enc } = require('./db');
const { fail } = require('./http');
const SITE = '*', KEY = 'web_lang';      // one row: { by: { '<e-mail>': 'mr' | 'hi' } } – a person on English is not in it
const ok = v => (v === 'mr' || v === 'hi' ? v : '');
const mail = e => String(e || '').toLowerCase().slice(0, 200);
const read = async () => { const r = ((await db('GET', 'hr_settings?select=value&site=eq.' + enc(SITE) + '&key=eq.' + KEY)) || [])[0]; return (r && r.value && r.value.by && typeof r.value.by === 'object' && r.value.by) || {}; };
// '' = English; a database that cannot be asked (or without step 6) = English
async function of(email) {
  if (!email) return '';
  try { return ok((await read())[mail(email)]); } catch (e) { return ''; }
}
const ACT = {
  // { lang: 'en' | 'mr' | 'hi' } – the person's own choice (the row is read and written again: the last of two people who choose
  // in the very same moment is kept – the other one chooses once more)
  async langSet(s, x) {
    const v = String(x.lang || ''); if (['en', 'mr', 'hi'].indexOf(v) < 0) throw fail(400, 'Language: English, मराठी or हिंदी.', 'lang');
    const by = Object.assign({}, await read()); if (ok(v)) by[mail(s.email)] = v; else delete by[mail(s.email)];
    await db('POST', 'hr_settings?on_conflict=site,key', [{ site: SITE, key: KEY, value: { by: by }, updated_by: s.email, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
    return { lang: ok(v) };
  },
};
module.exports = { of, ACT };      // (not for "My HR": that page is one line – the person's work is in the phone app)
