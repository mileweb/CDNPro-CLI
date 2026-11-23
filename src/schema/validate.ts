import Ajv, { ErrorObject } from 'ajv';
import { getRequestBodySchema } from './loader';
import { isRfc3339DateTime } from './date-time';

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
  schema: unknown; // the resolved schema — included in JSON error envelopes (5.5)
}

let _ajv: Ajv | null = null;

function getAjv(): Ajv {
  if (!_ajv) {
    // No type coercion: Ajv would silently rewrite the caller's body in place
    // (e.g. {"version":"3"} -> {"version":3}), hiding type errors in --file
    // bodies and changing what is sent. Commands that build bodies from flags
    // convert numeric values themselves (see parseIntegerOption).
    _ajv = new Ajv({ allErrors: true, strict: false });
    _ajv.addFormat('date-time', { type: 'string', validate: isRfc3339DateTime });
    // The spec declares these formats; register them so Ajv does not print an
    // "unknown format ignored" warning each time a schema is compiled. Both are
    // deliberately lenient: origin host headers may carry a port, and the server
    // is the authority on address syntax.
    _ajv.addFormat('email', { type: 'string', validate: (v: string) => /^[^\s@]+@[^\s@]+$/.test(v) });
    _ajv.addFormat('hostname', { type: 'string', validate: (v: string) => v.length > 0 && !/\s/.test(v) });
  }
  return _ajv;
}

/**
 * Validates a request body against the JSON Schema for the given OpenAPI path + method.
 * Returns valid=true and empty errors when no schema is found for the operation.
 */
export function validateBody(
  openapiPath: string,
  method: string,
  body: unknown,
): ValidationResult {
  const { schema } = getRequestBodySchema(openapiPath, method);
  if (!schema) return { valid: true, errors: [], schema: null };

  const ajv = getAjv();
  const valid = ajv.validate(schema as object, body) as boolean;
  const errors = ajv.errors ? [...ajv.errors] : [];
  return { valid, errors, schema };
}
