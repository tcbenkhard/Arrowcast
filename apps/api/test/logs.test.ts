import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { buildApp } from '../src/app.js';
import { logRoutes } from '../src/modules/logs/routes.js';
import { loginAdmin } from './helpers.js';

test('log sources are allowlisted, uncached and return literal text; read failures return 503', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const read: string[] = [];
  await app.register(logRoutes, {
    readLogs: async (source) => {
      read.push(source);
      if (source === 'updates') throw new Error('private filesystem details');
      return `${source}: <script>example</script>\n`;
    },
  });
  for (const source of ['frontend', 'backend']) {
    const response = await app.inject(`/logs/${source}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { text: `${source}: <script>example</script>\n` });
  }
  assert.equal((await app.inject('/logs/ssh.service')).statusCode, 400);
  assert.equal((await app.inject('/logs/--all')).statusCode, 400);
  const unavailable = await app.inject('/logs/updates');
  assert.equal(unavailable.statusCode, 503);
  assert.ok(!unavailable.body.includes('private filesystem'));
  assert.deepEqual(read, ['frontend', 'backend', 'updates']);
});

test('logs require an administrator who has completed password setup', async (t) => {
  const app = buildApp({ jwtSecret: 'logs-test-secret-with-at-least-thirty-two-bytes', databasePath: ':memory:' });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/v1/admin/logs/backend')).statusCode, 401);
  const initial = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin' },
  });
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/admin/logs/backend',
        headers: { authorization: `Bearer ${initial.json().token}` },
      })
    ).statusCode,
    403,
  );
  const login = await loginAdmin(app);
  const headers = { authorization: `Bearer ${login.json().token}` };
  assert.equal((await app.inject({ url: '/api/v1/admin/logs/unknown', headers })).statusCode, 400);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/users',
    headers,
    payload: { name: 'Manager', username: 'manager', password: 'initial-password', role: 'competition_manager' },
  });
  assert.equal(created.statusCode, 201);
  const manager = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'manager', password: 'initial-password' },
  });
  const changed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers: { authorization: `Bearer ${manager.json().token}` },
    payload: { currentPassword: 'initial-password', newPassword: 'manager-changed-password' },
  });
  assert.equal(changed.statusCode, 200);
  for (const source of ['frontend', 'backend', 'updates']) {
    assert.equal(
      (
        await app.inject({
          url: `/api/v1/admin/logs/${source}`,
          headers: { authorization: `Bearer ${changed.json().token}` },
        })
      ).statusCode,
      403,
    );
  }
});
