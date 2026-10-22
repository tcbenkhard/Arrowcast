import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loginAdmin } from './helpers.js';

const config = { jwtSecret: 'users-test-secret-with-at-least-thirty-two-bytes', databasePath: ':memory:' };
const initial = {
  name: 'Competition User',
  username: 'manager',
  password: 'initial-password',
  role: 'competition_manager',
};

test('the built-in admin cannot be edited through user management but can change its own password', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  const profile = { name: 'Administrator', username: 'admin', role: 'admin' };
  const originalUsers = (await app.inject({ url: '/api/v1/admin/users', headers })).json();
  const originalAdmin = originalUsers.find((user: { username: string }) => user.username === 'admin');
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: { ...initial, role: 'admin' } }))
      .statusCode,
    201,
  );
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: initial.username, password: initial.password },
  });
  const onboarded = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers: { authorization: `Bearer ${login.json().token}` },
    payload: { currentPassword: initial.password, newPassword: 'other-admin-password' },
  });
  assert.equal(onboarded.statusCode, 200);
  for (const token of [admin.json().token, onboarded.json().token]) {
    for (const changes of [
      {},
      { name: 'Changed Administrator' },
      { username: 'renamed-admin' },
      { role: 'competition_manager' },
      { language: 'en' },
      { password: 'forbidden-reset-password' },
    ]) {
      const edit = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/users/admin',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...profile, ...changes },
      });
      assert.equal(edit.statusCode, 403);
      assert.equal(edit.json().message, 'The admin account cannot be edited.');
    }
  }
  assert.deepEqual(
    (await app.inject({ url: '/api/v1/admin/users', headers }))
      .json()
      .find((user: { username: string }) => user.username === 'admin'),
    originalAdmin,
  );
  const changed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers,
    payload: { currentPassword: 'test-admin-password', newPassword: 'admin-changed-own-password' },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().forceChangePassword, false);
});

test('users are administrator-only and new users must change their password before managing competitions', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: initial });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json(), {
    name: initial.name,
    username: initial.username,
    role: initial.role,
    language: 'nl',
    forceChangePassword: true,
  });
  const listed = await app.inject({ url: '/api/v1/admin/users', headers });
  assert.equal(listed.json().length, 2);
  assert.ok(
    listed
      .json()
      .every((user: object) => !('password' in user) && !('passwordHash' in user) && !('sessionVersion' in user)),
  );
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: initial.username, password: initial.password },
  });
  assert.equal(login.statusCode, 200);
  const freshHeaders = { authorization: `Bearer ${login.json().token}` };
  const blocked = await app.inject({ url: '/api/v1/admin/competitions', headers: freshHeaders });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().code, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers: freshHeaders,
    payload: { currentPassword: initial.password, newPassword: 'manager-password' },
  });
  assert.equal(changed.statusCode, 200);
  const managerHeaders = { authorization: `Bearer ${changed.json().token}` };
  for (const url of ['/competitions', '/ranges', '/target-types', '/me']) {
    assert.equal((await app.inject({ url: `/api/v1/admin${url}`, headers: managerHeaders })).statusCode, 200, url);
  }
  for (const url of ['/users', '/updates', '/network', '/participants/import']) {
    assert.equal((await app.inject({ url: `/api/v1/admin${url}`, headers: managerHeaders })).statusCode, 403, url);
    assert.equal(
      (await app.inject({ method: 'POST', url: `/api/v1/admin${url}`, headers: managerHeaders, payload: initial }))
        .statusCode,
      403,
      url,
    );
  }
  for (const [method, url, payload] of [
    ['POST', '/ranges', {}],
    ['POST', '/target-types', { name: 'Forbidden' }],
    ['DELETE', '/target-types', { names: ['Forbidden'] }],
    ['PUT', '/users/admin', initial],
    ['DELETE', '/users/admin', {}],
  ] as const) {
    assert.equal(
      (await app.inject({ method, url: `/api/v1/admin${url}`, headers: managerHeaders, payload })).statusCode,
      403,
    );
  }
  assert.equal((await app.inject({ url: '/api/v1/admin/users' })).statusCode, 401);
});

test('removing users revokes access, requires an administrator and preserves the last administrator', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/admin/users/admin' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/admin/users/admin', headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/admin/users/missing', headers })).statusCode, 404);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: initial })).statusCode,
    201,
  );
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: initial.username, password: initial.password },
  });
  const removed = await app.inject({ method: 'DELETE', url: '/api/v1/admin/users/manager', headers });
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().sessionRevoked, false);
  assert.equal(
    (await app.inject({ url: '/api/v1/admin/me', headers: { authorization: `Bearer ${login.json().token}` } }))
      .statusCode,
    401,
  );
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/admin/users/manager', headers })).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: initial.username, password: initial.password },
      })
    ).statusCode,
    401,
  );
  assert.equal((await app.inject({ url: '/api/v1/admin/users', headers })).json().length, 1);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: { ...initial, role: 'admin' } }))
      .statusCode,
    201,
  );
  // Reusing the username must not revive tokens from the removed account.
  assert.equal(
    (await app.inject({ url: '/api/v1/admin/me', headers: { authorization: `Bearer ${login.json().token}` } }))
      .statusCode,
    401,
  );
  const protectedAdmin = await app.inject({ method: 'DELETE', url: '/api/v1/admin/users/admin', headers });
  assert.equal(protectedAdmin.statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/users/admin',
        headers,
        payload: { name: 'Administrator', username: 'renamed-admin', role: 'admin' },
      })
    ).statusCode,
    403,
  );
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers })).statusCode, 200);
  // Other administrators remain removable.
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/admin/users/manager', headers })).statusCode, 200);
});

test('user validation, editing, promotion, password resets and last administrator protection', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  for (const payload of [
    { ...initial, name: ' ' },
    { ...initial, username: ' ' },
    { ...initial, password: '        ' },
    { ...initial, password: 'short' },
    { ...initial, role: 'scorer' },
    { ...initial, forceChangePassword: false },
  ]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload })).statusCode, 400);
  }
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: initial })).statusCode,
    201,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: initial })).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/users/admin',
        headers,
        payload: { name: 'Admin', username: 'admin', role: 'competition_manager' },
      })
    ).statusCode,
    403,
  );
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: initial.username, password: initial.password },
  });
  const changed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers: { authorization: `Bearer ${login.json().token}` },
    payload: { currentPassword: initial.password, newPassword: 'manager-password' },
  });
  const managerHeaders = { authorization: `Bearer ${changed.json().token}` };
  const edit = { name: 'Updated User', username: 'manager', role: 'competition_manager' };
  const renamed = await app.inject({ method: 'PUT', url: '/api/v1/admin/users/manager', headers, payload: edit });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().user.forceChangePassword, false);
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers: managerHeaders })).json().name, 'Updated User');
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/users/manager',
        headers,
        payload: { ...edit, username: 'admin' },
      })
    ).statusCode,
    409,
  );
  const promoted = await app.inject({
    method: 'PUT',
    url: '/api/v1/admin/users/manager',
    headers,
    payload: { ...edit, role: 'admin' },
  });
  assert.equal(promoted.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers: managerHeaders })).statusCode, 401);
  const promotedLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'manager', password: 'manager-password' },
  });
  const promotedHeaders = { authorization: `Bearer ${promotedLogin.json().token}` };
  assert.equal((await app.inject({ url: '/api/v1/admin/users', headers: promotedHeaders })).statusCode, 200);
  const reset = await app.inject({
    method: 'PUT',
    url: '/api/v1/admin/users/manager',
    headers,
    payload: { ...edit, username: 'renamed-manager', role: 'admin', password: 'reset-password' },
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().user.forceChangePassword, true);
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers: promotedHeaders })).statusCode, 401);
  const resetLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'renamed-manager', password: 'reset-password' },
  });
  assert.equal(resetLogin.statusCode, 200);
  assert.equal(resetLogin.json().forceChangePassword, true);
  const resetChanged = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers: { authorization: `Bearer ${resetLogin.json().token}` },
    payload: { currentPassword: 'reset-password', newPassword: 'new-manager-password' },
  });
  assert.equal(resetChanged.statusCode, 200);
  const selfHeaders = { authorization: `Bearer ${resetChanged.json().token}` };
  const selfEdit = await app.inject({
    method: 'PUT',
    url: '/api/v1/admin/users/renamed-manager',
    headers: selfHeaders,
    payload: { name: 'Updated User', username: 'renamed-manager', role: 'competition_manager' },
  });
  assert.equal(selfEdit.statusCode, 200);
  assert.equal(selfEdit.json().sessionRevoked, true);
  assert.equal((await app.inject({ url: '/api/v1/admin/users', headers: selfHeaders })).statusCode, 401);
});
