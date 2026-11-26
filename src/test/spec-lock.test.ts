import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Guards the pinned baseline: openapi.lock.json is the spec the CLI code is
 * based on, so the local openapi.json must match it byte-for-byte. This fails
 * loudly after an unpinned OPENAPI_SPEC_URL experiment or a hand-copied file.
 */

const root = path.join(__dirname, '..', '..');
const lockPath = path.join(root, 'openapi.lock.json');
const specPath = path.join(root, 'openapi.json');

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const specBuffer = fs.readFileSync(specPath);
const spec = JSON.parse(specBuffer.toString('utf8'));
const specSha256 = createHash('sha256').update(specBuffer).digest('hex');

const VERBS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

function operationCount(paths: Record<string, Record<string, unknown>>): number {
  let count = 0;
  for (const item of Object.values(paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const verb of VERBS) {
      if (item[verb]) count++;
    }
  }
  return count;
}

test('openapi.lock.json has the expected shape', () => {
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.source.repo, 'mileweb/docs-content-cdn');
  assert.equal(lock.source.path, 'en/apispec/openapi.json');
  assert.match(lock.source.commit, /^[0-9a-f]{40}$/);
  assert.match(lock.spec.sha256, /^[0-9a-f]{64}$/);
  assert.ok(
    lock.source.ref === null || (typeof lock.source.ref === 'string' && lock.source.ref.length > 0),
    'source.ref must be a non-empty string or null',
  );
  assert.ok(Number.isInteger(lock.spec.bytes) && lock.spec.bytes > 0);
});

test('openapi.json matches the lock byte-for-byte', () => {
  assert.equal(
    specSha256,
    lock.spec.sha256,
    'openapi.json does not match the lock. Run "npm run fetch:spec -- --force" or restore the intended lock.',
  );
  assert.equal(specBuffer.length, lock.spec.bytes);
});

test('the locked spec shape matches the lock metadata', () => {
  assert.equal(spec.openapi, lock.spec.openapi);
  const paths = spec.paths as Record<string, Record<string, unknown>>;
  assert.equal(Object.keys(paths).length, lock.spec.paths);
  assert.equal(operationCount(paths), lock.spec.operations);
});