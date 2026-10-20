import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from './index.js';
import { users } from './schema.js';
import { hashPassword, verifyPassword } from '../modules/auth/password.js';

export async function seedAdmin(db: AppDatabase): Promise<void> {
  const existing = db.select().from(users).where(eq(users.username, 'admin')).get();
  if (existing) {
    // Upgrade installations still using the shared default without resetting passwords.
    if (existing.role === 'admin' && !existing.forceChangePassword && existing.sessionVersion === 0
        && await verifyPassword('admin', existing.passwordHash)) {
      db.update(users).set({ forceChangePassword: true }).where(and(eq(users.username, 'admin'),
        eq(users.passwordHash, existing.passwordHash), eq(users.sessionVersion, existing.sessionVersion))).run();
    }
    return;
  }
  const password = process.env.INITIAL_ADMIN_PASSWORD || 'admin';
  const passwordHash = await hashPassword(password);
  db.insert(users).values({ username: 'admin', passwordHash, role: 'admin', forceChangePassword: true })
    .onConflictDoNothing({ target: users.username }).run();
}
