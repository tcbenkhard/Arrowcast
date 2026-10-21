import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loginAdmin } from './helpers.js';

test('network management requires admin authentication and validates input', async (t) => {
  const app = buildApp({ jwtSecret: 'test-secret-with-at-least-thirty-two-bytes', databasePath: ':memory:' });
  t.after(() => app.close());
  for (const method of ['GET', 'POST'] as const) {
    assert.equal((await app.inject({ method, url: '/api/v1/admin/network' })).statusCode, 401);
  }
  const login = await loginAdmin(app);
  const headers = { authorization: `Bearer ${login.json().token}` };
  const status = await app.inject({ url: '/api/v1/admin/network', headers });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().mode, 'disabled');
  for (const payload of [
    { ssid: '', password: '' },
    { ssid: 'LAN', password: 'secret', command: 'reboot' },
    { ssid: 'LAN\ncommand', password: '' },
    { ssid: 'LAN', password: 'bad\npassword' },
  ]) {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/admin/network', headers, payload })).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/network',
        headers,
        payload: { ssid: 'Club Wi-Fi', password: 'test-password' },
      })
    ).statusCode,
    503,
  );
});
