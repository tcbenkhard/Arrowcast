import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('competition defaults persist, initialize lanes, allow overrides and protect referenced targets', async () => {
  const app = buildApp({ jwtSecret: 'default-target-test-secret-at-least-thirty-two-bytes', databasePath: ':memory:' });
  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'admin' } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    for (const name of ['Default face', 'Other face']) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/target-types', headers, payload: { name } })).statusCode, 201);
    }
    const range = (await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers,
      payload: { name: 'Default range', supportedDistancesMeters: [18], lanes: [{ number: 1 }, { number: 2 }] } })).json();
    const payload = { name: 'Default competition', date: '2026-12-01', startingTime: '09:00', endingTime: '12:00', rangeId: range.id,
      lanes: range.lanes.map((lane: { id: string }) => ({ laneId: lane.id, distanceMeters: 18 })) };
    for (const defaultTargetType of ['Missing face', ' ', 'x'.repeat(101)]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers,
        payload: { ...payload, defaultTargetType } })).statusCode, 400);
    }
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers,
      payload: { ...payload, defaultTargetType: ' Default face ' } });
    assert.equal(response.statusCode, 201, response.body);
    const competition = response.json();
    assert.equal(competition.defaultTargetType, 'Default face');
    const url = `/api/v1/admin/competitions/${competition.id}`;
    assert.equal((await app.inject({ url, headers })).json().defaultTargetType, 'Default face');
    const laneList = (await app.inject({ url: `${url}/lanes`, headers })).json();
    assert.deepEqual(laneList.map((lane: { targetType: string }) => lane.targetType), ['Default face', 'Default face']);
    for (const lane of laneList) {
      assert.equal((await app.inject({ method: 'PUT', url: `${url}/lanes/${lane.laneId}`, headers,
        payload: { targetType: 'Other face', numberOfTargets: 1 } })).statusCode, 200);
    }
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/admin/target-types', headers,
      payload: { names: ['Default face'] } })).statusCode, 409);
    assert.equal((await app.inject({ url, headers })).json().defaultTargetType, 'Default face');
    const withoutDefault = await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers, payload });
    assert.equal(withoutDefault.statusCode, 201);
    assert.equal(withoutDefault.json().defaultTargetType, null);
    const explicitNull = await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers,
      payload: { ...payload, defaultTargetType: null } });
    assert.equal(explicitNull.statusCode, 201);
    assert.equal(explicitNull.json().defaultTargetType, null);
  } finally { await app.close(); }
});
