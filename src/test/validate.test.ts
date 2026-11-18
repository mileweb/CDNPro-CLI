import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateBody } from '../schema/validate';

test('coerces numeric flag values for integer fields', () => {
  const body: { propertyId: string; version: string | number } = {
    propertyId: 'p',
    version: '3',
  };

  const result = validateBody('/cdn/validations', 'post', body);

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  // coerceTypes mutates the body so the request carries a JSON number.
  assert.equal(body.version, 3);
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
      urls: { urls: ['https://example.com/a.js'] },
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
