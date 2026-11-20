import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { printCreateSuccess, printWriteResult, writeResultData } from '../cli/output';

function captureStdout(fn: () => void): string {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = ((chunk: unknown) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return out;
}

test('writeResultData wraps fields in the data/success envelope', () => {
  assert.equal(writeResultData(), '{"data":{"success":true}}');
  assert.equal(
    writeResultData({ propertyId: 'abc' }),
    '{"data":{"success":true,"propertyId":"abc"}}',
  );
});

test('printWriteResult emits the envelope when not a TTY', () => {
  const out = captureStdout(() =>
    printWriteResult({ propertyId: 'abc' }, 'json', 'ignored'));
  assert.equal(out, '{"data":{"success":true,"propertyId":"abc"}}\n');
});

test('printCreateSuccess emits the envelope when not a TTY', () => {
  const out = captureStdout(() =>
    printCreateSuccess('Property', 'propertyId', 'abc', 'json'));
  assert.equal(out, '{"data":{"success":true,"propertyId":"abc"}}\n');
});