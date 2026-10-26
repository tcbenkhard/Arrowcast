import type { logbookEntries } from '../../db/schema.js';

export type LogbookEntry = typeof logbookEntries.$inferSelect;
export type LogbookParticipant = { id: string; name: string };
export type LogbookHistoryEntry = Pick<LogbookEntry, 'id' | 'total' | 'completedAt'>;
export type LogbookContext = { participant: LogbookParticipant; entry: LogbookEntry; history: LogbookHistoryEntry[] };
export type LogbookCredentials = { participantId: string; pin: string; createPin: boolean };
export type LogbookMutation = {
  entryId: string;
  rounds: (string | null)[][];
  expectedVersion: number;
  finish: boolean;
};
export type LogbookSession = { context: LogbookContext; token?: string };
