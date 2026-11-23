import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { encodeQuery, withQuery } from '../client/ApiCore';

test('encodeQuery encodes scalars and comma-joins arrays', () => {
  assert.equal(encodeQuery({ a: '1', b: ['x', 'y'] }), '?a=1&b=x,y');
});

test('encodeQuery skips empty values', () => {
  assert.equal(encodeQuery({ a: '', b: undefined as unknown as string }), '');
});

test('withQuery appends to an existing query string', () => {
  assert.equal(withQuery('/cdn/x', { a: 1 }), '/cdn/x?a=1');
  assert.equal(withQuery('/cdn/x?z=0', { a: 1 }), '/cdn/x?z=0&a=1');
  assert.equal(withQuery('/cdn/x'), '/cdn/x');
});

// ── End-to-end behaviour against a local HTTP server ──────────────────────
import * as http from 'http';
import * as zlib from 'zlib';
import { AddressInfo } from 'net';
import { ApiCore } from '../client/ApiCore';

async function withServer<T>(
  handler: http.RequestListener,
  run: (core: ApiCore, requests: () => number) => Promise<T>,
): Promise<T> {
  let count = 0;
  const server = http.createServer((req, res) => { count += 1; handler(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const core = new ApiCore({ host: '127.0.0.1', user: 'u', secretKey: 'k', scheme: 'http', port });
  try {
    return await run(core, () => count);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('multi-byte UTF-8 characters split across chunks decode intact', async () => {
  const bytes = Buffer.from('{"a":"你好"}', 'utf8');
  const split = bytes.indexOf(0xe4) + 1; // inside the first 3-byte character
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.write(bytes.subarray(0, split));
    setTimeout(() => res.end(bytes.subarray(split)), 30);
  }, async (core) => {
    assert.deepEqual(await core.request('GET', '/x'), { a: '你好' });
  });
});

test('gzip responses with multi-byte characters decode intact', async () => {
  const gz = zlib.gzipSync(Buffer.from('{"a":"你好世界"}', 'utf8'));
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('content-encoding', 'gzip');
    res.write(gz.subarray(0, 12));
    setTimeout(() => res.end(gz.subarray(12)), 30);
  }, async (core) => {
    assert.deepEqual(await core.request('GET', '/x'), { a: '你好世界' });
  });
});

test('a reset GET is retried on a fresh connection', async () => {
  let seen = 0;
  await withServer((_req, res) => {
    seen += 1;
    if (seen === 1) { res.socket!.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  }, async (core, requests) => {
    assert.deepEqual(await core.request('GET', '/x'), { ok: true });
    assert.equal(requests(), 2);
  });
});

test('a reset POST is never replayed (it may already have been processed)', async () => {
  await withServer((_req, res) => { res.socket!.destroy(); }, async (core, requests) => {
    await assert.rejects(core.request('POST', '/cdn/purges', { body: { target: 'production' } }));
    assert.equal(requests(), 1);
  });
});
