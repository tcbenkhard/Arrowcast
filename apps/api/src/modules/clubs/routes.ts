import { t } from '@arrowcast/contracts/i18n';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { clubSettings, clubs, participants } from '../../db/schema.js';

export function clubMemberFilter(db: AppDatabase) {
  const number = db.select().from(clubSettings).where(eq(clubSettings.id, 1)).get()?.clubNumber;
  return number ? eq(participants.clubNumber, number) : undefined;
}

export async function clubSettingsRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  const selected = () =>
    db
      .select({ clubNumber: clubs.clubNumber, name: clubs.name })
      .from(clubSettings)
      .innerJoin(clubs, eq(clubs.clubNumber, clubSettings.clubNumber))
      .where(eq(clubSettings.id, 1))
      .get() ?? null;
  app.get('/settings/club', async () => selected());
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
    async (request, reply) => {
      const clubNumber = request.body.clubNumber?.trim() ?? null;
      const name = request.body.name?.trim();
      if (clubNumber && !db.select().from(clubs).where(eq(clubs.clubNumber, clubNumber)).get() && !name) {
        return reply.code(400).send({ message: t('Club.nameRequired') });
      }
      db.transaction((tx) => {
        if (clubNumber && name) tx.insert(clubs).values({ clubNumber, name }).onConflictDoNothing().run();
        tx.insert(clubSettings)
          .values({ id: 1, clubNumber })
          .onConflictDoUpdate({ target: clubSettings.id, set: { clubNumber } })
          .run();
      });
      return selected();
    },
  );
}
