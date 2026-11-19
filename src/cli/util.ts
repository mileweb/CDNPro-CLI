import * as fs from 'fs';
import { CliError } from './errors';
import { OptionMapping, flagForBodyPath } from './option-map';
import { validateBody, ValidationResult } from '../schema/validate';
import { toHttpDate } from '../schema/date-time';

/**
 * Read a JSON body from a file path or stdin ("-").
 * Throws CliError if the path is unreadable or the content is not valid JSON.
 */
export function readBodyFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = filePath === '-'
      ? fs.readFileSync(process.stdin.fd, 'utf8')
      : fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new CliError('ERROR', `Cannot read "${filePath}": ${(e as Error).message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new CliError('VALIDATION', `"${filePath}" is not valid JSON: ${(e as Error).message}`);
  }
}

/**
 * Formats and emits a validation failure, then throws a CliError (exit code 4).
 *
 * In table/TTY mode: human-readable error lines on stderr.
 * In JSON mode: machine-readable envelope on stdout with the full schema
 *   so an AI agent can self-correct without a second round-trip.
 *
 * @param result   - The ValidationResult from validateBody()
 * @param hint     - The full `cdnpro <resource> <operation> --example` command string for the hint message
 * @param output   - The --output flag value (undefined = auto-detect from isTTY)
 * @param mappings - Optional option mappings; used to annotate errors with the CLI flag that
 *                   populates the failing body path (e.g. --hostname)
 */
export function emitValidationError(
  result: ValidationResult,
  hint: string,
  output?: string,
  mappings?: OptionMapping[],
): never {
  const errors = result.errors;
  const isHuman = output == null ? process.stdout.isTTY : output === 'table';

  if (isHuman) {
    process.stderr.write('Error: Invalid request body\n');
    for (const e of errors) {
      const flag = flagForBodyPath(e.instancePath || '', mappings);
      process.stderr.write(
        `  - ${e.instancePath || 'body'}: ${e.message}${flag ? ` (flag ${flag})` : ''}\n`,
      );
    }
    process.stderr.write(`\nTip: run \`${hint}\` for a valid template\n`);
  } else {
    const count = errors.length;
    const envelope = {
      error: {
        code: 'VALIDATION',
        message: `Request body failed schema validation (${count} error${count !== 1 ? 's' : ''})`,
        validationErrors: errors.map(e => {
          const cliFlag = flagForBodyPath(e.instancePath || '', mappings);
          return {
            path: e.instancePath || '',
            message: e.message ?? '',
            keyword: e.keyword,
            params: e.params,
            ...(cliFlag ? { cliFlag } : {}),
          };
        }),
        schema: result.schema,
        hint: `Run \`${hint}\` to see a valid body template`,
      },
    };
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  }

  throw new CliError('VALIDATION', 'Invalid request body', undefined, true);
}

/**
 * Validate a request body that the CLI is about to send. Skips validation when
 * there is no body (e.g. a report request with no filters).
 *
 * This is the single path used by both `--file` bodies and bodies assembled
 * from individual flags.
 */
export function validateRequestOrThrow(
  openapiPath: string,
  method: string,
  body: unknown,
  hint: string,
  output?: string,
  mappings?: OptionMapping[],
): void {
  if (body === undefined || body === null) return;
  const result = validateBody(openapiPath, method, body);
  if (!result.valid) emitValidationError(result, hint, output, mappings);
}

/**
 * Validates that a required option is present.  Use this instead of
 * Commander's `.requiredOption()` whenever the command also supports
 * `--example`, because `.requiredOption()` rejects the command before
 * the action handler gets a chance to handle `--example`.
 */
export function checkRequiredOption(
  value: string | undefined,
  flagName: string,
): asserts value is string {
  if (!value) {
    throw new CliError('VALIDATION', `Required option ${flagName} not specified`);
  }
}

/**
 * Parse an integer-valued flag. Rejects non-integer input with exit code 4.
 */
export function parseIntegerOption(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new CliError('VALIDATION', `${flagName} must be an integer, got: ${value}`);
  }
  return parsed;
}

/**
 * Normalize --if-unmodified-since for the HTTP header. Accepts an HTTP-date
 * (as returned by the API's Last-Modified) or an RFC 3339 date-time, which is
 * converted to the equivalent UTC HTTP-date. Exits 4 on anything else.
 */
export function normalizeIfUnmodifiedSince(value: string): string {
  const normalized = toHttpDate(value);
  if (!normalized) {
    throw new CliError(
      'VALIDATION',
      '--if-unmodified-since must be an HTTP-date ' +
        '(e.g. "Thu, 01 Jan 2026 00:00:00 GMT") or an RFC 3339 date-time ' +
        '(e.g. "2026-01-01T00:00:00Z")',
      { cliFlag: '--if-unmodified-since' },
    );
  }
  return normalized;
}

/**
 * Given a raw API response, extract the resource ID from the Location header
 * and enrich the response body with it.  Many CDN Pro POST endpoints return
 * the new resource's URL in the Location header rather than in the body.
 */
export function enrichWithLocationId(
  raw: { obj: unknown; ctx: { _res: { headers: Record<string, string | string[] | undefined> } } },
): Record<string, unknown> {
  const data = (raw.obj ?? {}) as Record<string, unknown>;
  if (data['id'] !== undefined && data['id'] !== null) return data;
  const location = raw.ctx._res.headers['location'] as string | undefined;
  if (!location) return data;
  const id = location.split('/').pop();
  if (id) {
    return { ...data, id };
  }
  return data;
}
