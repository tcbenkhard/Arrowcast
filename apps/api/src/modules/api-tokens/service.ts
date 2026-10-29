import { randomUUID } from 'node:crypto';
import type { CreatedApiToken } from '@arrowcast/contracts';
import type { DatabaseContext } from '../../db/context.js';
import { hashToken, newToken } from '../../shared/tokens.js';
import { ApiTokenDatabaseClient } from './database-client.js';

export class ApiTokenService {
  private readonly tokens: ApiTokenDatabaseClient;

  constructor(context: DatabaseContext) {
    this.tokens = new ApiTokenDatabaseClient(context);
  }

  list() {
    return this.tokens.list();
  }

  create(name: string): CreatedApiToken {
    const token = newToken();
    const summary = { id: randomUUID().replaceAll('-', ''), name: name.trim(), createdDate: Date.now() };
    this.tokens.create({ ...summary, tokenHash: hashToken(token) });
    return { ...summary, token };
  }

  valid(token: string) {
    return this.tokens.exists(hashToken(token));
  }

  revoke(id: string) {
    this.tokens.remove(id);
  }
}
