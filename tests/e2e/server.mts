import { buildApp } from '../../apps/api/src/app.js';
import { openDatabase } from '../../apps/api/src/db/index.js';
import { clubs, users } from '../../apps/api/src/db/schema.js';
import { hashPassword } from '../../apps/api/src/modules/auth/password.js';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testJwtSecret } from './admin.js';

const directory = mkdtempSync(join(tmpdir(), 'arrowcast-e2e-'));
const databasePath = join(directory, 'test.sqlite');
const fixture = openDatabase(databasePath);
fixture.db.insert(clubs).values({ clubNumber: 'e2e-club', name: 'Browser test club' }).run();
fixture.close();

// Isolated test credentials; never use the installation's .env or real account.
const app = buildApp({
  jwtSecret: testJwtSecret,
  databasePath,
});
await app.ready();
// Feature tests use an already-onboarded administrator. Auth tests also exercise
// an explicitly flagged fresh account through the real first-login screen.
const accounts = openDatabase(databasePath);
accounts.db.update(users).set({ forceChangePassword: false, language: 'en' }).where(eq(users.username, 'admin')).run();
accounts.db.insert(users).values({ username: 'first-login', passwordHash: await hashPassword('admin'),
  role: 'admin', language: 'en', forceChangePassword: true }).run();
accounts.db.insert(users).values({ username: 'profile-user', passwordHash: await hashPassword('admin'),
  role: 'admin', language: 'en', forceChangePassword: false }).run();
accounts.close();
await app.listen({ host: '127.0.0.1', port: Number(process.env.ARROWCAST_E2E_API_PORT ?? 3000) });
async function shutdown() {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
