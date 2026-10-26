import { and, eq } from 'drizzle-orm';
import { users } from '../../db/schema.js';
import { UserDatabaseClient, type UserRecord } from './database-client.js';

export class AdminBootstrapDatabaseClient extends UserDatabaseClient {
  hasUsers() {
    return Boolean(this.db.select({ username: users.username }).from(users).limit(1).get());
  }

  requirePasswordChange(user: UserRecord) {
    this.db
      .update(users)
      .set({ forceChangePassword: true })
      .where(
        and(
          eq(users.username, user.username),
          eq(users.passwordHash, user.passwordHash),
          eq(users.sessionVersion, user.sessionVersion),
        ),
      )
      .run();
  }
}
