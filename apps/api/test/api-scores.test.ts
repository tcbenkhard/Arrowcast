import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { DatabaseConnection } from '../src/db/index.js';
import {
  arrowScores,
  bowTypes,
  clubSettings,
  clubs,
  competitionParticipants,
  competitions,
  participants,
  ranges,
  roundScores,
  scorecards,
} from '../src/db/schema.js';
import { ApiTokenService } from '../src/modules/api-tokens/service.js';
import { loginAdmin } from './helpers.js';

const request = { verenigingsnummer: 1241, date: '2026-10-05', starttime: '10:00' };
const scoresUrl = '/api/scores';

async function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-api-scores-'));
  const databasePath = join(directory, 'test.sqlite');
  const store = new DatabaseConnection(databasePath);
  const db = store.db;
  db.insert(clubs)
    .values([
      { clubNumber: '1241', name: 'Selected club' },
      { clubNumber: '5678', name: 'Visiting club' },
    ])
    .run();
  db.insert(clubSettings).values({ id: 1, clubNumber: '1241' }).run();
  db.insert(ranges).values({ id: 'range', name: 'Indoor' }).run();
  const tokens = new ApiTokenService(store.context);
  const key = tokens.create('Scores integration');
  const headers = { authorization: `Bearer ${key.token}` };
  const config = { jwtSecret: 'api-scores-test-secret-with-at-least-thirty-two-bytes', databasePath };
  let app = buildApp(config);
  t.after(async () => {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await app.ready();
  return {
    get app() {
      return app;
    },
    db,
    key,
    tokens,
    headers,
    async restart() {
      await app.close();
      app = buildApp(config);
      await app.ready();
    },
    fetch(payload = request) {
      return app.inject({ method: 'POST', url: scoresUrl, headers, payload });
    },
    competition(input: Partial<typeof competitions.$inferInsert> = {}) {
      db.insert(competitions)
        .values({
          id: 'competition',
          name: 'Requested competition',
          date: request.date,
          startingTime: request.starttime,
          endingTime: '13:00',
          rangeId: 'range',
          status: 'Closed',
          numberOfRounds: 10,
          arrowsPerRound: 3,
          ...input,
        })
        .run();
    },
    person(
      id: string,
      bowType: string,
      options: { checkedIn?: boolean; competitionId?: string; clubNumber?: string; federationNumber?: string } = {},
    ) {
      db.insert(participants)
        .values({
          id,
          name: `Archer ${id}`,
          federationNumber: options.federationNumber ?? id,
          clubNumber: options.clubNumber ?? '1241',
        })
        .run();
      db.insert(competitionParticipants)
        .values({
          competitionId: options.competitionId ?? 'competition',
          participantId: id,
          bowType,
          checkedIn: options.checkedIn ?? true,
        })
        .run();
    },
    scores(id: string, rounds: { arrows: string[]; submitted?: boolean }[], competitionId = 'competition') {
      const cardId = `${competitionId}-${id}`;
      db.insert(scorecards).values({ id: cardId, competitionId, participantId: id, createdAt: 1, updatedAt: 1 }).run();
      for (const [index, round] of rounds.entries()) {
        const roundId = `${cardId}-${index}`;
        db.insert(roundScores)
          .values({
            id: roundId,
            scorecardId: cardId,
            roundNumber: index + 1,
            submittedAt: round.submitted === false ? null : 1,
          })
          .run();
        if (round.arrows.length) {
          db.insert(arrowScores)
            .values(
              round.arrows.map((symbol, arrowIndex) => ({ roundScoreId: roundId, arrowIndex: arrowIndex + 1, symbol })),
            )
            .run();
        }
      }
    },
  };
}

test('scores requires a valid Bearer API key before validating the body', async (t) => {
  const f = await setup(t);
  for (const headers of [
    {},
    { authorization: 'Bearer invalid' },
    { authorization: `Basic ${f.key.token}` },
    { authorization: `Bearer ${'x'.repeat(43)}` },
    { cookie: `arrowcast.scoring=${f.key.token}` },
  ]) {
    const response = await f.app.inject({ method: 'POST', url: scoresUrl, headers, payload: {} });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  }
  f.tokens.revoke(f.key.id);
  assert.equal((await f.fetch()).statusCode, 401);
});

test('scores accepts JSON without Content-Type and still validates the body and API key', async (t) => {
  const f = await setup(t);
  f.competition();
  f.person('archer', 'Compound', { federationNumber: '001001' });
  f.scores('archer', [{ arrows: ['10', '9', '8'] }]);
  const response = await f.app.inject({
    method: 'POST',
    url: scoresUrl,
    headers: f.headers,
    payload: JSON.stringify(request),
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { results: [{ score: 27, lidnummer: '001001', boogtype: 'C' }] });
  assert.match(response.headers['content-type']!, /^application\/json/);

  for (const payload of ['{', JSON.stringify({ ...request, verenigingsnummer: '1241' })]) {
    const invalid = await f.app.inject({ method: 'POST', url: scoresUrl, headers: f.headers, payload });
    assert.equal(invalid.statusCode, 400);
  }
  const unauthorized = await f.app.inject({ method: 'POST', url: scoresUrl, payload: '{' });
  assert.equal(unauthorized.statusCode, 401);
});

test('scores rejects malformed request bodies', async (t) => {
  const f = await setup(t);
  for (const payload of [
    {},
    { date: request.date, starttime: request.starttime },
    { verenigingsnummer: 1241, starttime: request.starttime },
    { verenigingsnummer: 1241, date: request.date },
    { ...request, verenigingsnummer: '1241' },
    { ...request, verenigingsnummer: 1241.5 },
    { ...request, date: '05-10-2026' },
    { ...request, date: '2026-02-30' },
    { ...request, date: '2026-13-05' },
    { ...request, date: 20261005 },
    { ...request, starttime: '24:00' },
    { ...request, starttime: '10:60' },
    { ...request, starttime: '10:00:00' },
    { ...request, starttime: 1000 },
    { ...request, ignored: true },
    [],
    null,
  ]) {
    const response = await f.app.inject({ method: 'POST', url: scoresUrl, headers: f.headers, payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
});

test('scores validates the selected club before looking up a competition', async (t) => {
  const f = await setup(t);
  const wrongClub = await f.fetch({ ...request, verenigingsnummer: 5678 });
  assert.equal(wrongClub.statusCode, 400);
  assert.deepEqual(wrongClub.json(), { message: 'Verkeerde vereniging' });
  f.db.update(clubSettings).set({ clubNumber: null }).run();
  const unselectedClub = await f.fetch();
  assert.equal(unselectedClub.statusCode, 400);
  assert.deepEqual(unselectedClub.json(), { message: 'Verkeerde vereniging' });
  f.db.delete(clubSettings).run();
  const missingSettings = await f.fetch();
  assert.equal(missingSettings.statusCode, 400);
  assert.deepEqual(missingSettings.json(), { message: 'Verkeerde vereniging' });
});

test('scores requires both the exact date and starting time', async (t) => {
  const f = await setup(t);
  f.competition({ id: 'other-date', date: '2026-10-06' });
  f.competition({ id: 'other-time', startingTime: '11:00' });
  const response = await f.fetch();
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { message: 'Wedstrijd niet gevonden' });
});

test('scores returns a conflict for every competition status before Closed', async (t) => {
  const f = await setup(t);
  f.competition({ scoringLocked: true });
  for (const status of ['Scheduled', 'Check-in', 'Active'] as const) {
    f.db.update(competitions).set({ status }).run();
    const response = await f.fetch();
    assert.equal(response.statusCode, 409, status);
    assert.deepEqual(response.json(), { message: 'De wedstrijd is nog niet afgesloten' });
  }
});

test('scores uses the first matching competition before checking its status', async (t) => {
  const f = await setup(t);
  f.competition({ id: 'z-second', status: 'Closed' });
  f.competition({ id: 'a-first', status: 'Active' });
  assert.equal((await f.fetch()).statusCode, 409);
  f.db.update(competitions).set({ status: 'Closed' }).where(eq(competitions.id, 'a-first')).run();
  f.person('first', 'Compound', { competitionId: 'a-first' });
  f.scores('first', [{ arrows: ['10', '9', '8'] }], 'a-first');
  f.person('second', 'Recurve', { competitionId: 'z-second' });
  f.scores('second', [{ arrows: ['1', '2', '3'] }], 'z-second');
  const response = await f.fetch();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { results: [{ score: 27, lidnummer: 'first', boogtype: 'C' }] });
});

test('scores returns submitted totals and all five bow codes with string member numbers', async (t) => {
  const f = await setup(t);
  f.competition();
  const bows = [
    ['Compound', 'C'],
    ['Recurve', 'R'],
    ['Barebow', 'BB'],
    ['Longbow', 'LB'],
    ['Traditional', 'TR'],
  ] as const;
  for (const [index, [name]] of bows.entries()) {
    const id = `archer-${index}`;
    f.person(id, name, { federationNumber: `00000${index}`, clubNumber: index === 4 ? '5678' : '1241' });
    f.scores(id, [
      { arrows: ['10', '9', 'M'] },
      { arrows: ['8', String(index + 1), 'M'] },
      { arrows: ['10', '10', '10'], submitted: false },
    ]);
  }
  f.person('absent', 'Recurve', { checkedIn: false });
  f.scores('absent', [{ arrows: ['10', '10', '10'] }]);
  f.person('zero', 'Recurve');
  f.competition({ id: 'different-competition', startingTime: '11:00' });
  f.person('different', 'Compound', { competitionId: 'different-competition' });
  f.scores('different', [{ arrows: ['10', '10', '10'] }], 'different-competition');
  const response = await f.fetch();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  const result = response.json<{ results: { score: number; lidnummer: string; boogtype: string }[] }>();
  assert.deepEqual(
    result.results.sort((a, b) => a.lidnummer.localeCompare(b.lidnummer)),
    [
      ...bows.map(([, code], index) => ({ score: 28 + index, lidnummer: `00000${index}`, boogtype: code })),
      { score: 0, lidnummer: 'zero', boogtype: 'R' },
    ],
  );
  assert.deepEqual(Object.keys(result), ['results']);
});

test('scores returns an empty result list for a closed competition without attendees', async (t) => {
  const f = await setup(t);
  f.competition();
  f.person('absent', 'Recurve', { checkedIn: false });
  const response = await f.fetch();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { results: [] });
});

test('scores reports legacy missing or unsupported bow types instead of returning an invalid code', async (t) => {
  const f = await setup(t);
  f.competition();
  f.person('legacy', 'Recurve');
  f.db.insert(bowTypes).values({ name: 'Custom bow' }).run();
  for (const bowType of [null, 'Custom bow']) {
    f.db.update(competitionParticipants).set({ bowType }).run();
    const response = await f.fetch();
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { message: 'Onbekend of ontbrekend boogtype voor lidnummer legacy' });
  }
});

test('successful score retrieval records only the selected competition, refreshes its time and persists it for management', async (t) => {
  const f = await setup(t);
  f.competition({ id: 'z-second' });
  f.competition({ id: 'a-first' });
  f.competition({ id: 'other-time', startingTime: '11:00' });
  f.person('archer', 'Compound', { competitionId: 'a-first' });
  f.scores('archer', [{ arrows: ['10', '9', '8'] }], 'a-first');
  const admin = await loginAdmin(f.app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  const detailUrl = '/api/v1/admin/competitions/a-first';
  assert.equal((await f.app.inject({ url: detailUrl, headers })).json().scoresSyncedAt, null);
  assert.ok(
    f.db
      .select()
      .from(competitions)
      .all()
      .every((competition) => competition.scoresSyncedAt === null),
  );

  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const first = await f.fetch();
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(first.json(), { results: [{ score: 27, lidnummer: 'archer', boogtype: 'C' }] });
  const detail = await f.app.inject({ url: detailUrl, headers });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().scoresSyncedAt, now);
  const listed = await f.app.inject({ url: '/api/v1/admin/competitions', headers });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(
    listed
      .json<{ id: string; scoresSyncedAt: number | null }[]>()
      .map(({ id, scoresSyncedAt }) => ({ id, scoresSyncedAt })),
    [
      { id: 'a-first', scoresSyncedAt: now },
      { id: 'z-second', scoresSyncedAt: null },
      { id: 'other-time', scoresSyncedAt: null },
    ],
  );

  now += 1000;
  assert.equal((await f.fetch()).statusCode, 200);
  assert.equal(f.db.select().from(competitions).where(eq(competitions.id, 'a-first')).get()!.scoresSyncedAt, now);
  await f.restart();
  const persisted = await f.app.inject({ url: detailUrl, headers });
  assert.equal(persisted.statusCode, 200);
  assert.equal(persisted.json().scoresSyncedAt, now);
});

test('failed score requests neither mark an unsynchronized competition nor overwrite its previous synchronization', async (t) => {
  const f = await setup(t);
  f.competition();
  f.competition({ id: 'other', startingTime: '11:00' });
  f.person('valid', 'Compound');
  f.scores('valid', [{ arrows: ['10', '9', '8'] }]);
  f.person('legacy', 'Recurve');
  for (const previous of [null, 1700000000000]) {
    f.db
      .update(competitions)
      .set({ status: 'Closed', scoresSyncedAt: previous })
      .where(eq(competitions.id, 'competition'))
      .run();
    f.db
      .update(competitionParticipants)
      .set({ bowType: 'Recurve' })
      .where(eq(competitionParticipants.participantId, 'legacy'))
      .run();
    const unchanged = () => {
      assert.equal(
        f.db.select().from(competitions).where(eq(competitions.id, 'competition')).get()!.scoresSyncedAt,
        previous,
      );
      assert.equal(f.db.select().from(competitions).where(eq(competitions.id, 'other')).get()!.scoresSyncedAt, null);
    };

    const unauthorized = await f.app.inject({ method: 'POST', url: scoresUrl, payload: request });
    assert.equal(unauthorized.statusCode, 401);
    unchanged();
    const wrongClub = await f.fetch({ ...request, verenigingsnummer: 5678 });
    assert.equal(wrongClub.statusCode, 400);
    unchanged();
    const invalidBody = await f.app.inject({ method: 'POST', url: scoresUrl, headers: f.headers, payload: {} });
    assert.equal(invalidBody.statusCode, 400);
    unchanged();
    const missing = await f.fetch({ ...request, date: '2026-10-06' });
    assert.equal(missing.statusCode, 404);
    unchanged();

    f.db.update(competitions).set({ status: 'Active' }).where(eq(competitions.id, 'competition')).run();
    assert.equal((await f.fetch()).statusCode, 409);
    unchanged();
    f.db.update(competitions).set({ status: 'Closed' }).where(eq(competitions.id, 'competition')).run();
    f.db
      .update(competitionParticipants)
      .set({ bowType: null })
      .where(eq(competitionParticipants.participantId, 'legacy'))
      .run();
    assert.equal((await f.fetch()).statusCode, 409);
    unchanged();
  }
});

test('reopening a synchronized competition clears its marker while rejected transitions preserve it', async (t) => {
  const f = await setup(t);
  f.competition();
  f.person('archer', 'Compound');
  f.scores('archer', [{ arrows: ['10', '9', '8'] }]);
  const admin = await loginAdmin(f.app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  assert.equal((await f.fetch()).statusCode, 200);
  const syncedAt = f.db.select().from(competitions).where(eq(competitions.id, 'competition')).get()!.scoresSyncedAt;
  assert.equal(typeof syncedAt, 'number');
  for (const status of ['Closed', 'Scheduled']) {
    const rejected = await f.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/competitions/competition/status',
      headers,
      payload: { status },
    });
    assert.equal(rejected.statusCode, 409);
    assert.equal(
      f.db.select().from(competitions).where(eq(competitions.id, 'competition')).get()!.scoresSyncedAt,
      syncedAt,
    );
  }
  const reopened = await f.app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/competitions/competition/status',
    headers,
    payload: { status: 'Active' },
  });
  assert.equal(reopened.statusCode, 200, reopened.body);
  assert.equal(reopened.json().scoresSyncedAt, null);
  assert.equal(f.db.select().from(competitions).where(eq(competitions.id, 'competition')).get()!.scoresSyncedAt, null);
  assert.equal((await f.fetch()).statusCode, 409);
  assert.equal(f.db.select().from(competitions).where(eq(competitions.id, 'competition')).get()!.scoresSyncedAt, null);
});
