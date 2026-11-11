/* GET /menu.json (→ /api/menu) – the pages of HR for the menu of the screen around it (Mechanical's dark menu). The frame only
 * (12-11-2026): one page. The pages of each phase are added here as the owner approves them. */
'use strict';
const { handler, send } = require('../lib/http');
const PAGES = [{ key: 'home', name: 'Home' }];
module.exports = handler(async (req, res) => { send(res, 200, { module: 'hr', name: 'HR', pages: PAGES }); });
module.exports.PAGES = PAGES;
