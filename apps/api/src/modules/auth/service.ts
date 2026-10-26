import { t } from '@arrowcast/contracts/i18n';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { UserDatabaseClient, type UserRecord } from './database-client.js';
import { hashPassword, verifyPassword } from './password.js';

export interface SessionIdentity {
  username: string;
  role: 'admin' | 'competition_manager';
  sessionVersion: number;
  forceChangePassword: boolean;
}

export class AuthenticationService {
  private readonly users: UserDatabaseClient;

  private constructor(
    context: DatabaseContext,
    private readonly dummyHash: string,
  ) {
    this.users = new UserDatabaseClient(context);
  }

  static async create(context: DatabaseContext) {
    return new AuthenticationService(context, await hashPassword('unknown-user'));
  }

  async authenticate(username: string, password: string): Promise<SessionIdentity> {
    const user = this.users.find(username);
    // Always derive the hash, including for unknown usernames.
    const passwordValid = await verifyPassword(password, user?.passwordHash ?? this.dummyHash);
    if (!passwordValid || !user || !['admin', 'competition_manager'].includes(user.role)) {
      throw new ApplicationError(t('AdminPage.gebruikersnaam_of_wachtwoord_is_onjuist', {}, 'nl'), 401);
    }
    return this.identity(user);
  }

  profile(username: string) {
    const user = this.users.find(username)!;
    return {
      username: user.username,
      name: user.name,
      role: user.role,
      forceChangePassword: user.forceChangePassword,
      language: user.language,
    };
  }

  changeLanguage(username: string, language: 'nl' | 'en') {
    this.users.changeLanguage(username, language);
    return { language };
  }

  async changePassword(username: string, currentPassword: string, newPassword: string): Promise<SessionIdentity> {
    const user = this.users.find(username)!;
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApplicationError(t('routes.het_huidige_wachtwoord_is_onjuist', {}, 'nl'), 400);
    }
    if (
      newPassword.trim().length < 8 ||
      newPassword === 'admin' ||
      (await verifyPassword(newPassword, user.passwordHash))
    ) {
      throw new ApplicationError(t('routes.kies_een_ander_wachtwoord_met_minstens_8_tekens', {}, 'nl'), 400);
    }
    const passwordHash = await hashPassword(newPassword);
    const changed = this.users.changePassword(user, passwordHash);
    if (!changed) {
      throw new ApplicationError(t('routes.het_wachtwoord_is_ondertussen_gewijzigd_log_opnieuw_in', {}, 'nl'), 409);
    }
    return this.identity(changed);
  }

  private identity(user: UserRecord): SessionIdentity {
    return {
      username: user.username,
      role: user.role,
      sessionVersion: user.sessionVersion,
      forceChangePassword: user.forceChangePassword,
    };
  }
}
