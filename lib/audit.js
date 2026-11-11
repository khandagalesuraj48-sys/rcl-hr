'use strict';
const { db } = require('./db');
/* THE AUDIT RECORD of HR (hr_audit): who did what, when – with the old and the new value where something was changed. Rows are
 * only added, never changed. Writing it never stops the work it records. */
async function audit(site, email, action, target, detail) {
  try { await db('POST', 'hr_audit', [{ site: site || '', email: email || '', action: action, target: String(target || '').slice(0, 200), detail: detail || null }], 'return=minimal'); }
  catch (e) { console.error('[hr audit] ' + String((e && e.message) || e)); }
}
module.exports = { audit };
