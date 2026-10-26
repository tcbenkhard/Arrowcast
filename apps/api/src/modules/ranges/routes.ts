import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { administratorOnly } from '../auth/policies.js';
import { RangeService, type RangeInput } from './service.js';
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

export async function rangeRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const service = new RangeService(context);
  app.get('/ranges', { schema: { response: { 200: { type: 'array', items: rangeSchema } } } }, async () =>
    service.list(),
  );
  app.post<{ Body: RangeInput }>(
    '/ranges',
    { onRequest: administratorOnly, schema: { body: rangeBodySchema, response: { 201: rangeSchema } } },
    async (request, reply) => reply.code(201).send(service.create({ ...request.body, name: request.body.name.trim() })),
  );
  app.put<{ Params: { id: string }; Body: RangeInput }>(
    '/ranges/:id',
    { onRequest: administratorOnly, schema: { body: rangeBodySchema, response: { 200: rangeSchema } } },
    async (request) => service.update(request.params.id, { ...request.body, name: request.body.name.trim() }),
  );
  app.delete<{ Params: { id: string } }>('/ranges/:id', { onRequest: administratorOnly }, async (request, reply) => {
    service.remove(request.params.id);
    return reply.code(204).send();
  });
}
