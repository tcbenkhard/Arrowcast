export interface LaneQrCode {
  grantId: string;
  laneId: string;
  laneNumber: number;
  path: string;
  expiresAt: number;
}

export interface ScoringMutation {
  submissionId: string;
  expectedVersion: number;
  participantId: string;
  roundNumber: number;
  arrows: (string | null)[];
  submit: boolean;
}

export interface ScoringContext {
  competition: { id: string; name: string; numberOfRounds: number; arrowsPerRound: number; status: string; scoringLocked: boolean };
  lane: { id: string; number: number };
  version: number;
  currentRoundNumber: number;
  currentParticipantId: string | null;
  completed: boolean;
  participants: { id: string; name: string; targetLetter: string | null }[];
  rounds: { participantId: string; roundNumber: number; status: 'draft' | 'submitted'; arrows: (string | null)[]; total: number }[];
}

export interface ScoringStanding {
  participantId: string;
  name: string;
  enteredRounds: number;
  totalRounds: number;
  totalScore: number;
  averageScore: number;
}
