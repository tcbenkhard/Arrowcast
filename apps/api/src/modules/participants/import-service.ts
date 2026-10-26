import { randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../../db/context.js';
import { ParticipantsDatabaseClient } from './database-client.js';
import type { ImportData } from './types.js';

export class ParticipantImportService {
  private readonly participants: ParticipantsDatabaseClient;

  constructor(private readonly context: DatabaseContext) {
    this.participants = new ParticipantsDatabaseClient(context);
  }

  save(data: ImportData) {
    this.context.transaction((scope) => new ParticipantImportService(scope).saveInTransaction(data));
  }

  private saveInTransaction(data: ImportData) {
    for (const club of data.clubs) this.participants.upsertClub(club);
    for (const person of data.participants) this.participants.upsertParticipant({ id: randomUUID(), ...person });
  }
}
