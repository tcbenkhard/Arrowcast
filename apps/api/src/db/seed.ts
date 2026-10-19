import { eq } from 'drizzle-orm';
import type { AppDatabase } from './index.js';
import { users } from './schema.js';
import { hashPassword } from '../modules/auth/password.js';

export async function seedAdmin(db: AppDatabase): Promise<void> {
  if (db.select().from(users).where(eq(users.username, 'admin')).get()) return;
  const passwordHash = await hashPassword('admin');
  db.insert(users).values({ username: 'admin', passwordHash, role: 'admin' })
    .onConflictDoNothing({ target: users.username }).run();
}
