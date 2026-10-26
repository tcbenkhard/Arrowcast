import { t } from '@arrowcast/contracts/i18n';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { SessionService } from './session-service.js';

export type ManagementPolicy = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const unauthorized = async (reply: FastifyReply) => {
  await reply.code(401).send({ message: t('PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan', {}, 'nl') });
};

/** Verifies both the JWT and its mutable database-backed authorization state. */
export function authenticatedManagement(context: DatabaseContext): ManagementPolicy {
  const service = new SessionService(context);
  return async (request, reply) => {
    try {
      await request.jwtVerify();
      if (!service.validManagementSession(request.user)) {
        await unauthorized(reply);
      }
    } catch {
      await unauthorized(reply);
    }
  };
}

/** Denies all feature operations until the bootstrap password has been replaced. */
export function passwordChanged(context: DatabaseContext): ManagementPolicy {
  const service = new SessionService(context);
  return async (request, reply) => {
    if (service.requiresPasswordChange(request.user.sub)) {
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
