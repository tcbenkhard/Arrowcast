import type { ScoringContext, ScoringMutation } from '@arrowcast/contracts';
import { HttpError, requireJson, scoringRequest } from '../../lib/http';

const headers = { 'X-Arrowcast-Scoring': '1' };
const scoringUrl = (grantId: string) => `/api/v1/scoring/${encodeURIComponent(grantId)}`;

export class ScoringContextMismatchError extends HttpError {
  constructor() {
    super(403, 'This QR code belongs to a different competition or lane.');
  }
}

/** A supplied token exchanges QR access; subsequent loads use the scoring cookie. */
export async function loadScoringContext(
  lane: { competitionId: string; laneId: string; grantId: string },
  token?: string | null,
): Promise<ScoringContext> {
  const exchange = token !== undefined;
  const response = await scoringRequest(
    `${scoringUrl(lane.grantId)}/${exchange ? 'exchange' : 'context'}`,
    exchange ? { method: 'POST', headers, json: { token } } : {},
  );
  const result = await requireJson<ScoringContext>(response);
  if (result.competition.id !== lane.competitionId || result.lane.id !== lane.laneId)
    throw new ScoringContextMismatchError();
  return result;
}

export async function submitLaneScores(grantId: string, operation: ScoringMutation): Promise<void> {
  await requireJson(
    await scoringRequest(`${scoringUrl(grantId)}/scores`, { method: 'POST', headers, json: operation }),
  );
}
