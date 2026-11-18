import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { encodeQuery, withQuery } from '../client/ApiCore';

test('encodeQuery encodes scalars and comma-joins arrays', () => {
  assert.equal(encodeQuery({ a: '1', b: ['x', 'y'] }), '?a=1&b=x,y');
});

test('encodeQuery skips empty values', () => {
  assert.equal(encodeQuery({ a: '', b: undefined as unknown as string }), '');
});

test('withQuery appends to an existing query string', () => {
  assert.equal(withQuery('/cdn/x', { a: 1 }), '/cdn/x?a=1');
  assert.equal(withQuery('/cdn/x?z=0', { a: 1 }), '/cdn/x?z=0&a=1');
  assert.equal(withQuery('/cdn/x'), '/cdn/x');
});
