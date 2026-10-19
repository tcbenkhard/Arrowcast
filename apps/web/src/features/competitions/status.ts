export const competitionStatuses = ['Scheduled', 'Check-in', 'Active', 'Closed'] as const;
export type CompetitionStatus = typeof competitionStatuses[number];
