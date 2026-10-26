import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { ScoringOriginService } from '../src/modules/public-access/scoring-origin-service.js';
import { loginAdmin } from './helpers.js';

test('hotspot QR address overrides public settings without consulting or changing them', async () => {
  const publicState = { code: 200, body: { origin: 'https://scores.club.nl' } };
  for (const mode of ['wifi', 'hotspot', 'ethernet', 'wifi']) {
    let publicReads = 0;
    const result = await new ScoringOriginService(
      { statusIfAvailable: async () => ({ code: 200, body: { mode } }) },
      {
        status: async () => {
          publicReads++;
          return publicState;
        },
      },
    ).origin();
    assert.deepEqual(
      result,
      mode === 'hotspot' ? { code: 200, body: { origin: 'http://10.42.0.1', hotspot: true } } : publicState,
    );
    assert.equal(publicReads, mode === 'hotspot' ? 0 : 1);
    assert.equal(publicState.body.origin, 'https://scores.club.nl');
  }
  const result = await new ScoringOriginService(
    { statusIfAvailable: async () => ({ code: 200, body: { mode: 'hotspot' } }) },
    {
      status: async () => {
        throw new Error('Public broker offline');
      },
    },
  ).origin();
  assert.equal(result.body.origin, 'http://10.42.0.1');
});

test('unknown Pi network state prevents printing QR codes with a stale club address', async () => {
  for (const networkStatus of [
    async () => ({ code: 200, body: { mode: 'starting' } }),
    async () => ({ code: 503, body: {} }),
    async () => {
      throw new Error('Network broker unavailable');
    },
  ]) {
    const result = await new ScoringOriginService(
      { statusIfAvailable: networkStatus },
      {
        status: async () => {
          throw new Error('Must not consult public settings');
        },
      },
    ).origin();
    assert.equal(result.code, 503);
    assert.equal('origin' in result.body, false);
  }
  assert.deepEqual(
    await new ScoringOriginService(
      { statusIfAvailable: async () => null },
      { status: async () => ({ code: 200, body: { origin: null } }) },
    ).origin(),
    { code: 200, body: { origin: null } },
  );
});

test('proxy rate limits distinguish visitors and reject forwarded headers from direct clients', async (t) => {
  const app = buildApp({ jwtSecret: 'test-secret-with-at-least-thirty-two-bytes', databasePath: ':memory:' });
  t.after(() => app.close());
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.1' },
      payload: { username: 'unknown', password: 'invalid' },
    });
    assert.equal(response.statusCode, attempt < 5 ? 401 : 429);
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.2' },
        payload: { username: 'unknown', password: 'invalid' },
      })
    ).statusCode,
    401,
  );
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '203.0.113.9',
      headers: { 'x-forwarded-for': `198.51.100.${attempt}` },
      payload: { username: 'unknown', password: 'invalid' },
    });
    assert.equal(response.statusCode, attempt < 5 ? 401 : 429);
  }
});

test('public HTTPS settings require an administrator; QR origin is readable by competition managers', async (t) => {
  const app = buildApp({ jwtSecret: 'test-secret-with-at-least-thirty-two-bytes', databasePath: ':memory:' });
  t.after(() => app.close());
  for (const method of ['GET', 'POST'] as const) {
    assert.equal((await app.inject({ method, url: '/api/v1/admin/public-access' })).statusCode, 401);
  }
  assert.equal((await app.inject('/api/v1/admin/scoring-origin')).statusCode, 401);
  const login = await loginAdmin(app);
  const headers = { authorization: `Bearer ${login.json().token}` };
  const status = await app.inject({ url: '/api/v1/admin/public-access', headers });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().available, false);
  const origin = await app.inject({ url: '/api/v1/admin/scoring-origin', headers });
  assert.deepEqual(origin.json(), { origin: null });
  for (const payload of [
    { enabled: true },
    { enabled: 'true', domain: 'scores.club.nl', email: 'admin@club.nl' },
    { enabled: true, domain: 'scores.club.nl', email: 'admin@club.nl', command: 'reboot' },
  ]) {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/admin/public-access', headers, payload })).statusCode,
      400,
    );
  }
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/users',
    headers,
    payload: { username: 'manager', name: 'Manager', role: 'competition_manager', password: 'initial-password' },
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
    payload: { currentPassword: 'initial-password', newPassword: 'manager-new-password' },
  });
  const managerHeaders = { authorization: `Bearer ${changed.json().token}` };
  assert.equal((await app.inject({ url: '/api/v1/admin/scoring-origin', headers: managerHeaders })).statusCode, 200);
  for (const method of ['GET', 'POST'] as const) {
    assert.equal(
      (await app.inject({ method, url: '/api/v1/admin/public-access', headers: managerHeaders })).statusCode,
      403,
    );
  }
});
