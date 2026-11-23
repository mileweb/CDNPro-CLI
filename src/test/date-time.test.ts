import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isHttpDate, isRfc3339DateTime, toHttpDate } from '../schema/date-time';
import { normalizeIfUnmodifiedSince } from '../cli/util';
import { CliError } from '../cli/errors';

test('accepts RFC 3339 date-times with timezone', () => {
  assert.equal(isRfc3339DateTime('2026-01-31T00:00:00Z'), true);
  assert.equal(isRfc3339DateTime('2026-01-31T00:00:00.123Z'), true);
  assert.equal(isRfc3339DateTime('2026-01-31T12:30:45+08:00'), true);
  assert.equal(isRfc3339DateTime('2026-01-31t00:00:00z'), true);
});

test('rejects dates without time, timezone, or valid components', () => {
  assert.equal(isRfc3339DateTime('2026-01-31'), false);
  assert.equal(isRfc3339DateTime('2026-01-31T00:00:00'), false);
  assert.equal(isRfc3339DateTime('2026-02-30T00:00:00Z'), false);
  assert.equal(isRfc3339DateTime('2026-13-01T00:00:00Z'), false);
  assert.equal(isRfc3339DateTime('2026-01-01T24:00:00Z'), false);
  assert.equal(isRfc3339DateTime('not-a-date'), false);
});

test('accepts IMF-fixdate HTTP-dates only', () => {
  assert.equal(isHttpDate('Thu, 01 Jan 2026 00:00:00 GMT'), true);
  assert.equal(isHttpDate('Wed, 01 Jan 2026 00:00:00 GMT'), false); // wrong weekday
  assert.equal(isHttpDate('Wed, 31 Feb 2026 00:00:00 GMT'), false);
  assert.equal(isHttpDate('2026-01-01T00:00:00Z'), false);
});

test('toHttpDate passes HTTP-dates through and converts RFC 3339', () => {
  assert.equal(
    toHttpDate('Thu, 01 Jan 2026 00:00:00 GMT'),
    'Thu, 01 Jan 2026 00:00:00 GMT',
  );
  assert.equal(
    toHttpDate('2026-01-01T08:00:00+08:00'),
    'Thu, 01 Jan 2026 00:00:00 GMT',
  );
  assert.equal(toHttpDate('tomorrow'), undefined);
});

test('normalizeIfUnmodifiedSince accepts HTTP-dates and converts RFC 3339', () => {
  assert.equal(
    normalizeIfUnmodifiedSince('Thu, 01 Jan 2026 00:00:00 GMT'),
    'Thu, 01 Jan 2026 00:00:00 GMT',
  );
  assert.equal(
    normalizeIfUnmodifiedSince('2026-01-01T08:00:00+08:00'),
    'Thu, 01 Jan 2026 00:00:00 GMT',
  );
});

test('normalizeIfUnmodifiedSince rejects anything else with exit code 4', () => {
  try {
    normalizeIfUnmodifiedSince('next tuesday');
    assert.fail('expected CliError');
  } catch (err) {
    assert.ok(err instanceof CliError);
    assert.equal(err.code, 'VALIDATION');
  }
});
