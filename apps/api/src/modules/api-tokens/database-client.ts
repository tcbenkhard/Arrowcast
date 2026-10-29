import { asc, desc, eq } from 'drizzle-orm';
import type { ApiTokenSummary } from '@arrowcast/contracts';
import { DatabaseClient } from '../../db/context.js';
import { apiTokens } from '../../db/schema.js';

export class ApiTokenDatabaseClient extends DatabaseClient {
  list(): ApiTokenSummary[] {
    return this.db
      .select({ id: apiTokens.id, name: apiTokens.name, createdDate: apiTokens.createdDate })
      .from(apiTokens)
      .orderBy(desc(apiTokens.createdDate), asc(apiTokens.name))
      .all();
  }

  create(token: typeof apiTokens.$inferInsert) {
    this.db.insert(apiTokens).values(token).run();
  }

  remove(id: string) {
    this.db.delete(apiTokens).where(eq(apiTokens.id, id)).run();
  }

  exists(tokenHash: string) {
    return Boolean(
      this.db
        .select({ tokenHash: apiTokens.tokenHash })
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, tokenHash))
        .get(),
    );
  }
}
