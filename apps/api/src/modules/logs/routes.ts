import type { FastifyInstance } from 'fastify';
import { LogService, logSources, type LogSource } from './service.js';

export async function logRoutes(app: FastifyInstance, options: { readLogs?: (source: LogSource) => Promise<string> }) {
  const service = options.readLogs ? new LogService({ read: options.readLogs }) : new LogService();
  app.get<{ Params: { source: LogSource } }>(
    '/logs/:source',
    {
      // Polling the backend log must not generate more log entries itself.
      logLevel: 'silent',
      schema: {
        params: {
          type: 'object',
          required: ['source'],
          properties: { source: { type: 'string', enum: logSources } },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const result = await service.read(request.params.source);
      return reply.code(result.code).send(result.body);
    },
  );
}
