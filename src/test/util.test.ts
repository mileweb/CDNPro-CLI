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
