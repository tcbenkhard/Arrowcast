export interface ApiTokenSummary {
  id: string;
  name: string;
  createdDate: number;
}

export interface CreatedApiToken extends ApiTokenSummary {
  token: string;
}

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
  competition: {
    id: string;
    name: string;
    numberOfRounds: number;
    arrowsPerRound: number;
    status: string;
    scoringLocked: boolean;
  };
  lane: { id: string; number: number };
  version: number;
  currentRoundNumber: number;
  currentParticipantId: string | null;
  completed: boolean;
  participants: { id: string; name: string; targetLetter: string | null }[];
  rounds: {
    participantId: string;
    roundNumber: number;
    status: 'draft' | 'submitted';
    arrows: (string | null)[];
    total: number;
  }[];
}

export interface ScoringStanding {
  participantId: string;
  checkedIn: boolean;
  name: string;
  laneNumber: number | null;
  targetLetter: string | null;
  enteredRounds: number;
  totalRounds: number;
  totalScore: number;
  averageScore: number;
  lastArrows: string[];
}
export interface LogbookPerson {
  id: string;
  name: string;
  clubName: string;
  hasPin: boolean;
}

export interface LogbookHistoryEntry {
  id: string;
  total: number;
  completedAt: number;
}

export interface LogbookContext {
  participant: { id: string; name: string };
  entry: { id: string; rounds: (string | null)[][]; version: number; completedAt: number | null; total: number | null };
  history: LogbookHistoryEntry[];
}

export interface LogbookSummary {
  participantId: string;
  name: string;
  averageScore: number;
  averagePerArrow: number;
  highestScore: number;
}
