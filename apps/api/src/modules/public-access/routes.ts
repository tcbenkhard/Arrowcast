import type { FastifyInstance } from 'fastify';
import { PublicAccessService, type PublicAccessSettings } from './service.js';
import { ScoringOriginService } from './scoring-origin-service.js';

export async function scoringOriginRoutes(app: FastifyInstance) {
  const service = new ScoringOriginService();
  app.get('/scoring-origin', async (_request, reply) => {
    const result = await service.origin();
    return reply.header('Cache-Control', 'no-store').code(result.code).send(result.body);
  });
}

export async function publicAccessRoutes(app: FastifyInstance) {
  const service = new PublicAccessService();
  app.get('/public-access', async (_request, reply) => {
    const result = await service.status();
    return reply.header('Cache-Control', 'no-store').code(result.code).send(result.body);
  });
  app.post<{ Body: PublicAccessSettings }>(
    '/public-access',
    {
      bodyLimit: 2048,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'domain', 'email'],
          properties: {
            enabled: { type: 'boolean' },
            domain: { type: 'string', maxLength: 253 },
            email: { type: 'string', maxLength: 254 },
            accessMode: { type: 'string', enum: ['public', 'ddns'] },
            ddnsToken: { type: 'string', maxLength: 512 },
            action: { type: 'string', enum: ['prepare-ddns'] },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await service.configure(req.body);
      return reply.code(result.code).send(result.body);
    },
  );
}
