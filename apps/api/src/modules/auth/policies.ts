import { t } from '@arrowcast/contracts/i18n';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { users } from '../../db/schema.js';

export type ManagementPolicy = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const unauthorized = async (reply: FastifyReply) => {
  await reply.code(401).send({ message: t('PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan', {}, 'nl') });
};

/** Verifies both the JWT and its mutable database-backed authorization state. */
export function authenticatedManagement(db: AppDatabase): ManagementPolicy {
  return async (request, reply) => {
    try {
      await request.jwtVerify();
      const user = db.select().from(users).where(eq(users.username, request.user.sub)).get();
      if (!user || !['admin', 'competition_manager'].includes(user.role)
        || request.user.role !== user.role || !Number.isFinite(request.user.exp)
        || (request.user.sessionVersion ?? 0) !== user.sessionVersion) {
        await unauthorized(reply);
      }
    } catch {
      await unauthorized(reply);
    }
  };
}

/** Denies all feature operations until the bootstrap password has been replaced. */
export function passwordChanged(db: AppDatabase): ManagementPolicy {
  return async (request, reply) => {
    const user = db.select({ forceChangePassword: users.forceChangePassword }).from(users)
      .where(eq(users.username, request.user.sub)).get();
    if (!user || user.forceChangePassword) {
      await reply.code(403).send({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: t('routes.wijzig_eerst_je_wachtwoord', {}, 'nl'),
      });
    }
  };
}

export const administratorOnly: ManagementPolicy = async (request, reply) => {
  if (request.user.role !== 'admin') {
    await reply.code(403).send({ message: t('routes.only_administrators_can_access_settings') });
  }
};
