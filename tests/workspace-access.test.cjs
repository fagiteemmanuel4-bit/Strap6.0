'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('core workspace pages remain available on the free plan', () => {
  const source = fs.readFileSync(require.resolve('../dashboard.js'), 'utf8');
  const start = source.indexOf("!['home'");
  const end = source.indexOf('].includes(id)', start);
  assert.notEqual(start, -1, 'Premium navigation allow-list must be present');
  assert.notEqual(end, -1, 'Premium navigation allow-list must close correctly');
  const allowed = source.slice(start, end);
  for (const route of ['home','orders','products','customers','purchase','transfers','gift','sales-today','sales-history','new-sale','inventory','collections','growth','online','mcp','settings']) {
    assert.ok(allowed.includes("'" + route + "'"), route + ' must be accessible on the free plan');
  }
});
