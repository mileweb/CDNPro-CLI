import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Command } from 'commander';
import { registerAllCommands } from '../cli/register-commands';
import { getAllMappings } from '../cli/option-map';
import { lookupOperation } from '../schema/query';
import { getResponseSchema, getSpec, isParameterDeclared } from '../schema/loader';

registerAllCommands(new Command());

/**
 * Parameters the CLI sends that the current spec does not declare. Kept
 * deliberately because the API may support them; tracked as L-28 until the
 * spec is corrected or the flags are removed.
 */
const KNOWN_SPEC_GAPS = new Set([
  'prefetch.tokens query.target',
  'hostname.list query.search',
  'hostname-history.list header.Report-Range',
]);

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
      if (KNOWN_SPEC_GAPS.has(`${resource}.${operation} ${m.target}.${m.param}`)) continue;
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
