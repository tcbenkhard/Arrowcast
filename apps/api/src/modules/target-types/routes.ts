import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { administratorOnly } from '../auth/policies.js';
import { TargetTypeService } from './service.js';

export async function targetTypeRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const service = new TargetTypeService(context);
  app.get(
    '/target-types',
    {
      schema: { response: { 200: { type: 'array', items: { type: 'string' } } } },
    },
    async () => service.list(),
  );

  app.post<{ Body: { name: string } }>(
    '/target-types',
    {
      onRequest: administratorOnly,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' } },
        },
        response: { 201: { type: 'string' } },
      },
    },
    async (request, reply) => {
      const name = service.create(request.body.name.trim());
      return reply.type('application/json').code(201).send(JSON.stringify(name));
    },
  );

  app.delete<{ Body: { names: string[] } }>(
    '/target-types',
    {
      onRequest: administratorOnly,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['names'],
          properties: {
            names: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              uniqueItems: true,
              items: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
            },
          },
        },
      },
    },
    async (request) => ({ removed: service.remove(request.body.names) }),
  );
}
