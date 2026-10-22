import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const password = 'admin';
const config = {
  jwtSecret: 'test-secret-with-at-least-thirty-two-bytes',
  databasePath: ':memory:',
};

test('login issues a JWT that grants access to the protected admin endpoint', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.headers['cache-control'], 'no-store');
  const { token, expiresAt } = login.json();
  assert.equal(token.split('.').length, 3);
  assert.ok(Math.abs(expiresAt - (Date.now() + 24 * 3600000)) < 5000);
  const me = await app.inject({ url: '/api/v1/admin/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), {
    username: 'admin',
    name: 'Administrator',
    role: 'admin',
    language: 'nl',
    expiresAt,
    forceChangePassword: true,
  });
});

test('invalid credentials have the same generic response', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  for (const payload of [
    { username: 'admin', password: 'wrong' },
    { username: 'unknown', password },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { message: 'Gebruikersnaam of wachtwoord is onjuist.' });
  }
});

test('invalid login bodies are rejected before authentication', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  for (const payload of [
    {},
    { username: 123, password },
    { username: 'admin', password: '' },
    { username: 'admin', password, role: 'admin' },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
    assert.equal(response.statusCode, 400);
  }
});

test('admin rejects missing, forged, expired and inappropriate tokens', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  await app.ready();
  const now = Math.floor(Date.now() / 1000);
  function sign(changes: Record<string, unknown>, secret = config.jwtSecret) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'admin',
        role: 'admin',
        iss: 'arrowcast',
        aud: 'arrowcast-admin',
        exp: now + 3600,
        ...changes,
      }),
    ).toString('base64url');
    return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
  }
  for (const token of [
    null,
    'not-a-jwt',
    sign({}, 'wrong-secret'),
    sign({ exp: now - 1 }),
    sign({ role: 'scorer' }),
    sign({ sub: 'someone-else' }),
    sign({ iss: 'other-app' }),
    sign({ aud: 'scoring' }),
    sign({ exp: undefined }),
  ]) {
    const response = await app.inject({
      url: '/api/v1/admin/me',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().username, undefined);
  }
});

test('login limits brute force attempts per IP', async (t) => {
  const app = buildApp(config);
  t.after(() => app.close());
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    assert.equal(response.statusCode, 401);
  }
  const blocked = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password },
  });
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers['retry-after']);
});

test('first login blocks management until password change and revokes all earlier tokens', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-password-'));
  const persistentConfig = { ...config, databasePath: join(directory, 'auth.sqlite') };
  let app = buildApp(persistentConfig);
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin' },
  });
  assert.equal(login.json().forceChangePassword, true);
  const secondLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin' },
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  for (const url of ['/api/v1/admin/ranges', '/api/v1/admin/updates', '/api/v1/admin/participants/import']) {
    const blocked = await app.inject({ url, headers });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().code, 'PASSWORD_CHANGE_REQUIRED');
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/password',
        payload: { currentPassword: 'admin', newPassword: 'new-pass' },
      })
    ).statusCode,
    401,
  );
  for (const payload of [
    { currentPassword: 'wrong', newPassword: 'new-pass' },
    { currentPassword: 'admin', newPassword: '1234567' },
    { currentPassword: 'admin', newPassword: '        ' },
  ]) {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/admin/password', headers, payload })).statusCode,
      400,
    );
  }
  const changed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers,
    payload: { currentPassword: 'admin', newPassword: 'new-pass' },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().forceChangePassword, false);
  for (const token of [login.json().token, secondLogin.json().token]) {
    assert.equal(
      (await app.inject({ url: '/api/v1/admin/me', headers: { authorization: `Bearer ${token}` } })).statusCode,
      401,
    );
  }
  const newHeaders = { authorization: `Bearer ${changed.json().token}` };
  assert.equal((await app.inject({ url: '/api/v1/admin/ranges', headers: newHeaders })).statusCode, 200);
  const reuse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers: newHeaders,
    payload: { currentPassword: 'new-pass', newPassword: 'new-pass' },
  });
  assert.equal(reuse.statusCode, 400);
  await app.close();
  app = buildApp(persistentConfig);
  const restored = await app.inject({ url: '/api/v1/admin/me', headers: newHeaders });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().forceChangePassword, false);
  const oldPassword = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin' },
  });
  assert.equal(oldPassword.statusCode, 401);
  const newLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'new-pass' },
  });
  assert.equal(newLogin.statusCode, 200);
  assert.equal(newLogin.json().forceChangePassword, false);
});
