import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from './index.js';
import { users } from './schema.js';
import { hashPassword, verifyPassword } from '../modules/auth/password.js';

export async function seedAdmin(db: AppDatabase): Promise<void> {
  const existing = db.select().from(users).where(eq(users.username, 'admin')).get();
  if (existing) {
    // Upgrade installations still using the shared default without resetting passwords.
    if (
      existing.role === 'admin' &&
      !existing.forceChangePassword &&
      existing.sessionVersion === 0 &&
      (await verifyPassword('admin', existing.passwordHash))
    ) {
      db.update(users)
        .set({ forceChangePassword: true })
        .where(
          and(
            eq(users.username, 'admin'),
            eq(users.passwordHash, existing.passwordHash),
            eq(users.sessionVersion, existing.sessionVersion),
          ),
        )
        .run();
    }
    return;
  }
  // Renaming the original administrator must not recreate its default credentials.
  if (db.select({ username: users.username }).from(users).limit(1).get()) return;
  const password = process.env.INITIAL_ADMIN_PASSWORD || 'admin';
  const passwordHash = await hashPassword(password);
  db.insert(users)
    .values({ username: 'admin', name: 'Administrator', passwordHash, role: 'admin', forceChangePassword: true })
    .onConflictDoNothing({ target: users.username })
    .run();
}
