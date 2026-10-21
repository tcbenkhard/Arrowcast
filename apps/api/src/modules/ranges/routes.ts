import { t } from '@arrowcast/contracts/i18n';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { competitionLanes, competitions, lanes, rangeDistances, ranges } from '../../db/schema.js';
import { administratorOnly } from '../auth/policies.js';

interface CreateRangeBody {
  name: string;
  supportedDistancesMeters: number[];
  lanes: { number: number }[];
}

const laneNumberSchema = { type: 'integer', minimum: 1, maximum: 2147483647 };
const distanceSchema = { type: 'number', exclusiveMinimum: 0 };
const rangeSchema = {
  type: 'object',
  required: ['id', 'name', 'supportedDistancesMeters', 'lanes'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    supportedDistancesMeters: { type: 'array', items: distanceSchema },
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'number'],
        additionalProperties: false,
        properties: { id: { type: 'string' }, number: laneNumberSchema },
      },
    },
  },
};

const rangeBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'supportedDistancesMeters', 'lanes'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
    supportedDistancesMeters: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: distanceSchema,
    },
    lanes: {
      type: 'array',
      minItems: 1,
      maxItems: 1000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number'],
        properties: { number: laneNumberSchema },
      },
    },
  },
};

export async function rangeRoutes(app: FastifyInstance, options: { db: AppDatabase }) {
  app.get(
    '/ranges',
    {
      schema: { response: { 200: { type: 'array', items: rangeSchema } } },
    },
    async () =>
      options.db.transaction((tx) => {
        const distancesByRange = new Map<string, number[]>();
        for (const distance of tx.select().from(rangeDistances).orderBy(rangeDistances.distanceMeters).all()) {
          const values = distancesByRange.get(distance.rangeId) ?? [];
          values.push(distance.distanceMeters);
          distancesByRange.set(distance.rangeId, values);
        }
        const lanesByRange = new Map<string, { id: string; number: number }[]>();
        for (const lane of tx.select().from(lanes).orderBy(lanes.number).all()) {
          const values = lanesByRange.get(lane.rangeId) ?? [];
          values.push({ id: lane.id, number: lane.number });
          lanesByRange.set(lane.rangeId, values);
        }
        return tx
          .select()
          .from(ranges)
          .orderBy(ranges.name, ranges.id)
          .all()
          .map((range) => ({
            ...range,
            supportedDistancesMeters: distancesByRange.get(range.id) ?? [],
            lanes: lanesByRange.get(range.id) ?? [],
          }));
      }),
  );
  app.post<{ Body: CreateRangeBody }>(
    '/ranges',
    {
      onRequest: administratorOnly,
      schema: {
        body: rangeBodySchema,
        response: {
          201: rangeSchema,
        },
      },
    },
    async (request, reply) => {
      const { name, supportedDistancesMeters, lanes: requestedLanes } = request.body;
      if (new Set(requestedLanes.map((lane) => lane.number)).size !== requestedLanes.length) {
        return reply.code(400).send({ message: t('routes.lane_numbers_must_be_unique_within_a_range') });
      }

      const range = options.db.transaction((tx) => {
        const created = tx.insert(ranges).values({ id: randomUUID(), name: name.trim() }).returning().get();
        // Insert separately to stay below SQLite's bound-parameter limit for large ranges.
        for (const distanceMeters of supportedDistancesMeters) {
          tx.insert(rangeDistances).values({ rangeId: created.id, distanceMeters }).run();
        }
        const createdLanes = requestedLanes.map(({ number }) =>
          tx.insert(lanes).values({ id: randomUUID(), rangeId: created.id, number }).returning().get(),
        );
        return {
          ...created,
          supportedDistancesMeters,
          lanes: createdLanes.map(({ id, number }) => ({ id, number })),
        };
      });
      return reply.code(201).send(range);
    },
  );
  app.put<{ Params: { id: string }; Body: CreateRangeBody }>(
    '/ranges/:id',
    { onRequest: administratorOnly, schema: { body: rangeBodySchema, response: { 200: rangeSchema } } },
    async (request, reply) => {
      const { name, supportedDistancesMeters, lanes: requestedLanes } = request.body;
      const numbers = new Set(requestedLanes.map((lane) => lane.number));
      if (numbers.size !== requestedLanes.length) {
        return reply.code(400).send({ message: t('routes.lane_numbers_must_be_unique_within_a_range') });
      }
      const result = options.db.transaction((tx) => {
        const id = request.params.id;
        if (!tx.select().from(ranges).where(eq(ranges.id, id)).get()) return { status: 404 } as const;
        const existing = tx.select().from(lanes).where(eq(lanes.rangeId, id)).all();
        const removed = existing.filter((lane) => !numbers.has(lane.number));
        const assignments = tx.select().from(competitionLanes).where(eq(competitionLanes.rangeId, id)).all();
        if (
          assignments.some(
            (assignment) =>
              removed.some((lane) => lane.id === assignment.laneId) ||
              !supportedDistancesMeters.includes(assignment.distanceMeters),
          )
        )
          return { status: 409 } as const;
        tx.update(ranges).set({ name: name.trim() }).where(eq(ranges.id, id)).run();
        for (const lane of removed) tx.delete(lanes).where(eq(lanes.id, lane.id)).run();
        const updatedLanes = requestedLanes.map(({ number }) => {
          const existingLane = existing.find((lane) => lane.number === number);
          return existingLane ?? tx.insert(lanes).values({ id: randomUUID(), rangeId: id, number }).returning().get();
        });
        const existingDistances = tx.select().from(rangeDistances).where(eq(rangeDistances.rangeId, id)).all();
        for (const distance of existingDistances) {
          if (!supportedDistancesMeters.includes(distance.distanceMeters)) {
            tx.delete(rangeDistances)
              .where(and(eq(rangeDistances.rangeId, id), eq(rangeDistances.distanceMeters, distance.distanceMeters)))
              .run();
          }
        }
        for (const distanceMeters of supportedDistancesMeters) {
          if (!existingDistances.some((distance) => distance.distanceMeters === distanceMeters)) {
            tx.insert(rangeDistances).values({ rangeId: id, distanceMeters }).run();
          }
        }
        return {
          status: 200,
          range: {
            id,
            name: name.trim(),
            supportedDistancesMeters,
            lanes: updatedLanes.map(({ id, number }) => ({ id, number })),
          },
        } as const;
      });
      if (result.status !== 200)
        return reply
          .code(result.status)
          .send({ message: t(result.status === 409 ? 'RangesPage.edit_conflict' : 'RangesPage.not_found') });
      return result.range;
    },
  );
  app.delete<{ Params: { id: string } }>('/ranges/:id', { onRequest: administratorOnly }, async (request, reply) => {
    const status = options.db.transaction((tx) => {
      const id = request.params.id;
      if (!tx.select().from(ranges).where(eq(ranges.id, id)).get()) return 404;
      if (tx.select().from(competitions).where(eq(competitions.rangeId, id)).get()) return 409;
      tx.delete(ranges).where(eq(ranges.id, id)).run();
      return 204;
    });
    if (status === 204) return reply.code(204).send();
    return reply
      .code(status)
      .send({ message: t(status === 409 ? 'RangesPage.remove_conflict' : 'RangesPage.not_found') });
  });
}
