import { and, asc, eq } from 'drizzle-orm';
import { DatabaseClient } from '../../db/context.js';
import { users } from '../../db/schema.js';

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;

export class UserDatabaseClient extends DatabaseClient {
  find(username: string) {
    return this.db.select().from(users).where(eq(users.username, username)).get();
  }

  list() {
    return this.db.select().from(users).orderBy(asc(users.name), asc(users.username)).all();
  }

  administrators() {
    return this.db.select().from(users).where(eq(users.role, 'admin')).all();
  }

  create(user: NewUserRecord) {
    return this.db.insert(users).values(user).onConflictDoNothing({ target: users.username }).returning().get();
  }

  update(username: string, changes: Partial<NewUserRecord>) {
    return this.db.update(users).set(changes).where(eq(users.username, username)).returning().get();
  }

  remove(username: string) {
    this.db.delete(users).where(eq(users.username, username)).run();
  }

  changeLanguage(username: string, language: 'nl' | 'en') {
    this.db.update(users).set({ language }).where(eq(users.username, username)).run();
  }

  changePassword(user: UserRecord, passwordHash: string) {
    return this.db
      .update(users)
      .set({ passwordHash, forceChangePassword: false, sessionVersion: user.sessionVersion + 1 })
      .where(
        and(
          eq(users.username, user.username),
          eq(users.passwordHash, user.passwordHash),
          eq(users.sessionVersion, user.sessionVersion),
        ),
      )
      .returning()
      .get();
  }
}
