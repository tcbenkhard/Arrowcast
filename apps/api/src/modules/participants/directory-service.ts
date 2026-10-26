import type { DatabaseContext } from '../../db/context.js';
import { ParticipantsDatabaseClient } from './database-client.js';

export class ParticipantDirectoryService {
  private readonly participants: ParticipantsDatabaseClient;

  constructor(context: DatabaseContext) {
    this.participants = new ParticipantsDatabaseClient(context);
  }

  search(query: string) {
    if (!query) return [];
    return this.participants.search(query);
  }

  clubs() {
    return this.participants.listClubs();
  }

  bowTypes() {
    return this.participants.listBowTypes().map((bow) => bow.name);
  }
}
