import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// Feature tests complete the same first-login setup as a real installation.
export async function loginAdmin(app: FastifyInstance) {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin' },
  });
  assert.equal(login.statusCode, 200);
  if (!login.json().forceChangePassword) return login;
  const changed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers: { authorization: `Bearer ${login.json().token}` },
    payload: { currentPassword: 'admin', newPassword: 'test-admin-password' },
  });
  assert.equal(changed.statusCode, 200);
  return changed;
}
