import { t } from '@arrowcast/contracts/i18n';
import { randomUUID } from 'node:crypto';
import type { LaneQrCode } from '@arrowcast/contracts';
import type { DatabaseContext } from '../../db/context.js';
import { ScoringError } from './errors.js';
import { hashToken, newToken } from '../../shared/tokens.js';
import { ScoringDatabaseClient } from './scoring-database-client.js';

export class ScoringGrantService {
  private readonly client: ScoringDatabaseClient;

  constructor(context: DatabaseContext) {
    this.client = new ScoringDatabaseClient(context);
  }

  revokeGrants(competitionId: string) {
    const now = Date.now();
    this.client.revokeGrantSessions(competitionId, now);
    this.client.revokeGrants(competitionId, now);
  }

  // Admins can retrieve issued codes for reprinting; replacements revoke previous grants.
  issueLaneCodes(competitionId: string): LaneQrCode[] {
    this.revokeGrants(competitionId);
    const now = Date.now();
    return this.client.listCompetitionLanes(competitionId).map((lane) => {
      const grantId = randomUUID();
      const token = newToken();
      const expiresAt = now + 7 * 86400_000;
      this.client.insertGrant({
        id: grantId,
        competitionId,
        laneId: lane.laneId,
        token,
        tokenHash: hashToken(token),
        createdAt: now,
        expiresAt,
      });
      return {
        ...lane,
        grantId,
        expiresAt,
        path: `/scores/${competitionId}/${lane.laneId}/${grantId}#token=${token}`,
      };
    });
  }

  // Recover displayable codes for older grants without revoking printed codes or sessions.
  restoreLaneCodes(competitionId: string) {
    const now = Date.now();
    const grants = this.client.listUnrevokedGrants(competitionId).filter((grant) => grant.expiresAt > now);
    const restoredLanes = new Set(grants.filter((grant) => grant.token).map((grant) => grant.laneId));
    for (const grant of grants) {
      if (restoredLanes.has(grant.laneId)) continue;
      const token = newToken();
      this.client.insertGrant({
        id: randomUUID(),
        competitionId,
        laneId: grant.laneId,
        token,
        tokenHash: hashToken(token),
        createdAt: now,
        expiresAt: grant.expiresAt,
      });
      restoredLanes.add(grant.laneId);
    }
  }

  validGrant(grantId: string) {
    const grant = this.client.findGrant(grantId);
    if (grant) {
      const status = this.client.findCompetition(grant.competitionId)?.status;
      if (status !== 'Active') {
        throw new ScoringError(
          403,
          t(
            status === 'Closed'
              ? 'service.this_competition_is_closed_scoring_access_has_ended'
              : 'routes.scoring_has_not_started',
          ),
          status === 'Closed' ? undefined : 'SCORING_NOT_STARTED',
        );
      }
    }
    if (!grant || grant.revokedAt !== null || grant.expiresAt <= Date.now()) {
      throw new ScoringError(401, t('service.this_scoring_code_has_expired_or_been_revoked_ask'));
    }
    return grant;
  }
}
