import type { LogbookContext, LogbookEntry } from './types.js';

export function logbookEntryResponse(entry: LogbookEntry) {
  return {
    id: entry.id,
    participantId: entry.participantId,
    rounds: entry.rounds,
    version: entry.version,
    total: entry.total,
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
  };
}

export function logbookContextResponse(context: LogbookContext) {
  return {
    participant: { id: context.participant.id, name: context.participant.name },
    entry: logbookEntryResponse(context.entry),
    history: context.history,
  };
}
