import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateBody } from '../schema/validate';

test('does not coerce types or mutate the body being validated', () => {
  // Commands that build bodies from flags convert numbers themselves
  // (parseIntegerOption); a --file body with a string where an integer is
  // required must be reported, not silently rewritten.
  const body: { propertyId: string; version: string | number } = {
    propertyId: 'p',
    version: '3',
  };

  const result = validateBody('/cdn/validations', 'post', body);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.instancePath === '/version' && e.keyword === 'type'));
  assert.equal(body.version, '3');

  assert.equal(validateBody('/cdn/validations', 'post', { propertyId: 'p', version: 3 }).valid, true);
});

test('compiling schemas with email/hostname formats prints no Ajv warnings', () => {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    validateBody('/cdn/properties', 'post', { name: 'p' });
    validateBody('/ngadmin/contacts', 'post', { emailAddress: 'a@example.com' });
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, []);
});

test('certificate create bodies require name and newVersion', () => {
  const valid = {
    name: 'example-cert',
    newVersion: { certificate: 'PEM', privateKey: 'KEY' },
  };
  assert.equal(validateBody('/cdn/certificates', 'post', valid).valid, true);

  const missingName = {
    newVersion: { certificate: 'PEM', privateKey: 'KEY' },
  };
  assert.equal(validateBody('/cdn/certificates', 'post', missingName).valid, false);
});

test('representative flag-built bodies validate against their schemas', () => {
  const cases: Array<[string, string, unknown]> = [
    ['/cdn/deploymentTasks', 'post', {
      target: 'production',
      actions: [{ action: 'deploy_property', propertyId: 'p', version: '1' }],
      webhook: 'webhook-id',
    }],
    ['/cdn/purges', 'post', {
      target: 'production',
      fileUrls: ['https://example.com/a.js'],
      action: 'invalidate',
      webhook: 'webhook-id',
    }],
    ['/cdn/prefetches', 'post', {
      fileList: [{ url: 'https://example.com/a.js' }],
      webhook: 'webhook-id',
    }],
    ['/cdn/validations', 'post', { propertyId: 'p', version: 3, webhook: 'webhook-id' }],
    ['/cdn/report/bandwidth', 'post', { filters: { hostnames: ['example.com'] } }],
    ['/cdn/annotationsList', 'post', {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      type: 'client',
      search: 'x',
      limit: 10,
      offset: 0,
    }],
    ['/cdn/properties/{propertyID}', 'patch', { description: 'updated' }],
  ];

  for (const [path, method, body] of cases) {
    const result = validateBody(path, method, body);
    assert.equal(
      result.valid,
      true,
      `${method.toUpperCase()} ${path}: ${JSON.stringify(result.errors)}`,
    );
  }
});
