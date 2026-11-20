import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildIpRangeList, buildMeta, unwrapRawResponse } from '../cli/output';

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

test('buildMeta unwraps the single array of a list response', () => {
  const { items, meta } = buildMeta({ properties: [{ id: 'a' }], count: 42 });
  assert.deepEqual(items, [{ id: 'a' }]);
  assert.equal(meta.total, 42);
});

test('buildMeta passes a bare array through', () => {
  const { items, meta } = buildMeta([{ code: 'x' }]);
  assert.deepEqual(items, [{ code: 'x' }]);
  assert.deepEqual(meta, {});
});

test('buildMeta returns a single resource without wrapping it in items', () => {
  const result = buildMeta({ id: 'a', name: 'n' });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.single, { id: 'a', name: 'n' });
});

test('buildMeta refuses to guess when multiple arrays are present', () => {
  assert.throws(
    () => buildMeta({ ipV4: ['1.2.3.4'], ipV6: ['::1'] }),
    /multiple top-level arrays/,
  );
});

test('buildMeta uses itemsKey when one is supplied', () => {
  const { items } = buildMeta({ ipV4: ['1.2.3.4'], ipV6: ['::1'] }, undefined, 'ipV6');
  assert.deepEqual(items, ['::1']);
});

test('buildIpRangeList merges IPv4 and IPv6 and preserves dates in meta', () => {
  const { items, meta } = buildIpRangeList({
    lastUpdated: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-02T00:00:00Z',
    ipV4: ['1.2.3.0/24'],
    ipV6: ['2001:db8::/32'],
  });

  assert.deepEqual(items, [
    { ip: '1.2.3.0/24', version: 4 },
    { ip: '2001:db8::/32', version: 6 },
  ]);
  assert.deepEqual(meta, {
    lastUpdated: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-02T00:00:00Z',
  });
});
