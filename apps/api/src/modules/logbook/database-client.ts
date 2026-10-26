import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { DatabaseClient, type DatabaseContext } from '../../db/context.js';
import { clubs, logbookEntries, logbookPins, participants } from '../../db/schema.js';
import { ClubSettingsDatabaseClient } from '../clubs/database-client.js';
import type { LogbookEntry } from './types.js';

export class LogbookDatabaseClient extends DatabaseClient {
  private readonly clubSettings: ClubSettingsDatabaseClient;

  constructor(context: DatabaseContext) {
    super(context);
    this.clubSettings = new ClubSettingsDatabaseClient(context);
  }

  findMember(participantId: string) {
    return this.db
      .select()
      .from(participants)
      .where(and(eq(participants.id, participantId), this.clubSettings.memberFilter()))
      .get();
  }

  findAccess(tokenHash: string, now: number) {
    const access = this.db
      .select({ id: logbookEntries.id, participantId: logbookEntries.participantId })
      .from(logbookEntries)
      .where(and(eq(logbookEntries.tokenHash, tokenHash), sql`${logbookEntries.expiresAt} > ${now}`))
      .get();
    return access && this.findMember(access.participantId) ? access : undefined;
  }

  findEntry(id: string) {
    return this.db.select().from(logbookEntries).where(eq(logbookEntries.id, id)).get();
  }

  createEntry(entry: typeof logbookEntries.$inferInsert) {
    return this.db.insert(logbookEntries).values(entry).returning().get()!;
  }

  updateEntry(id: string, changes: Pick<LogbookEntry, 'rounds' | 'version' | 'completedAt' | 'total'>) {
    return this.db.update(logbookEntries).set(changes).where(eq(logbookEntries.id, id)).returning().get()!;
  }

  expireAccess(tokenHash: string) {
    this.db.update(logbookEntries).set({ expiresAt: 0 }).where(eq(logbookEntries.tokenHash, tokenHash)).run();
  }

  findPin(participantId: string) {
    return this.db.select().from(logbookPins).where(eq(logbookPins.participantId, participantId)).get();
  }

  createPin(participantId: string, pinHash: string) {
    return this.db.insert(logbookPins).values({ participantId, pinHash }).onConflictDoNothing().returning().get();
  }

  searchParticipants(query: string) {
    return this.db
      .select({
        id: participants.id,
        name: participants.name,
        clubName: clubs.name,
        hasPin: sql<boolean>`${logbookPins.participantId} IS NOT NULL`.mapWith(Boolean),
      })
      .from(participants)
      .innerJoin(clubs, eq(clubs.clubNumber, participants.clubNumber))
      .leftJoin(logbookPins, eq(logbookPins.participantId, participants.id))
      .where(and(sql`instr(lower(${participants.name}), lower(${query})) > 0`, this.clubSettings.memberFilter()))
      .orderBy(participants.name, participants.id)
      .limit(20)
      .all();
  }

  history(participantId: string) {
    return this.db
      .select({ id: logbookEntries.id, total: logbookEntries.total, completedAt: logbookEntries.completedAt })
      .from(logbookEntries)
      .where(and(eq(logbookEntries.participantId, participantId), isNotNull(logbookEntries.completedAt)))
      .orderBy(desc(logbookEntries.completedAt), logbookEntries.id)
      .all();
  }

  summary() {
    const completedEntries = this.db
      .select({
        participantId: logbookEntries.participantId,
        total: logbookEntries.total,
        rank: sql<number>`row_number() over (partition by ${logbookEntries.participantId} order by ${logbookEntries.completedAt} desc, ${logbookEntries.id} desc)`.as(
          'rank',
        ),
      })
      .from(logbookEntries)
      .where(isNotNull(logbookEntries.completedAt))
      .as('completed_entries');
    return this.db
      .select({
        participantId: participants.id,
        name: participants.name,
        averageScore: sql<number>`avg(case when ${completedEntries.rank} <= 5 then ${completedEntries.total} end)`,
        averagePerArrow: sql<number>`avg(case when ${completedEntries.rank} <= 5 then ${completedEntries.total} end) / 30.0`,
        highestScore: sql<number>`max(${completedEntries.total})`,
      })
      .from(completedEntries)
      .innerJoin(participants, eq(participants.id, completedEntries.participantId))
      .where(this.clubSettings.memberFilter())
      .groupBy(participants.id)
      .orderBy(participants.name, participants.id)
      .all();
  }
}
