import type { AppDatabase } from './index.js';

export type DatabaseSession = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete' | 'transaction'>;

/** Shares one connection or transaction across the clients participating in an operation. */
export class DatabaseContext {
  constructor(readonly session: DatabaseSession) {}

  transaction<T>(operation: (context: DatabaseContext) => T): T {
    return this.session.transaction((transaction) => operation(new DatabaseContext(transaction)));
  }
}

/** Persistence clients are the only application objects that build database queries. */
export abstract class DatabaseClient {
  constructor(protected readonly context: DatabaseContext) {}

  protected get db(): DatabaseSession {
    return this.context.session;
  }
}
