import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { read, utils } from 'xlsx';
import { buildApp } from '../src/app.js';
import { DatabaseConnection } from '../src/db/index.js';
import {
  clubs,
  competitionParticipants,
  competitions,
  logbookEntries,
  logbookPins,
  participants,
  scorecards,
} from '../src/db/schema.js';
import { loginAdmin } from './helpers.js';

const base = '/api/v1/scoring/logbook';
const jwtSecret = 'logbook-test-secret-with-at-least-thirty-two-bytes';

test('logbook protects personal scores, resumes drafts and aggregates only completed independent entries', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-logbook-'));
  const databasePath = join(directory, 'test.sqlite');
  const fixture = new DatabaseConnection(databasePath);
  fixture.db.insert(clubs).values({ clubNumber: 'club', name: 'Club' }).run();
  fixture.db
    .insert(participants)
    .values([
      { id: 'a', name: 'Alice', federationNumber: '1', clubNumber: 'club' },
      { id: 'b', name: 'Bob', federationNumber: '2', clubNumber: 'club' },
    ])
    .run();
  const app = buildApp({ jwtSecret, databasePath });
  let restarted: ReturnType<typeof buildApp> | undefined;
  t.after(async () => {
    await app.close();
    await restarted?.close();
    fixture.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const admin = { authorization: `Bearer ${(await loginAdmin(app)).json().token}` };
  const people = (await app.inject({ url: `${base}/participants?q=Ali` })).json();
  assert.deepEqual((await app.inject({ url: `${base}/participants` })).json(), []);
  assert.deepEqual(people, [{ id: 'a', name: 'Alice', clubName: 'Club', hasPin: false }]);
  assert.equal((await app.inject({ url: '/api/v1/admin/logbook' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/admin/logbook/export' })).statusCode, 401);
  const exportRows = async (language = 'nl') => {
    const response = await app.inject({ url: `/api/v1/admin/logbook/export?language=${language}`, headers: admin });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/vnd.ms-excel');
    assert.equal(response.headers['content-disposition'], 'attachment; filename="scorelogboek.xls"');
    assert.equal(response.rawPayload.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
    const workbook = read(response.rawPayload, { type: 'buffer' });
    return utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1 });
  };
  const exportHeaders = ['Naam', 'Gemiddelde score', 'Gemiddelde per pijl', 'Hoogste score'];
  assert.deepEqual(await exportRows(), [exportHeaders]);
  const summary = async () => (await app.inject({ url: '/api/v1/admin/logbook', headers: admin })).json();
  assert.deepEqual(await summary(), []);
  assert.equal((await app.inject({ url: `${base}/context` })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: 'POST', url: `${base}/restart`, headers: { 'x-arrowcast-scoring': '1' } })).statusCode,
    401,
  );
  const arrows = Array.from({ length: 10 }, () => ['10', '9', 'M']);
  const payload = { entryId: 'unknown', rounds: arrows, expectedVersion: 0, finish: true };
  assert.equal(
    (await app.inject({ method: 'PUT', url: `${base}/entry`, headers: { 'x-arrowcast-scoring': '1' }, payload }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `${base}/authenticate`,
        payload: { participantId: 'a', pin: '1234', createPin: true },
      })
    ).statusCode,
    403,
  );

  let ip = 1;
  const authenticate = (participantId: string, pin: string, createPin: boolean, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: `${base}/authenticate`,
      remoteAddress: `10.0.0.${ip++}`,
      headers: { 'x-arrowcast-scoring': '1', ...(cookie ? { cookie } : {}) },
      payload: { participantId, pin, createPin },
    });
  assert.equal((await authenticate('a', 'abc', true)).statusCode, 400);
  const login = await authenticate('a', '1234', true);
  assert.equal(login.statusCode, 200, login.body);
  const publicEntryFields = ['completedAt', 'createdAt', 'id', 'participantId', 'rounds', 'total', 'version'];
  assert.deepEqual(Object.keys(login.json().entry).sort(), publicEntryFields);
  payload.entryId = login.json().entry.id;
  const cookie = login.headers['set-cookie']!.toString().split(';')[0]!;
  const headers = { cookie, 'x-arrowcast-scoring': '1' };
  assert.match(login.headers['set-cookie']!.toString(), /HttpOnly/);
  assert.match(fixture.db.select().from(logbookPins).get()!.pinHash, /^scrypt\$/);
  assert.equal((await authenticate('a', '4321', true)).statusCode, 409);
  assert.equal((await authenticate('a', '0000', false)).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `${base}/entry`,
        headers: { ...headers, 'sec-fetch-site': 'cross-site' },
        payload,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: 'PUT', url: `${base}/entry`, headers, payload: { ...payload, participantId: 'b' } }))
      .statusCode,
    400,
  );
  for (const rounds of [
    arrows.slice(1),
    [...arrows.slice(1), ['11', '9', 'M']],
    [...arrows.slice(1), ['10', null, 'M']],
  ]) {
    assert.equal(
      (await app.inject({ method: 'PUT', url: `${base}/entry`, headers, payload: { ...payload, rounds } })).statusCode,
      400,
    );
  }
  const draft = Array.from({ length: 10 }, (_, index) => (index === 0 ? ['10', '9', 'M'] : [null, null, null]));
  const draftResponse = await app.inject({
    method: 'PUT',
    url: `${base}/entry`,
    headers,
    payload: { entryId: payload.entryId, rounds: draft, expectedVersion: 0, finish: false },
  });
  assert.equal(draftResponse.statusCode, 200, draftResponse.body);
  assert.deepEqual(Object.keys(draftResponse.json()).sort(), publicEntryFields);
  assert.equal(draftResponse.json().version, 1);
  assert.deepEqual(await summary(), []);
  const resumed = await authenticate('a', '1234', false, cookie);
  assert.equal(resumed.json().entry.version, 1);
  assert.deepEqual(resumed.json().entry.rounds, draft);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/entry`, headers, payload })).statusCode, 409);
  const finished = await app.inject({
    method: 'PUT',
    url: `${base}/entry`,
    headers,
    payload: { ...payload, expectedVersion: 1 },
  });
  assert.equal(finished.statusCode, 200, finished.body);
  assert.equal(finished.json().total, 190);
  assert.ok(Math.abs(finished.json().completedAt - Date.now()) < 5000);
  const retried = await app.inject({
    method: 'PUT',
    url: `${base}/entry`,
    headers,
    payload: { ...payload, expectedVersion: 1 },
  });
  assert.deepEqual(retried.json(), finished.json());
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `${base}/entry`,
        headers,
        payload: { ...payload, rounds: draft, finish: false, expectedVersion: 2 },
      })
    ).statusCode,
    409,
  );
  const again = await app.inject({ method: 'POST', url: `${base}/restart`, headers });
  assert.equal(again.json().participant.id, 'a');
  const cookie2 = again.headers['set-cookie']!.toString().split(';')[0]!;
  assert.equal(again.json().history.length, 1);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `${base}/entry`,
        headers: { cookie: cookie2, 'x-arrowcast-scoring': '1' },
        payload: {
          ...payload,
          entryId: again.json().entry.id,
          rounds: Array.from({ length: 10 }, () => ['10', '10', '10']),
        },
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(await summary(), [
    { participantId: 'a', name: 'Alice', averageScore: 245, averagePerArrow: 245 / 30, highestScore: 300 },
  ]);
  assert.deepEqual(await exportRows(), [exportHeaders, ['Alice', 245, 245 / 30, 300]]);
  assert.deepEqual(await exportRows('en'), [
    ['Name', 'Average score', 'Average per arrow', 'Highest score'],
    ['Alice', 245, 245 / 30, 300],
  ]);
  const history = (await app.inject({ url: '/api/v1/admin/logbook/a', headers: admin })).json();
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry: { total: number }) => entry.total).sort(), [190, 300]);
  assert.equal(fixture.db.select().from(logbookEntries).all().length, 2);
  for (const table of [competitions, competitionParticipants, scorecards])
    assert.deepEqual(fixture.db.select().from(table).all(), []);
  // A second person gets a separate sheet and cannot write to Alice by supplying an ID.
  const bob = await authenticate('b', '5678', true);
  const bobCookie = bob.headers['set-cookie']!.toString().split(';')[0]!;
  const bobContext = (await app.inject({ url: `${base}/context`, headers: { cookie: bobCookie } })).json();
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `${base}/entry`,
        headers: { cookie: bobCookie, 'x-arrowcast-scoring': '1' },
        payload,
      })
    ).statusCode,
    409,
  );
  assert.equal(bobContext.participant.id, 'b');
  assert.deepEqual(bobContext.history, []);
  const bobHeaders = { cookie: bobCookie, 'x-arrowcast-scoring': '1' };
  assert.equal((await app.inject({ method: 'POST', url: `${base}/logout` })).statusCode, 403);
  const logout = await app.inject({ method: 'POST', url: `${base}/logout`, headers: bobHeaders });
  assert.equal(logout.statusCode, 200);
  assert.match(logout.headers['set-cookie']!.toString(), /arrowcast\.logbook=;/);
  assert.equal((await app.inject({ url: `${base}/context`, headers: bobHeaders })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/restart`, headers: bobHeaders })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: 'PUT', url: `${base}/entry`, headers: bobHeaders, payload })).statusCode,
    401,
  );
  assert.equal((await app.inject({ method: 'POST', url: `${base}/logout`, headers: bobHeaders })).statusCode, 200);
  const fresh = await authenticate('b', '5678', false, bobCookie);
  assert.equal(fresh.statusCode, 200);
  assert.notEqual(fresh.json().entry.id, bobContext.entry.id);
  assert.deepEqual(
    fresh.json().entry.rounds,
    Array.from({ length: 10 }, () => [null, null, null]),
  );
  fixture.db.update(logbookEntries).set({ expiresAt: 0 }).where(eq(logbookEntries.participantId, 'b')).run();
  assert.equal((await app.inject({ url: `${base}/context`, headers: { cookie: bobCookie } })).statusCode, 401);
  const chooseClub = (payload: { clubNumber: string | null; name?: string }) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/club',
      headers: admin,
      payload,
    });
  assert.equal((await app.inject({ url: '/api/v1/admin/settings/club' })).statusCode, 401);
  assert.equal((await chooseClub({ clubNumber: 'missing' })).statusCode, 400);
  assert.equal((await chooseClub({ clubNumber: ' ', name: 'Invalid' })).statusCode, 400);
  assert.equal((await chooseClub({ clubNumber: 'other', name: 'Other club' })).statusCode, 200);
  fixture.db.update(participants).set({ clubNumber: 'other' }).where(eq(participants.id, 'b')).run();
  assert.deepEqual(await summary(), []);
  assert.deepEqual(await exportRows(), [exportHeaders]);
  assert.deepEqual((await app.inject({ url: `${base}/participants?q=Ali` })).json(), []);
  assert.equal((await app.inject({ url: `${base}/participants?q=Bob` })).json()[0].id, 'b');
  assert.equal((await authenticate('a', '1234', false)).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/v1/admin/logbook/a', headers: admin })).statusCode, 404);
  assert.equal((await app.inject({ url: `${base}/context`, headers })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/restart`, headers })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/entry`, headers, payload })).statusCode, 401);
  assert.equal((await chooseClub({ clubNumber: null })).statusCode, 200);
  assert.equal((await summary()).length, 1);
  assert.equal((await chooseClub({ clubNumber: 'club' })).statusCode, 200);
  assert.deepEqual((await app.inject({ url: `${base}/participants?q=Bob` })).json(), []);
  await app.close();
  restarted = buildApp({ jwtSecret, databasePath });
  assert.deepEqual((await restarted.inject({ url: '/api/v1/admin/settings/club', headers: admin })).json(), {
    clubNumber: 'club',
    name: 'Club',
  });
  const restored = await restarted.inject({ url: '/api/v1/admin/logbook', headers: admin });
  assert.equal(restored.json()[0].averageScore, 245);
  // Five newer completions replace both older scores in the averages, but not the personal best.
  for (let index = 1; index <= 6; index++) {
    const id = `recent-${index}`;
    fixture.db
      .insert(logbookEntries)
      .values({
        id,
        participantId: 'a',
        tokenHash: id,
        expiresAt: Date.now() + 60000,
        rounds: Array.from({ length: 10 }, () => [String(index), String(index), String(index)]),
        total: index === 6 ? null : index * 30,
        createdAt: Date.now() + index * 1000,
        completedAt: index === 6 ? null : Date.now() + index * 1000,
      })
      .run();
  }
  const recentSummary = await restarted.inject({ url: '/api/v1/admin/logbook', headers: admin });
  assert.deepEqual(recentSummary.json(), [
    { participantId: 'a', name: 'Alice', averageScore: 90, averagePerArrow: 3, highestScore: 300 },
  ]);
  const exported = await restarted.inject({ url: '/api/v1/admin/logbook/export', headers: admin });
  const workbook = read(exported.rawPayload, { type: 'buffer' });
  assert.deepEqual(utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1 }), [
    exportHeaders,
    ['Alice', 90, 3, 300],
  ]);
});

test('logbook PIN attempts are rate limited', async (t) => {
  const app = buildApp({ jwtSecret, databasePath: ':memory:' });
  t.after(() => app.close());
  for (let index = 0; index < 6; index++) {
    const response = await app.inject({
      method: 'POST',
      url: `${base}/authenticate`,
      headers: { 'x-arrowcast-scoring': '1' },
      payload: { participantId: 'missing', pin: '1234', createPin: false },
    });
    assert.equal(response.statusCode, index < 5 ? 404 : 429);
  }
});
