import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as http from 'http';
import { AddressInfo } from 'net';
import { CDNProClient } from '../client/CDNProClient';
import { getSpec } from '../schema/loader';

interface Seen { method: string; path: string }

async function withClient(run: (client: CDNProClient, seen: Seen[]) => Promise<void>): Promise<void> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? '', path: req.url ?? '' });
    res.setHeader('content-type', 'application/json');
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const client = new CDNProClient({ host: '127.0.0.1', user: 'u', secretKey: 'k', scheme: 'http', port });
  try {
    await run(client, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('every service-quota wrapper hits an operation that exists in the spec', async () => {
  await withClient(async (client, seen) => {
    const q = client.serviceQuotas;
    await q.list();
    await q.create({ customerId: 1 });
    await q.get('sq1');
    await q.update('sq1', { x: 1 });
    await q.delete('sq1');
    await q.getByCustomer(7);
    await q.updateByCustomer(7, { x: 1 });
    await q.deleteByCustomer(7);

    assert.deepEqual(seen, [
      { method: 'GET', path: '/cdn/serviceQuotas' },
      { method: 'POST', path: '/cdn/serviceQuotas' },
      { method: 'GET', path: '/cdn/serviceQuotas/sq1' },
      { method: 'PATCH', path: '/cdn/serviceQuotas/sq1' },
      { method: 'DELETE', path: '/cdn/serviceQuotas/sq1' },
      { method: 'GET', path: '/cdn/serviceQuotas/customer/7' },
      { method: 'PATCH', path: '/cdn/serviceQuotas/customer/7' },
      { method: 'DELETE', path: '/cdn/serviceQuotas/customer/7' },
    ]);

    const paths = getSpec().paths as unknown as Record<string, Record<string, unknown>>;
    for (const { method, path } of seen) {
      const template = path
        .replace('/customer/7', '/customer/{customerId}')
        .replace('/sq1', '/{serviceQuotaId}');
      assert.ok(paths[template]?.[method.toLowerCase()], `${method} ${template} is in the spec`);
    }
  });
});

test('a numeric customer id of 0 is accepted; empty ids are rejected', async () => {
  await withClient(async (client, seen) => {
    await client.serviceQuotas.getByCustomer(0);
    assert.equal(seen[0].path, '/cdn/serviceQuotas/customer/0');
  });
  const client = new CDNProClient({ host: 'h', user: 'u', secretKey: 'k' });
  assert.throws(() => client.serviceQuotas.getByCustomer(''), /customerId is required/);
  assert.throws(() => client.serviceQuotas.delete(''), /serviceQuotaId is required/);
});

test('the client exposes no wrapper for the removed internal endpoints', () => {
  const client = new CDNProClient({ host: 'h', user: 'u', secretKey: 'k' }) as unknown as Record<string, unknown>;
  assert.equal(client['resourceSummary'], undefined);
  assert.equal(typeof (client['systemConfigs'] as Record<string, unknown>)['get'], 'function');
  assert.equal((client['systemConfigs'] as Record<string, unknown>)['update'], undefined);
});
