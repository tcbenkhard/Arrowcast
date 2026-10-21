import { loginAdmin } from './helpers.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import SQLite from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import {
  bowTypes,
  clubs,
  competitionLanes,
  competitionParticipants,
  competitions,
  lanes,
  participants,
  rangeDistances,
  ranges,
  targetTypes,
} from '../src/db/schema.js';
import { AssignmentError, planAssignments } from '../src/modules/competitions/assignments.js';

const laneList = Array.from({ length: 7 }, (_, i) => ({
  laneId: `lane-${i}`,
  number: i + 1,
  numberOfTargets: 2,
  targetType: '40 cm',
}));
const people = (count: number, targetType = '40 cm') =>
  Array.from({ length: count }, (_, i) => ({
    participantId: `person-${i}`,
    targetType,
    laneId: null,
    targetLetter: null,
  }));

test('planner minimizes lines, spreads shooters, matches targets and preserves existing places', () => {
  const plan = planAssignments(laneList, people(8));
  assert.deepEqual([...new Set(plan.map((p) => p.targetLetter))].sort(), ['A', 'B']);
  for (const letter of ['A', 'B']) {
    const numbers = plan
      .filter((p) => p.targetLetter === letter)
      .map((p) => laneList.find((l) => l.laneId === p.laneId)!.number)
      .sort((a, b) => a - b);
    assert.deepEqual(numbers, [1, 3, 5, 7]);
  }
  assert.equal(
    planAssignments(laneList, people(7)).every((p) => p.targetLetter === 'A'),
    true,
  );
  assert.deepEqual([...new Set(planAssignments(laneList, people(15)).map((p) => p.targetLetter))].sort(), [
    'A',
    'B',
    'C',
  ]);
  const fixed = { ...people(1)[0]!, laneId: 'lane-3', targetLetter: 'B' as const };
  const added = planAssignments(laneList, [
    fixed,
    ...people(4).map((p) => ({ ...p, participantId: `new-${p.participantId}` })),
  ]);
  assert.equal(added.length, 4);
  assert.ok(!added.some((p) => p.laneId === fixed.laneId && p.targetLetter === fixed.targetLetter));
  assert.ok(added.every((p) => ['A', 'B'].includes(p.targetLetter)));
  const mixed = [
    { ...laneList[0]!, targetType: '60 cm' },
    { ...laneList[1]!, numberOfTargets: 1 },
  ];
  const matched = planAssignments(mixed, [
    ...people(2),
    ...people(4, '60 cm').map((p) => ({ ...p, participantId: `other-${p.participantId}` })),
  ]);
  assert.deepEqual(
    matched
      .filter((p) => p.participantId.startsWith('person'))
      .map((p) => p.targetLetter)
      .sort(),
    ['A', 'C'],
  );
  assert.ok(matched.filter((p) => p.participantId.startsWith('other')).every((p) => p.laneId === mixed[0]!.laneId));
  const twoLines = planAssignments(mixed, [
    ...people(2),
    ...people(2, '60 cm').map((p) => ({ ...p, participantId: `other-${p.participantId}` })),
  ]);
  assert.deepEqual([...new Set(twoLines.map((p) => p.targetLetter))].sort(), ['A', 'C']);
  assert.throws(() => planAssignments(mixed, people(3)), AssignmentError);
  assert.throws(() => planAssignments(laneList, people(29)), AssignmentError);
});

test('planner mixes clubs across letters and uses free lanes before repeating clubmates', () => {
  const entrants = people(8).map((p, i) => ({ ...p, clubNumber: i < 4 ? 'first' : 'second' }));
  const mixed = planAssignments(laneList.slice(0, 4), entrants);
  for (const lane of laneList.slice(0, 4)) {
    const clubsOnLane = mixed
      .filter((p) => p.laneId === lane.laneId)
      .map((p) => entrants.find((person) => person.participantId === p.participantId)!.clubNumber);
    assert.deepEqual(clubsOnLane.sort(), ['first', 'second']);
  }
  const sameClub = planAssignments(
    laneList,
    entrants.map((p) => ({ ...p, clubNumber: 'only' })),
  );
  assert.equal(new Set(sameClub.map((p) => p.laneId)).size, 7);
  assert.equal(sameClub.filter((p) => p.targetLetter === 'A').length, 4);
  assert.equal(sameClub.filter((p) => p.targetLetter === 'B').length, 4);
  assert.equal(new Set(sameClub.map((p) => `${p.laneId}/${p.targetLetter}`)).size, 8);
});

test('planner considers fixed clubmates and allows unavoidable repeats on matching targets', () => {
  const fixed = { ...people(1)[0]!, clubNumber: 'club', laneId: 'lane-0', targetLetter: 'A' as const };
  const late = { ...people(1)[0]!, participantId: 'late', clubNumber: 'club' };
  const plan = planAssignments(laneList.slice(0, 2), [fixed, late]);
  assert.deepEqual(plan, [{ participantId: 'late', laneId: 'lane-1', targetLetter: 'A' }]);
  const restricted = [{ ...laneList[0]! }, { ...laneList[1]!, targetType: '60 cm' }];
  const unavoidable = planAssignments(restricted, [fixed, late]);
  assert.deepEqual(unavoidable, [{ participantId: 'late', laneId: 'lane-0', targetLetter: 'B' }]);
  const singleLane = planAssignments(
    laneList.slice(0, 1),
    people(4).map((p) => ({ ...p, clubNumber: 'club' })),
  );
  assert.equal(singleLane.length, 4);
  assert.equal(new Set(singleLane.map((p) => p.targetLetter)).size, 4);
});

test('check-in persists assignments, fills open places on re-entry, and rebuilds checked-in participants only', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-assignments-'));
  const databasePath = join(directory, 'test.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = openDatabase(databasePath);
  const db = database.db;
  db.insert(ranges).values({ id: 'range', name: 'Indoor' }).run();
  db.insert(rangeDistances).values({ rangeId: 'range', distanceMeters: 18 }).run();
  db.insert(clubs).values({ clubNumber: 'club', name: 'Club' }).run();
  db.insert(clubs).values({ clubNumber: 'other', name: 'Other club' }).run();
  db.insert(bowTypes).values({ name: 'Recurve' }).onConflictDoNothing().run();
  db.insert(targetTypes).values({ name: '40 cm' }).run();
  db.insert(competitions)
    .values({
      id: 'competition',
      name: 'Test',
      date: '2026-11-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: 'range',
    })
    .run();
  for (const lane of laneList.slice(0, 3)) {
    db.insert(lanes).values({ id: lane.laneId, number: lane.number, rangeId: 'range' }).run();
    db.insert(competitionLanes)
      .values({ ...lane, competitionId: 'competition', rangeId: 'range', distanceMeters: 18 })
      .run();
  }
  const addPerson = (id: string, clubNumber = 'club') => {
    db.insert(participants).values({ id, federationNumber: id, name: id, clubNumber }).run();
    db.insert(competitionParticipants)
      .values({ competitionId: 'competition', participantId: id, bowType: 'Recurve', targetType: '40 cm' })
      .run();
  };
  for (let i = 0; i < 5; i++) addPerson(`person-${i}`, i < 3 ? 'club' : 'other');
  const app = buildApp({ jwtSecret: 'assignments-secret-with-at-least-thirty-two-bytes', databasePath });
  const base = '/api/v1/admin/competitions/competition';
  try {
    const login = await loginAdmin(app);
    const headers = { authorization: `Bearer ${login.json().token}` };
    const status = (value: string) =>
      app.inject({ method: 'PATCH', url: `${base}/status`, headers, payload: { status: value } });
    const getPeople = async () => (await app.inject({ url: `${base}/participants`, headers })).json();
    const reassign = () => app.inject({ method: 'POST', url: `${base}/assignments/reassign`, headers });
    assert.equal((await app.inject({ method: 'POST', url: `${base}/assignments/reassign` })).statusCode, 401);
    assert.equal((await reassign()).statusCode, 409);
    assert.equal((await status('Check-in')).statusCode, 200);
    const initial = await getPeople();
    assert.ok(initial.every((p: any) => p.laneId && p.targetLetter && p.checkedIn === false));
    for (const lane of laneList.slice(0, 3)) {
      const onLane = initial.filter((p: any) => p.laneId === lane.laneId);
      assert.equal(new Set(onLane.map((p: any) => p.clubNumber)).size, onLane.length);
    }
    assert.equal((await status('Scheduled')).statusCode, 200);
    addPerson('late');
    assert.equal((await status('Check-in')).statusCode, 200);
    const filled = await getPeople();
    assert.deepEqual(
      filled.filter((p: any) => p.id !== 'late'),
      initial,
    );
    assert.ok(filled.every((p: any) => ['A', 'B'].includes(p.targetLetter)));
    const checkIn = (id: string, checkedIn: boolean) =>
      app.inject({ method: 'PATCH', url: `${base}/participants/${id}/check-in`, headers, payload: { checkedIn } });
    assert.equal((await checkIn('missing', true)).statusCode, 404);
    assert.equal((await checkIn('person-0', true)).statusCode, 200);
    assert.equal((await checkIn('person-1', true)).statusCode, 200);
    const beforeFailure = await getPeople();
    db.$client.exec(`CREATE TRIGGER fail_reassignment BEFORE UPDATE OF lane_id ON competition_participants
      WHEN NEW.participant_id = 'person-1' AND NEW.lane_id IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'simulated assignment failure'); END`);
    assert.equal((await reassign()).statusCode, 500);
    assert.deepEqual(await getPeople(), beforeFailure);
    db.$client.exec('DROP TRIGGER fail_reassignment');
    assert.equal((await reassign()).statusCode, 200);
    const rebuilt = await getPeople();
    const present = rebuilt.filter((p: any) => p.checkedIn);
    assert.equal(present.length, 2);
    assert.ok(present.every((p: any) => p.targetLetter === 'A'));
    assert.deepEqual(present.map((p: any) => p.laneId).sort(), ['lane-0', 'lane-2']);
    assert.ok(rebuilt.filter((p: any) => !p.checkedIn).every((p: any) => p.laneId === null && p.targetLetter === null));
    assert.equal((await checkIn('person-1', false)).statusCode, 200);
    assert.equal((await checkIn('person-1', true)).statusCode, 200);
    assert.equal((await status('Scheduled')).statusCode, 200);
    assert.equal((await checkIn('person-0', false)).statusCode, 409);
    for (let i = 5; i < 13; i++) addPerson(`person-${i}`);
    assert.equal((await status('Check-in')).statusCode, 409);
    assert.equal((await app.inject({ url: base, headers })).json().status, 'Scheduled');
    assert.deepEqual(
      (await getPeople()).filter((p: any) => p.laneId),
      present,
    );
    const occupied = db
      .select()
      .from(competitionParticipants)
      .all()
      .find((p) => p.laneId)!;
    assert.throws(() =>
      db
        .insert(competitionParticipants)
        .values({ ...occupied, participantId: 'person-12' })
        .onConflictDoUpdate({
          target: [competitionParticipants.competitionId, competitionParticipants.participantId],
          set: { laneId: occupied.laneId, targetLetter: occupied.targetLetter },
        })
        .run(),
    );
  } finally {
    await app.close();
    database.close();
  }
  const reopened = openDatabase(databasePath);
  try {
    assert.equal(
      reopened.db
        .select()
        .from(competitionParticipants)
        .all()
        .filter((p) => p.checkedIn && p.laneId).length,
      2,
    );
  } finally {
    reopened.close();
  }
});

test('assignment migration preserves registrations and caps legacy lane target counts at two', () => {
  const client = new SQLite(':memory:');
  try {
    client.pragma('foreign_keys = ON');
    const journal = JSON.parse(
      readFileSync(new URL('../../../migrations/meta/_journal.json', import.meta.url), 'utf8'),
    );
    for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx < 14)) {
      client.exec(readFileSync(new URL(`../../../migrations/${entry.tag}.sql`, import.meta.url), 'utf8'));
    }
    client.exec(`INSERT INTO ranges VALUES ('range', 'Indoor');
      INSERT INTO lanes VALUES ('lane', 'range', 1);
      INSERT INTO range_distances VALUES ('range', 18);
      INSERT INTO competitions VALUES ('competition', 'Test', '2026-11-01', '09:00', '12:00', 'range', 'Scheduled');
      INSERT INTO competition_lanes VALUES ('competition', 'range', 'lane', 18, '40 cm', 4);
      INSERT INTO clubs VALUES ('club', 'Club');
      INSERT INTO participants VALUES ('person', '123', 'Archer', 'club');
      INSERT INTO competition_participants VALUES ('competition', 'person', NULL, NULL);`);
    client.transaction(() =>
      client.exec(readFileSync(new URL('../../../migrations/0014_shooting_assignments.sql', import.meta.url), 'utf8')),
    )();
    assert.deepEqual(client.prepare('SELECT checked_in, lane_id, target_letter FROM competition_participants').get(), {
      checked_in: 0,
      lane_id: null,
      target_letter: null,
    });
    assert.deepEqual(client.prepare('SELECT number_of_targets FROM competition_lanes').get(), { number_of_targets: 2 });
    assert.deepEqual(client.pragma('foreign_key_check'), []);
    assert.throws(() => client.exec('UPDATE competition_lanes SET number_of_targets = 3'));
    assert.throws(() => client.exec("UPDATE competition_participants SET target_letter = 'A'"));
  } finally {
    client.close();
  }
});
