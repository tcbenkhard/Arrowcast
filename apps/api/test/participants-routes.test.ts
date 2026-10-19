import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import Fastify from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { participants } from '../src/db/schema.js';
import { participantRoutes } from '../src/modules/participants/routes.js';

const url = '/participants/import';
const data = { season: '2026-2027', pages: 1,
  clubs: [{ clubNumber: '0012', name: 'Club' }],
  participants: [{ federationNumber: '000123', name: 'Alex', clubNumber: '0012' }],
};

test('import endpoints require admin authentication', async () => {
  const app = buildApp({ jwtSecret: 'participant-import-test-secret-at-least-32-bytes', databasePath: ':memory:' });
  try {
    for (const method of ['GET', 'POST'] as const) {
      assert.equal((await app.inject({ method, url: `/api/v1/admin${url}` })).statusCode, 401);
      assert.equal((await app.inject({ method, url: '/api/v1/admin/competitions/test/participants' })).statusCode, 401);
    }
    for (const path of ['/participants?q=Alex', '/clubs', '/bow-types']) {
      assert.equal((await app.inject({ url: `/api/v1/admin${path}` })).statusCode, 401);
    }
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/admin/competitions/test/participants', payload: { participantIds: ['test'] } })).statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'admin' } });
    const status = await app.inject({ url: `/api/v1/admin${url}`, headers: { authorization: `Bearer ${login.json().token}` } });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().status, 'idle');
    assert.equal(status.headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});

test('background import reports progress, blocks duplicate starts and saves results', async () => {
  const database = openDatabase(':memory:');
  const app = Fastify();
  let complete!: () => void;
  const gate = new Promise<void>((resolve) => { complete = resolve; });
  let calls = 0;
  await app.register(participantRoutes, { db: database.db, scrape: async (progress) => {
    calls++; progress('Regio 101 verwerkt'); await gate; return data;
  } });
  try {
    assert.equal((await app.inject({ method: 'POST', url })).statusCode, 202);
    const running = (await app.inject({ url })).json();
    assert.equal(running.status, 'running');
    assert.equal(running.progress, 'Regio 101 verwerkt');
    assert.equal((await app.inject({ method: 'POST', url })).statusCode, 409);
    assert.equal(calls, 1);
    complete(); await setImmediate();
    const result = (await app.inject({ url })).json();
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.result, { season: '2026-2027', participants: 1, clubs: 1 });
    assert.equal(database.db.select().from(participants).all().length, 1);
  } finally { complete(); await app.close(); database.close(); }
});

test('a failed import leaves the database unchanged and allows retry', async () => {
  const database = openDatabase(':memory:');
  const app = Fastify();
  let calls = 0;
  await app.register(participantRoutes, { db: database.db, scrape: async () => {
    if (++calls === 1) throw new Error('Source unavailable');
    return data;
  } });
  try {
    assert.equal((await app.inject({ method: 'POST', url })).statusCode, 202);
    assert.equal((await app.inject({ url })).json().status, 'failed');
    assert.equal(database.db.select().from(participants).all().length, 0);
    assert.equal((await app.inject({ method: 'POST', url })).statusCode, 202);
    await setImmediate();
    assert.equal((await app.inject({ url })).json().status, 'completed');
  } finally { await app.close(); database.close(); }
});
