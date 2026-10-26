import { t } from '@arrowcast/contracts/i18n';
import type { ScoringMutation } from '@arrowcast/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../../db/context.js';
import { ScoringContextService } from './context.js';
import { ScoringError } from './errors.js';
import { ScoringGrantService } from './grants.js';
import { ScoreSubmissionService } from './score-submission.js';
import { hashToken, newToken } from '../../shared/tokens.js';
import { ScoringDatabaseClient } from './scoring-database-client.js';

export class ScoringSessionService {
  private readonly client: ScoringDatabaseClient;
  private readonly grants: ScoringGrantService;
  private readonly scoring: ScoringContextService;

  constructor(private readonly context: DatabaseContext) {
    this.client = new ScoringDatabaseClient(context);
    this.grants = new ScoringGrantService(context);
    this.scoring = new ScoringContextService(context);
  }

  private authorize(grantId: string, token: string | undefined) {
    const grant = this.grants.validGrant(grantId);
    const session = token ? this.client.findSession(hashToken(token)) : undefined;
    if (!session || session.grantId !== grantId || session.revokedAt !== null || session.expiresAt <= Date.now()) {
      throw new ScoringError(401, t('routes.scan_the_lane_qr_code_to_open_a_scoring'));
    }
    return { grant, session };
  }

  exchangeScoringToken(grantId: string, laneToken: string) {
    const grant = this.grants.validGrant(grantId);
    if (hashToken(laneToken) !== grant.tokenHash) throw new ScoringError(401, t('routes.invalid_lane_scoring_code'));
    const context = this.scoring.scoringContext(grant);
    const token = newToken();
    const now = Date.now();
    const expiresAt = Math.min(grant.expiresAt, now + 86400_000);
    this.client.insertSession({
      id: randomUUID(),
      grantId: grant.id,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt,
    });
    return { context, token, maxAge: Math.floor((expiresAt - now) / 1000) };
  }

  getScoringContext(grantId: string, token: string | undefined) {
    const { grant } = this.authorize(grantId, token);
    return this.context.transaction((context) => new ScoringContextService(context).scoringContext(grant));
  }

  submitScores(grantId: string, token: string | undefined, mutation: ScoringMutation) {
    const { session } = this.authorize(grantId, token);
    return this.context.transaction((context) =>
      new ScoreSubmissionService(context).saveScores(grantId, session.id, mutation),
    );
  }
}
