import { loginAdmin } from './helpers.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('update status and installation require an administrator', async (t) => {
  const app = buildApp({ jwtSecret: 'test-secret-with-at-least-thirty-two-bytes', databasePath: ':memory:' });
  t.after(() => app.close());
  for (const method of ['GET', 'POST'] as const) {
    const response = await app.inject({ method, url: '/api/v1/admin/updates' });
    assert.equal(response.statusCode, 401);
  }
  const login = await loginAdmin(app);
  const headers = { authorization: `Bearer ${login.json().token}` };
  const response = await app.inject({ url: '/api/v1/admin/updates', headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'disabled');
  const install = await app.inject({ method: 'POST', url: '/api/v1/admin/updates', headers });
  assert.equal(install.statusCode, 503);
});
