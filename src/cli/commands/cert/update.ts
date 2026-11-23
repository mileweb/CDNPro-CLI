import * as fs from 'fs';
import * as crypto from 'crypto';
import { Command } from 'commander';
import { resolveCredentials, GlobalOptions } from '../../config';
import { CDNProClient } from '../../../client/CDNProClient';
import { handleError } from '../../errors';
import { CliError } from '../../errors';
import { printWriteResult } from '../../output';
import { readBodyFile, checkRequiredOption, validateRequestOrThrow } from '../../util';
import { getCertExample } from './example';
import {
  OptionMapping,
  FILE_EXAMPLE,
  registerOptionsFromMapping,
  registerMappings,
} from '../../option-map';

export const CERT_UPDATE_OPTIONS: OptionMapping[] = [
  { flag: '--name <name>',       target: 'body', param: 'name',                        description: 'Friendly name for the certificate record' },
  // Upload mode
  { flag: '--cert <file>',       target: 'body', param: 'newVersion.certificate',       description: 'PEM certificate file (upload mode)' },
  { flag: '--key <file>',        target: 'body', param: 'newVersion.privateKey',        description: 'PEM private key file (upload mode)' },
  { flag: '--ca <file>',         target: 'body', param: 'newVersion.chainCert',         description: 'PEM CA chain file (upload or CA-only mode)' },
  // Self-signed mode
  { flag: '--self-signed <alg>', target: 'cli-only', param: null,                     description: 'Algorithm: RSA2048 | ECC256 (server generates cert+key)' },
  { flag: '--common-name <cn>',  target: 'body', param: 'newVersion.identificationInfo.commonName',          description: 'CN for the certificate (required with --self-signed)' },
  { flag: '--san <hostname>',    target: 'body', param: 'newVersion.identificationInfo.subjectAlternativeNames', description: 'Subject Alternative Name; repeatable', repeatable: true },
  { flag: '--country <CC>',      target: 'body', param: 'newVersion.identificationInfo.country',             description: '2-letter ISO-3166 country code' },
  { flag: '--state <state>',     target: 'body', param: 'newVersion.identificationInfo.state',               description: 'State or province' },
  { flag: '--city <city>',       target: 'body', param: 'newVersion.identificationInfo.city',                description: 'Locality' },
  { flag: '--company <org>',     target: 'body', param: 'newVersion.identificationInfo.company',        description: 'Organization' },
  { flag: '--department <ou>',   target: 'body', param: 'newVersion.identificationInfo.department',           description: 'Organizational unit' },
  { flag: '--email <email>',     target: 'body', param: 'newVersion.identificationInfo.email',                description: 'Email address' },
  { flag: '--comments <text>',   target: 'body', param: 'newVersion.comments',               description: 'Version comments' },
  // CA-only mode
  { flag: '--ca-only',           target: 'body', param: 'caOnly',                            description: 'Update CA chain certificate only', boolean: true },
  // Full-body fallback
  ...FILE_EXAMPLE,
];

function readPemFile(filePath: string, label: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new CliError('ERROR', `Cannot read ${label} file "${filePath}": ${(e as Error).message}`);
  }
}

function encryptPrivateKey(pemContent: string, secretKey: string, dateStr: string): string {
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(dateStr);
  const hexDigest = hmac.digest('hex');

  const ivHex = hexDigest.substring(0, 32);
  const keyHex = hexDigest.substring(32, 64);

  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivHex, 'hex'),
  );
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(pemContent, 'utf8')),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}

interface UpdateOpts {
  name?: string;
  cert?: string;
  key?: string;
  ca?: string;
  selfSigned?: string;
  commonName?: string;
  san?: string[];
  country?: string;
  state?: string;
  city?: string;
  company?: string;
  department?: string;
  email?: string;
  comments?: string;
  caOnly?: boolean;
  file?: string;
  example?: boolean;
}

function emitUpdateSuccess(id: string, globals: GlobalOptions): void {
  printWriteResult({ certificateId: id }, globals.output, `Certificate version added for ${id}.`);
}

export function registerCertUpdateCommand(parent: Command): void {
  const cmd = parent
    .command('update [id]')
    .description('Add a new certificate version (PATCH)');

  registerOptionsFromMapping(cmd, CERT_UPDATE_OPTIONS);
  registerMappings('cert', 'update', CERT_UPDATE_OPTIONS);

  cmd.action(async (id: string | undefined, opts: UpdateOpts, cmdObj: Command) => {
    try {
      const isUpload = !!(opts.cert || opts.key);
      const isSelfSigned = !!opts.selfSigned;
      const isCaOnly = !!opts.caOnly;
      const isFile = !!opts.file;

      if (opts.example) {
        const mode = isSelfSigned
          ? { kind: 'self-signed' as const, alg: opts.selfSigned! }
          : isCaOnly
            ? { kind: 'ca-only' as const }
            : { kind: 'upload' as const };
        const example = getCertExample(
          '/cdn/certificates/{certificateID}',
          'patch',
          mode,
        );
        process.stdout.write(JSON.stringify(example, null, 2) + '\n');
        return;
      }

      checkRequiredOption(id, 'id');
      const certId = id;

      const modeCount = [isUpload, isSelfSigned, isCaOnly, isFile].filter(Boolean).length;
      if (modeCount === 0) {
        throw new CliError(
          'VALIDATION',
          'One of --cert/--key (upload), --self-signed (generated), --ca-only (CA chain), or --file (full body) is required',
        );
      }
      if (modeCount > 1) {
        throw new CliError(
          'VALIDATION',
          '--cert/--key, --self-signed, --ca-only, and --file are mutually exclusive',
        );
      }

      const globals = cmdObj.optsWithGlobals<GlobalOptions>();

      let body: Record<string, unknown>;
      let uploadKeyPem: string | undefined;

      if (isFile) {
        checkRequiredOption(opts.file, '--file <path>');
        body = readBodyFile(opts.file) as Record<string, unknown>;
      } else if (isUpload) {
        if (!opts.cert) throw new CliError('VALIDATION', '--cert <file> is required in upload mode');
        if (!opts.key) throw new CliError('VALIDATION', '--key <file> is required in upload mode');

        const certPem = readPemFile(opts.cert, 'certificate');
        uploadKeyPem = readPemFile(opts.key, 'private key');

        const newVersion: Record<string, unknown> = {
          certificate: certPem,
          // Placeholder: validation only needs a string. The real key is
          // encrypted after credentials are resolved.
          privateKey: uploadKeyPem,
        };
        if (opts.ca) newVersion['chainCert'] = readPemFile(opts.ca, 'CA chain');
        if (opts.comments) newVersion['comments'] = opts.comments;

        body = {
          ...(opts.name ? { name: opts.name } : {}),
          newVersion,
        };
      } else if (isSelfSigned) {
        const alg = opts.selfSigned!.toUpperCase();
        if (alg !== 'RSA2048' && alg !== 'ECC256') {
          throw new CliError('VALIDATION', '--self-signed must be RSA2048 or ECC256');
        }
        if (!opts.commonName) throw new CliError('VALIDATION', '--common-name is required with --self-signed');

        const identificationInfo: Record<string, unknown> = {
          commonName: opts.commonName,
          subjectAlternativeNames: opts.san ?? [],
        };
        if (opts.country) identificationInfo['country'] = opts.country;
        if (opts.state) identificationInfo['state'] = opts.state;
        if (opts.city) identificationInfo['city'] = opts.city;
        if (opts.company) identificationInfo['company'] = opts.company;
        if (opts.department) identificationInfo['department'] = opts.department;
        if (opts.email) identificationInfo['email'] = opts.email;

        const newVersion: Record<string, unknown> = {
          privateKey: alg,
          certificate: 'Generate',
          identificationInfo,
        };
        if (opts.comments) newVersion['comments'] = opts.comments;

        body = {
          ...(opts.name ? { name: opts.name } : {}),
          newVersion,
        };
      } else {
        // CA-only mode
        if (!opts.ca) throw new CliError('VALIDATION', '--ca <file> is required with --ca-only');
        const caPem = readPemFile(opts.ca, 'CA chain');
        body = {
          caOnly: true,
          ...(opts.name ? { name: opts.name } : {}),
          newVersion: { chainCert: caPem },
        };
      }

      validateRequestOrThrow(
        '/cdn/certificates/{certificateID}',
        'patch',
        body,
        'cdnpro cert update --example',
        globals.output,
        CERT_UPDATE_OPTIONS,
      );

      const serverInfo = await resolveCredentials(globals);
      const client = new CDNProClient(serverInfo);

      if (isUpload) {
        const dateStr = new Date().toUTCString();
        const newVersion = body['newVersion'] as Record<string, unknown>;
        newVersion['privateKey'] = encryptPrivateKey(
          uploadKeyPem as string,
          serverInfo.secretKey,
          dateStr,
        );

        const reqOptions = {
          ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
          ...(globals.verbose ? { verbose: globals.verbose } : {}),
          dateOverride: dateStr,
        };

        await client.certificates.update(certId, body, { ...reqOptions, raw: true, dateOverride: dateStr });
        emitUpdateSuccess(certId, globals);
        return;
      }

      const reqOptions = {
        ...(globals.onBehalfOf ? { onBehalfOf: globals.onBehalfOf } : {}),
        ...(globals.verbose ? { verbose: globals.verbose } : {}),
      };

      await client.certificates.update(certId, body, { ...reqOptions, raw: true });
      emitUpdateSuccess(certId, globals);
    } catch (err) {
      handleError(err);
    }
  });
}
