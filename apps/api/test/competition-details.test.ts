import { loginAdmin } from './helpers.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('competition details validate, persist and preserve assigned lanes', async () => {
  const app = buildApp({ jwtSecret: 'competition-details-secret-at-least-thirty-two-bytes', databasePath: ':memory:' });
  try {
    const login = await loginAdmin(app);
    const headers = { authorization: `Bearer ${login.json().token}` };
    const range = (await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers,
      payload: { name: 'Details range', supportedDistancesMeters: [18], lanes: [{ number: 1 }] } })).json();
    const created = (await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers,
      payload: { name: 'Original', date: '2026-12-01', startingTime: '09:00', endingTime: '12:00', rangeId: range.id,
        lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }] } })).json();
    const url = `/api/v1/admin/competitions/${created.id}`;
    const initialLanes = (await app.inject({ url: `${url}/lanes`, headers })).json();
    const payload = { name: ' Updated ', date: '2026-12-02', startingTime: '10:00', endingTime: '13:00',
      defaultTargetType: null, numberOfRounds: 12, arrowsPerRound: 6 };
    for (const method of ['PATCH', 'DELETE'] as const) {
      assert.equal((await app.inject({ method, url, ...(method === 'PATCH' ? { payload } : {}) })).statusCode, 401);
      assert.equal((await app.inject({ method, url: '/api/v1/admin/competitions/missing', headers,
        ...(method === 'PATCH' ? { payload } : {}) })).statusCode, 404);
    }
    for (const invalid of [{ name: ' ' }, { date: '2026-02-30' }, { date: '0000-01-01' }, { endingTime: '09:00' },
      { startingTime: '24:00' }, { defaultTargetType: 'Missing' }, { numberOfRounds: 0 }, { arrowsPerRound: 37 },
      { status: 'Closed' }, { rangeId: 'missing' }]) {
      const response = await app.inject({ method: 'PATCH', url, headers, payload: { ...payload, ...invalid } });
      assert.equal(response.statusCode, 400, response.body);
    }
    assert.equal((await app.inject({ url, headers })).json().name, 'Original');
    await app.inject({ method: 'POST', url: '/api/v1/admin/target-types', headers, payload: { name: 'Edited target' } });
    const response = await app.inject({ method: 'PATCH', url, headers, payload: { ...payload, defaultTargetType: ' Edited target ' } });
    assert.equal(response.statusCode, 200, response.body);
    const { lanes: _lanes, ...originalDetails } = created;
    assert.deepEqual(response.json(), { ...originalDetails, ...payload, name: 'Updated', defaultTargetType: 'Edited target' });
    assert.deepEqual((await app.inject({ url, headers })).json(), response.json());
    assert.deepEqual((await app.inject({ url: `${url}/lanes`, headers })).json(), initialLanes);
    const other = (await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers,
      payload: { name: 'New range', supportedDistancesMeters: [25], lanes: [{ number: 3 }, { number: 4 }] } })).json();
    const validLane = { laneId: other.lanes[0].id, distanceMeters: 25 };
    const updatedDetails = { ...payload, defaultTargetType: 'Edited target' };
    for (const invalid of [
      { rangeId: other.id }, { rangeId: other.id, lanes: [] },
      { rangeId: other.id, lanes: [validLane, validLane] },
      { rangeId: other.id, lanes: [{ ...validLane, distanceMeters: 18 }] },
      { rangeId: other.id, lanes: [{ laneId: range.lanes[0].id, distanceMeters: 25 }] },
      { rangeId: range.id, lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }] },
    ]) {
      const failed = await app.inject({ method: 'PATCH', url, headers, payload: { ...updatedDetails, ...invalid } });
      assert.equal(failed.statusCode, 400, failed.body);
      assert.equal((await app.inject({ url, headers })).json().range.id, range.id);
      assert.deepEqual((await app.inject({ url: `${url}/lanes`, headers })).json(), initialLanes);
    }
    const moved = await app.inject({ method: 'PATCH', url, headers, payload: { ...updatedDetails, rangeId: other.id, lanes: [validLane] } });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal(moved.json().range.id, other.id);
    assert.deepEqual((await app.inject({ url: `${url}/lanes`, headers })).json(), [{ ...validLane, number: 3, targetType: 'Edited target', numberOfTargets: 1 }]);
    assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 204);
    assert.equal((await app.inject({ url, headers })).statusCode, 404);
    assert.deepEqual((await app.inject({ url: '/api/v1/admin/competitions', headers })).json(), []);
    assert.equal((await app.inject({ url: '/api/v1/admin/ranges', headers })).json()[0].id, range.id);
  } finally { await app.close(); }
});
