import type { DatabaseContext } from '../../db/context.js';
import { AdminBootstrapDatabaseClient } from './bootstrap-database-client.js';
import { hashPassword, verifyPassword } from './password.js';

export class AdminBootstrapService {
  private readonly users: AdminBootstrapDatabaseClient;

  constructor(
    context: DatabaseContext,
    private readonly initialPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin',
  ) {
    this.users = new AdminBootstrapDatabaseClient(context);
  }

  async initialize(): Promise<void> {
    const existing = this.users.find('admin');
    if (existing) {
      // Upgrade the shared default without overwriting credentials changed by another request.
      if (
        existing.role === 'admin' &&
        !existing.forceChangePassword &&
        existing.sessionVersion === 0 &&
        (await verifyPassword('admin', existing.passwordHash))
      ) {
        this.users.requirePasswordChange(existing);
      }
      return;
    }
    // Renaming the original administrator must not recreate its default credentials.
    if (this.users.hasUsers()) return;
    const passwordHash = await hashPassword(this.initialPassword);
    this.users.create({
      username: 'admin',
      name: 'Administrator',
      passwordHash,
      role: 'admin',
      forceChangePassword: true,
    });
  }
}
