// RIG ONLY (the local database rig_hr – never a live one). A bulk-correction test enters days that the server itself never takes
// out again; so that the test can be run any number of times, the rig is put back when the test ends: the entries of the
// imports made DURING the test go, and the site's own attendance policy the test set is switched off again.
const { execSync } = require('child_process');
const sql = q => execSync('timeout 20 su postgres -c "psql -d rig_hr -tA -q"', { input: q }).toString().trim();
module.exports = function tidy(site) {
  const imp0 = +sql('select coalesce(max(id),0) from hr_att_imports'), ask0 = +sql('select coalesce(max(id),0) from hr_asks');
  process.on('exit', () => {
    try {
      sql('begin; create temp table t_e as select entry_id from hr_att_import_rows where import_id > ' + imp0 + '; delete from hr_att_import_rows where import_id > ' + imp0 + '; delete from hr_day_entries where id in (select entry_id from t_e); delete from hr_att_imports where id > ' + imp0 + '; ' +
        "delete from hr_asks where id > " + ask0 + " and kind = 'att_import'; insert into hr_policy_defaults (site, kind, policy_id, valid_from, set_by) select '" + site + "', 'attendance', null, '2026-11-01', 'rig tidy' where (select policy_id from hr_policy_defaults where site = '" + site + "' and kind = 'attendance' order by valid_from desc, id desc limit 1) is not null; commit;");
    } catch (e) { console.log('(the rig could not be put back: ' + e.message + ')'); }
  });
};
