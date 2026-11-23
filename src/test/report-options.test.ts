import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Command } from 'commander';
import { registerAllCommands } from '../cli/register-commands';
import { getMappings } from '../cli/option-map';

registerAllCommands(new Command());

function flags(resource: string, operation: string): string[] {
  const mappings = getMappings(resource, operation);
  assert.ok(mappings, `${resource}.${operation} is registered`);
  return mappings.map((m) => m.flag.split(' ')[0]);
}

function describe(resource: string, operation: string, flag: string): string {
  return getMappings(resource, operation)!.find((m) => m.flag.startsWith(flag + ' '))?.description ?? '';
}

test('L7 reports offer only the filters their spec declares', () => {
  for (const op of ['l7-volume', 'l7-bandwidth', 'l7-volume-summary', 'l7-bandwidth-summary']) {
    const f = flags('report', op);
    assert.ok(f.includes('--hostname'), op);
    assert.ok(f.includes('--property-hostname'), op);
    assert.ok(f.includes('--content-code'), op);
    assert.ok(!f.includes('--property'), `${op} must not offer --property`);
    assert.ok(!f.includes('--server-group'), `${op} must not offer --server-group`);
  }
});

test('L7 summaries expose --report-range; other summaries do not', () => {
  assert.ok(flags('report', 'l7-volume-summary').includes('--report-range'));
  assert.ok(flags('report', 'l7-bandwidth-summary').includes('--report-range'));
  assert.ok(!flags('report', 'edge-bandwidth-summary').includes('--report-range'));
});

test('--scheme help follows each endpoint\'s enum', () => {
  assert.doesNotMatch(describe('report', 'edge-volume-summary', '--scheme'), /\ball\b/);
  assert.match(describe('report', 'edge-requests-summary', '--scheme'), /http \| https \| all/);
});

test('--group-by help is derived from the endpoint spec', () => {
  assert.doesNotMatch(describe('report', 'edge-status-summary', '--group-by'), /legacyTypes/);
  assert.match(describe('report', 'edge-status-summary', '--group-by'), /up to 2/);
  assert.match(describe('report', 'l7-volume-summary', '--group-by'), /contentCodes/);
});

test('required query parameters are flagged required where the spec says so', () => {
  const required = (resource: string, operation: string, flag: string) =>
    getMappings(resource, operation)!.find((m) => m.flag.startsWith(flag + ' '))?.required === true;
  assert.ok(required('annotation', 'list', '--from'));
  assert.ok(required('annotation', 'list', '--to'));
  assert.ok(required('purge', 'summary', '--from'));
  assert.ok(required('purge', 'summary', '--to'));
  assert.ok(required('log-aggregation-point', 'summary', '--from'));
});
