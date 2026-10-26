import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseConnection } from '../src/db/index.js';
import { DatabaseContext } from '../src/db/context.js';
import { CompetitionService } from '../src/modules/competitions/service.js';
import { CompetitionLifecycleService } from '../src/modules/competitions/lifecycle.js';
import { CompetitionLaneService } from '../src/modules/competitions/lanes.js';
import {
  clubs,
  competitionParticipants,
  laneScoringGrants,
  lanes,
  participants,
  rangeDistances,
  ranges,
  targetTypes,
} from '../src/db/schema.js';
import { ApplicationError } from '../src/shared/errors.js';

function setup() {
  const database = new DatabaseConnection(':memory:');
  database.db.insert(ranges).values({ id: 'range', name: 'Indoor' }).run();
  database.db.insert(lanes).values({ id: 'lane', rangeId: 'range', number: 1 }).run();
  database.db.insert(rangeDistances).values({ rangeId: 'range', distanceMeters: 18 }).run();
  return database;
}

const details = {
  name: ' Club shoot ',
  date: '2026-11-01',
  startingTime: '09:00',
  endingTime: '12:00',
  rangeId: 'range',
  lanes: [{ laneId: 'lane', distanceMeters: 18 }],
};

test('competition services validate configuration and preserve stored data on rejected edits without HTTP', () => {
  const database = setup();
  const { db } = database;
  const service = new CompetitionService(new DatabaseContext(db));
  try {
    for (const invalid of [
      { date: '2026-02-30' },
      { endingTime: '08:00' },
      { lanes: [details.lanes[0], details.lanes[0]] },
      { lanes: [{ laneId: 'lane', distanceMeters: 25 }] },
    ]) {
      assert.throws(() => service.create({ ...details, ...invalid }), ApplicationError);
      assert.deepEqual(service.list(), []);
    }
    const created = service.create(details);
    assert.equal(created.name, 'Club shoot');
    const { rangeId: _rangeId, lanes: _lanes, ...updated } = details;
    assert.throws(
      () =>
        service.update(created.id, {
          ...updated,
          defaultTargetType: null,
          numberOfRounds: 10,
          arrowsPerRound: 3,
          name: 'Must not persist',
          rangeId: 'missing',
          lanes: details.lanes,
        }),
      ApplicationError,
    );
    assert.equal(service.get(created.id).name, 'Club shoot');
  } finally {
    database.close();
  }
});

test('failed check-in rolls back assignments and scoring access, and can be retried after lane configuration', () => {
  const database = setup();
  const { db } = database;
  const context = new DatabaseContext(db);
  const service = new CompetitionService(context);
  const lifecycle = new CompetitionLifecycleService(context);
  const laneService = new CompetitionLaneService(context);
  try {
    db.insert(targetTypes).values({ name: 'Service target' }).run();
    db.insert(clubs).values({ clubNumber: '001', name: 'Archery' }).run();
    db.insert(participants).values({ id: 'person', name: 'Alex', federationNumber: '123', clubNumber: '001' }).run();
    const created = service.create(details);
    db.insert(competitionParticipants)
      .values({ competitionId: created.id, participantId: 'person', targetType: 'Service target' })
      .run();

    assert.throws(() => lifecycle.changeStatus(created.id, 'Check-in'), ApplicationError);
    assert.equal(service.get(created.id).status, 'Scheduled');
    assert.equal(db.select().from(competitionParticipants).get()!.laneId, null);
    assert.deepEqual(db.select().from(laneScoringGrants).all(), []);

    laneService.configure(created.id, 'lane', { targetType: 'Service target', numberOfTargets: 1 });
    const checkedIn = lifecycle.changeStatus(created.id, 'Check-in');
    assert.equal(checkedIn.status, 'Check-in');
    assert.equal(checkedIn.qrCodes?.length, 1);
    assert.equal(db.select().from(competitionParticipants).get()!.laneId, 'lane');
  } finally {
    database.close();
  }
});
