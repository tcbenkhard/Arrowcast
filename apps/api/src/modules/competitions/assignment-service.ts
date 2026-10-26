import { CompetitionDatabaseClient } from './database-client.js';
import type { DatabaseContext } from '../../db/context.js';
import { planAssignments } from './assignments.js';

export class AssignmentService {
  private readonly client: CompetitionDatabaseClient;

  constructor(context: DatabaseContext) {
    this.client = new CompetitionDatabaseClient(context);
  }

  assignParticipants(competitionId: string, reassign = false) {
    const people = this.client.assignmentParticipants(competitionId);
    const plan = planAssignments(
      this.client.assignedLanes(competitionId),
      reassign
        ? people.filter((person) => person.checkedIn).map((person) => ({ ...person, laneId: null, targetLetter: null }))
        : people,
    );
    if (reassign) this.client.clearParticipantAssignments(competitionId);
    for (const { participantId, ...place } of plan) {
      this.client.assignParticipant(competitionId, participantId, place);
    }
  }
}
