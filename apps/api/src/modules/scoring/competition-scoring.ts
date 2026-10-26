import type { DatabaseContext } from '../../db/context.js';
import { ScoringDatabaseClient } from './scoring-database-client.js';

export class ScoringLifecycleService {
  private readonly client: ScoringDatabaseClient;

  constructor(context: DatabaseContext) {
    this.client = new ScoringDatabaseClient(context);
  }

  initializeLaneScoring(competitionId: string) {
    const participants = this.client.listCheckedInParticipants(competitionId);
    for (const lane of this.client.listCompetitionLanes(competitionId)) {
      const order = participants
        .filter((person) => person.laneId === lane.laneId)
        .map((person) => person.participantId);
      this.client.insertLaneState({
        competitionId,
        laneId: lane.laneId,
        participantOrder: order,
        currentParticipantId: order[0] ?? null,
        completed: order.length === 0,
        updatedAt: Date.now(),
      });
    }
  }

  // Runs in the status transaction. Automatically finalized misses may be reset;
  // input with an audit trail and other unaudited score data must stay locked.
  resetUnenteredScores(competitionId: string): boolean {
    if (this.client.hasScoringMutations(competitionId) || this.client.hasEnteredScores(competitionId)) return false;
    this.client.deleteCompetitionScores(competitionId);
    return true;
  }

  // Runs in the closing transaction so all configured arrows count in the average.
  finalizeScores(competitionId: string) {
    const competition = this.client.findCompetition(competitionId)!;
    const now = Date.now();
    for (const person of this.client.listCheckedInParticipants(competitionId)) {
      const card = this.client.ensureScorecard(competitionId, person.participantId, now);
      let changed = false;
      for (let number = 1; number <= competition.numberOfRounds; number++) {
        const round = this.client.ensureRound(card.id, number);
        const entered = new Set(this.client.listArrows(round.id).map((arrow) => arrow.arrowIndex));
        for (let index = 1; index <= competition.arrowsPerRound; index++) {
          if (entered.has(index)) continue;
          this.client.insertArrow(round.id, index, 'M');
          changed = true;
        }
        if (round.submittedAt === null) {
          this.client.markRoundSubmitted(round.id, now);
          changed = true;
        }
      }
      if (changed) this.client.updateScorecardVersion(card.id, card.version + 1, now);
    }
    for (const state of this.client.listLaneStates(competitionId)) {
      this.client.updateLaneState(competitionId, state.laneId, {
        completed: true,
        currentParticipantId: null,
        version: state.version + 1,
        updatedAt: now,
      });
    }
  }
}
