import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getCertExample } from '../cli/commands/cert/example';

interface CertExample {
  caOnly?: boolean;
  newVersion: {
    certificate?: string;
    privateKey?: string;
    chainCert?: string;
    identificationInfo?: { commonName?: string };
  };
}

function asExample(value: unknown): CertExample {
  return value as CertExample;
}

test('ca-only example is mode-specific', () => {
  const ex = asExample(
    getCertExample('/cdn/certificates', 'post', { kind: 'ca-only' }),
  );

  assert.equal(ex.caOnly, true);
  assert.match(ex.newVersion.chainCert ?? '', /BEGIN CERTIFICATE/);
});

test('PATCH ca-only example does not carry caOnly', () => {
  const ex = asExample(
    getCertExample('/cdn/certificates/{certificateID}', 'patch', { kind: 'ca-only' }),
  );
  assert.equal(ex.caOnly, undefined);
  assert.match(ex.newVersion.chainCert ?? '', /BEGIN CERTIFICATE/);
});

test('self-signed ECC256 example comes from the spec', () => {
  const ex = asExample(
    getCertExample('/cdn/certificates', 'post', { kind: 'self-signed', alg: 'ECC256' }),
  );

  assert.equal(ex.newVersion.privateKey, 'ECC256');
  assert.equal(typeof ex.newVersion.identificationInfo?.commonName, 'string');
});

test('PATCH examples are constructed because the spec has no named PATCH examples', () => {
  const ex = asExample(
    getCertExample('/cdn/certificates/{certificateID}', 'patch', { kind: 'upload' }),
  );

  assert.match(ex.newVersion.certificate ?? '', /BEGIN CERTIFICATE/);
  assert.equal(typeof ex.newVersion.privateKey, 'string');
});
