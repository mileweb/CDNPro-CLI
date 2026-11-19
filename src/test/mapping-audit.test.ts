import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Command } from 'commander';
import { registerAllCommands } from '../cli/register-commands';
import { getAllMappings } from '../cli/option-map';
import { lookupOperation } from '../schema/query';
import { isParameterDeclared } from '../schema/loader';

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

test('every mapped query/header parameter is declared by its operation', () => {
  registerAllCommands(new Command());

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
