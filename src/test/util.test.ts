import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseIntegerOption } from '../cli/util';

test('parseIntegerOption accepts integer strings', () => {
  assert.equal(parseIntegerOption('3', '--property-version'), 3);
});

test('parseIntegerOption rejects non-integers', () => {
  assert.throws(
    () => parseIntegerOption('3.5', '--property-version'),
    /--property-version must be an integer/,
  );
  assert.throws(
    () => parseIntegerOption('abc', '--property-version'),
    /--property-version must be an integer/,
  );
});

import { enrichWithLocationId } from '../cli/util';

function rawResponse(obj: unknown, location?: string | string[]) {
  return { obj, ctx: { _res: { headers: location === undefined ? {} : { location } } } };
}

test('enrichWithLocationId prefers the body id', () => {
  assert.deepEqual(enrichWithLocationId(rawResponse({ id: 'abc' }, '/cdn/x/zzz')), { id: 'abc' });
});

test('enrichWithLocationId takes the id from the Location header', () => {
  assert.equal(enrichWithLocationId(rawResponse(null, 'https://h/cdn/properties/p1'))['id'], 'p1');
  assert.equal(enrichWithLocationId(rawResponse({}, 'https://h/cdn/properties/p1/'))['id'], 'p1');
  assert.equal(enrichWithLocationId(rawResponse('', 'https://h/cdn/properties/p1?x=1'))['id'], 'p1');
  assert.equal(enrichWithLocationId(rawResponse({}, ['https://h/cdn/properties/p2']))['id'], 'p2');
});

test('enrichWithLocationId fails loudly when no id is available', () => {
  assert.throws(() => enrichWithLocationId(rawResponse({})), /no resource ID/);
  assert.throws(() => enrichWithLocationId(rawResponse({ id: '' }, '')), /no resource ID/);
});
