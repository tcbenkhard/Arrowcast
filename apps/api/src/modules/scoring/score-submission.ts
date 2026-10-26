import { t } from '@arrowcast/contracts/i18n';
import type { ScoringMutation } from '@arrowcast/contracts';
import { isValidRound } from '@arrowcast/scoring';
import type { DatabaseContext } from '../../db/context.js';
import { ScoringContextService } from './context.js';
import { ScoringError } from './errors.js';
import { ScoringGrantService } from './grants.js';
import { laneProgress } from './progress.js';
import { roundArrows } from './scorecards.js';
import { hashToken } from '../../shared/tokens.js';
import { ScoringDatabaseClient } from './scoring-database-client.js';

export class ScoreSubmissionService {
  private readonly client: ScoringDatabaseClient;
  private readonly grants: ScoringGrantService;
  private readonly scoring: ScoringContextService;

  constructor(context: DatabaseContext) {
    this.client = new ScoringDatabaseClient(context);
    this.grants = new ScoringGrantService(context);
    this.scoring = new ScoringContextService(context);
  }

  // The session service owns the transaction, including the mutation audit and
  // optimistic lane-version update, so conflicts cannot leave partial scores.
  saveScores(grantId: string, sessionId: string, body: ScoringMutation) {
    const grant = this.grants.validGrant(grantId);
    const requestHash = hashToken(
      JSON.stringify({
        grantId,
        expectedVersion: body.expectedVersion,
        participantId: body.participantId,
        roundNumber: body.roundNumber,
        arrows: body.arrows,
        submit: body.submit,
      }),
    );
    const previous = this.client.findMutation(body.submissionId);
    if (previous) {
      if (previous.sessionId !== sessionId || previous.requestHash !== requestHash)
        throw new ScoringError(409, t('service.submission_id_has_already_been_used_with_different_input'));
      return { version: previous.resultVersion };
    }
    const competition = this.client.findCompetition(grant.competitionId)!;
    if (competition.status !== 'Active' || competition.scoringLocked)
      throw new ScoringError(403, t('service.scoring_is_paused_or_the_competition_is_closed'));
    const state = this.scoring.presentLaneState(competition, grant.laneId);
    if (!state || state.version !== body.expectedVersion)
      throw new ScoringError(409, t('ScoringPage.lane_progress_changed_on_another_device_reload_the_latest'));
    if (!this.client.findLaneAssignment(grant.competitionId, body.participantId, grant.laneId))
      throw new ScoringError(403, t('service.this_participant_is_not_assigned_to_your_lane'));
    if (
      body.roundNumber > competition.numberOfRounds ||
      !isValidRound(body.arrows, competition.arrowsPerRound, body.submit)
    )
      throw new ScoringError(400, t('service.enter_the_configured_number_of_valid_arrow_scores'));
    if (body.roundNumber > state.currentRoundNumber) {
      throw new ScoringError(
        409,
        t('service.finish_round_for_everyone_in_your_lane_before_entering', {
          p0: state.currentRoundNumber,
          p1: body.roundNumber,
        }),
      );
    }
    const now = Date.now();
    const card = this.client.ensureScorecard(grant.competitionId, body.participantId, now);
    const round = this.client.ensureRound(card.id, body.roundNumber);
    if (round.submittedAt !== null && !body.submit)
      throw new ScoringError(409, t('service.save_a_complete_correction_to_update_a_submitted_round'));
    const before = roundArrows(this.client.listArrows(round.id), competition.arrowsPerRound);
    this.client.deleteRoundArrows(round.id);
    body.arrows.forEach((symbol, index) => {
      if (symbol !== null) this.client.insertArrow(round.id, index + 1, symbol);
    });
    if (body.submit) this.client.markRoundSubmitted(round.id, now);
    this.client.updateScorecardVersion(card.id, card.version + 1, now);
    const progress = body.submit
      ? laneProgress(
          this.client.listSubmittedRounds(competition.id),
          state.participantOrder,
          competition.numberOfRounds,
          state.currentRoundNumber,
        )
      : {
          currentParticipantId: state.currentParticipantId,
          currentRoundNumber: state.currentRoundNumber,
          completed: state.completed,
        };
    const result = { version: state.version + 1 };
    const updated = this.client.updateLaneState(
      grant.competitionId,
      grant.laneId,
      {
        version: result.version,
        participantOrder: state.participantOrder,
        ...progress,
        updatedAt: now,
      },
      body.expectedVersion,
    );
    if (!updated) throw new ScoringError(409, t('service.lane_progress_changed_reload_the_latest_scores'));
    this.client.insertMutation({
      id: body.submissionId,
      scorecardId: card.id,
      sessionId,
      requestHash,
      resultVersion: result.version,
      roundNumber: body.roundNumber,
      before,
      after: body.arrows,
      submitted: body.submit,
      createdAt: now,
    });
    return result;
  }
}
