import { and, eq } from 'drizzle-orm';
import { DatabaseClient } from '../../db/context.js';
import { competitionLanes, competitions, lanes, rangeDistances, ranges } from '../../db/schema.js';

export class RangeDatabaseClient extends DatabaseClient {
  list() {
    const distancesByRange = new Map<string, number[]>();
    for (const distance of this.db.select().from(rangeDistances).orderBy(rangeDistances.distanceMeters).all()) {
      const values = distancesByRange.get(distance.rangeId) ?? [];
      values.push(distance.distanceMeters);
      distancesByRange.set(distance.rangeId, values);
    }
    const lanesByRange = new Map<string, { id: string; number: number }[]>();
    for (const lane of this.db.select().from(lanes).orderBy(lanes.number).all()) {
      const values = lanesByRange.get(lane.rangeId) ?? [];
      values.push({ id: lane.id, number: lane.number });
      lanesByRange.set(lane.rangeId, values);
    }
    return this.db
      .select()
      .from(ranges)
      .orderBy(ranges.name, ranges.id)
      .all()
      .map((range) => ({
        ...range,
        supportedDistancesMeters: distancesByRange.get(range.id) ?? [],
        lanes: lanesByRange.get(range.id) ?? [],
      }));
  }

  find(id: string) {
    return this.db.select().from(ranges).where(eq(ranges.id, id)).get();
  }

  lanes(rangeId: string) {
    return this.db.select().from(lanes).where(eq(lanes.rangeId, rangeId)).all();
  }

  assignments(rangeId: string) {
    return this.db.select().from(competitionLanes).where(eq(competitionLanes.rangeId, rangeId)).all();
  }

  distances(rangeId: string) {
    return this.db.select().from(rangeDistances).where(eq(rangeDistances.rangeId, rangeId)).all();
  }

  hasCompetitions(rangeId: string) {
    return !!this.db.select().from(competitions).where(eq(competitions.rangeId, rangeId)).get();
  }

  create(id: string, name: string) {
    return this.db.insert(ranges).values({ id, name }).returning().get();
  }

  rename(id: string, name: string) {
    this.db.update(ranges).set({ name }).where(eq(ranges.id, id)).run();
  }

  remove(id: string) {
    this.db.delete(ranges).where(eq(ranges.id, id)).run();
  }

  createLane(id: string, rangeId: string, number: number) {
    return this.db.insert(lanes).values({ id, rangeId, number }).returning().get();
  }

  removeLane(id: string) {
    this.db.delete(lanes).where(eq(lanes.id, id)).run();
  }

  addDistance(rangeId: string, distanceMeters: number) {
    this.db.insert(rangeDistances).values({ rangeId, distanceMeters }).run();
  }

  removeDistance(rangeId: string, distanceMeters: number) {
    this.db
      .delete(rangeDistances)
      .where(and(eq(rangeDistances.rangeId, rangeId), eq(rangeDistances.distanceMeters, distanceMeters)))
      .run();
  }
}
