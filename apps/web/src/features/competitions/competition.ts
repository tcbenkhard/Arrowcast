import type { CompetitionStatus } from './status';

export interface CompetitionSummary {
  id: string;
  name: string;
  date: string;
  startingTime: string;
  endingTime: string;
  status: CompetitionStatus;
  scoresSyncedAt?: number | null;
  range: { id: string; name: string };
}

export interface Competition extends CompetitionSummary {
  numberOfRounds: number;
  arrowsPerRound: number;
  scoringLocked: boolean;
  defaultTargetType: string | null;
}

const statusOrder: Record<CompetitionStatus, number> = { Active: 0, 'Check-in': 1, Scheduled: 2, Closed: 3 };

export function compareCompetitions(a: CompetitionSummary, b: CompetitionSummary): number {
  return (
    statusOrder[a.status] - statusOrder[b.status] ||
    a.date.localeCompare(b.date) ||
    a.startingTime.localeCompare(b.startingTime) ||
    a.id.localeCompare(b.id)
  );
}
