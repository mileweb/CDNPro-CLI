import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { waitForTask, parseWaitOptions } from '../cli/wait';
import { CliError } from '../cli/errors';

/** Silence the NDJSON poll events waitForTask writes to stdout when not on a TTY. */
function muteStdout<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  return fn().finally(() => { process.stdout.write = original; });
}

const running = { status: 'inprogress' };
const succeeded = { status: 'succeeded' };

function httpError(statusCode: number): Error {
  return Object.assign(new Error(`Status code is ${statusCode}`), { ctx: { _res: { statusCode } } });
}

test('parseWaitOptions applies defaults and accepts plain positive integers', () => {
  assert.deepEqual(parseWaitOptions({}, { timeout: 600, pollInterval: 30 }), { timeout: 600, pollInterval: 30 });
  assert.deepEqual(
    parseWaitOptions({ timeout: '90', pollInterval: '5' }, { timeout: 600, pollInterval: 30 }),
    { timeout: 90, pollInterval: 5 },
  );
});

test('parseWaitOptions rejects values parseInt would have let through', () => {
  for (const bad of ['10abc', '1.5', '0', '-1', 'abc', '', ' ']) {
    assert.throws(
      () => parseWaitOptions({ timeout: bad }, { timeout: 600, pollInterval: 30 }),
      (e: unknown) => e instanceof CliError && e.code === 'VALIDATION' && /--timeout/.test(e.message),
      `--timeout ${JSON.stringify(bad)}`,
    );
  }
  assert.throws(
    () => parseWaitOptions({ pollInterval: '0' }, { timeout: 600, pollInterval: 30 }),
    /--poll-interval must be a positive integer/,
  );
});

test('waitForTask polls once more at the deadline instead of sleeping past it', async () => {
  let calls = 0;
  const started = Date.now();
  const task = await muteStdout(() => waitForTask(
    async () => (++calls < 2 ? running : succeeded),
    't1',
    { taskType: 'deployment', timeout: 1, pollInterval: 30 },
  ));
  assert.deepEqual(task, succeeded);
  assert.equal(calls, 2);
  // The 30s interval is capped at the 1s deadline.
  assert.ok(Date.now() - started < 5000, 'must not sleep a full poll interval');
});

test('waitForTask times out near --timeout, not a whole interval later', async () => {
  const started = Date.now();
  await assert.rejects(
    muteStdout(() => waitForTask(
      async () => running,
      't2',
      { taskType: 'deployment', timeout: 1, pollInterval: 30 },
    )),
    (e: unknown) => e instanceof CliError && e.code === 'TIMEOUT',
  );
  assert.ok(Date.now() - started < 5000);
});

test('waitForTask survives transient polling errors', async () => {
  const sequence: Array<Error | typeof running | typeof succeeded> = [httpError(503), httpError(429), succeeded];
  const task = await muteStdout(() => waitForTask(
    async () => {
      const next = sequence.shift()!;
      if (next instanceof Error) throw next;
      return next;
    },
    't3',
    { taskType: 'deployment', timeout: 30, pollInterval: 0.01 },
  ));
  assert.deepEqual(task, succeeded);
});

test('waitForTask does not retry non-transient errors', async () => {
  let calls = 0;
  await assert.rejects(
    muteStdout(() => waitForTask(
      async () => { calls += 1; throw httpError(404); },
      't4',
      { taskType: 'deployment', timeout: 30, pollInterval: 0.01 },
    )),
    /404/,
  );
  assert.equal(calls, 1);
});

test('waitForTask gives up after repeated transient errors', async () => {
  let calls = 0;
  await assert.rejects(
    muteStdout(() => waitForTask(
      async () => { calls += 1; throw httpError(500); },
      't5',
      { taskType: 'deployment', timeout: 30, pollInterval: 0.01 },
    )),
    /500/,
  );
  assert.equal(calls, 4);
});

test('waitForTask reports a failed task with its details', async () => {
  await assert.rejects(
    muteStdout(() => waitForTask(
      async () => ({ status: 'failed', statusDetails: 'bad cert' }),
      't6',
      { taskType: 'deployment', timeout: 5, pollInterval: 0.01 },
    )),
    /failed: bad cert/,
  );
});
