import type { FastifyInstance } from 'fastify';
import { NetworkService, type NetworkSettings } from './service.js';

export async function networkRoutes(app: FastifyInstance) {
  const service = new NetworkService();
  app.get('/network', async (_request, reply) => {
    const result = await service.status();
    return reply.code(result.code).send(result.body);
  });
  app.post<{ Body: NetworkSettings }>(
    '/network',
    {
      bodyLimit: 2048,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ssid', 'password'],
          properties: {
            ssid: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[^\\u0000-\\u001f\\u007f]+$' },
            password: { type: 'string', maxLength: 64, pattern: '^[^\\u0000-\\u001f\\u007f]*$' },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await service.connect(req.body);
      return reply.code(result.code).send(result.body);
    },
  );
}
