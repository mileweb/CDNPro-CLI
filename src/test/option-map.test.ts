import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  flagToCliFlag,
  flagToAttr,
  flagForBodyPath,
  buildRequestFromMapping,
  checkRequiredMappings,
  OptionMapping,
} from '../cli/option-map';

const mappings: OptionMapping[] = [
  { flag: '--limit <n>', target: 'query', param: 'limit', description: '' },
  { flag: '--ca-only', target: 'query', param: 'caOnly', description: '', boolean: true },
  { flag: '--report-range <scope>', target: 'header', param: 'Report-Range', description: '' },
  { flag: '--hostname <h>', target: 'body', param: 'filters.hostnames', description: '', repeatable: true },
  { flag: '--wait', target: 'cli-only', param: null, description: '', boolean: true },
];

test('flagToCliFlag strips the value placeholder', () => {
  assert.equal(flagToCliFlag('--limit <n>'), '--limit');
  assert.equal(flagToCliFlag('--all'), '--all');
});

test('flagToAttr converts kebab-case to camelCase', () => {
  assert.equal(flagToAttr('--sort-by <field>'), 'sortBy');
  assert.equal(flagToAttr('--ca-only'), 'caOnly');
});

test('flagForBodyPath maps array paths back to flags', () => {
  const bodyMappings: OptionMapping[] = [
    { flag: '--hostname <h>', target: 'body', param: 'filters.hostnames', description: '', repeatable: true },
    { flag: '--url <url>', target: 'body', param: 'fileList.url', description: '', repeatable: true },
    { flag: '--deploy-property <id@version>', target: 'body', param: 'actions', description: '' },
    { flag: '--deploy-cert <id@version>', target: 'body', param: 'actions', description: '' },
  ];

  assert.equal(flagForBodyPath('/filters/hostnames/0', bodyMappings), '--hostname');
  assert.equal(flagForBodyPath('/fileList/0/url', bodyMappings), '--url');
  // Ambiguous: several action flags feed /actions, so do not guess.
  assert.equal(flagForBodyPath('/actions/0/version', bodyMappings), undefined);
  assert.equal(flagForBodyPath('/actions', bodyMappings), undefined);
  assert.equal(flagForBodyPath('', bodyMappings), undefined);
});

test('buildRequestFromMapping routes query, header, body, and cli-only options', () => {
  const { query, reqOptions, body } = buildRequestFromMapping(
    {
      limit: '5',
      caOnly: true,
      reportRange: 'self-only',
      hostname: ['a.example', 'b.example'],
      wait: true,
    },
    mappings,
  );

  assert.deepEqual(query, { limit: '5', caOnly: 'true' });
  assert.deepEqual(reqOptions, { reportRange: 'self-only' });
  assert.deepEqual(body, { filters: { hostnames: ['a.example', 'b.example'] } });
});

test('buildRequestFromMapping skips empty values and empty repeatables', () => {
  const { query, reqOptions, body } = buildRequestFromMapping(
    { limit: '', hostname: [] },
    mappings,
  );

  assert.deepEqual(query, {});
  assert.deepEqual(reqOptions, {});
  assert.equal(body, null);
});

test('checkRequiredMappings rejects missing or empty required options', () => {
  const required: OptionMapping[] = [
    { flag: '--from <date>', target: 'query', param: 'startdate', description: '', required: true },
    { flag: '--url <url>', target: 'body', param: 'fileList', description: '', required: true, repeatable: true },
  ];

  assert.throws(() => checkRequiredMappings({}, required), /Required option --from/);
  assert.throws(
    () => checkRequiredMappings({ from: '2026-01-01', url: [] }, required),
    /Required option --url/,
  );
  assert.doesNotThrow(() => checkRequiredMappings({ from: '2026-01-01', url: ['https://x/y'] }, required));
});
