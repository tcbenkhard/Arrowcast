import type { competitions, laneScoringGrants, laneScoringState } from '../../db/schema.js';

export type ScoringCompetition = typeof competitions.$inferSelect;
export type ScoringGrant = typeof laneScoringGrants.$inferSelect;
export type LaneScoringState = typeof laneScoringState.$inferSelect;
export interface SubmittedRound {
  participantId: string;
  roundNumber: number;
}
export interface StandingParticipant {
  participantId: string;
  checkedIn: boolean;
  name: string;
  laneNumber: number | null;
  targetLetter: string | null;
}
export interface StandingScore {
  participantId: string;
  roundId: string;
  symbol: string | null;
}
export interface ResultsParticipant {
  participantId: string;
  federationNumber: string | null;
  clubNumber: string;
  clubName: string;
}
