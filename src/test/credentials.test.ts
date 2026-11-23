import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { CliError } from '../cli/errors';

// config.ts opens the user's real config store at import time. Point every
// platform's config location at a throwaway directory first.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cdnpro-test-'));
process.env['APPDATA'] = sandbox;
process.env['XDG_CONFIG_HOME'] = sandbox;
process.env['HOME'] = sandbox;
process.env['USERPROFILE'] = sandbox;
for (const k of ['CDNPRO_HOST', 'CDNPRO_USER', 'CDNPRO_SECRETKEY', 'CDNPRO_PROFILE']) delete process.env[k];

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveCredentials } = require('../cli/config') as typeof import('../cli/config');

test('all three flags are used directly', async () => {
  assert.deepEqual(
    await resolveCredentials({ host: 'h.example', user: 'u', secretKey: 's' }),
    { host: 'h.example', user: 'u', secretKey: 's' },
  );
});

test('a partial flag set is rejected instead of silently using a saved profile', async () => {
  for (const partial of [{ host: 'h' }, { user: 'u' }, { secretKey: 's' }, { host: 'h', user: 'u' }]) {
    await assert.rejects(
      resolveCredentials(partial),
      (e: unknown) => e instanceof CliError && e.code === 'CONFIG_ERROR' && /must be supplied together/.test(e.message),
      JSON.stringify(partial),
    );
  }
});

test('complete environment credentials are used when no --profile is given', async () => {
  process.env['CDNPRO_HOST'] = 'env.example';
  process.env['CDNPRO_USER'] = 'envuser';
  process.env['CDNPRO_SECRETKEY'] = 'envsecret';
  try {
    assert.deepEqual(
      await resolveCredentials({}),
      { host: 'env.example', user: 'envuser', secretKey: 'envsecret' },
    );
  } finally {
    for (const k of ['CDNPRO_HOST', 'CDNPRO_USER', 'CDNPRO_SECRETKEY']) delete process.env[k];
  }
});

test('an explicit --profile wins over environment credentials', async () => {
  process.env['CDNPRO_HOST'] = 'env.example';
  process.env['CDNPRO_USER'] = 'envuser';
  process.env['CDNPRO_SECRETKEY'] = 'envsecret';
  try {
    // The profile does not exist in the sandboxed store, so resolution must
    // fail on it rather than quietly falling back to the environment.
    await assert.rejects(
      resolveCredentials({ profile: 'staging' }),
      (e: unknown) => e instanceof CliError && e.code === 'CONFIG_ERROR' && /No credentials found/.test(e.message),
    );
  } finally {
    for (const k of ['CDNPRO_HOST', 'CDNPRO_USER', 'CDNPRO_SECRETKEY']) delete process.env[k];
  }
});
