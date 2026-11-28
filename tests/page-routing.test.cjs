const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pages = fs.readFileSync(path.join(__dirname, '..', 'pages.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8');

test('implemented dashboard pages are connected to their renderers', () => {
  assert.match(pages, /if \(id === 'inventory'\) return inventory\(root, ctx\);/);
  assert.match(pages, /if \(id === 'growth'\) return growth\(root, ctx\);/);
  assert.match(pages, /if \(id === 'sales-today'\) return sales\.today\(root, ctx\);/);
  assert.match(pages, /if \(id === 'sales-history'\) return sales\.history\(root, ctx\);/);
  assert.match(pages, /return sales\.mount\(root, ctx\);/);
});

test('unfinished navigation sections are blocked instead of opening blank panes', () => {
  assert.match(dashboard, /const comingSoon = \{ staff: 'Staff', activity: 'Activity log', devices: 'Devices & printers' \};/);
});
