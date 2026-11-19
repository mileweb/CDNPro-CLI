import { Command } from 'commander';
import { CliError } from './errors';
import { lookupOperation } from '../schema/query';
import { getParameterEnum } from '../schema/loader';

// ── Types ──────────────────────────────────────────────────────────

export interface OptionMapping {
  /** Commander flag string, e.g. '--limit <n>' or '--all' */
  flag: string;
  /** Where the value ends up in the API request */
  target: 'query' | 'header' | 'body' | 'cli-only';
  /** For query/header/body: the API parameter name or body path.
   *  null for cli-only. Body paths use dot notation: 'filters.hostnames'. */
  param: string | null;
  /** Description shown in --help */
  description: string;
  /** Mark the option as required (checked in action handler) */
  required?: boolean;
  /** True for repeatable array options */
  repeatable?: boolean;
  /** True for boolean flags (no value argument) */
  boolean?: boolean;
}

// ── Shared presets ─────────────────────────────────────────────────

export const PAGINATION_OPTIONS: OptionMapping[] = [
  { flag: '--limit <n>',  target: 'query', param: 'limit',  description: 'Page size' },
  { flag: '--offset <n>', target: 'query', param: 'offset', description: 'Page offset' },
];

export const SORT_OPTIONS: OptionMapping[] = [
  { flag: '--sort-by <field>',   target: 'query', param: 'sortBy',   description: 'Sort field' },
  { flag: '--sort-order <order>', target: 'query', param: 'sortOrder', description: 'Sort direction: asc | desc' },
];

export const REPORT_RANGE: OptionMapping = {
  flag: '--report-range <scope>',
  target: 'header',
  param: 'Report-Range',
  description: 'Report-Range: self-only | self+children | children-only',
};

export const FILE_EXAMPLE: OptionMapping[] = [
  { flag: '--file <path>', target: 'cli-only', param: null, description: 'JSON body file (- for stdin)' },
  { flag: '--example',     target: 'cli-only', param: null, description: 'Print example body and exit' },
];

export const IF_UNMODIFIED_SINCE: OptionMapping = {
  flag: '--if-unmodified-since <date>',
  target: 'header',
  param: 'If-Unmodified-Since',
  description: 'Fail if resource has been modified since this RFC 1123 date',
};

export const CONFIRM: OptionMapping = {
  flag: '--confirm',
  target: 'cli-only',
  param: null,
  description: 'Skip confirmation prompt',
  boolean: true,
};

export const ALL: OptionMapping = {
  flag: '--all',
  target: 'cli-only',
  param: null,
  description: 'Auto-paginate; implies --output jsonl',
  boolean: true,
};

export const MAX_PAGES: OptionMapping = {
  flag: '--max-pages <n>',
  target: 'cli-only',
  param: null,
  description: 'Maximum pages for --all [default: 10, max: 50]',
};

// ── Flag helpers ───────────────────────────────────────────────────

/** Extract the bare flag name from a Commander flag string.
 *  '--limit <n>' → '--limit', '--all' → '--all'. */
export function flagToCliFlag(flag: string): string {
  const m = flag.match(/^(--[\w-]+)/);
  return m ? m[1] : flag;
}

/**
 * Map an AJV instance path (e.g. "/filters/hostnames/0") to the CLI flag that
 * populates it (e.g. "--hostname"). Numeric array indices are ignored.
 * Only exact mapping matches are returned: ambiguous paths such as
 * "/actions/0/version" (which several action flags can produce) stay unmapped
 * rather than pointing at the wrong flag.
 */
export function flagForBodyPath(
  instancePath: string,
  mappings: OptionMapping[] | undefined,
): string | undefined {
  if (!mappings || !instancePath) return undefined;
  const normalized = instancePath
    .split('/')
    .filter(Boolean)
    .filter((segment) => !/^\d+$/.test(segment))
    .join('.');
  const matches = mappings.filter(
    (m) => m.target === 'body' && m.param === normalized,
  );
  // Several flags can feed the same body property (e.g. all deploy action
  // flags feed `actions`); do not guess in that case.
  return matches.length === 1 ? flagToCliFlag(matches[0].flag) : undefined;
}

/** Derive Commander attribute name from a flag: '--sort-by' → 'sortBy'. */
export function flagToAttr(flag: string): string {
  const m = flag.match(/--([\w-]+)/);
  if (!m) throw new Error(`Cannot parse flag: ${flag}`);
  return m[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ── Commander integration ──────────────────────────────────────────

/** Register Commander .option() calls from an OptionMapping array. */
export function registerOptionsFromMapping(cmd: Command, mappings: OptionMapping[]): void {
  for (const m of mappings) {
    if (m.repeatable) {
      cmd.option(m.flag, m.description, (v: string, prev: string[]) => [...prev, v], [] as string[]);
    } else {
      cmd.option(m.flag, m.description);
    }
  }
}

/** Global options that apply to the request rather than the mapped command flags. */
export interface RequestGlobals {
  onBehalfOf?: string;
  verbose?: number;
  output?: string;
}

/** Build { query, reqOptions, body } from parsed Commander opts. */
export function buildRequestFromMapping(
  opts: Record<string, unknown>,
  mappings: OptionMapping[],
  globals?: RequestGlobals,
): {
  query: Record<string, unknown>;
  reqOptions: Record<string, unknown>;
  body: Record<string, unknown> | null;
} {
  const query: Record<string, unknown> = {};
  const reqOptions: Record<string, unknown> = {};
  let bodyObj: Record<string, unknown> | null = null;

  if (globals?.onBehalfOf != null) reqOptions.onBehalfOf = globals.onBehalfOf;
  if (globals?.verbose) reqOptions.verbose = globals.verbose;

  for (const m of mappings) {
    if (m.target === 'cli-only' || m.param === null) continue;

    const attr = flagToAttr(m.flag);
    const val = opts[attr];
    if (val === undefined || val === null || val === '') continue;
    // Repeatable options default to [] in Commander; omit them when unused.
    if (Array.isArray(val) && val.length === 0) continue;

    // Boolean flags are set to true by Commander; convert to string for query params
    const value = (m.boolean && m.target === 'query') ? String(val) : val;

    switch (m.target) {
      case 'query':
        query[m.param] = value;
        break;
      case 'header':
        reqOptions[attr] = value;
        break;
      case 'body':
        if (!bodyObj) bodyObj = {};
        setNestedPath(bodyObj, m.param, value);
        break;
    }
  }

  const target = mappingOperations.get(mappings);
  if (target) {
    const violations = findEnumViolations(
      target.resource,
      target.operation,
      mappings,
      query,
      reqOptions,
    );
    if (violations.length > 0) {
      emitEnumViolations(violations, target.resource, target.operation, globals?.output);
    }
  }

  return { query, reqOptions, body: bodyObj };
}

// ── Schema-driven enum validation ─────────────────────────────────
// registerMappings associates each option array with its API operation, so
// buildRequestFromMapping can reject invalid enumerated values without every
// command passing the operation explicitly.
const mappingOperations = new WeakMap<
  OptionMapping[],
  { resource: string; operation: string }
>();

interface EnumViolation {
  cliFlag: string;
  location: 'query' | 'header';
  param: string;
  value: string;
  allowed: string[];
}

function findEnumViolations(
  resource: string,
  operation: string,
  mappings: OptionMapping[],
  query: Record<string, unknown>,
  reqOptions: Record<string, unknown>,
): EnumViolation[] {
  const entry = lookupOperation(resource, operation);
  if (!entry) return [];

  const violations: EnumViolation[] = [];
  for (const m of mappings) {
    if (m.target !== 'query' && m.target !== 'header') continue;
    if (!m.param) continue;

    const raw = m.target === 'query'
      ? query[m.param]
      : reqOptions[flagToAttr(m.flag)];
    if (raw === undefined || raw === null || raw === '') continue;

    const constraint = getParameterEnum(entry.path, entry.method, m.target, m.param);
    if (!constraint) continue;

    // Query arrays are encoded comma-separated; repeatable flags arrive as arrays.
    const values = constraint.type === 'array'
      ? (Array.isArray(raw) ? raw.map(String) : String(raw).split(','))
      : [String(raw)];

    for (const value of values) {
      if (!constraint.values.includes(value)) {
        violations.push({
          cliFlag: flagToCliFlag(m.flag),
          location: m.target,
          param: m.param,
          value,
          allowed: constraint.values,
        });
      }
    }
  }
  return violations;
}

function emitEnumViolations(
  violations: EnumViolation[],
  resource: string,
  operation: string,
  output?: string,
): never {
  const isHuman = output == null ? !!process.stdout.isTTY : output === 'table';
  const message = violations.length === 1
    ? `Invalid value for ${violations[0].cliFlag}`
    : `Invalid values for ${violations.length} enumerated options`;

  if (isHuman) {
    process.stderr.write(`Error: ${message}\n`);
    for (const v of violations) {
      process.stderr.write(
        `  - ${v.cliFlag} "${v.value}": must be one of: ${v.allowed.join(', ')}\n`,
      );
    }
    process.stderr.write(`\nTip: run \`cdnpro schema ${resource} ${operation}\` to see accepted values\n`);
  } else {
    const envelope = {
      error: {
        code: 'VALIDATION',
        message,
        validationErrors: violations.map(v => ({
          path: `${v.location}.${v.param}`,
          message: `must be one of: ${v.allowed.join(', ')}`,
          keyword: 'enum',
          params: { allowedValues: v.allowed },
          cliFlag: v.cliFlag,
        })),
        hint: `Run \`cdnpro schema ${resource} ${operation}\` to see accepted values`,
      },
    };
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  }

  throw new CliError('VALIDATION', message, undefined, true);
}

/** Validate required options from mappings. */
export function checkRequiredMappings(
  opts: Record<string, unknown>,
  mappings: OptionMapping[],
): void {
  for (const m of mappings) {
    if (!m.required) continue;
    const attr = flagToAttr(m.flag);
    const val = opts[attr];
    if (val === undefined || val === null || val === '') {
      throw new CliError('VALIDATION', `Required option ${flagToCliFlag(m.flag)} not specified`);
    }
    if (Array.isArray(val) && val.length === 0) {
      throw new CliError('VALIDATION', `Required option ${flagToCliFlag(m.flag)} not specified`);
    }
  }
}

// ── Internal helpers ───────────────────────────────────────────────

function setNestedPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

// ── Registry (for schema command to introspect mappings) ───────────

const mappingRegistry = new Map<string, OptionMapping[]>();

/** Register option mappings for a CLI operation (resource.operation). */
export function registerMappings(
  resource: string,
  operation: string,
  mappings: OptionMapping[],
): void {
  mappingRegistry.set(`${resource}.${operation}`, mappings);
  mappingOperations.set(mappings, { resource, operation });
}

/** Look up option mappings for a CLI operation. */
export function getMappings(
  resource: string,
  operation: string,
): OptionMapping[] | undefined {
  return mappingRegistry.get(`${resource}.${operation}`);
}
