import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateOutputOption } from '../cli/util';
import { CliError, outputsHumanErrors } from '../cli/errors';

test('accepts the supported output formats and the default', () => {
  assert.doesNotThrow(() => validateOutputOption(undefined));
  assert.doesNotThrow(() => validateOutputOption('table'));
  assert.doesNotThrow(() => validateOutputOption('json'));
  assert.doesNotThrow(() => validateOutputOption('jsonl'));
});

test('rejects an unsupported output format with VALIDATION', () => {
  try {
    validateOutputOption('xml');
    assert.fail('expected CliError');
  } catch (err) {
    assert.ok(err instanceof CliError);
    assert.equal(err.code, 'VALIDATION');
    assert.deepEqual(err.details, {
      cliFlag: '--output',
      allowedValues: ['table', 'json', 'jsonl'],
    });
  }
});

test('output format is case-sensitive', () => {
  assert.throws(() => validateOutputOption('JSON'), (err: unknown) =>
    err instanceof CliError && err.code === 'VALIDATION');
});

test('explicit output formats decide human vs JSON errors', () => {
  assert.equal(outputsHumanErrors('table'), true);
  assert.equal(outputsHumanErrors('json'), false);
  assert.equal(outputsHumanErrors('jsonl'), false);
  assert.equal(outputsHumanErrors(undefined), !!process.stdout.isTTY);
});