import type { competitionStatuses } from '../../db/schema.js';

export interface CompetitionLaneSelection {
  laneId: string;
  distanceMeters: number;
}

export interface CompetitionDetails {
  name: string;
  date: string;
  startingTime: string;
  endingTime: string;
  numberOfRounds: number;
  arrowsPerRound: number;
  defaultTargetType: string | null;
}

export interface CreateCompetition
  extends Omit<CompetitionDetails, 'numberOfRounds' | 'arrowsPerRound' | 'defaultTargetType'> {
  rangeId: string;
  numberOfRounds?: number;
  arrowsPerRound?: number;
  defaultTargetType?: string | null;
  lanes: CompetitionLaneSelection[];
}

export interface UpdateCompetition extends CompetitionDetails {
  rangeId?: string;
  lanes?: CompetitionLaneSelection[];
}

export type CompetitionStatus = (typeof competitionStatuses)[number];
