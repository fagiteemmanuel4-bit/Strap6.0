'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('storefront order INSERT supplies one value for every target column', () => {
  const source = fs.readFileSync(require.resolve('../api/[...route].js'), 'utf8');
  const start = source.indexOf('insert into store_orders(');
  const end = source.indexOf(') returning id,order_number', start);
  assert.notEqual(start, -1, 'storefront order INSERT statement must be present');
  assert.notEqual(end, -1, 'storefront order INSERT must return its created order');
  const statement = source.slice(start, end);
  const split = statement.indexOf(') values(');
  assert.notEqual(split, -1, 'storefront order INSERT must include a VALUES clause');
  const columns = statement.slice(statement.indexOf('(') + 1, split).split(',').map(value => value.trim());
  const values = statement.slice(split + ') values('.length).split(',').map(value => value.trim());
  assert.equal(columns.length, values.length, 'INSERT column and value counts must match');
  assert.equal(columns.at(-2), 'payment_note');
  assert.equal(values.at(-2), '$18');
  assert.equal(columns.at(-1), 'items_snapshot');
  assert.equal(values.at(-1), '$19::jsonb');
});
