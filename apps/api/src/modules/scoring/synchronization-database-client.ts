import { desc, eq } from 'drizzle-orm';
import { DatabaseClient } from '../../db/context.js';
import { synchronizationRequests } from '../../db/schema.js';

export class SynchronizationDatabaseClient extends DatabaseClient {
  start() {
    return this.db.insert(synchronizationRequests).values({ requestedAt: Date.now() }).returning().get().id;
  }

  complete(
    id: number,
    body: unknown,
    statusCode: number,
    apiKeyName?: string,
    errorMessage?: string,
    competition?: { id: string; name: string },
  ) {
    const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    this.db
      .update(synchronizationRequests)
      .set({
        requestDate: typeof input.date === 'string' ? input.date : null,
        requestTime: typeof input.starttime === 'string' ? input.starttime : null,
        competitionId: competition?.id ?? null,
        competitionName: competition?.name ?? null,
        apiKeyName: apiKeyName ?? null,
        statusCode,
        errorMessage: errorMessage ?? null,
      })
      .where(eq(synchronizationRequests.id, id))
      .run();
  }

  list() {
    return this.db.select().from(synchronizationRequests).orderBy(desc(synchronizationRequests.id)).all();
  }
}
