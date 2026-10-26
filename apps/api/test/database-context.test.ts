import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseConnection } from '../src/db/index.js';
import { lanes, rangeDistances, ranges } from '../src/db/schema.js';
import { CompetitionService } from '../src/modules/competitions/service.js';
import { CompetitionLaneService } from '../src/modules/competitions/lanes.js';
import { CompetitionLifecycleService } from '../src/modules/competitions/lifecycle.js';
import { laneScoringGrants } from '../src/db/schema.js';
import { ApplicationError } from '../src/shared/errors.js';

test('services and their clients share a transaction, including nested service transactions', () => {
  const database = new DatabaseConnection(':memory:');
  try {
    database.db.insert(ranges).values({ id: 'range', name: 'Indoor' }).run();
    database.db.insert(lanes).values({ id: 'lane', rangeId: 'range', number: 1 }).run();
    database.db.insert(rangeDistances).values({ rangeId: 'range', distanceMeters: 18 }).run();
    const details = {
      name: 'Club shoot',
      date: '2026-11-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: 'range',
      lanes: [{ laneId: 'lane', distanceMeters: 18 }],
    };

    assert.throws(
      () =>
        database.context.transaction((scope) => {
          const competitions = new CompetitionService(scope);
          const competition = competitions.create(details);
          new CompetitionLaneService(scope).configure(competition.id, 'lane', { targetType: null, numberOfTargets: 2 });
          // A later operation must roll back the nested creation and the other client's lane write.
          competitions.create({ ...details, endingTime: '08:00' });
        }),
      ApplicationError,
    );

    assert.deepEqual(new CompetitionService(database.context).list(), []);
    const created = new CompetitionService(database.context).create(details);
    assert.equal(new CompetitionLaneService(database.context).list(created.id)[0]!.numberOfTargets, 1);
  } finally {
    database.close();
  }
});

test('a rejected status update rolls back grants created earlier in the transition', () => {
  const database = new DatabaseConnection(':memory:');
  try {
    database.db.insert(ranges).values({ id: 'range', name: 'Indoor' }).run();
    database.db.insert(lanes).values({ id: 'lane', rangeId: 'range', number: 1 }).run();
    database.db.insert(rangeDistances).values({ rangeId: 'range', distanceMeters: 18 }).run();
    const competitions = new CompetitionService(database.context);
    const competition = competitions.create({
      name: 'Club shoot',
      date: '2026-11-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: 'range',
      lanes: [{ laneId: 'lane', distanceMeters: 18 }],
    });
    // Simulate a status changing between reading it and the conditional update.
    database.db.$client.exec(`
      CREATE TRIGGER change_status_during_grant_issue AFTER INSERT ON lane_scoring_grants
      BEGIN
        UPDATE competitions SET status = 'Active' WHERE id = NEW.competition_id;
      END;
    `);

    assert.throws(
      () => new CompetitionLifecycleService(database.context).changeStatus(competition.id, 'Check-in'),
      (error: unknown) => error instanceof ApplicationError && error.code === 409,
    );
    assert.equal(competitions.get(competition.id).status, 'Scheduled');
    assert.deepEqual(database.db.select().from(laneScoringGrants).all(), []);
  } finally {
    database.close();
  }
});
