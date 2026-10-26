import { t } from '@arrowcast/contracts/i18n';
import { randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { RangeDatabaseClient } from './database-client.js';

export interface RangeInput {
  name: string;
  supportedDistancesMeters: number[];
  lanes: { number: number }[];
}

export class RangeService {
  private readonly ranges: RangeDatabaseClient;

  constructor(private readonly context: DatabaseContext) {
    this.ranges = new RangeDatabaseClient(context);
  }

  list() {
    return this.context.transaction((context) => new RangeDatabaseClient(context).list());
  }

  create(input: RangeInput) {
    this.laneNumbers(input.lanes);
    return this.context.transaction((context) => new RangeService(context).createInTransaction(input));
  }

  private createInTransaction(input: RangeInput) {
    const created = this.ranges.create(randomUUID(), input.name);
    // Insert separately to stay below SQLite's bound-parameter limit for large ranges.
    for (const distanceMeters of input.supportedDistancesMeters) {
      this.ranges.addDistance(created.id, distanceMeters);
    }
    const createdLanes = input.lanes.map(({ number }) => this.ranges.createLane(randomUUID(), created.id, number));
    return {
      ...created,
      supportedDistancesMeters: input.supportedDistancesMeters,
      lanes: createdLanes.map(({ id, number }) => ({ id, number })),
    };
  }

  update(id: string, input: RangeInput) {
    const numbers = this.laneNumbers(input.lanes);
    return this.context.transaction((context) => new RangeService(context).updateInTransaction(id, input, numbers));
  }

  private updateInTransaction(id: string, input: RangeInput, numbers: Set<number>) {
    const { name, supportedDistancesMeters, lanes: requestedLanes } = input;
    this.requireRange(id);
    const existing = this.ranges.lanes(id);
    const removed = existing.filter((lane) => !numbers.has(lane.number));
    const removedIds = new Set(removed.map((lane) => lane.id));
    if (
      this.ranges
        .assignments(id)
        .some(
          (assignment) =>
            removedIds.has(assignment.laneId) || !supportedDistancesMeters.includes(assignment.distanceMeters),
        )
    ) {
      throw new ApplicationError(t('RangesPage.edit_conflict'), 409);
    }
    this.ranges.rename(id, name);
    for (const lane of removed) this.ranges.removeLane(lane.id);
    const existingByNumber = new Map(existing.map((lane) => [lane.number, lane]));
    const updatedLanes = requestedLanes.map(
      ({ number }) => existingByNumber.get(number) ?? this.ranges.createLane(randomUUID(), id, number),
    );
    const existingDistances = this.ranges.distances(id);
    for (const distance of existingDistances) {
      if (!supportedDistancesMeters.includes(distance.distanceMeters)) {
        this.ranges.removeDistance(id, distance.distanceMeters);
      }
    }
    const existingMeters = new Set(existingDistances.map((distance) => distance.distanceMeters));
    for (const distanceMeters of supportedDistancesMeters) {
      if (!existingMeters.has(distanceMeters)) this.ranges.addDistance(id, distanceMeters);
    }
    return { id, name, supportedDistancesMeters, lanes: updatedLanes.map(({ id, number }) => ({ id, number })) };
  }

  remove(id: string) {
    this.context.transaction((context) => new RangeService(context).removeInTransaction(id));
  }

  private removeInTransaction(id: string) {
    this.requireRange(id);
    if (this.ranges.hasCompetitions(id)) {
      throw new ApplicationError(t('RangesPage.remove_conflict'), 409);
    }
    this.ranges.remove(id);
  }

  private laneNumbers(requestedLanes: RangeInput['lanes']) {
    const numbers = new Set(requestedLanes.map((lane) => lane.number));
    if (numbers.size !== requestedLanes.length) {
      throw new ApplicationError(t('routes.lane_numbers_must_be_unique_within_a_range'), 400);
    }
    return numbers;
  }

  private requireRange(id: string) {
    if (!this.ranges.find(id)) throw new ApplicationError(t('RangesPage.not_found'), 404);
  }
}
