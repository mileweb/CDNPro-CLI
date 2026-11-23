import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Command } from 'commander';
import { registerAllCommands } from '../cli/register-commands';
import { getAllMappings } from '../cli/option-map';
import { lookupOperation } from '../schema/query';
import { getRequestBodySchema, getResponseSchema, getSpec, isParameterDeclared } from '../schema/loader';

registerAllCommands(new Command());

/** List operations that return more than one top-level array of items. */
const MULTI_ARRAY_LISTS = new Set([
  'public-ip.list',
  'origin-fast-route-ip.list',
]);

test('every mapped query/header parameter is declared by its operation', () => {
  const problems: string[] = [];
  for (const { resource, operation, mappings } of getAllMappings()) {
    const entry = lookupOperation(resource, operation);
    if (!entry) {
      problems.push(`${resource}.${operation}: no OpenAPI operation mapping`);
      continue;
    }
    for (const m of mappings) {
      if (m.target !== 'query' && m.target !== 'header') continue;
      if (!m.param) continue;
      if (!isParameterDeclared(entry.path, entry.method, m.target, m.param)) {
        problems.push(
          `${resource}.${operation}: ${m.flag} maps to undeclared ` +
          `${m.target} parameter "${m.param}"`,
        );
      }
    }
  }

  assert.deepEqual(problems, []);
});

function deref(schema: unknown): Record<string, unknown> | undefined {
  if (schema === null || typeof schema !== 'object') return undefined;
  const obj = schema as Record<string, unknown>;
  if (typeof obj.$ref !== 'string') return obj;
  return obj.$ref.split('/').slice(1).reduce<unknown>(
    (node, key) => (node as Record<string, unknown> | undefined)?.[key],
    getSpec() as unknown,
  ) as Record<string, unknown> | undefined;
}

test('list responses expose a single item array, except the merged IP lists', () => {
  const problems: string[] = [];

  for (const { resource, operation } of getAllMappings()) {
    if (operation !== 'list') continue;
    const entry = lookupOperation(resource, operation);
    if (!entry) continue;

    const { schema } = getResponseSchema(entry.path, entry.method);
    const resolved = deref(schema);
    if (!resolved || resolved['type'] === 'array') continue;

    const arrays = Object.entries((resolved['properties'] ?? {}) as Record<string, unknown>)
      .filter(([, value]) => deref(value)?.['type'] === 'array')
      .map(([key]) => key);

    const key = `${resource}.${operation}`;
    if (arrays.length > 1 && !MULTI_ARRAY_LISTS.has(key)) {
      problems.push(`${key}: response has multiple top-level arrays (${arrays.join(', ')})`);
    }
  }

  assert.deepEqual(problems, []);
});

/** Walk a dot-notation body path through a JSON schema (descending into array items). */
function bodyPathExists(schema: unknown, path: string): boolean {
  let node = deref(schema);
  for (const part of path.split('.')) {
    while (node && node['type'] === 'array') node = deref(node['items']);
    const props = node?.['properties'] as Record<string, unknown> | undefined;
    if (!props || !(part in props)) return false;
    node = deref(props[part]);
  }
  return true;
}

/**
 * Known mismatches that are tracked but not yet fixed. Remove an entry when its
 * flag is fixed or dropped; the test also fails if an entry no longer applies.
 */
const KNOWN_BODY_PATH_MISMATCHES = new Set([
  'cert.update: --ca-only -> caOnly',
  'report.l7-volume: --property <id> -> filters.propertyIds',
  'report.l7-volume: --server-group <g> -> filters.serverGroups',
  'report.l7-bandwidth: --property <id> -> filters.propertyIds',
  'report.l7-bandwidth: --server-group <g> -> filters.serverGroups',
  'report.l7-volume-summary: --property <id> -> filters.propertyIds',
  'report.l7-volume-summary: --server-group <g> -> filters.serverGroups',
  'report.l7-bandwidth-summary: --property <id> -> filters.propertyIds',
  'report.l7-bandwidth-summary: --server-group <g> -> filters.serverGroups',
]);

test('every body-mapped flag targets a property that exists in the request schema', () => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { resource, operation, mappings } of getAllMappings()) {
    const entry = lookupOperation(resource, operation);
    if (!entry) continue;
    const { schema } = getRequestBodySchema(entry.path, entry.method);
    for (const m of mappings) {
      if (m.target !== 'body' || !m.param) continue;
      if (!schema || !bodyPathExists(schema, m.param)) {
        const key = `${resource}.${operation}: ${m.flag} -> ${m.param}`;
        if (KNOWN_BODY_PATH_MISMATCHES.has(key)) seen.add(key);
        else problems.push(key);
      }
    }
  }
  for (const key of KNOWN_BODY_PATH_MISMATCHES) {
    if (!seen.has(key)) problems.push(`stale known-mismatch entry: ${key}`);
  }
  assert.deepEqual(problems, []);
});

test('required query parameters are marked required in the option mappings', () => {
  const problems: string[] = [];
  for (const { resource, operation, mappings } of getAllMappings()) {
    const entry = lookupOperation(resource, operation);
    if (!entry) continue;
    const spec = getSpec() as unknown as { paths: Record<string, Record<string, { parameters?: Array<Record<string, unknown>> }>> };
    const params = spec.paths[entry.path]?.[entry.method]?.parameters ?? [];
    for (const p of params) {
      if (p['in'] !== 'query' || p['required'] !== true) continue;
      const m = mappings.find((x) => x.target === 'query' && x.param === p['name']);
      if (!m) problems.push(`${resource}.${operation}: required query "${String(p['name'])}" has no flag`);
    }
  }
  assert.deepEqual(problems, []);
});
