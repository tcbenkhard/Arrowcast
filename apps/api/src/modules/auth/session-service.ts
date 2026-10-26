import type { DatabaseContext } from '../../db/context.js';
import { UserDatabaseClient } from './database-client.js';

interface SessionClaims {
  sub: string;
  role: string;
  exp: number;
  sessionVersion?: number;
}

/** Rechecks mutable authorization state after JWT verification. */
export class SessionService {
  private readonly users: UserDatabaseClient;

  constructor(context: DatabaseContext) {
    this.users = new UserDatabaseClient(context);
  }

  validManagementSession(claims: SessionClaims) {
    const user = this.users.find(claims.sub);
    return (
      !!user &&
      ['admin', 'competition_manager'].includes(user.role) &&
      claims.role === user.role &&
      Number.isFinite(claims.exp) &&
      (claims.sessionVersion ?? 0) === user.sessionVersion
    );
  }

  requiresPasswordChange(username: string) {
    const user = this.users.find(username);
    return !user || user.forceChangePassword;
  }
}
