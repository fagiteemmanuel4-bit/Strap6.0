'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('core workspace pages remain available on the free plan', () => {
  const source = fs.readFileSync(require.resolve('../dashboard.js'), 'utf8');
  const gate = source.match(/if \\(planAccess\\.verified && planAccess\\.plan !== 'premium' && !\\[([^\\]]+)\\]\\.includes\\(id\\)\\)/);
  assert.ok(gate, 'Premium navigation guard must remain explicit');
  const allowed = gate[1];
  for (const route of ['home','orders','products','customers','purchase','transfers','gift','sales-today','sales-history','new-sale','inventory','collections','growth','online','mcp','settings']) {
    assert.ok(allowed.includes("'" + route + "'"), route + ' must be accessible on the free plan');
  }
});
