import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { ApiTokenService } from '../api-tokens/service.js';
import type { ApiScoresRequest } from './api-service.js';
import { ApiScoringService } from './api-service.js';

/** Integration endpoint; browser scoring retains its own session and CSRF policies. */
export async function apiScoringRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const tokens = new ApiTokenService(context);
  const service = new ApiScoringService(context);
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  app.post<{ Body: ApiScoresRequest }>(
    '/scores',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['verenigingsnummer', 'date', 'starttime'],
          properties: {
            verenigingsnummer: { type: 'integer', minimum: 1 },
            date: { type: 'string', format: 'date', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
            starttime: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['results'],
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['score', 'lidnummer', 'boogtype'],
                  properties: {
                    score: { type: 'integer', minimum: 0 },
                    lidnummer: { type: 'string' },
                    boogtype: { type: 'string', enum: ['R', 'C', 'BB', 'LB', 'TR'] },
                  },
                },
              },
            },
          },
        },
      },
      onRequest: async (request, reply) => {
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '');
        if (!match || !tokens.valid(match[1]!)) {
          return reply.header('WWW-Authenticate', 'Bearer').code(401).send({ message: 'Invalid or missing API key.' });
        }
        request.headers['content-type'] ??= 'application/json';
      },
    },
    async (request) => service.results(request.body),
  );
}
