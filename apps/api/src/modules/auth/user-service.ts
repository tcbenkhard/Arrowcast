import { randomInt } from 'node:crypto';
import { t } from '@arrowcast/contracts/i18n';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { UserDatabaseClient, type UserRecord } from './database-client.js';
import { hashPassword } from './password.js';

export interface UserInput {
  name: string;
  username: string;
  password?: string;
  role: 'admin' | 'competition_manager';
  language?: 'nl' | 'en';
}

const publicUser = (user: UserRecord) => ({
  name: user.name,
  username: user.username,
  role: user.role,
  language: user.language,
  forceChangePassword: user.forceChangePassword,
});

function normalizeUserInput(input: UserInput): UserInput {
  return { ...input, name: input.name.trim(), username: input.username.trim() };
}

export class UserService {
  private readonly users: UserDatabaseClient;

  constructor(private readonly context: DatabaseContext) {
    this.users = new UserDatabaseClient(context);
  }

  list() {
    return this.users.list().map(publicUser);
  }

  remove(username: string, actor: string) {
    return this.context.transaction((context) => new UserService(context).removeInTransaction(username, actor));
  }

  private removeInTransaction(username: string, actor: string) {
    const existing = this.requireUser(username);
    if (existing.username === 'admin') {
      throw new ApplicationError(t('users.the_admin_account_cannot_be_removed'), 403);
    }
    this.keepAdministrator(existing, false);
    this.users.remove(existing.username);
    return { sessionRevoked: actor === existing.username };
  }

  async create(input: UserInput) {
    const { name, username, password, role } = normalizeUserInput(input);
    if (!name || !username || !password || password.trim().length < 8) {
      throw new ApplicationError(t('users.enter_a_name_username_and_initial_password_with_at'), 400);
    }
    const passwordHash = await hashPassword(password);
    const created = this.users.create({
      name,
      username,
      role,
      language: input.language ?? 'nl',
      passwordHash,
      forceChangePassword: true,
      sessionVersion: randomInt(1, 2147483647),
    });
    if (!created) throw new ApplicationError(t('users.this_username_is_already_in_use'), 409);
    return publicUser(created);
  }

  async update(existingUsername: string, input: UserInput, actor: string) {
    const { name, username, role, password } = normalizeUserInput(input);
    if (existingUsername === 'admin') {
      throw new ApplicationError(t('users.the_admin_account_cannot_be_edited'), 403);
    }
    if (!name || !username || (password !== undefined && password.trim().length < 8)) {
      throw new ApplicationError(t('Users.enter_a_name_username_and_a_password_with_at'), 400);
    }
    const passwordHash = password === undefined ? undefined : await hashPassword(password);
    return this.context.transaction((context) =>
      new UserService(context).updateInTransaction(
        existingUsername,
        { ...input, name, username, role },
        actor,
        passwordHash,
      ),
    );
  }

  private updateInTransaction(existingUsername: string, input: UserInput, actor: string, passwordHash?: string) {
    const { name, username, role } = input;
    const existing = this.requireUser(existingUsername);
    if (username !== existing.username && this.users.find(username)) {
      throw new ApplicationError(t('users.this_username_is_already_in_use'), 409);
    }
    this.keepAdministrator(existing, role === 'admin');
    const sessionRevoked = username !== existing.username || role !== existing.role || passwordHash !== undefined;
    const changed = this.users.update(existing.username, {
      name,
      username,
      role,
      language: input.language ?? existing.language,
      ...(passwordHash === undefined ? {} : { passwordHash, forceChangePassword: true }),
      sessionVersion: existing.sessionVersion + (sessionRevoked ? 1 : 0),
    })!;
    return { user: publicUser(changed), sessionRevoked: sessionRevoked && actor === existing.username };
  }

  private requireUser(username: string) {
    const user = this.users.find(username);
    if (!user) throw new ApplicationError(t('users.user_not_found'), 404);
    return user;
  }

  private keepAdministrator(existing: UserRecord, remainsAdministrator: boolean) {
    if (existing.role === 'admin' && !remainsAdministrator && this.users.administrators().length === 1) {
      throw new ApplicationError(t('users.keep_at_least_one_administrator'), 409);
    }
  }
}
