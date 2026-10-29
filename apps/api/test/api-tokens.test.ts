import assert from 'node:assert/strict';
import type { ApiTokenSummary, CreatedApiToken } from '@arrowcast/contracts';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { DatabaseConnection } from '../src/db/index.js';
import { apiTokens } from '../src/db/schema.js';
import { loginAdmin } from './helpers.js';

const jwtSecret = 'api-tokens-test-secret-with-at-least-thirty-two-bytes';
const managementUrl = '/api/v1/admin/api-tokens';
const scoringUrl = '/api/scores';
const scoringRequest = { verenigingsnummer: 1241, date: '2026-10-05', starttime: '10:00' };
const missingKeyId = 'a'.repeat(32);

test('only administrators who have changed their password can list, generate or revoke API keys', async (t) => {
  const app = buildApp({ jwtSecret, databasePath: ':memory:' });
  t.after(() => app.close());
  for (const method of ['GET', 'POST', 'DELETE'] as const) {
    const url = method === 'DELETE' ? `${managementUrl}/${missingKeyId}` : managementUrl;
    assert.equal((await app.inject({ method, url })).statusCode, 401);
  }
  const firstLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin' },
  });
  assert.equal(firstLogin.statusCode, 200);
  const firstHeaders = { authorization: `Bearer ${firstLogin.json().token}` };
  for (const method of ['GET', 'POST', 'DELETE'] as const) {
    const response = await app.inject({
      method,
      url: method === 'DELETE' ? `${managementUrl}/${missingKeyId}` : managementUrl,
      headers: firstHeaders,
      ...(method === 'POST' ? { payload: { name: 'Blocked key' } } : {}),
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'PASSWORD_CHANGE_REQUIRED');
  }
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  const createdUser = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/users',
    headers,
    payload: {
      name: 'Manager',
      username: 'manager',
      password: 'initial-manager-password',
      role: 'competition_manager',
    },
  });
  assert.equal(createdUser.statusCode, 201);
  const managerLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'manager', password: 'initial-manager-password' },
  });
  assert.equal(managerLogin.statusCode, 200);
  const changed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/password',
    headers: { authorization: `Bearer ${managerLogin.json().token}` },
    payload: { currentPassword: 'initial-manager-password', newPassword: 'changed-manager-password' },
  });
  assert.equal(changed.statusCode, 200);
  const managerHeaders = { authorization: `Bearer ${changed.json().token}` };
  for (const method of ['GET', 'POST', 'DELETE'] as const) {
    assert.equal(
      (
        await app.inject({
          method,
          url: method === 'DELETE' ? `${managementUrl}/${missingKeyId}` : managementUrl,
          headers: managerHeaders,
          ...(method === 'POST' ? { payload: { name: 'Blocked key' } } : {}),
        })
      ).statusCode,
      403,
    );
  }
  const list = await app.inject({ url: managementUrl, headers });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json(), []);
});

test('API key creation rejects blank names and client-supplied secrets or persistence fields', async (t) => {
  const app = buildApp({ jwtSecret, databasePath: ':memory:' });
  t.after(() => app.close());
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  let client = 1;
  for (const payload of [
    {},
    { name: '' },
    { name: ' \t\n ' },
    { name: 123 },
    { name: 'x'.repeat(101) },
    { name: 'Integration', token: 'chosen-by-the-client' },
    { name: 'Integration', token_hash: 'chosen-by-the-client' },
    { name: 'Integration', id: missingKeyId },
    { name: 'Integration', createdDate: 0 },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: managementUrl,
      headers,
      remoteAddress: `192.0.2.${client++}`,
      payload,
    });
    assert.equal(response.statusCode, 400);
  }
  assert.deepEqual((await app.inject({ url: managementUrl, headers })).json(), []);
});

test('generated API keys are shown only on creation, stored as hashes and authenticate scoring across restarts', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-api-tokens-'));
  const databasePath = join(directory, 'test.sqlite');
  let app = buildApp({ jwtSecret, databasePath });
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  const before = Date.now();
  const response = await app.inject({
    method: 'POST',
    url: managementUrl,
    headers,
    payload: { name: '  Score integration  ' },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['cache-control'], 'no-store');
  const created = response.json<CreatedApiToken>();
  assert.deepEqual(Object.keys(created).sort(), ['createdDate', 'id', 'name', 'token']);
  assert.equal(created.name, 'Score integration');
  assert.match(created.id, /^[0-9a-f]{32}$/);
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(created.createdDate >= before && created.createdDate <= Date.now());
  const otherResponse = await app.inject({
    method: 'POST',
    url: managementUrl,
    headers,
    payload: { name: 'Another integration' },
  });
  assert.equal(otherResponse.statusCode, 201);
  const other = otherResponse.json<CreatedApiToken>();
  assert.match(other.id, /^[0-9a-f]{32}$/);
  assert.notEqual(other.id, created.id);
  assert.match(other.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(other.token, created.token);
  const metadata = [created, other].map(({ id, name, createdDate }) => ({ id, name, createdDate }));
  const listed = await app.inject({ url: managementUrl, headers });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.headers['cache-control'], 'no-store');
  assert.deepEqual(
    listed.json().sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)),
    [...metadata].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const database = new DatabaseConnection(databasePath);
  try {
    const stored = database.db.select().from(apiTokens).all();
    assert.equal(stored.length, 2);
    for (const key of [created, other]) {
      assert.deepEqual(
        stored.find((row) => row.name === key.name),
        {
          id: key.id,
          name: key.name,
          tokenHash: createHash('sha256').update(key.token).digest('hex'),
          createdDate: key.createdDate,
        },
      );
    }
    assert.ok(!JSON.stringify(stored).includes(created.token));
    assert.ok(!JSON.stringify(stored).includes(other.token));
    assert.deepEqual(
      database.db.$client
        .prepare('PRAGMA table_info(api_tokens)')
        .all()
        .map((column) => (column as { name: string }).name)
        .sort(),
      ['created_date', 'id', 'naam', 'token_hash'],
    );
  } finally {
    database.close();
  }

  for (const invalidHeaders of [
    {},
    { authorization: 'Bearer' },
    { authorization: `Basic ${created.token}` },
    { authorization: `Bearer ${created.token} extra` },
    { authorization: `Bearer ${'x'.repeat(43)}` },
    headers,
    { cookie: `arrowcast.scoring=${created.token}; arrowcast.logbook=${created.token}` },
  ]) {
    const denied = await app.inject({ method: 'POST', url: scoringUrl, headers: invalidHeaders });
    assert.equal(denied.statusCode, 401);
  }
  for (const key of [created, other]) {
    const accepted = await app.inject({
      method: 'POST',
      url: scoringUrl,
      headers: { authorization: `Bearer ${key.token}` },
      payload: scoringRequest,
    });
    assert.equal(accepted.statusCode, 400);
    assert.deepEqual(accepted.json(), { message: 'Verkeerde vereniging' });
  }
  assert.equal(
    (await app.inject({ url: managementUrl, headers: { authorization: `Bearer ${created.token}` } })).statusCode,
    401,
  );
  await app.close();
  app = buildApp({ jwtSecret, databasePath });
  const persisted = await app.inject({
    method: 'POST',
    url: scoringUrl,
    headers: { authorization: `Bearer ${created.token}` },
    payload: scoringRequest,
  });
  assert.equal(persisted.statusCode, 400);
  assert.deepEqual(persisted.json(), { message: 'Verkeerde vereniging' });
  const reopenedList = await app.inject({ url: managementUrl, headers });
  assert.equal(reopenedList.statusCode, 200);
  assert.deepEqual(
    reopenedList.json().sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)),
    [...metadata].sort((a, b) => a.name.localeCompare(b.name)),
  );
});

test('revoking an API key removes only its opaque ID and denies its token immediately and after restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-api-revoke-'));
  const databasePath = join(directory, 'test.sqlite');
  let app = buildApp({ jwtSecret, databasePath });
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  const created: CreatedApiToken[] = [];
  for (let index = 0; index < 2; index++) {
    const response = await app.inject({
      method: 'POST',
      url: managementUrl,
      headers,
      payload: { name: 'Same integration name' },
    });
    assert.equal(response.statusCode, 201);
    created.push(response.json<CreatedApiToken>());
  }
  const [revoked, retained] = created as [CreatedApiToken, CreatedApiToken];
  assert.notEqual(revoked.id, retained.id);
  for (const key of created) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: scoringUrl,
          headers: { authorization: `Bearer ${key.token}` },
          payload: scoringRequest,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `${managementUrl}/${revoked.id}`,
        headers: { authorization: `Bearer ${retained.token}` },
      })
    ).statusCode,
    401,
  );
  for (const invalidId of [
    'not-an-id',
    'A'.repeat(32),
    revoked.token,
    createHash('sha256').update(revoked.token).digest('hex'),
    revoked.name,
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: `${managementUrl}/${encodeURIComponent(invalidId)}`,
          headers,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal((await app.inject({ url: managementUrl, headers })).json<ApiTokenSummary[]>().length, 2);
  const response = await app.inject({ method: 'DELETE', url: `${managementUrl}/${revoked.id}`, headers });
  assert.equal(response.statusCode, 204);
  assert.equal(response.body, '');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(
    (await app.inject({ method: 'DELETE', url: `${managementUrl}/${revoked.id}`, headers })).statusCode,
    204,
  );
  const retainedSummary: ApiTokenSummary = {
    id: retained.id,
    name: retained.name,
    createdDate: retained.createdDate,
  };
  assert.deepEqual((await app.inject({ url: managementUrl, headers })).json(), [retainedSummary]);
  for (const restart of [false, true]) {
    if (restart) {
      await app.close();
      app = buildApp({ jwtSecret, databasePath });
    }
    assert.equal(
      (await app.inject({ method: 'POST', url: scoringUrl, headers: { authorization: `Bearer ${revoked.token}` } }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: scoringUrl,
          headers: { authorization: `Bearer ${retained.token}` },
          payload: scoringRequest,
        })
      ).statusCode,
      400,
    );
    assert.deepEqual((await app.inject({ url: managementUrl, headers })).json(), [retainedSummary]);
  }
  const database = new DatabaseConnection(databasePath);
  try {
    assert.deepEqual(database.db.select().from(apiTokens).all(), [
      { ...retainedSummary, tokenHash: createHash('sha256').update(retained.token).digest('hex') },
    ]);
  } finally {
    database.close();
  }
});
