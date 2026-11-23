import chalk from 'chalk';
import Table from 'cli-table3';
import { sanitizeForTerminal } from './sanitize';

export type OutputFormat = 'table' | 'json' | 'jsonl';

/**
 * Print data in the requested format.
 * If format is undefined, auto-detects: table for TTY, json when piped.
 */
export function print(
  data: unknown,
  format: OutputFormat | undefined,
  columns?: string[],
): void {
  const fmt = format ?? (process.stdout.isTTY ? 'table' : 'json');

  switch (fmt) {
    case 'json':  return printJson(data);
    case 'jsonl': return printJsonl(data);
    case 'table': return printTable(data, columns);
  }
}

/**
 * Emit a single JSON envelope:
 * { "data": [...], "meta": { "total": N, "limit": N, "offset": N } }
 * or { "data": {...} } for single objects.
 */
export function printJson(data: unknown, meta?: Record<string, unknown>): void {
  const envelope = wrapEnvelope(data, meta);
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}

/**
 * Emit one JSON object per line.
 * If data is an array, each element is emitted separately.
 * Otherwise a single line is emitted.
 */
export function printJsonl(data: unknown): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(JSON.stringify(item) + '\n');
    }
  } else {
    process.stdout.write(JSON.stringify(data) + '\n');
  }
}

function wrapEnvelope(
  data: unknown,
  meta?: Record<string, unknown>,
): Record<string, unknown> {
  const envelope: Record<string, unknown> = { data };
  if (meta && Object.keys(meta).length > 0) {
    envelope.meta = meta;
  }
  return envelope;
}

/**
 * Print data as an ASCII table.
 * - If data is an array of objects, renders each object as a row.
 * - If data is a single object, renders key/value pairs.
 * - Falls back to JSON if data cannot be rendered as a table.
 */
/**
 * Print a single result (non-list) in the requested format.
 * Unlike {@link print}, this defaults to JSON in TTY mode because table
 * format is only appropriate for list endpoints.
 */
export function printResult(
  data: unknown,
  format: OutputFormat | undefined,
  columns?: string[],
  meta?: Record<string, unknown>,
): void {
  const fmt = format ?? 'json';
  switch (fmt) {
    case 'json':  return printJson(data, meta);
    case 'jsonl': return printJsonl(data);
    case 'table': return printTable(data, columns);
  }
}

/**
 * Build the JSON payload for a write success:
 * `{"data":{"success":true,...fields}}`.
 */
export function writeResultData(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ data: { success: true, ...fields } });
}

/**
 * Emit a write success in the standard envelope.
 * In TTY mode (no explicit format): `humanMessage` to stderr.
 * In pipe / explicit format mode: `{"data":{"success":true,...}}` to stdout.
 */
export function printWriteResult(
  fields: Record<string, unknown>,
  format?: string,
  humanMessage?: string,
): void {
  if (!process.stdout.isTTY || format) {
    process.stdout.write(writeResultData(fields) + '\n');
  } else if (humanMessage) {
    // humanMessage often embeds IDs taken from the server's Location header.
    const text = sanitizeForTerminal(humanMessage);
    process.stderr.write(text.endsWith('\n') ? text : text + '\n');
  }
}

/**
 * Print a success message for resource creation.
 * In TTY mode (no explicit format): "Created new <label>: \"<id>\"." to stderr.
 * In pipe / explicit format mode: {"data":{"success":true,"<jsonKey>":"<id>"}}.
 */
export function printCreateSuccess(
  label: string,
  jsonKey: string,
  id: string,
  format?: string,
): void {
  printWriteResult({ [jsonKey]: id }, format, `Created new ${label}: "${id}".`);
}

export function printTable(data: unknown, columns?: string[]): void {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      process.stdout.write(chalk.dim('(no results)\n'));
      return;
    }
    // Arrays of primitives (strings, numbers, etc.) — render as a single column.
    if (data[0] === null || typeof data[0] !== 'object') {
      const col = columns?.[0] ?? 'value';
      const table = new Table({
        head: [chalk.bold(col)],
        style: { head: [], border: [] },
      });
      for (const item of data) {
        table.push([formatCell(item)]);
      }
      process.stdout.write(table.toString() + '\n');
      return;
    }
    // Rows can have different keys (optional properties), so take the union in
    // first-seen order rather than only the first row's keys. A key is skipped only
    // when every row that has it holds a nested object, which does not fit a table
    // cell. A column that is null everywhere is still shown (as "-").
    const rows = data.filter((r) => r !== null && typeof r === 'object') as Array<Record<string, unknown>>;
    const isNested = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const allKeys: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) { seen.add(k); allKeys.push(k); }
      }
    }
    const cols = columns ?? allKeys.filter((k) =>
      rows.some((r) => k in r && !isNested(r[k])),
    );
    const table = new Table({
      head: cols.map((c) => chalk.bold(sanitizeForTerminal(c))),
      style: { head: [], border: [] },
    });
    for (const row of data) {
      const r = row as Record<string, unknown>;
      table.push(cols.map((c) => formatCell(r[c])));
    }
    process.stdout.write(table.toString() + '\n');
    return;
  }

  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const table = new Table({ style: { head: [], border: [] } });
    for (const [k, v] of Object.entries(obj)) {
      table.push({ [chalk.bold(sanitizeForTerminal(k))]: formatCell(v) });
    }
    process.stdout.write(table.toString() + '\n');
    return;
  }

  // Scalar or null — just print it
  process.stdout.write(sanitizeForTerminal(String(data)) + '\n');
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return chalk.dim('-');
  // JSON.stringify already escapes control characters.
  if (typeof value === 'object') return JSON.stringify(value);
  return sanitizeForTerminal(String(value));
}

interface RawResponseLike {
  obj: unknown;
  ctx: { _res: { headers: Record<string, string | string[] | undefined> } };
}

function isRawResponse(v: unknown): v is RawResponseLike {
  return typeof v === 'object' && v !== null && 'obj' in v && 'ctx' in v;
}

/**
 * Unwrap a raw client response (`{ obj, ctx }`) and extract `Last-Modified`.
 *
 * Commands must pass `raw: true` to the client to receive headers. Endpoints
 * that do not declare `Last-Modified` return `meta = {}`.
 */
export function unwrapRawResponse(
  rsp: unknown,
): { data: unknown; meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {};
  if (isRawResponse(rsp)) {
    const lm = rsp.ctx._res.headers['last-modified'] ?? rsp.ctx._res.headers['Last-Modified'];
    if (lm) meta.lastModified = Array.isArray(lm) ? lm[0] : lm;
    return { data: rsp.obj, meta };
  }
  return { data: rsp, meta };
}

/**
 * Build a meta object from a list response.
 * Extracts total/limit/offset and lastModified from response headers.
 *
 * For list responses (arrays or `{ items: [...] }` wrappers), populates `items`.
 * For single-object responses, sets `single` and leaves `items` empty — the
 * caller should render `single` directly (e.g. via `printTable`) rather than
 * treating it as a one-element list.
 *
 * When the response contains more than one top-level array, `itemsKey` must
 * name the array that holds the list items; otherwise this throws rather than
 * silently picking one. (The IP-range reference lists merge their arrays in
 * {@link buildIpRangeList} instead.)
 */
export function buildMeta(
  rawData: unknown,
  headers?: Record<string, string | string[] | undefined>,
  itemsKey?: string,
): { items: unknown[]; meta: Record<string, unknown>; single?: unknown } {
  // CDN Pro list responses are plain arrays; total may come from a header.
  let items: unknown[] = [];
  const meta: Record<string, unknown> = {};

  if (Array.isArray(rawData)) {
    items = rawData;
  } else if (rawData !== null && typeof rawData === 'object') {
    const obj = rawData as Record<string, unknown>;
    // CDN Pro list responses wrap results in a resource-specific array key,
    // e.g. { properties: [...], count: N } or { certificates: [...] }.
    let arrayKey: string | undefined;
    if (itemsKey !== undefined) {
      if (!Array.isArray(obj[itemsKey])) {
        throw new Error(`Response does not contain an array named "${itemsKey}"`);
      }
      arrayKey = itemsKey;
    } else {
      const arrayKeys = Object.keys(obj).filter(k => Array.isArray(obj[k]));
      if (arrayKeys.length > 1) {
        throw new Error(
          `Response contains multiple top-level arrays (${arrayKeys.join(', ')}); ` +
          `cannot determine which one holds the list items`,
        );
      }
      arrayKey = arrayKeys[0];
    }

    if (arrayKey !== undefined) {
      items = obj[arrayKey] as unknown[];
      // Most list endpoints include a count field; apicalls uses hasMore instead.
      if (obj.count !== undefined) meta.total = obj.count;
      if (obj.total !== undefined) meta.total = obj.total;
      if (obj.limit !== undefined) meta.limit = obj.limit;
      if (obj.offset !== undefined) meta.offset = obj.offset;
      if (obj.hasMore !== undefined) meta.hasMore = obj.hasMore;
    } else {
      // Single resource — pass through; don't wrap in array
      return { items: [], meta, single: rawData };
    }
  }

  if (headers) {
    const lm = headers['last-modified'] ?? headers['Last-Modified'];
    if (lm) meta.lastModified = Array.isArray(lm) ? lm[0] : lm;
  }

  return { items, meta };
}

export interface IpRangeItem {
  ip: string;
  version: 4 | 6;
}

/**
 * Merge the `ipV4` and `ipV6` arrays returned by `/cdn/publicIpList` and
 * `/cdn/originFastRouteIpList` into a single item list, preserving the
 * response's `lastUpdated` and `effectiveDate` in `meta`.
 */
export function buildIpRangeList(
  rawData: unknown,
): { items: IpRangeItem[]; meta: Record<string, unknown> } {
  const obj = (rawData ?? {}) as Record<string, unknown>;
  const ipV4 = Array.isArray(obj.ipV4) ? obj.ipV4.map(String) : [];
  const ipV6 = Array.isArray(obj.ipV6) ? obj.ipV6.map(String) : [];

  const meta: Record<string, unknown> = {};
  if (obj.lastUpdated !== undefined) meta.lastUpdated = obj.lastUpdated;
  if (obj.effectiveDate !== undefined) meta.effectiveDate = obj.effectiveDate;

  return {
    items: [
      ...ipV4.map(ip => ({ ip, version: 4 as const })),
      ...ipV6.map(ip => ({ ip, version: 6 as const })),
    ],
    meta,
  };
}
