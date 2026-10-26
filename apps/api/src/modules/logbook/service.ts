import { randomUUID } from 'node:crypto';
import { t } from '@arrowcast/contracts/i18n';
import { calculateRoundTotal, isValidRound } from '@arrowcast/scoring';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { hashToken, newToken } from '../../shared/tokens.js';
import { LogbookDatabaseClient } from './database-client.js';
import type {
  LogbookContext,
  LogbookCredentials,
  LogbookEntry,
  LogbookMutation,
  LogbookParticipant,
  LogbookSession,
} from './types.js';

export class LogbookService {
  private readonly logbook: LogbookDatabaseClient;

  constructor(private readonly database: DatabaseContext) {
    this.logbook = new LogbookDatabaseClient(database);
  }

  private session(token: string | undefined) {
    return token ? this.logbook.findAccess(hashToken(token), Date.now()) : undefined;
  }

  private requireSession(token: string | undefined) {
    const access = this.session(token);
    if (!access) throw new ApplicationError(t('logbook.enterPin'), 401);
    return access;
  }

  private requireParticipant(id: string) {
    const person = this.logbook.findMember(id);
    if (!person) throw new ApplicationError(t('logbook.personMissing'), 404);
    return person;
  }

  private context(person: LogbookParticipant, entry: LogbookEntry): LogbookContext {
    return { participant: { id: person.id, name: person.name }, entry, history: this.logbook.history(person.id) };
  }

  private openEntry(person: LogbookParticipant): LogbookSession {
    const token = newToken();
    const now = Date.now();
    const entry = this.logbook.createEntry({
      id: randomUUID(),
      participantId: person.id,
      tokenHash: hashToken(token),
      expiresAt: now + 86400_000,
      rounds: Array.from({ length: 10 }, () => Array<string | null>(3).fill(null)),
      createdAt: now,
    });
    return { context: this.context(person, entry), token };
  }

  getContext(token: string | undefined) {
    const access = this.requireSession(token);
    return this.context(this.requireParticipant(access.participantId), this.logbook.findEntry(access.id)!);
  }

  restart(token: string | undefined): LogbookSession {
    const current = this.getContext(token);
    if (current.entry.completedAt === null) return { context: current };
    return this.openEntry(current.participant);
  }

  async authenticate(credentials: LogbookCredentials, token: string | undefined): Promise<LogbookSession> {
    const { participantId, pin, createPin } = credentials;
    const person = this.requireParticipant(participantId);
    const existing = this.logbook.findPin(participantId);
    if (existing && createPin) throw new ApplicationError(t('logbook.pinExists'), 409);
    if (!existing && !createPin) throw new ApplicationError(t('logbook.createPin'), 409);
    if (existing && !(await verifyPassword(pin, existing.pinHash)))
      throw new ApplicationError(t('logbook.wrongPin'), 401);
    if (!existing) {
      const pinHash = await hashPassword(pin);
      if (!this.logbook.createPin(participantId, pinHash)) throw new ApplicationError(t('logbook.pinExists'), 409);
    }
    // Re-entering a PIN resumes this device's draft only after verifying the PIN.
    const previous = this.session(token);
    if (previous?.participantId === participantId) {
      const entry = this.logbook.findEntry(previous.id);
      if (entry && entry.completedAt === null) return { context: this.context(person, entry) };
    }
    return this.openEntry(person);
  }

  logout(token: string | undefined) {
    if (token) this.logbook.expireAccess(hashToken(token));
  }

  saveEntry(token: string | undefined, mutation: LogbookMutation) {
    const access = this.requireSession(token);
    if (!mutation.rounds.every((round) => isValidRound(round, 3, mutation.finish)))
      throw new ApplicationError(t('logbook.completeFirst'), 400);
    const result = this.database.transaction((scope) =>
      new LogbookService(scope).saveInTransaction(access.id, mutation),
    );
    if (!result) throw new ApplicationError(t('logbook.conflict'), 409);
    return result;
  }

  private saveInTransaction(entryId: string, mutation: LogbookMutation) {
    const { rounds, expectedVersion, finish } = mutation;
    const entry = this.logbook.findEntry(entryId)!;
    if (entry.id !== mutation.entryId) return null;
    // Identical retries must never create another result after a lost response.
    if (JSON.stringify(entry.rounds) === JSON.stringify(rounds) && Boolean(entry.completedAt) === finish) return entry;
    if (entry.completedAt !== null || entry.version !== expectedVersion) return null;
    return this.logbook.updateEntry(entry.id, {
      rounds,
      version: entry.version + 1,
      completedAt: finish ? Date.now() : null,
      total: finish ? rounds.reduce((sum, round) => sum + calculateRoundTotal(round), 0) : null,
    });
  }

  searchParticipants(search: string | undefined) {
    const query = search?.trim() ?? '';
    return query ? this.logbook.searchParticipants(query) : [];
  }

  history(participantId: string) {
    this.requireParticipant(participantId);
    return this.logbook.history(participantId);
  }

  summary() {
    return this.logbook.summary();
  }
}
