import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as http from 'http';
import { AddressInfo } from 'net';
import { PassThrough } from 'stream';
import { waitForTask } from '../cli/wait';
import { sanitizeForTerminal } from '../cli/sanitize';
import { printTable, printWriteResult } from '../cli/output';
import { checkFileConflicts, OptionMapping } from '../cli/option-map';
import { confirmOrAbort } from '../cli/util';
import { CliError } from '../cli/errors';
import { CDNProClient } from '../client/CDNProClient';
import { pathSegment } from '../client/ApiCore';

function captureStdout(fn: () => void): string {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = ((chunk: string | Uint8Array) => { out += String(chunk); return true; }) as typeof process.stdout.write;
  try { fn(); } finally { process.stdout.write = original; }
  return out;
}

// ── terminal sanitizing ───────────────────────────────────────────────────

test('sanitizeForTerminal escapes control characters but keeps layout whitespace', () => {
  assert.equal(sanitizeForTerminal('a\u001b[31mred\u001b[0m'), 'a\\x1b[31mred\\x1b[0m');
  assert.equal(sanitizeForTerminal('bell\u0007 del\u007f c1\u009b'), 'bell\\x07 del\\x7f c1\\x9b');
  assert.equal(sanitizeForTerminal('line1\nline2\tTabbed'), 'line1\nline2\tTabbed');
  assert.equal(sanitizeForTerminal('plain 你好'), 'plain 你好');
});

test('printTable never emits raw escape sequences from API data', () => {
  const out = captureStdout(() => printTable([{ name: 'evil\u001b]0;pwned\u0007', n: 1 }]));
  assert.ok(!out.includes('\u001b]'), 'no OSC sequence');
  assert.ok(!out.includes('\u0007'), 'no BEL');
  assert.ok(out.includes('\\x1b]0;pwned\\x07'));
});

test('printTable uses columns from every row, not just the first', () => {
  const out = captureStdout(() => printTable([
    { id: 'a' },
    { id: 'b', comment: 'only-on-row-two' },
    { id: 'c', nested: { x: 1 } },
  ]));
  assert.match(out, /comment/);
  assert.match(out, /only-on-row-two/);
  assert.doesNotMatch(out, /nested/, 'an all-object column is still skipped');
});

// ── path segments ─────────────────────────────────────────────────────────

test('pathSegment encodes, and rejects empty and dot segments', () => {
  assert.equal(pathSegment('a/b?c#d%e'), 'a%2Fb%3Fc%23d%25e');
  assert.equal(pathSegment(0, 'customerId'), '0');
  for (const bad of ['', '.', '..']) {
    assert.throws(() => pathSegment(bad, 'propertyID'), /propertyID/);
  }
  assert.throws(() => pathSegment(undefined as unknown as string, 'id'), /id is required/);
});

test('client wrappers refuse ../ ids before any request is made', async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => { requests += 1; res.end('{}'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const client = new CDNProClient({ host: '127.0.0.1', user: 'u', secretKey: 'k', scheme: 'http', port });
  try {
    assert.throws(() => client.certificates.getVersion('..', '1'), /certificateID/);
    assert.throws(() => client.properties.deleteVersion('p1', '..'), /version/);
    assert.throws(() => client.purges.get('.'), /id/);
    assert.throws(() => client.report.post('/cdn/report/../properties'), /invalid report endpoint path/);
    assert.throws(() => client.report.post('/cdn/report/bandwidth?x=1'), /invalid report endpoint path/);
    assert.throws(() => client.report.post('/cdn/report/'), /invalid report endpoint path/);
    assert.equal(requests, 0);
    await client.report.post('/cdn/report/bandwidth');
    await client.report.post('vol');
    assert.equal(requests, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

// ── --file conflicts ──────────────────────────────────────────────────────

const MAPPINGS: OptionMapping[] = [
  { flag: '--url <url>', target: 'body', param: 'fileUrls', description: '', repeatable: true },
  { flag: '--ca-only', target: 'body', param: 'caOnly', description: '', boolean: true },
  { flag: '--from <date>', target: 'query', param: 'startdate', description: '' },
  { flag: '--file <path>', target: 'cli-only', param: null, description: '' },
];

test('checkFileConflicts rejects body flags combined with --file', () => {
  assert.throws(
    () => checkFileConflicts({ file: 'p.json', url: ['https://x/a.js'] }, MAPPINGS),
    (e: unknown) => e instanceof CliError && e.code === 'VALIDATION' && /--url/.test(e.message),
  );
  assert.throws(() => checkFileConflicts({ file: 'p.json', caOnly: true }, MAPPINGS), /--ca-only/);
});

test('checkFileConflicts allows --file alone, empty repeatables, and query flags', () => {
  checkFileConflicts({ file: 'p.json', url: [], caOnly: undefined, from: '2026-01-01T00:00:00Z' }, MAPPINGS);
  checkFileConflicts({ url: ['https://x/a.js'] }, MAPPINGS); // no --file: nothing to conflict with
});

// ── delete confirmation ───────────────────────────────────────────────────

test('confirmOrAbort returns immediately with --confirm or when stdout is not a TTY', async () => {
  const original = process.stdout.isTTY;
  try {
    process.stdout.isTTY = true;
    await confirmOrAbort('Delete x?', true);
    process.stdout.isTTY = false;
    await confirmOrAbort('Delete x?', undefined);
  } finally {
    process.stdout.isTTY = original;
  }
});

// ── table columns ─────────────────────────────────────────────────────────

test('printTable keeps a column that is null in every row', () => {
  const out = captureStdout(() => printTable([
    { id: 'a', description: null },
    { id: 'b', description: null },
  ]));
  assert.match(out, /description/);
});

// ── human-readable messages and spinner text ──────────────────────────────

function captureStderr(fn: () => void): string {
  const original = process.stderr.write;
  let out = '';
  process.stderr.write = ((chunk: string | Uint8Array) => { out += String(chunk); return true; }) as typeof process.stderr.write;
  try { fn(); } finally { process.stderr.write = original; }
  return out;
}

test('printWriteResult escapes control characters from server-derived ids', () => {
  const original = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const out = captureStderr(() => printWriteResult({ id: 'x' }, undefined, 'Created "p\u001b[2Jwned".'));
    assert.ok(!out.includes('\u001b'), 'no raw ESC');
    assert.ok(out.includes('p\\x1b[2Jwned'), out);
  } finally {
    process.stdout.isTTY = original;
  }
});

test('waitForTask spinner text escapes server-provided status details', async () => {
  const original = process.stdout.isTTY;
  process.stdout.isTTY = true;
  const writes: string[] = [];
  const originalErr = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try {
    await assert.rejects(
      waitForTask(
        async () => ({ status: 'failed', statusDetails: 'bad\u001b]0;pwned\u0007' }),
        't1',
        { taskType: 'deployment', timeout: 5, pollInterval: 1, outputFormat: 'table' },
      ),
      /failed/,
    );
  } finally {
    process.stderr.write = originalErr;
    process.stdout.isTTY = original;
  }
  const all = writes.join('');
  assert.ok(!all.includes('\u001b]0;pwned'), 'no raw OSC sequence on stderr');
  assert.ok(!all.includes('\u0007'), 'no raw BEL on stderr');
});

// ── delete confirmation prompt ────────────────────────────────────────────

async function prompt(feed: (input: PassThrough) => void): Promise<string> {
  const input = new PassThrough();
  const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
  const originalTTY = process.stdout.isTTY;
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  Object.defineProperty(process, 'stdin', { value: input, configurable: true });
  process.stdout.isTTY = true;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    const pending = confirmOrAbort('Delete x?', undefined);
    feed(input);
    await pending;
    return 'proceeded';
  } catch (e) {
    return `threw: ${(e as Error).message}`;
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    process.stdout.isTTY = originalTTY;
    Object.defineProperty(process, 'stdin', originalStdin);
  }
}

test('confirmOrAbort proceeds only on y or yes', async () => {
  assert.equal(await prompt((i) => i.write('y\n')), 'proceeded');
  assert.equal(await prompt((i) => i.write('YES\n')), 'proceeded');
});

test('confirmOrAbort aborts on no, an empty answer, or stdin EOF', async () => {
  assert.equal(await prompt((i) => i.write('n\n')), 'threw: Aborted.');
  assert.equal(await prompt((i) => i.write('\n')), 'threw: Aborted.');
  assert.match(await prompt((i) => i.end()), /^threw: No confirmation received/);
});
