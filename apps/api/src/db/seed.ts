import { eq } from 'drizzle-orm';
import type { AppDatabase } from './index.js';
import { users } from './schema.js';
import { hashPassword } from '../modules/auth/password.js';

export async function seedAdmin(db: AppDatabase): Promise<void> {
  if (db.select().from(users).where(eq(users.username, 'admin')).get()) return;
  const password = process.env.INITIAL_ADMIN_PASSWORD
    ?? (process.env.NODE_ENV === 'production' ? undefined : 'admin');
  if (!password || (process.env.NODE_ENV === 'production' && password.length < 16)) {
    throw new Error('INITIAL_ADMIN_PASSWORD of minstens 16 tekens is vereist voor de eerste productiebeheerder.');
  }
  const passwordHash = await hashPassword(password);
  db.insert(users).values({ username: 'admin', passwordHash, role: 'admin' })
    .onConflictDoNothing({ target: users.username }).run();
}
