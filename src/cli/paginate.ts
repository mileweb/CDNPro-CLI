import { CliError } from './errors';
import { buildMeta, OutputFormat, printJsonl } from './output';
import { lookupOperation } from '../schema/query';
import { getQueryLimitMaximum } from '../schema/loader';

export const DEFAULT_LIST_LIMIT = 10;
export const DEFAULT_ALL_LIMIT = 100;
export const DEFAULT_MAX_PAGES = 10;
export const MAX_PAGES_CEILING = 50;

export interface ListPaging {
  all: boolean;
  limit: number;
  offset: number;
  maxPages: number;
}

export interface CursorPaging {
  all: boolean;
  limit: number;
  maxPages: number;
  before?: string;
}

export interface PagingHooks<T> {
  /** Receives each page of items. Defaults to JSONL on stdout. */
  emit?: (items: T[]) => void;
  /** Receives the cap warning. Defaults to stderr. */
  warn?: (message: string) => void;
}

interface ResolveOptions {
  /** OPERATION_MAP resource key, e.g. "property" or "admin-apicall". */
  resource: string;
  /** OPERATION_MAP operation key, e.g. "list". */
  operation: string;
  /** Explicit --output value (undefined means auto). */
  output?: OutputFormat | string;
  defaultLimit?: number;
  defaultAllLimit?: number;
}

export interface PagingOptionBag {
  all?: unknown;
  limit?: unknown;
  offset?: unknown;
  maxPages?: unknown;
  before?: unknown;
}

function limitMaximum(resource: string, operation: string): number | undefined {
  const entry = lookupOperation(resource, operation);
  return entry ? getQueryLimitMaximum(entry.path, entry.method) : undefined;
}

function parseLimit(
  value: unknown,
  defaultValue: number,
  maximum: number | undefined,
  resource: string,
  operation: string,
): number {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError('VALIDATION', `--limit must be a positive integer, got: ${String(value)}`);
  }
  if (maximum !== undefined && parsed > maximum) {
    throw new CliError(
      'VALIDATION',
      `--limit must not exceed ${maximum} for ${resource} ${operation}, got: ${parsed}`,
    );
  }
  return parsed;
}

function parseOffset(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError('VALIDATION', `--offset must be a non-negative integer, got: ${String(value)}`);
  }
  return parsed;
}

function parseMaxPages(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGES_CEILING) {
    throw new CliError(
      'VALIDATION',
      `--max-pages must be an integer between 1 and ${MAX_PAGES_CEILING}, got: ${String(value)}`,
    );
  }
  return parsed;
}

function checkAllFlags(opts: PagingOptionBag, output?: OutputFormat | string): void {
  const all = opts.all === true;
  if (!all && opts.maxPages !== undefined) {
    throw new CliError('VALIDATION', '--max-pages requires --all');
  }
  if (all && (output === 'table' || output === 'json')) {
    throw new CliError(
      'VALIDATION',
      '--all outputs JSONL; do not combine it with --output table or --output json',
    );
  }
}

/** Validate and normalize --limit/--offset/--max-pages for offset-based lists. */
export function resolveListPaging(
  opts: PagingOptionBag,
  options: ResolveOptions,
): ListPaging {
  checkAllFlags(opts, options.output);
  const all = opts.all === true;
  const maximum = limitMaximum(options.resource, options.operation);
  const defaultLimit = all
    ? (options.defaultAllLimit ?? DEFAULT_ALL_LIMIT)
    : (options.defaultLimit ?? DEFAULT_LIST_LIMIT);
  const limit = parseLimit(opts.limit, defaultLimit, maximum, options.resource, options.operation);
  const offset = parseOffset(opts.offset);
  const maxPages = all && opts.maxPages !== undefined
    ? parseMaxPages(opts.maxPages)
    : DEFAULT_MAX_PAGES;
  return { all, limit, offset, maxPages };
}

/** Validate and normalize --limit/--max-pages/--before for cursor-based lists. */
export function resolveCursorPaging(
  opts: PagingOptionBag,
  options: ResolveOptions,
): CursorPaging {
  checkAllFlags(opts, options.output);
  const all = opts.all === true;
  const maximum = limitMaximum(options.resource, options.operation);
  const defaultLimit = options.defaultLimit ?? options.defaultAllLimit ?? DEFAULT_ALL_LIMIT;
  const limit = parseLimit(opts.limit, defaultLimit, maximum, options.resource, options.operation);
  const maxPages = all && opts.maxPages !== undefined
    ? parseMaxPages(opts.maxPages)
    : DEFAULT_MAX_PAGES;
  const before = typeof opts.before === 'string' && opts.before.length > 0
    ? opts.before
    : undefined;
  return { all, limit, maxPages, before };
}

function incomplete(
  maxPages: number,
  items: number,
  warn: (message: string) => void,
): never {
  const message =
    `--all stopped after ${maxPages} page${maxPages === 1 ? '' : 's'} ` +
    `(${items} item${items === 1 ? '' : 's'}); results may be incomplete. ` +
    `Increase --max-pages (max ${MAX_PAGES_CEILING}) or narrow the filters.`;
  warn(message);
  throw new CliError('INCOMPLETE', message, undefined, true);
}

/**
 * Stream every page of an offset-based list as JSONL.
 *
 * - Pages are advanced by the number of items actually returned.
 * - A short page does not imply the end (the server may clamp --limit); only an
 *   empty page or a reached `meta.total` ends pagination.
 * - Reaching --max-pages with more data possible throws INCOMPLETE (exit 11).
 */
export async function paginateOffset<T>(
  fetchPage: (limit: number, offset: number) => Promise<unknown>,
  opts: ListPaging,
  hooks?: PagingHooks<T>,
): Promise<void> {
  const emit = hooks?.emit ?? ((items: T[]) => printJsonl(items));
  const warn = hooks?.warn ?? ((message: string) => process.stderr.write(`Warning: ${message}\n`));

  let offset = opts.offset;
  let pages = 0;
  let emitted = 0;

  while (true) {
    const data = await fetchPage(opts.limit, offset);
    const { items, meta } = buildMeta(data) as { items: T[]; meta: Record<string, unknown> };
    if (items.length === 0) return;

    emit(items);
    emitted += items.length;
    pages += 1;

    const total = typeof meta.total === 'number' ? meta.total : undefined;
    if (total !== undefined && offset + items.length >= total) return;

    if (pages >= opts.maxPages) incomplete(opts.maxPages, emitted, warn);
    offset += items.length;
  }
}

/**
 * Stream every page of a cursor-based list (admin apicall) as JSONL.
 *
 * - The next cursor is the last item's apiRequestId.
 * - Stops on an empty page, `hasMore: false`, or a missing cursor.
 * - A non-advancing cursor is an error (exit 1), not a quiet loop.
 * - Reaching --max-pages with more data possible throws INCOMPLETE (exit 11).
 */
export async function paginateCursor<T extends Record<string, unknown>>(
  fetchPage: (cursor: string | undefined, limit: number) => Promise<unknown>,
  opts: CursorPaging,
  hooks?: PagingHooks<T>,
): Promise<void> {
  const emit = hooks?.emit ?? ((items: T[]) => printJsonl(items));
  const warn = hooks?.warn ?? ((message: string) => process.stderr.write(`Warning: ${message}\n`));

  let cursor = opts.before;
  let pages = 0;
  let emitted = 0;

  while (true) {
    const data = await fetchPage(cursor, opts.limit);
    const { items, meta } = buildMeta(data) as { items: T[]; meta: Record<string, unknown> };
    if (items.length === 0) return;

    emit(items);
    emitted += items.length;
    pages += 1;

    if (meta.hasMore === false) return;
    if (pages >= opts.maxPages) incomplete(opts.maxPages, emitted, warn);

    const last = items[items.length - 1];
    const next = last['apiRequestId'];
    if (next === undefined || next === null || next === '') {
      throw new CliError(
        'ERROR',
        'Server did not return apiRequestId; cannot continue --all pagination',
      );
    }
    const nextCursor = String(next);
    if (nextCursor === cursor) {
      throw new CliError(
        'ERROR',
        `Cursor did not advance (apiRequestId ${nextCursor}); aborting --all pagination`,
      );
    }
    cursor = nextCursor;
  }
}
