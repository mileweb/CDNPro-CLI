import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  containsSensitiveData,
  formatForLog,
  redactHeaders,
  redactSensitive,
} from '../client/redact';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEsecretsecret\n-----END RSA PRIVATE KEY-----';

test('redactHeaders redacts Authorization case-insensitively', () => {
  const out = redactHeaders({
    authorization: 'Basic dXNlcjpoYXNo',
    Date: 'Wed, 01 Jan 2026 00:00:00 GMT',
  });
  assert.equal(out.authorization, 'Basic <redacted>');
  assert.equal(out.Date, 'Wed, 01 Jan 2026 00:00:00 GMT');
});

test('redactSensitive redacts nested certificate and webhook fields', () => {
  const out = redactSensitive({
    name: 'cert',
    newVersion: { privateKey: PEM, certificate: 'PUBLIC CERT' },
    credentials: { user: 'u', secretKey: 's3cr3t' },
  }) as Record<string, any>;
  assert.equal(out.newVersion.privateKey, '<redacted>');
  assert.equal(out.newVersion.certificate, 'PUBLIC CERT');
  assert.equal(out.credentials.secretKey, '<redacted>');
  assert.equal(out.credentials.user, 'u');
});

test('redactSensitive handles lowercase apikey returned by the API', () => {
  const out = redactSensitive({ apikey: 'plaintext' }) as Record<string, unknown>;
  assert.equal(out.apikey, '<redacted>');
});

test('redactSensitive redacts PEM blocks under unknown keys', () => {
  const out = redactSensitive({ blob: PEM }) as Record<string, unknown>;
  assert.equal(out.blob, '<redacted PEM>');
});

test('redactSensitive redacts every PEM block in a string', () => {
  const ec = PEM.replace('RSA ', 'EC ');
  const out = redactSensitive({ blob: `${PEM}\nnote\n${ec}` }) as Record<string, unknown>;
  assert.equal(out.blob, '<redacted PEM>\nnote\n<redacted PEM>');
});

test('redactSensitive leaves unterminated PEM blocks untouched', () => {
  const out = redactSensitive({ blob: PEM.slice(0, PEM.indexOf('-----END')) });
  assert.deepEqual(out, { blob: PEM.slice(0, PEM.indexOf('-----END')) });
});

test('redactSensitive leaves non-private PEM blocks untouched', () => {
  const cert = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
  const out = redactSensitive({ blob: cert }) as Record<string, unknown>;
  assert.equal(out.blob, cert);
});

test(
  'redactSensitive stays linear on repeated unterminated PEM headers',
  { timeout: 2000 },
  () => {
    const blob = '-----BEGIN PRIVATE KEY-----'.repeat(50_000);
    const out = redactSensitive({ blob }) as Record<string, unknown>;
    assert.equal(out.blob, blob);
  },
);

test('redactSensitive redacts auth tokens embedded in text', () => {
  const out = redactSensitive({ note: 'sent Basic dXNlcjpoYXNo to server' }) as Record<string, unknown>;
  assert.equal(out.note, 'sent Basic <redacted> to server');
});

test('containsSensitiveData detects nested sensitive keys', () => {
  assert.equal(containsSensitiveData({ name: 'x' }), false);
  assert.equal(containsSensitiveData({ newVersion: { privateKey: 'x' } }), true);
  assert.equal(containsSensitiveData({ email: 'a@b.c' }), true);
});

test('formatForLog parses JSON strings and redacts before printing', () => {
  const text = formatForLog(JSON.stringify({ name: 'n', secret: 'hunter2' }));
  assert.ok(text.includes('"name": "n"'));
  assert.ok(text.includes('<redacted>'));
  assert.ok(!text.includes('hunter2'));
});

test('formatForLog truncates large payloads', () => {
  const text = formatForLog({ data: 'x'.repeat(5000) }, 128);
  assert.ok(text.length < 5000);
  assert.ok(text.includes('bytes total'));
});
