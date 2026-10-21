import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { seedAdmin } from '../src/db/seed.js';
import { verifyPassword } from '../src/modules/auth/password.js';
import { readAuthConfig } from '../src/modules/auth/config.js';

test('production bootstrap requires device secrets and preserves an existing administrator', async (t) => {
  const saved = Object.fromEntries(
    ['NODE_ENV', 'JWT_SECRET', 'INITIAL_ADMIN_PASSWORD'].map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = 'production';
  delete process.env.JWT_SECRET;
  delete process.env.INITIAL_ADMIN_PASSWORD;
  assert.throws(() => readAuthConfig(), /JWT_SECRET/);
  const database = openDatabase(':memory:');
  t.after(() => database.close());
  process.env.JWT_SECRET = 'production-device-secret-with-at-least-32-bytes';
  assert.equal(readAuthConfig().jwtSecret, process.env.JWT_SECRET);
  await seedAdmin(database.db);
  const admin = database.db.select().from(users).where(eq(users.username, 'admin')).get()!;
  assert.ok(await verifyPassword('admin', admin.passwordHash));
  assert.equal(admin.forceChangePassword, true);
  delete process.env.INITIAL_ADMIN_PASSWORD;
  await seedAdmin(database.db);
  assert.equal(database.db.select().from(users).get()!.passwordHash, admin.passwordHash);
});
