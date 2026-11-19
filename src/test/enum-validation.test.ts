import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildRequestFromMapping, registerMappings, OptionMapping } from '../cli/option-map';
import { CliError } from '../cli/errors';

/** Run fn with stdout captured, returning both its output and any thrown error. */
function runCapturing(fn: () => void): { out: string; error?: unknown } {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = ((chunk: unknown) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  let error: unknown;
  try {
    fn();
  } catch (err) {
    error = err;
  } finally {
    process.stdout.write = original;
  }
  return { out, error };
}

const validationStatus: OptionMapping[] = [
  { flag: '--status <status>', target: 'query', param: 'status', description: '' },
];
registerMappings('validation', 'list', validationStatus);

test('rejects an enumerated query value not declared by the spec', () => {
  const { out, error } = runCapturing(() =>
    buildRequestFromMapping({ status: 'in-progress' }, validationStatus, { output: 'json' }));

  assert.ok(error instanceof CliError, 'expected CliError');
  assert.equal(error.code, 'VALIDATION');
  assert.equal(error.silent, true);

  const envelope = JSON.parse(out);
  assert.equal(envelope.error.code, 'VALIDATION');
  assert.equal(envelope.error.message, 'Invalid value for --status');
  assert.deepEqual(envelope.error.validationErrors[0].params.allowedValues, [
    'waiting', 'in progress', 'failed', 'succeeded',
  ]);
  assert.equal(envelope.error.validationErrors[0].path, 'query.status');
  assert.equal(envelope.error.validationErrors[0].cliFlag, '--status');
});

test('accepts a declared enum value', () => {
  const { query } = buildRequestFromMapping(
    { status: 'in progress' },
    validationStatus,
    { output: 'json' },
  );
  assert.equal(query.status, 'in progress');
});

test('enum matching is case-sensitive', () => {
  const autoRenew: OptionMapping[] = [
    { flag: '--auto-renew <mode>', target: 'query', param: 'autoRenew', description: '' },
  ];
  registerMappings('cert', 'list', autoRenew);

  const rejected = runCapturing(() =>
    buildRequestFromMapping({ autoRenew: 'le' }, autoRenew, { output: 'json' }));
  assert.ok(rejected.error instanceof CliError);

  const { query } = buildRequestFromMapping({ autoRenew: 'LE' }, autoRenew, { output: 'json' });
  assert.equal(query.autoRenew, 'LE');
});

test('parameters not declared by the spec are forwarded unchanged', () => {
  const unknown: OptionMapping[] = [
    { flag: '--foo <value>', target: 'query', param: 'notARealParam', description: '' },
  ];
  registerMappings('property', 'list', unknown);

  const { query } = buildRequestFromMapping({ foo: 'anything' }, unknown, { output: 'json' });
  assert.equal(query.notARealParam, 'anything');
});
