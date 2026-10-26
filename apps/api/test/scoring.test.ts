import { loginAdmin } from './helpers.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { read, utils } from 'xlsx';
import SQLite from 'better-sqlite3';
import type { LaneQrCode, ScoringContext, ScoringMutation } from '@arrowcast/contracts';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import {
  arrowScores,
  clubs,
  competitionLanes,
  competitionParticipants,
  competitions,
  laneScoringGrants,
  laneScoringState,
  lanes,
  participants,
  rangeDistances,
  ranges,
  roundScores,
  scorecards,
  scoringMutations,
  scoringSessions,
  targetTypes,
} from '../src/db/schema.js';
import { hashToken } from '../src/modules/scoring/service.js';

const config = { jwtSecret: 'scoring-test-secret-with-at-least-thirty-two-bytes' };
const csrf = { 'x-arrowcast-scoring': '1' };
async function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-scoring-'));
  const databasePath = join(directory, 'test.sqlite');
  const store = openDatabase(databasePath);
  const db = store.db;
  db.insert(ranges).values({ id: 'range', name: 'Indoor' }).run();
  db.insert(rangeDistances).values({ rangeId: 'range', distanceMeters: 18 }).run();
  db.insert(lanes)
    .values([
      { id: 'lane-1', rangeId: 'range', number: 1 },
      { id: 'lane-2', rangeId: 'range', number: 2 },
    ])
    .run();
  db.insert(competitions)
    .values({
      id: 'competition',
      name: 'Test competition',
      date: '2026-11-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: 'range',
      status: 'Check-in',
      numberOfRounds: 2,
      arrowsPerRound: 2,
    })
    .run();
  db.insert(competitionLanes)
    .values(
      ['lane-1', 'lane-2'].map((laneId) => ({
        competitionId: 'competition',
        rangeId: 'range',
        laneId,
        distanceMeters: 18,
      })),
    )
    .run();
  db.insert(clubs).values({ clubNumber: 'club', name: 'Archery club' }).run();
  for (const [id, name, laneId, targetLetter] of [
    ['a', 'Archer A', 'lane-1', 'A'],
    ['c', 'Archer C', 'lane-1', 'C'],
    ['other', 'Other lane archer', 'lane-2', 'A'],
  ] as const) {
    db.insert(participants).values({ id, name, federationNumber: id, clubNumber: 'club' }).run();
    db.insert(competitionParticipants)
      .values({ competitionId: 'competition', participantId: id, laneId, targetLetter, checkedIn: true })
      .run();
  }
  let app = buildApp({ ...config, databasePath });
  t.after(async () => {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const login = await loginAdmin(app);
  const admin = { authorization: `Bearer ${login.json().token}` };
  const fixture = {
    get app() {
      return app;
    },
    db,
    admin,
    async restart() {
      await app.close();
      app = buildApp({ ...config, databasePath });
      await app.ready();
    },
    async start() {
      const codes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/competitions/competition/scoring-codes',
        headers: admin,
      });
      assert.equal(codes.statusCode, 200, codes.body);
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/competitions/competition/status',
        headers: admin,
        payload: { status: 'Active' },
      });
      assert.equal(response.statusCode, 200, response.body);
      return codes.json() as LaneQrCode[];
    },
    async exchange(code: LaneQrCode) {
      const token = new URLSearchParams(code.path.split('#')[1]).get('token')!;
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/scoring/${code.grantId}/exchange`,
        headers: csrf,
        payload: { token },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.match(String(response.headers['set-cookie']), /HttpOnly/);
      assert.match(String(response.headers['set-cookie']), /SameSite=Strict/i);
      assert.match(String(response.headers['set-cookie']), new RegExp(`Path=/api/v1/scoring/${code.grantId}`));
      const cookie = String(response.headers['set-cookie']).split(';')[0]!;
      return { cookie, context: response.json() as ScoringContext };
    },
    context(code: LaneQrCode, cookie: string) {
      return app.inject({ url: `/api/v1/scoring/${code.grantId}/context`, headers: { cookie } });
    },
    save(code: LaneQrCode, cookie: string, values: Partial<ScoringMutation> = {}) {
      const payload: ScoringMutation = {
        submissionId: randomUUID(),
        expectedVersion: 0,
        participantId: 'a',
        roundNumber: 1,
        arrows: ['10', '9'],
        submit: true,
        ...values,
      };
      return app.inject({
        method: 'POST',
        url: `/api/v1/scoring/${code.grantId}/scores`,
        headers: { ...csrf, cookie },
        payload,
      });
    },
  };
  return fixture;
}

for (const legacy of [false, true]) {
  test(`absent archers are excluded from scoring and remain in final results (legacy state: ${legacy})`, async (t) => {
    const f = await setup(t);
    const markAbsent = () => {
      for (const id of ['a', 'other']) {
        f.db
          .update(competitionParticipants)
          .set({ checkedIn: false })
          .where(eq(competitionParticipants.participantId, id))
          .run();
      }
    };
    if (!legacy) markAbsent();
    const codes = await f.start();
    if (legacy) markAbsent();
    const code = codes.find((code) => code.laneId === 'lane-1')!;
    const session = await f.exchange(code);
    assert.deepEqual(
      session.context.participants.map((person) => person.id),
      ['c'],
    );
    assert.equal(session.context.currentParticipantId, 'c');
    const empty = await f.exchange(codes.find((code) => code.laneId === 'lane-2')!);
    assert.deepEqual(empty.context.participants, []);
    assert.equal(empty.context.currentParticipantId, null);
    assert.equal(empty.context.completed, true);
    assert.equal((await f.save(code, session.cookie)).statusCode, 403);
    assert.equal((await f.save(code, session.cookie, { participantId: 'c' })).statusCode, 200);
    const progress = (await f.context(code, session.cookie)).json() as ScoringContext;
    assert.equal(progress.currentParticipantId, 'c');
    assert.equal(progress.currentRoundNumber, 2);
    assert.equal(
      (await f.save(code, session.cookie, { participantId: 'c', roundNumber: 2, expectedVersion: 1 })).statusCode,
      200,
    );
    assert.equal((await f.context(code, session.cookie)).json().completed, true);
    const base = '/api/v1/admin/competitions/competition';
    const standings = async () => (await f.app.inject({ url: `${base}/scoring-standings`, headers: f.admin })).json();
    assert.deepEqual(
      (await standings()).map((person: { participantId: string }) => person.participantId),
      ['c'],
    );
    const closed = await f.app.inject({
      method: 'PATCH',
      url: `${base}/status`,
      headers: f.admin,
      payload: { status: 'Closed' },
    });
    assert.equal(closed.statusCode, 200, closed.body);
    const results = await standings();
    assert.deepEqual(
      results.map((person: { participantId: string }) => person.participantId),
      ['c', 'a', 'other'],
    );
    assert.ok(
      results
        .slice(1)
        .every(
          (person: { checkedIn: boolean; enteredRounds: number }) => !person.checkedIn && person.enteredRounds === 0,
        ),
    );
    assert.deepEqual(
      f.db
        .select()
        .from(scorecards)
        .all()
        .map((card) => card.participantId),
      ['c'],
    );
    const exported = await f.app.inject({ url: `${base}/results-export`, headers: f.admin });
    assert.equal(exported.statusCode, 200);
    const workbook = read(exported.rawPayload, { type: 'buffer' });
    const rows = utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1 });
    assert.deepEqual(rows, [
      ['bondsnummer', 'naam', 'clubnummer', 'clubnaam', 'totaalscore', 'gemiddelde'],
      ['c', 'Archer C', 'club', 'Archery club', 38, 9.5],
      ['a', 'Archer A', 'club', 'Archery club', 'Afwezig', 'Afwezig'],
      ['other', 'Other lane archer', 'club', 'Archery club', 'Afwezig', 'Afwezig'],
    ]);
  });
}

for (const status of ['Active', 'Closed']) {
  test(`automatic scores for absent archers allow returning from ${status} to check-in and admitting a late archer`, async (t) => {
    const f = await setup(t);
    f.db
      .update(competitionParticipants)
      .set({ checkedIn: false })
      .where(eq(competitionParticipants.participantId, 'a'))
      .run();
    const code = (await f.start())[0]!;
    const session = await f.exchange(code);
    const base = '/api/v1/admin/competitions/competition';
    const changeStatus = (status: string) =>
      f.app.inject({ method: 'PATCH', url: `${base}/status`, headers: f.admin, payload: { status } });
    if (status === 'Closed') assert.equal((await changeStatus('Closed')).statusCode, 200);
    // Simulate scores created for an absent participant by earlier finalization code.
    f.db
      .insert(scorecards)
      .values({
        id: 'automatic-card',
        competitionId: 'competition',
        participantId: 'a',
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    for (let number = 1; number <= 2; number++) {
      const id = `automatic-round-${number}`;
      f.db.insert(roundScores).values({ id, scorecardId: 'automatic-card', roundNumber: number, submittedAt: 1 }).run();
      f.db
        .insert(arrowScores)
        .values([1, 2].map((arrowIndex) => ({ roundScoreId: id, arrowIndex, symbol: 'M' })))
        .run();
    }
    const response = await changeStatus('Check-in');
    assert.equal(response.statusCode, 200, response.body);
    for (const table of [scorecards, roundScores, arrowScores, laneScoringState]) {
      assert.deepEqual(f.db.select().from(table).all(), []);
    }
    assert.equal((await f.context(code, session.cookie)).statusCode, 403);
    const checkedIn = await f.app.inject({
      method: 'PATCH',
      url: `${base}/participants/a/check-in`,
      headers: f.admin,
      payload: { checkedIn: true },
    });
    assert.equal(checkedIn.statusCode, 200, checkedIn.body);
    assert.equal((await changeStatus('Active')).statusCode, 200);
    const replacement = (response.json().qrCodes as LaneQrCode[]).find((next) => next.laneId === code.laneId)!;
    const resumed = await f.exchange(replacement);
    assert.deepEqual(
      resumed.context.participants.map((person) => person.id),
      ['a', 'c'],
    );
    assert.deepEqual(resumed.context.rounds, []);
    assert.equal(resumed.context.currentParticipantId, 'a');
    assert.equal((await f.save(replacement, resumed.cookie)).statusCode, 200);
  });
}

test('a failed return to check-in restores automatic scores and the previous competition state', async (t) => {
  const f = await setup(t);
  await f.start();
  const status = (status: string) =>
    f.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/competitions/competition/status',
      headers: f.admin,
      payload: { status },
    });
  assert.equal((await status('Closed')).statusCode, 200);
  const cards = f.db.select().from(scorecards).all();
  const rounds = f.db.select().from(roundScores).all();
  const arrows = f.db.select().from(arrowScores).all();
  const grants = f.db.select().from(laneScoringGrants).all();
  const progress = f.db.select().from(laneScoringState).all();
  f.db.run(sql`CREATE TRIGGER fail_return BEFORE UPDATE OF status ON competitions
    WHEN NEW.status = 'Check-in' BEGIN SELECT RAISE(ABORT, 'simulated return failure'); END`);
  assert.equal((await status('Check-in')).statusCode, 500);
  assert.deepEqual(f.db.select().from(scorecards).all(), cards);
  assert.deepEqual(f.db.select().from(roundScores).all(), rounds);
  assert.deepEqual(f.db.select().from(arrowScores).all(), arrows);
  assert.deepEqual(f.db.select().from(laneScoringGrants).all(), grants);
  assert.deepEqual(f.db.select().from(laneScoringState).all(), progress);
  assert.equal(f.db.select().from(competitions).where(eq(competitions.id, 'competition')).get()?.status, 'Closed');
});

test('manually entered misses block returning to check-in even when the archer is absent', async (t) => {
  const f = await setup(t);
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  assert.equal((await f.save(code, session.cookie, { arrows: ['M', 'M'] })).statusCode, 200);
  f.db
    .update(competitionParticipants)
    .set({ checkedIn: false })
    .where(eq(competitionParticipants.participantId, 'a'))
    .run();
  const before = f.db.select().from(arrowScores).all();
  for (const status of ['Scheduled', 'Check-in']) {
    const response = await f.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/competitions/competition/status',
      headers: f.admin,
      payload: { status },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.deepEqual(f.db.select().from(arrowScores).all(), before);
    assert.equal(f.db.select().from(scoringMutations).all().length, 1);
    assert.equal(f.db.select().from(competitions).where(eq(competitions.id, 'competition')).get()?.status, 'Active');
  }
});

test('check-in issues printable codes, keeps scoring closed, and preserves codes through reassignment and activation', async (t) => {
  const f = await setup(t);
  f.db.insert(targetTypes).values({ name: '40 cm' }).run();
  f.db.update(competitionLanes).set({ numberOfTargets: 2, targetType: '40 cm' }).run();
  f.db.update(competitionParticipants).set({ targetType: '40 cm' }).run();
  const base = '/api/v1/admin/competitions/competition';
  const status = (status: string) =>
    f.app.inject({ method: 'PATCH', url: `${base}/status`, headers: f.admin, payload: { status } });
  const list = async () => (await f.app.inject({ url: `${base}/scoring-codes`, headers: f.admin })).json();
  assert.equal((await status('Scheduled')).statusCode, 200);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: `${base}/scoring-codes`, headers: f.admin })).statusCode,
    409,
  );
  const checkIn = await status('Check-in');
  assert.equal(checkIn.statusCode, 200, checkIn.body);
  const codes = checkIn.json().qrCodes as LaneQrCode[];
  assert.equal(codes.length, 2);
  assert.deepEqual(await list(), codes);
  const code = codes[0]!;
  const token = new URLSearchParams(code.path.split('#')[1]).get('token');
  const exchange = () =>
    f.app.inject({
      method: 'POST',
      url: `/api/v1/scoring/${code.grantId}/exchange`,
      headers: csrf,
      payload: { token },
    });
  const waiting = await exchange();
  assert.equal(waiting.statusCode, 403);
  assert.equal(waiting.json().code, 'SCORING_NOT_STARTED');
  assert.equal((await f.save(code, '')).statusCode, 403);
  assert.deepEqual(f.db.select().from(laneScoringState).all(), []);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: `${base}/assignments/reassign`, headers: f.admin })).statusCode,
    200,
  );
  await f.restart();
  assert.deepEqual(await list(), codes);
  assert.equal((await status('Active')).statusCode, 200);
  assert.deepEqual(await list(), codes);
  assert.equal((await exchange()).statusCode, 200);
  assert.equal((await status('Scheduled')).statusCode, 200);
  assert.deepEqual(await list(), []);
  assert.equal((await status('Check-in')).statusCode, 200);
  assert.ok((await list()).every((next: LaneQrCode) => !codes.some((old) => old.grantId === next.grantId)));
});

test('range changes preserve registrations, clear placements and old score access, and respect the phase lock', async (t) => {
  const f = await setup(t);
  f.db.insert(ranges).values({ id: 'new-range', name: 'Outdoor' }).run();
  f.db.insert(rangeDistances).values({ rangeId: 'new-range', distanceMeters: 25 }).run();
  f.db.insert(lanes).values({ id: 'new-lane', rangeId: 'new-range', number: 3 }).run();
  const url = '/api/v1/admin/competitions/competition';
  const payload = {
    name: 'Moved',
    date: '2026-11-01',
    startingTime: '09:00',
    endingTime: '12:00',
    numberOfRounds: 2,
    arrowsPerRound: 2,
    defaultTargetType: null,
    rangeId: 'new-range',
    lanes: [{ laneId: 'new-lane', distanceMeters: 25 }],
  };
  assert.equal((await f.app.inject({ method: 'PATCH', url, headers: f.admin, payload })).statusCode, 409);
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  assert.equal((await f.app.inject({ method: 'PATCH', url, headers: f.admin, payload })).statusCode, 409);
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url: `${url}/status`, headers: f.admin, payload: { status: 'Scheduled' } }))
      .statusCode,
    200,
  );
  const moved = await f.app.inject({ method: 'PATCH', url, headers: f.admin, payload });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().range.id, 'new-range');
  const registrations = f.db.select().from(competitionParticipants).all();
  assert.equal(registrations.length, 3);
  assert.ok(
    registrations.every(
      (participant) => participant.laneId === null && participant.targetLetter === null && participant.checkedIn,
    ),
  );
  assert.equal(f.db.select().from(laneScoringGrants).all().length, 0);
  assert.equal(f.db.select().from(scoringSessions).all().length, 0);
  assert.equal((await f.context(code, session.cookie)).statusCode, 401);
  assert.deepEqual(
    f.db
      .select()
      .from(competitionLanes)
      .all()
      .map((lane) => lane.laneId),
    ['new-lane'],
  );
});

test('editing preserves scoring format locks and removing a scored competition clears dependent data and access', async (t) => {
  const f = await setup(t);
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  assert.equal((await f.save(code, session.cookie)).statusCode, 200);
  const url = '/api/v1/admin/competitions/competition';
  const payload = {
    name: 'Updated during scoring',
    date: '2026-11-02',
    startingTime: '09:00',
    endingTime: '12:00',
    numberOfRounds: 2,
    arrowsPerRound: 2,
    defaultTargetType: null,
  };
  assert.equal((await f.app.inject({ method: 'PATCH', url, headers: f.admin, payload })).statusCode, 200);
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url, headers: f.admin, payload: { ...payload, numberOfRounds: 3 } }))
      .statusCode,
    409,
  );
  assert.equal((await f.context(code, session.cookie)).statusCode, 200);
  f.db
    .insert(competitions)
    .values({
      id: 'keep',
      name: 'Keep competition',
      date: '2026-11-03',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: 'range',
    })
    .run();
  f.db
    .insert(competitionLanes)
    .values({ competitionId: 'keep', rangeId: 'range', laneId: 'lane-1', distanceMeters: 18 })
    .run();
  const response = await f.app.inject({ method: 'DELETE', url, headers: f.admin });
  assert.equal(response.statusCode, 204, response.body);
  for (const table of [
    arrowScores,
    roundScores,
    scorecards,
    scoringMutations,
    scoringSessions,
    laneScoringGrants,
    laneScoringState,
    competitionParticipants,
  ]) {
    assert.deepEqual(f.db.select().from(table).all(), [], table.toString());
  }
  assert.equal((await f.context(code, session.cookie)).statusCode, 401);
  assert.equal((await f.app.inject({ url, headers: f.admin })).statusCode, 404);
  assert.equal(f.db.select().from(participants).all().length, 3);
  assert.equal(f.db.select().from(lanes).all().length, 2);
  assert.deepEqual(
    f.db
      .select()
      .from(competitionLanes)
      .all()
      .map((lane) => lane.competitionId),
    ['keep'],
  );
  assert.equal((await f.app.inject({ url: '/api/v1/admin/competitions/keep', headers: f.admin })).statusCode, 200);
});

test('QR access is separate from admin authentication and restricted to the competition lane', async (t) => {
  const f = await setup(t);
  const codes = await f.start();
  assert.equal(codes.length, 2);
  const code = codes[0]!;
  const otherCode = codes[1]!;
  assert.ok(code.path.startsWith('/scores/competition/lane-1/'));
  const token = new URLSearchParams(code.path.split('#')[1]).get('token')!;
  const stored = f.db.select().from(laneScoringGrants).where(eq(laneScoringGrants.id, code.grantId)).get()!;
  assert.notEqual(stored.tokenHash, token);
  assert.equal(stored.tokenHash, hashToken(token));
  assert.equal(
    (await f.app.inject({ method: 'POST', url: `/api/v1/scoring/${code.grantId}/exchange`, payload: { token } }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/api/v1/scoring/${code.grantId}/exchange`,
        headers: csrf,
        payload: { token: 'a'.repeat(43) },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await f.app.inject({ url: `/api/v1/scoring/${code.grantId}/context`, headers: f.admin })).statusCode,
    401,
  );
  const session = await f.exchange(code);
  assert.deepEqual(
    session.context.participants.map((p) => p.id),
    ['a', 'c'],
  );
  assert.equal(session.context.currentParticipantId, 'a');
  assert.equal((await f.context(otherCode, session.cookie)).statusCode, 401);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/admin/competitions', headers: { cookie: session.cookie } })).statusCode,
    401,
  );
  assert.equal((await f.save(code, session.cookie, { participantId: 'other' })).statusCode, 403);
  for (const arrows of [['10'], ['10', '9', '8'], ['10', null], ['11', '9'], ['X', '9']] as (string | null)[][]) {
    assert.equal((await f.save(code, session.cookie, { arrows })).statusCode, 400);
  }
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/api/v1/scoring/${code.grantId}/scores`,
        headers: { cookie: session.cookie },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(f.db.select().from(scorecards).all().length, 0);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/v1/admin/competitions/competition/scoring-codes' })).statusCode,
    401,
  );
});

test('drafts survive restart and device changes; Save rotates participants, wraps rounds and retries exactly once', async (t) => {
  const f = await setup(t);
  const code = (await f.start())[0]!;
  const first = await f.exchange(code);
  const draftId = randomUUID();
  const draft = { submissionId: draftId, arrows: ['10', null], submit: false };
  const saved = await f.save(code, first.cookie, draft);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json(), { version: 1 });
  assert.deepEqual((await f.save(code, first.cookie, draft)).json(), saved.json());
  assert.equal((await f.save(code, first.cookie, { ...draft, arrows: ['9', null] })).statusCode, 409);
  const second = await f.exchange(code);
  assert.deepEqual(second.context.rounds[0]?.arrows, ['10', null]);
  assert.equal(second.context.rounds[0]?.status, 'draft');
  assert.equal(second.context.currentParticipantId, 'a');
  await f.restart();
  assert.deepEqual((await f.context(code, second.cookie)).json().rounds[0].arrows, ['10', null]);
  const submissionId = randomUUID();
  const submitted = await f.save(code, second.cookie, { submissionId, expectedVersion: 1 });
  assert.equal(submitted.statusCode, 200, submitted.body);
  const next = (await f.context(code, first.cookie)).json() as ScoringContext;
  assert.equal(next.currentParticipantId, 'c');
  assert.equal(next.currentRoundNumber, 1);
  assert.equal(
    (await f.save(code, first.cookie, { expectedVersion: 1, arrows: ['8', '8'], submit: false })).statusCode,
    409,
  );
  assert.deepEqual((await f.save(code, second.cookie, { submissionId, expectedVersion: 1 })).json(), submitted.json());
  assert.equal(
    (await f.save(code, second.cookie, { participantId: 'c', expectedVersion: 2, arrows: ['8', '7'] })).statusCode,
    200,
  );
  const wrapped = (await f.context(code, first.cookie)).json() as ScoringContext;
  assert.equal(wrapped.currentParticipantId, 'a');
  assert.equal(wrapped.currentRoundNumber, 2);
  assert.equal(
    (await f.save(code, first.cookie, { expectedVersion: 3, roundNumber: 2, arrows: ['M', '1'] })).statusCode,
    200,
  );
  assert.equal(
    (await f.save(code, second.cookie, { participantId: 'c', expectedVersion: 4, roundNumber: 2, arrows: ['6', '5'] }))
      .statusCode,
    200,
  );
  const done = (await f.context(code, first.cookie)).json() as ScoringContext;
  assert.equal(done.completed, true);
  assert.equal(done.currentParticipantId, null);
  assert.equal(done.rounds.length, 4);
  assert.equal(
    done.rounds.filter((r) => r.participantId === 'a').reduce((n, r) => n + r.total, 0),
    20,
  );
  assert.equal(f.db.select().from(scoringMutations).all().length, 5);
  assert.equal(f.db.select().from(arrowScores).all().length, 8);
  assert.equal((await f.save(code, first.cookie, { expectedVersion: 5, arrows: ['8', '9'] })).statusCode, 200);
  const corrected = (await f.context(code, first.cookie)).json() as ScoringContext;
  assert.equal(corrected.completed, true);
  assert.equal(corrected.rounds.find((r) => r.participantId === 'a' && r.roundNumber === 1)?.total, 17);
  assert.deepEqual(f.db.select().from(scoringMutations).all().at(-1)?.before, ['10', '9']);
});

test('lane participants can score out of order and correct earlier rounds without skipping unfinished scores', async (t) => {
  const f = await setup(t);
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  assert.equal(
    (await f.save(code, session.cookie, { participantId: 'c', arrows: ['M', null], submit: false })).statusCode,
    200,
  );
  assert.equal(
    (await f.save(code, session.cookie, { participantId: 'c', expectedVersion: 1, arrows: ['M', '8'] })).statusCode,
    200,
  );
  let context = (await f.context(code, session.cookie)).json() as ScoringContext;
  assert.equal(context.currentParticipantId, 'a');
  assert.equal(context.currentRoundNumber, 1);
  assert.equal(
    (await f.save(code, session.cookie, { participantId: 'c', expectedVersion: 2, arrows: ['9', null], submit: false }))
      .statusCode,
    409,
  );
  assert.equal(
    (await f.save(code, session.cookie, { participantId: 'c', expectedVersion: 2, arrows: ['9', '8'] })).statusCode,
    200,
  );
  assert.equal((await f.save(code, session.cookie, { expectedVersion: 2 })).statusCode, 409);
  assert.equal((await f.save(code, session.cookie, { expectedVersion: 3 })).statusCode, 200);
  context = (await f.context(code, session.cookie)).json() as ScoringContext;
  assert.equal(context.currentParticipantId, 'a');
  assert.equal(context.currentRoundNumber, 2);
  assert.equal(context.rounds.find((r) => r.participantId === 'c')?.total, 17);
  const lock = await f.app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/competitions/competition/scoring-lock',
    headers: f.admin,
    payload: { scoringLocked: true },
  });
  assert.equal(lock.statusCode, 200);
  assert.equal((await f.save(code, session.cookie, { participantId: 'c', expectedVersion: 4 })).statusCode, 403);
});

test('lane scoring stays within one submitted round and blocks future drafts without changing progress', async (t) => {
  const f = await setup(t);
  f.db.update(competitions).set({ numberOfRounds: 3 }).where(eq(competitions.id, 'competition')).run();
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  let version = 0;
  async function save(participantId: string, roundNumber: number, submit = true) {
    const response = await f.save(code, session.cookie, {
      participantId,
      roundNumber,
      submit,
      expectedVersion: version,
      arrows: submit ? ['10', '9'] : ['10', null],
    });
    assert.equal(response.statusCode, 200, response.body);
    version++;
  }
  async function blocked(participantId: string, roundNumber: number) {
    const before = (await f.context(code, session.cookie)).json();
    const auditCount = f.db.select().from(scoringMutations).all().length;
    for (const submit of [false, true]) {
      const response = await f.save(code, session.cookie, {
        participantId,
        roundNumber,
        submit,
        expectedVersion: version,
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.match(response.json().message, /for everyone in your lane/);
    }
    assert.deepEqual((await f.context(code, session.cookie)).json(), before);
    assert.equal(f.db.select().from(scoringMutations).all().length, auditCount);
  }
  await blocked('a', 2);
  await blocked('a', 3);
  await save('a', 1);
  await blocked('a', 2);
  await save('c', 1, false);
  await blocked('a', 2); // A draft does not finish the round.
  await save('c', 1);
  await save('c', 2);
  await blocked('c', 3);
  await save('c', 1); // Earlier corrections remain available.
  await blocked('c', 3);
  await save('a', 2);
  await save('c', 3, false);
  await save('c', 3);
  await save('a', 3);
  assert.equal((await f.context(code, session.cookie)).json().completed, true);
  // The participant in lane 2 has no scores and does not block this lane.
});

test('scoring locks, closed competitions, grant rotation, expiry and revocation are enforced without losing scores', async (t) => {
  const f = await setup(t);
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  assert.equal((await f.save(code, session.cookie, { arrows: ['10', null], submit: false })).statusCode, 200);
  const base = '/api/v1/admin/competitions/competition';
  for (const status of ['Scheduled', 'Check-in'])
    assert.equal(
      (await f.app.inject({ method: 'PATCH', url: `${base}/status`, headers: f.admin, payload: { status } }))
        .statusCode,
      409,
    );
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `${base}/scoring-settings`,
        headers: f.admin,
        payload: { numberOfRounds: 3, arrowsPerRound: 3 },
      })
    ).statusCode,
    409,
  );
  const lock = (scoringLocked: boolean) =>
    f.app.inject({ method: 'PATCH', url: `${base}/scoring-lock`, headers: f.admin, payload: { scoringLocked } });
  assert.equal((await lock(true)).statusCode, 200);
  assert.equal((await f.save(code, session.cookie, { expectedVersion: 1 })).statusCode, 403);
  assert.equal((await lock(false)).statusCode, 200);
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url: `${base}/status`, headers: f.admin, payload: { status: 'Closed' } }))
      .statusCode,
    200,
  );
  assert.equal((await f.save(code, session.cookie, { expectedVersion: 1 })).statusCode, 403);
  assert.equal((await f.context(code, session.cookie)).statusCode, 403);
  const token = new URLSearchParams(code.path.split('#')[1]).get('token');
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/api/v1/scoring/${code.grantId}/exchange`,
        headers: csrf,
        payload: { token },
      })
    ).statusCode,
    403,
  );
  assert.deepEqual((await f.app.inject({ url: `${base}/scoring-codes`, headers: f.admin })).json(), []);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: `${base}/scoring-codes/restore`, headers: f.admin })).statusCode,
    409,
  );
  assert.equal(
    (await f.app.inject({ method: 'POST', url: `${base}/scoring-codes`, headers: f.admin })).statusCode,
    409,
  );
  assert.ok(
    f.db
      .select()
      .from(scoringSessions)
      .all()
      .every((session) => session.revokedAt !== null),
  );
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url: `${base}/status`, headers: f.admin, payload: { status: 'Active' } }))
      .statusCode,
    200,
  );
  assert.equal((await f.context(code, session.cookie)).statusCode, 401);
  const replacement = await f.app.inject({ method: 'POST', url: `${base}/scoring-codes`, headers: f.admin });
  assert.equal(replacement.statusCode, 200, replacement.body);
  assert.equal((await f.context(code, session.cookie)).statusCode, 401);
  assert.equal((await f.save(code, session.cookie, { expectedVersion: 1 })).statusCode, 401);
  const newCode = replacement.json()[0] as LaneQrCode;
  const newSession = await f.exchange(newCode);
  assert.deepEqual(newSession.context.rounds[0]?.arrows, ['10', 'M']);
  f.db
    .update(scoringSessions)
    .set({ expiresAt: Date.now() - 1 })
    .where(eq(scoringSessions.grantId, newCode.grantId))
    .run();
  assert.equal((await f.context(newCode, newSession.cookie)).statusCode, 401);
  const activeSession = await f.exchange(newCode);
  f.db
    .update(laneScoringGrants)
    .set({ expiresAt: Date.now() - 1 })
    .where(eq(laneScoringGrants.id, newCode.grantId))
    .run();
  assert.equal((await f.context(newCode, activeSession.cookie)).statusCode, 401);
  const renewed = (
    await f.app.inject({ method: 'POST', url: `${base}/scoring-codes`, headers: f.admin })
  ).json()[0] as LaneQrCode;
  const renewedSession = await f.exchange(renewed);
  assert.equal(
    (await f.app.inject({ method: 'DELETE', url: `${base}/scoring-codes`, headers: f.admin })).statusCode,
    204,
  );
  assert.equal((await f.context(renewed, renewedSession.cookie)).statusCode, 401);
  assert.equal(f.db.select().from(arrowScores).all().length, 12);
});

test('closing fills missing arrows and rounds with misses and corrects averages without losing entered scores', async (t) => {
  const f = await setup(t);
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  assert.equal((await f.save(code, session.cookie)).statusCode, 200);
  assert.equal(
    (await f.save(code, session.cookie, { participantId: 'c', expectedVersion: 1, arrows: [null, '8'], submit: false }))
      .statusCode,
    200,
  );
  const base = '/api/v1/admin/competitions/competition';
  const standings = async () => (await f.app.inject({ url: `${base}/scoring-standings`, headers: f.admin })).json();
  assert.equal((await standings())[0].averageScore, 9.5);
  const status = (value: string) =>
    f.app.inject({ method: 'PATCH', url: `${base}/status`, headers: f.admin, payload: { status: value } });
  assert.equal((await status('Closed')).statusCode, 200);
  assert.deepEqual(await standings(), [
    {
      participantId: 'a',
      checkedIn: true,
      name: 'Archer A',
      laneNumber: 1,
      targetLetter: 'A',
      enteredRounds: 2,
      totalRounds: 2,
      totalScore: 19,
      averageScore: 4.75,
      lastArrows: ['9', 'M', 'M'],
    },
    {
      participantId: 'c',
      checkedIn: true,
      name: 'Archer C',
      laneNumber: 1,
      targetLetter: 'C',
      enteredRounds: 2,
      totalRounds: 2,
      totalScore: 8,
      averageScore: 2,
      lastArrows: ['8', 'M', 'M'],
    },
    {
      participantId: 'other',
      checkedIn: true,
      name: 'Other lane archer',
      laneNumber: 2,
      targetLetter: 'A',
      enteredRounds: 2,
      totalRounds: 2,
      totalScore: 0,
      averageScore: 0,
      lastArrows: ['M', 'M', 'M'],
    },
  ]);
  assert.equal(f.db.select().from(arrowScores).all().length, 12);
  assert.ok(
    f.db
      .select()
      .from(roundScores)
      .all()
      .every((round) => round.submittedAt !== null),
  );
  assert.ok(
    f.db
      .select()
      .from(laneScoringState)
      .all()
      .every((state) => state.completed && state.currentParticipantId === null),
  );
  await f.restart();
  assert.equal((await status('Active')).statusCode, 200);
  const replacement = (
    await f.app.inject({ method: 'POST', url: `${base}/scoring-codes`, headers: f.admin })
  ).json()[0] as LaneQrCode;
  const reopened = await f.exchange(replacement);
  assert.equal(reopened.context.completed, true);
  assert.deepEqual(
    reopened.context.rounds.find((round) => round.participantId === 'c' && round.roundNumber === 1)?.arrows,
    ['M', '8'],
  );
  const before = await standings();
  assert.equal((await status('Closed')).statusCode, 200);
  assert.deepEqual(await standings(), before);
  assert.equal(f.db.select().from(arrowScores).all().length, 12);
});

test('failed closing rolls back zero scores, competition status, lane progress and access revocation', async (t) => {
  const f = await setup(t);
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  assert.equal((await f.save(code, session.cookie, { arrows: ['10', null], submit: false })).statusCode, 200);
  const before = (await f.context(code, session.cookie)).json();
  f.db.run(sql`CREATE TRIGGER fail_finalization BEFORE UPDATE OF status ON competitions
    WHEN NEW.status = 'Closed' BEGIN SELECT RAISE(ABORT, 'simulated closing failure'); END`);
  const response = await f.app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/competitions/competition/status',
    headers: f.admin,
    payload: { status: 'Closed' },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual((await f.context(code, session.cookie)).json(), before);
  assert.equal(f.db.select().from(scorecards).all().length, 1);
  assert.equal(f.db.select().from(roundScores).all().length, 1);
  assert.equal(f.db.select().from(arrowScores).all().length, 1);
  assert.ok(
    f.db
      .select()
      .from(laneScoringGrants)
      .all()
      .every((grant) => grant.revokedAt === null),
  );
});

test('a failed write rolls back scores, lane progress, audit and idempotency together', async (t) => {
  const f = await setup(t);
  const code = (await f.start())[0]!;
  const session = await f.exchange(code);
  f.db.run(
    sql`CREATE TRIGGER fail_score_audit BEFORE INSERT ON scoring_mutations BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END`,
  );
  const submissionId = randomUUID();
  assert.equal((await f.save(code, session.cookie, { submissionId })).statusCode, 500);
  for (const table of [scorecards, roundScores, arrowScores, scoringMutations])
    assert.equal(f.db.select().from(table).all().length, 0);
  assert.equal((await f.context(code, session.cookie)).json().version, 0);
  f.db.run(sql`DROP TRIGGER fail_score_audit`);
  assert.equal((await f.save(code, session.cookie, { submissionId })).statusCode, 200);
});

test('competition scoring settings validate counts and preserve existing competitions on migration', async (t) => {
  const f = await setup(t);
  const base = '/api/v1/admin/competitions/competition';
  f.db.update(competitions).set({ status: 'Scheduled' }).where(eq(competitions.id, 'competition')).run();
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `${base}/scoring-settings`,
        payload: { numberOfRounds: 5, arrowsPerRound: 3 },
      })
    ).statusCode,
    401,
  );
  for (const body of [
    { numberOfRounds: 0, arrowsPerRound: 3 },
    { numberOfRounds: 1.5, arrowsPerRound: 3 },
    { numberOfRounds: 3, arrowsPerRound: 0 },
    { numberOfRounds: '3', arrowsPerRound: 3 },
    { numberOfRounds: 1001, arrowsPerRound: 3 },
    { numberOfRounds: 3, arrowsPerRound: 37 },
  ]) {
    assert.equal(
      (await f.app.inject({ method: 'PATCH', url: `${base}/scoring-settings`, headers: f.admin, payload: body }))
        .statusCode,
      400,
    );
  }
  const settings = await f.app.inject({
    method: 'PATCH',
    url: `${base}/scoring-settings`,
    headers: f.admin,
    payload: { numberOfRounds: 5, arrowsPerRound: 6 },
  });
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.json().numberOfRounds, 5);
  assert.equal(settings.json().arrowsPerRound, 6);
  assert.throws(() => f.db.update(competitions).set({ numberOfRounds: 0 }).run());
  assert.throws(() => f.db.update(competitions).set({ arrowsPerRound: 1.5 }).run());
  const client = new SQLite(':memory:');
  try {
    client.pragma('foreign_keys = ON');
    const journal = JSON.parse(
      readFileSync(new URL('../../../migrations/meta/_journal.json', import.meta.url), 'utf8'),
    );
    for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx < 15))
      client.exec(readFileSync(new URL(`../../../migrations/${entry.tag}.sql`, import.meta.url), 'utf8'));
    client.exec(`INSERT INTO ranges VALUES ('range', 'Indoor'); INSERT INTO lanes VALUES ('lane', 'range', 1);
      INSERT INTO range_distances VALUES ('range', 18);
      INSERT INTO competitions VALUES ('competition', 'Existing', '2026-11-01', '09:00', '12:00', 'range', 'Active');
      INSERT INTO competition_lanes VALUES ('competition', 'range', 'lane', 18, NULL, 1);`);
    client.transaction(() =>
      client.exec(readFileSync(new URL('../../../migrations/0015_lane_scoring.sql', import.meta.url), 'utf8')),
    )();
    assert.deepEqual(
      client.prepare('SELECT status, number_of_rounds, arrows_per_round, scoring_locked FROM competitions').get(),
      { status: 'Active', number_of_rounds: 10, arrows_per_round: 3, scoring_locked: 0 },
    );
    assert.deepEqual(client.pragma('foreign_key_check'), []);
    assert.equal(client.prepare('SELECT * FROM competition_lanes').all().length, 1);
  } finally {
    client.close();
  }
});

test('admins retrieve identical QR codes after restart and standings rank submitted round averages', async (t) => {
  const f = await setup(t);
  const codes = await f.start();
  const url = '/api/v1/admin/competitions/competition/scoring-codes';
  assert.equal((await f.app.inject({ url })).statusCode, 401);
  await f.restart();
  assert.deepEqual((await f.app.inject({ url, headers: f.admin })).json(), codes);
  const session = await f.exchange(codes[0]!);
  const standingsUrl = '/api/v1/admin/competitions/competition/scoring-standings';
  assert.equal((await f.app.inject({ url: standingsUrl })).statusCode, 401);
  assert.equal((await f.save(codes[0]!, session.cookie, { submit: false, arrows: ['10', null] })).statusCode, 200);
  let standings = (await f.app.inject({ url: standingsUrl, headers: f.admin })).json();
  assert.ok(
    standings.every(
      (p: { enteredRounds: number; totalScore: number; lastArrows: string[] }) =>
        p.enteredRounds === 0 && p.totalScore === 0 && p.lastArrows.length === 0,
    ),
  );
  assert.equal((await f.save(codes[0]!, session.cookie, { expectedVersion: 1 })).statusCode, 200);
  assert.equal(
    (await f.save(codes[0]!, session.cookie, { expectedVersion: 2, participantId: 'c', arrows: ['8', '8'] }))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.save(codes[0]!, session.cookie, { expectedVersion: 3, roundNumber: 2, arrows: ['M', '1'] })).statusCode,
    200,
  );
  standings = (await f.app.inject({ url: standingsUrl, headers: f.admin })).json();
  assert.deepEqual(standings, [
    {
      participantId: 'c',
      checkedIn: true,
      name: 'Archer C',
      laneNumber: 1,
      targetLetter: 'C',
      enteredRounds: 1,
      totalRounds: 2,
      totalScore: 16,
      averageScore: 8,
      lastArrows: ['8', '8'],
    },
    {
      participantId: 'a',
      checkedIn: true,
      name: 'Archer A',
      laneNumber: 1,
      targetLetter: 'A',
      enteredRounds: 2,
      totalRounds: 2,
      totalScore: 20,
      averageScore: 5,
      lastArrows: ['9', 'M', '1'],
    },
    {
      participantId: 'other',
      checkedIn: true,
      name: 'Other lane archer',
      laneNumber: 2,
      targetLetter: 'A',
      enteredRounds: 0,
      totalRounds: 2,
      totalScore: 0,
      averageScore: 0,
      lastArrows: [],
    },
  ]);
  await f.app.inject({ method: 'POST', url, headers: f.admin });
  const replacements = (await f.app.inject({ url, headers: f.admin })).json();
  assert.equal(replacements.length, 2);
  assert.ok(replacements.every((code: LaneQrCode) => !codes.some((old) => old.grantId === code.grantId)));
});

test('legacy QR codes recover without revoking printouts or scoring sessions', async (t) => {
  const f = await setup(t);
  const codes = await f.start();
  const session = await f.exchange(codes[0]!);
  f.db.update(laneScoringGrants).set({ token: null }).run();
  const url = '/api/v1/admin/competitions/competition/scoring-codes';
  assert.equal((await f.app.inject({ method: 'POST', url: `${url}/restore` })).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url: `${url}/restore`, headers: f.admin })).statusCode, 204);
  const restored = (await f.app.inject({ url, headers: f.admin })).json() as LaneQrCode[];
  assert.equal(restored.length, 2);
  assert.ok(restored.every((code) => code.path.includes('#token=')));
  assert.equal((await f.context(codes[0]!, session.cookie)).statusCode, 200);
  assert.equal((await f.exchange(codes[0]!)).context.lane.id, 'lane-1');
  assert.equal((await f.exchange(restored[0]!)).context.lane.id, 'lane-1');
  await f.app.inject({ method: 'POST', url: `${url}/restore`, headers: f.admin });
  assert.deepEqual((await f.app.inject({ url, headers: f.admin })).json(), restored);
  await f.restart();
  assert.deepEqual((await f.app.inject({ url, headers: f.admin })).json(), restored);
  assert.equal((await f.save(codes[0]!, session.cookie)).statusCode, 200);
});

test('closed results export is a real XLS with final scores, text identifiers and competition date', async (t) => {
  const f = await setup(t);
  const url = '/api/v1/admin/competitions/competition/results-export';
  assert.equal((await f.app.inject({ url })).statusCode, 401);
  assert.equal((await f.app.inject({ url, headers: f.admin })).statusCode, 409);
  assert.equal(
    (await f.app.inject({ url: url.replace('competition/results', 'missing/results'), headers: f.admin })).statusCode,
    404,
  );
  const code = (await f.start())[0]!;
  assert.equal((await f.app.inject({ url, headers: f.admin })).statusCode, 409);
  const session = await f.exchange(code);
  assert.equal((await f.save(code, session.cookie)).statusCode, 200);
  assert.equal(
    (await f.save(code, session.cookie, { participantId: 'c', expectedVersion: 1, arrows: [null, '8'], submit: false }))
      .statusCode,
    200,
  );
  f.db.insert(clubs).values({ clubNumber: '0012', name: 'Club & Vrienden' }).run();
  f.db
    .update(participants)
    .set({ federationNumber: '000123', name: '=Ren\u00e9', clubNumber: '0012' })
    .where(eq(participants.id, 'a'))
    .run();
  f.db.update(competitions).set({ name: 'Jaarlijkse Wedstrijd' }).where(eq(competitions.id, 'competition')).run();
  const close = await f.app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/competitions/competition/status',
    headers: f.admin,
    payload: { status: 'Closed' },
  });
  assert.equal(close.statusCode, 200, close.body);
  const response = await f.app.inject({ url, headers: f.admin });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['content-type'], 'application/vnd.ms-excel');
  assert.match(
    String(response.headers['content-disposition']),
    /filename\*=UTF-8''jaarlijkse_wedstrijd_2026-11-01\.xls/,
  );
  assert.match(String(response.headers['cache-control']), /no-store/);
  assert.equal(response.rawPayload.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
  const workbook = read(response.rawPayload, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
  assert.deepEqual(utils.sheet_to_json(sheet, { header: 1 }), [
    ['bondsnummer', 'naam', 'clubnummer', 'clubnaam', 'totaalscore', 'gemiddelde'],
    ['000123', '=Ren\u00e9', '0012', 'Club & Vrienden', 19, 4.75],
    ['c', 'Archer C', 'club', 'Archery club', 8, 2],
    ['other', 'Other lane archer', 'club', 'Archery club', 0, 0],
  ]);
  assert.equal(sheet.B2.t, 's');
  assert.equal(sheet.B2.f, undefined);
  assert.equal(sheet.F2.t, 'n');
  assert.equal(sheet.F2.w, '4.75');
  f.db
    .insert(competitions)
    .values({
      id: 'empty',
      name: 'Empty competition',
      date: '2026-11-02',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: 'range',
      status: 'Closed',
    })
    .run();
  const empty = await f.app.inject({ url: url.replace('competition/results', 'empty/results'), headers: f.admin });
  assert.equal(empty.statusCode, 200);
  const emptyBook = read(empty.rawPayload, { type: 'buffer' });
  assert.deepEqual(utils.sheet_to_json(emptyBook.Sheets[emptyBook.SheetNames[0]!]!, { header: 1 }), [
    ['bondsnummer', 'naam', 'clubnummer', 'clubnaam', 'totaalscore', 'gemiddelde'],
  ]);
});
