'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('storefront order INSERT supplies one value for every target column', () => {
  const source = fs.readFileSync(require.resolve('../api/[...route].js'), 'utf8');
  const match = source.match(/insert into store_orders\\(([^)]*)\\)\\s*values\\(([^)]*)\\)\\s*returning id,order_number/);
  assert.ok(match, 'storefront order INSERT statement must be present');
  const columns = match[1].split(',').map(value => value.trim());
  const values = match[2].split(',').map(value => value.trim());
  assert.equal(columns.length, values.length, 'INSERT column and value counts must match');
  assert.equal(columns.at(-2), 'payment_note');
  assert.equal(values.at(-2), '$18');
  assert.equal(columns.at(-1), 'items_snapshot');
  assert.equal(values.at(-1), '$19::jsonb');
});
