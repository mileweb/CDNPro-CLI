import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { unwrapRawResponse } from '../cli/output';

function rawResponse(headers: Record<string, string | string[] | undefined>, obj: unknown) {
  return { obj, ctx: { _res: { headers } } };
}

test('unwrapRawResponse extracts last-modified from a raw response', () => {
  const rsp = rawResponse({ 'last-modified': 'Wed, 01 Jan 2026 00:00:00 GMT' }, { id: 'abc' });
  const { data, meta } = unwrapRawResponse(rsp);
  assert.deepEqual(data, { id: 'abc' });
  assert.equal(meta.lastModified, 'Wed, 01 Jan 2026 00:00:00 GMT');
});

test('unwrapRawResponse takes the first value from an array header', () => {
  const rsp = rawResponse({ 'last-modified': ['a', 'b'] }, { id: 'abc' });
  assert.equal(unwrapRawResponse(rsp).meta.lastModified, 'a');
});

test('unwrapRawResponse returns empty meta when the header is absent', () => {
  const rsp = rawResponse({}, { id: 'abc' });
  const { data, meta } = unwrapRawResponse(rsp);
  assert.deepEqual(data, { id: 'abc' });
  assert.deepEqual(meta, {});
});

test('unwrapRawResponse passes through an already-unwrapped body', () => {
  const { data, meta } = unwrapRawResponse({ id: 'abc' });
  assert.deepEqual(data, { id: 'abc' });
  assert.deepEqual(meta, {});
});
