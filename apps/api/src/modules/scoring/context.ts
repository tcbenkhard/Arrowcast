import { t } from '@arrowcast/contracts/i18n';
import type { ScoringContext } from '@arrowcast/contracts';
import { calculateRoundTotal } from '@arrowcast/scoring';
import type { DatabaseContext } from '../../db/context.js';
import { ScoringError } from './errors.js';
import { laneProgress } from './progress.js';
import { roundArrows } from './scorecards.js';
import { ScoringDatabaseClient } from './scoring-database-client.js';
import type { ScoringCompetition, ScoringGrant } from './types.js';

export class ScoringContextService {
  private readonly client: ScoringDatabaseClient;

  constructor(context: DatabaseContext) {
    this.client = new ScoringDatabaseClient(context);
  }

  // Existing active competitions may still have absent archers in their saved order.
  presentLaneState(competition: ScoringCompetition, laneId: string) {
    const state = this.client.findLaneState(competition.id, laneId);
    if (!state) return undefined;
    const absent = new Set(this.client.listAbsentParticipantIds(competition.id));
    const participantOrder = state.participantOrder.filter((id) => !absent.has(id));
    if (participantOrder.length === state.participantOrder.length) return state;
    return {
      ...state,
      participantOrder,
      ...laneProgress(
        this.client.listSubmittedRounds(competition.id),
        participantOrder,
        competition.numberOfRounds,
        state.currentRoundNumber,
      ),
    };
  }

  scoringContext(grant: ScoringGrant): ScoringContext {
    const competition = this.client.findCompetition(grant.competitionId)!;
    const lane = this.client.findLane(grant.laneId)!;
    const state = this.presentLaneState(competition, grant.laneId);
    if (!state) throw new ScoringError(403, t('service.scoring_has_not_started_for_this_lane'));
    const assigned = this.client.listLaneParticipants(grant.competitionId, grant.laneId);
    const people = state.participantOrder.map((id) => assigned.find((person) => person.id === id));
    if (people.some((person) => !person))
      throw new ScoringError(403, t('service.lane_assignments_have_changed_ask_the_organizer_for_a'));
    const rounds: ScoringContext['rounds'] = [];
    for (const person of assigned) {
      const card = this.client.findScorecard(competition.id, person.id);
      if (!card) continue;
      for (const round of this.client.listRounds(card.id)) {
        const arrows = roundArrows(this.client.listArrows(round.id), competition.arrowsPerRound);
        rounds.push({
          participantId: person.id,
          roundNumber: round.roundNumber,
          status: round.submittedAt === null ? 'draft' : 'submitted',
          arrows,
          total: calculateRoundTotal(arrows),
        });
      }
    }
    return {
      competition: {
        id: competition.id,
        name: competition.name,
        numberOfRounds: competition.numberOfRounds,
        arrowsPerRound: competition.arrowsPerRound,
        status: competition.status,
        scoringLocked: competition.scoringLocked,
      },
      lane: { id: lane.id, number: lane.number },
      version: state.version,
      currentRoundNumber: state.currentRoundNumber,
      currentParticipantId: state.currentParticipantId,
      completed: state.completed,
      participants: people.filter((person) => person !== undefined),
      rounds,
    };
  }
}
