import { getNamedSpecExample } from '../../../schema/loader';

export type CertExampleMode =
  | { kind: 'upload' }
  | { kind: 'self-signed'; alg: string }
  | { kind: 'ca-only' };

const PEM_CERT = '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----';
const PEM_CHAIN = '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----';

/**
 * Mode-specific placeholder bodies for modes or operations that have no
 * named example in the OpenAPI spec (CA-only, and every PATCH request).
 * They are illustrative only — the CLI never validates `--example` output.
 */
function constructedExample(mode: CertExampleMode): unknown {
  switch (mode.kind) {
    case 'self-signed':
      return {
        name: '<certificate-name>',
        newVersion: {
          privateKey: mode.alg.toUpperCase(),
          certificate: 'Generate',
          identificationInfo: {
            commonName: 'domain.com',
            subjectAlternativeNames: ['domain.com'],
          },
        },
      };
    case 'ca-only':
      return {
        name: '<ca-certificate-name>',
        caOnly: true,
        newVersion: { chainCert: PEM_CHAIN },
      };
    case 'upload':
      return {
        name: '<certificate-name>',
        newVersion: {
          certificate: PEM_CERT,
          privateKey: '<private-key-encrypted-client-side>',
          chainCert: PEM_CHAIN,
        },
      };
  }
}

/**
 * Returns an example body for `cert create` / `cert update` in the selected
 * mode. POST requests use the spec's named examples when available; PATCH
 * requests and CA-only mode use constructed placeholders.
 */
export function getCertExample(
  path: string,
  method: string,
  mode: CertExampleMode,
): unknown {
  if (method.toLowerCase() === 'post' && mode.kind !== 'ca-only') {
    const exampleName =
      mode.kind === 'self-signed'
        ? mode.alg.toUpperCase() === 'ECC256'
          ? 'Example of generating a self-signed ECC256 certificate'
          : 'Example of generating a self-signed RSA2048 certificate'
        : 'Example of uploading a certificate';
    const specExample = getNamedSpecExample(path, method, exampleName);
    if (specExample !== null) return specExample;
  }

  return constructedExample(mode);
}
