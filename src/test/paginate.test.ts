import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CliError, EXIT_CODES } from '../cli/errors';
import {
  resolveListPaging,
  resolveCursorPaging,
  paginateOffset,
  paginateCursor,
} from '../cli/paginate';

function expectCliError(fn: () => unknown, code: keyof typeof EXIT_CODES): void {
  try {
    fn();
    assert.fail(`expected CliError ${code}`);
  } catch (err) {
    assert.ok(err instanceof CliError, 'expected CliError');
    assert.equal((err as CliError).code, code);
  }
}

test('exit code 11 is INCOMPLETE', () => {
  assert.equal(EXIT_CODES.INCOMPLETE, 11);
});

test('resolveListPaging applies defaults', () => {
  const list = resolveListPaging({}, { resource: 'property', operation: 'list' });
  assert.deepEqual(list, { all: false, limit: 10, offset: 0, maxPages: 10 });

  const all = resolveListPaging({ all: true }, { resource: 'property', operation: 'list' });
  assert.deepEqual(all, { all: true, limit: 100, offset: 0, maxPages: 10 });
});

test('resolveListPaging validates --max-pages', () => {
  const opts = { resource: 'property', operation: 'list' };
  assert.equal(resolveListPaging({ all: true, maxPages: '5' }, opts).maxPages, 5);

  expectCliError(() => resolveListPaging({ maxPages: '5' }, opts), 'VALIDATION');
  expectCliError(() => resolveListPaging({ all: true, maxPages: '0' }, opts), 'VALIDATION');
  expectCliError(() => resolveListPaging({ all: true, maxPages: '51' }, opts), 'VALIDATION');
  expectCliError(() => resolveListPaging({ all: true, maxPages: 'x' }, opts), 'VALIDATION');
});

test('resolveListPaging rejects conflicting output and invalid limit/offset', () => {
  const opts = { resource: 'property', operation: 'list', output: 'json' };
  expectCliError(() => resolveListPaging({ all: true }, opts), 'VALIDATION');

  const jsonl = resolveListPaging({ all: true }, {
    resource: 'property',
    operation: 'list',
    output: 'jsonl',
  });
  assert.equal(jsonl.all, true);

  const base = { resource: 'property', operation: 'list' };
  expectCliError(() => resolveListPaging({ limit: 'abc' }, base), 'VALIDATION');
  expectCliError(() => resolveListPaging({ offset: '-1' }, base), 'VALIDATION');
  // property list declares limit maximum 200.
  expectCliError(() => resolveListPaging({ limit: '201' }, base), 'VALIDATION');
});

test('resolveCursorPaging uses apicall limits and cursor', () => {
  const opts = { resource: 'admin-apicall', operation: 'list' };
  const all = resolveCursorPaging({ all: true, before: 'abc' }, opts);
  assert.deepEqual(all, { all: true, limit: 100, maxPages: 10, before: 'abc' });

  expectCliError(() => resolveCursorPaging({ limit: '101' }, opts), 'VALIDATION');
});

test('paginateOffset advances by returned items and stops on an empty page', async () => {
  const fetchedOffsets: number[] = [];
  const pages: number[][] = [[1, 2], [3, 4], []];
  let page = 0;
  const emitted: number[] = [];

  await paginateOffset<number>(
    async (_limit, offset) => {
      fetchedOffsets.push(offset);
      return pages[page++];
    },
    { all: true, limit: 2, offset: 0, maxPages: 10 },
    { emit: (items) => emitted.push(...items) },
  );

  assert.deepEqual(emitted, [1, 2, 3, 4]);
  assert.deepEqual(fetchedOffsets, [0, 2, 4]);
});

test('paginateOffset stops when meta.total is reached', async () => {
  let calls = 0;
  const emitted: number[] = [];

  await paginateOffset<number>(
    async () => {
      calls += 1;
      return { properties: [1, 2], count: 2 };
    },
    { all: true, limit: 2, offset: 0, maxPages: 10 },
    { emit: (items) => emitted.push(...items) },
  );

  assert.equal(calls, 1);
  assert.deepEqual(emitted, [1, 2]);
});

test('paginateOffset throws INCOMPLETE at the page cap', async () => {
  const warnings: string[] = [];
  const emitted: number[] = [];

  await assert.rejects(
    () => paginateOffset<number>(
      async () => [1, 2],
      { all: true, limit: 2, offset: 0, maxPages: 2 },
      { emit: (items) => emitted.push(...items), warn: (m) => warnings.push(m) },
    ),
    (err: unknown) => err instanceof CliError && err.code === 'INCOMPLETE',
  );

  assert.deepEqual(emitted, [1, 2, 1, 2]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /--max-pages/);
});

test('paginateCursor follows apiRequestId cursors', async () => {
  const seenCursors: Array<string | undefined> = [];
  const emitted: Record<string, unknown>[] = [];
  const pages = [
    { apicalls: [{ apiRequestId: 'a' }, { apiRequestId: 'b' }], hasMore: true },
    { apicalls: [{ apiRequestId: 'c' }], hasMore: false },
  ];
  let page = 0;

  await paginateCursor<Record<string, unknown>>(
    async (cursor) => {
      seenCursors.push(cursor);
      return pages[page++];
    },
    { all: true, limit: 100, maxPages: 10 },
    { emit: (items) => emitted.push(...items) },
  );

  assert.deepEqual(seenCursors, [undefined, 'b']);
  assert.deepEqual(emitted, [
    { apiRequestId: 'a' },
    { apiRequestId: 'b' },
    { apiRequestId: 'c' },
  ]);
});

test('paginateCursor rejects a non-advancing cursor', async () => {
  await assert.rejects(
    () => paginateCursor<Record<string, unknown>>(
      async () => ({ apicalls: [{ apiRequestId: 'same' }], hasMore: true }),
      { all: true, limit: 100, maxPages: 10, before: 'same' },
      { emit: () => undefined, warn: () => undefined },
    ),
    (err: unknown) => err instanceof CliError && err.code === 'ERROR',
  );
});

test('paginateCursor throws INCOMPLETE at the page cap', async () => {
  const warnings: string[] = [];

  await assert.rejects(
    () => paginateCursor<Record<string, unknown>>(
      async () => ({ apicalls: [{ apiRequestId: 'a' }], hasMore: true }),
      { all: true, limit: 100, maxPages: 1 },
      { emit: () => undefined, warn: (m) => warnings.push(m) },
    ),
    (err: unknown) => err instanceof CliError && err.code === 'INCOMPLETE',
  );

  assert.equal(warnings.length, 1);
});
