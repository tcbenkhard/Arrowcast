import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { ClubSettingsService } from './service.js';

export async function clubSettingsRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const service = new ClubSettingsService(context);
  app.get('/settings/club', async () => service.selected());
  const nonBlank = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };
  app.put<{ Body: { clubNumber: string | null; name?: string } }>(
    '/settings/club',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['clubNumber'],
          properties: { clubNumber: { anyOf: [nonBlank, { type: 'null' }] }, name: nonBlank },
        },
      },
    },
    async (request) => service.select(request.body.clubNumber?.trim() ?? null, request.body.name?.trim()),
  );
}
