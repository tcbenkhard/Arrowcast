import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { ApiTokenService } from './service.js';

const tokenSummaryProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  createdDate: { type: 'integer' },
};

export async function apiTokenRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const service = new ApiTokenService(context);
  app.get(
    '/api-tokens',
    {
      schema: {
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name', 'createdDate'],
              properties: tokenSummaryProperties,
            },
          },
        },
      },
    },
    async () => service.list(),
  );
  app.post<{ Body: { name: string } }>(
    '/api-tokens',
    {
      bodyLimit: 1024,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' } },
        },
        response: {
          201: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'name', 'createdDate', 'token'],
            properties: { ...tokenSummaryProperties, token: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => reply.code(201).send(service.create(request.body.name)),
  );
  app.delete<{ Params: { id: string } }>(
    '/api-tokens/:id',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^[0-9a-f]{32}$' } },
        },
      },
    },
    async (request, reply) => {
      service.revoke(request.params.id);
      return reply.code(204).send();
    },
  );
}
