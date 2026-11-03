import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { ApiTokenService } from '../api-tokens/service.js';
import type { ApiScoresRequest } from './api-service.js';
import { ApiScoringService } from './api-service.js';
import { SynchronizationDatabaseClient } from './synchronization-database-client.js';

/** Integration endpoint; browser scoring retains its own session and CSRF policies. */
export async function apiScoringRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const tokens = new ApiTokenService(context);
  const service = new ApiScoringService(context);
  const history = new SynchronizationDatabaseClient(context);
  const requests = new WeakMap<
    FastifyRequest,
    {
      id: number;
      apiKeyName: string | undefined;
      errorMessage?: string;
      competition?: { id: string; name: string };
    }
  >();
  app.addHook('onRequest', async (request) => {
    if (request.method === 'POST' && request.routeOptions.url === '/api/scores') {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '');
      const key = match ? tokens.identify(match[1]!) : undefined;
      requests.set(request, { id: history.start(), apiKeyName: key?.name });
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const entry = requests.get(request);
    if (entry && reply.statusCode >= 400 && typeof payload === 'string') {
      try {
        const result: unknown = JSON.parse(payload);
        if (result && typeof result === 'object' && 'message' in result && typeof result.message === 'string') {
          entry.errorMessage = result.message;
        }
      } catch {
        // A non-JSON error response still records its HTTP status.
      }
    }
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    const entry = requests.get(request);
    if (entry)
      history.complete(
        entry.id,
        request.body,
        reply.statusCode,
        entry.apiKeyName,
        entry.errorMessage,
        entry.competition,
      );
  });
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
        if (!match || requests.get(request)?.apiKeyName === undefined) {
          return reply.header('WWW-Authenticate', 'Bearer').code(401).send({ message: 'Invalid or missing API key.' });
        }
        request.headers['content-type'] ??= 'application/json';
      },
    },
    async (request) =>
      service.results(request.body, (competition) => {
        requests.get(request)!.competition = competition;
      }),
  );
}
