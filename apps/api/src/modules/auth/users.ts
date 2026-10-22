import { randomInt } from 'node:crypto';
import { t } from '@arrowcast/contracts/i18n';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { hashPassword } from './password.js';

interface UserInput {
  name: string;
  username: string;
  password?: string;
  role: 'admin' | 'competition_manager';
  language?: 'nl' | 'en';
}

const properties = {
  name: { type: 'string', minLength: 1, maxLength: 100 },
  username: { type: 'string', minLength: 1, maxLength: 100 },
  password: { type: 'string', minLength: 8, maxLength: 1024 },
  role: { type: 'string', enum: ['admin', 'competition_manager'] },
  language: { type: 'string', enum: ['nl', 'en'] },
};
const publicUser = (user: typeof users.$inferSelect) => ({
  name: user.name,
  username: user.username,
  role: user.role,
  language: user.language,
  forceChangePassword: user.forceChangePassword,
});

export async function userRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.user.role !== 'admin')
      return reply.code(403).send({ message: t('users.only_administrators_can_manage_users') });
  });

  app.get('/users', async () =>
    db.select().from(users).orderBy(asc(users.name), asc(users.username)).all().map(publicUser),
  );

  app.delete<{ Params: { username: string } }>(
    '/users/:username',
    {
      schema: { params: { type: 'object', required: ['username'], properties: { username: properties.username } } },
    },
    async (request, reply) => {
      const result = db.transaction((tx) => {
        const existing = tx.select().from(users).where(eq(users.username, request.params.username)).get();
        if (!existing) return { status: 404, message: t('users.user_not_found') };
        if (existing.username === 'admin')
          return { status: 403, message: t('users.the_admin_account_cannot_be_removed') };
        if (existing.role === 'admin' && tx.select().from(users).where(eq(users.role, 'admin')).all().length === 1) {
          return { status: 409, message: t('users.keep_at_least_one_administrator') };
        }
        tx.delete(users).where(eq(users.username, existing.username)).run();
        return { sessionRevoked: request.user.sub === existing.username };
      });
      if (result.status !== undefined) return reply.code(result.status).send({ message: result.message });
      return result;
    },
  );

  app.post<{ Body: UserInput }>(
    '/users',
    {
      bodyLimit: 8192,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'username', 'password', 'role'],
          properties,
        },
      },
    },
    async (request, reply) => {
      const { role, password } = request.body;
      const name = request.body.name.trim();
      const username = request.body.username.trim();
      if (!name || !username || !password || password.trim().length < 8) {
        return reply.code(400).send({ message: t('users.enter_a_name_username_and_initial_password_with_at') });
      }
      const passwordHash = await hashPassword(password);
      const created = db
        .insert(users)
        .values({
          name,
          username,
          role,
          language: request.body.language ?? 'nl',
          passwordHash,
          forceChangePassword: true,
          sessionVersion: randomInt(1, 2147483647),
        })
        .onConflictDoNothing({ target: users.username })
        .returning()
        .get();
      if (!created) return reply.code(409).send({ message: t('users.this_username_is_already_in_use') });
      return reply.code(201).send(publicUser(created));
    },
  );

  app.put<{ Params: { username: string }; Body: UserInput }>(
    '/users/:username',
    {
      bodyLimit: 8192,
      schema: {
        params: { type: 'object', required: ['username'], properties: { username: properties.username } },
        body: { type: 'object', additionalProperties: false, required: ['name', 'username', 'role'], properties },
      },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      const username = request.body.username.trim();
      const { role, password } = request.body;
      if (request.params.username === 'admin') {
        return reply.code(403).send({ message: t('users.the_admin_account_cannot_be_edited') });
      }
      if (!name || !username || (password !== undefined && password.trim().length < 8)) {
        return reply.code(400).send({ message: t('Users.enter_a_name_username_and_a_password_with_at') });
      }
      const passwordHash = password === undefined ? undefined : await hashPassword(password);
      const result = db.transaction((tx) => {
        const existing = tx.select().from(users).where(eq(users.username, request.params.username)).get();
        if (!existing) return { status: 404, message: t('users.user_not_found') };
        if (username !== existing.username && tx.select().from(users).where(eq(users.username, username)).get()) {
          return { status: 409, message: t('users.this_username_is_already_in_use') };
        }
        if (
          existing.role === 'admin' &&
          role !== 'admin' &&
          tx.select().from(users).where(eq(users.role, 'admin')).all().length === 1
        ) {
          return { status: 409, message: t('users.keep_at_least_one_administrator') };
        }
        const sessionRevoked = username !== existing.username || role !== existing.role || passwordHash !== undefined;
        const changed = tx
          .update(users)
          .set({
            name,
            username,
            role,
            language: request.body.language ?? existing.language,
            ...(passwordHash === undefined ? {} : { passwordHash, forceChangePassword: true }),
            sessionVersion: existing.sessionVersion + (sessionRevoked ? 1 : 0),
          })
          .where(eq(users.username, existing.username))
          .returning()
          .get()!;
        return { user: publicUser(changed), sessionRevoked: sessionRevoked && request.user.sub === existing.username };
      });
      if (result.status !== undefined) return reply.code(result.status).send({ message: result.message });
      return result;
    },
  );
}
