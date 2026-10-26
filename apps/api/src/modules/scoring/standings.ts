import type { ScoringStanding } from '@arrowcast/contracts';
import { calculateAverageScore } from '@arrowcast/scoring';
import type { ScoringCompetition, StandingParticipant, StandingScore } from './types.js';

export function scoringStandings(
  competition: ScoringCompetition,
  people: readonly StandingParticipant[],
  scores: readonly StandingScore[],
): ScoringStanding[] {
  const totals = new Map<string, { rounds: Set<string>; total: number; lastArrows: string[] }>();
  for (const score of scores) {
    const total = totals.get(score.participantId) ?? { rounds: new Set<string>(), total: 0, lastArrows: [] };
    total.rounds.add(score.roundId);
    total.total += score.symbol && score.symbol !== 'M' ? Number(score.symbol) : 0;
    if (score.symbol !== null) {
      total.lastArrows.push(score.symbol);
      if (total.lastArrows.length > 3) total.lastArrows.shift();
    }
    totals.set(score.participantId, total);
  }
  return people
    .filter((person) => competition.status === 'Closed' || person.checkedIn)
    .map((person): ScoringStanding => {
      const total = person.checkedIn ? totals.get(person.participantId) : undefined;
      const enteredRounds = total?.rounds.size ?? 0;
      const totalScore = total?.total ?? 0;
      return {
        ...person,
        enteredRounds,
        totalRounds: competition.numberOfRounds,
        totalScore,
        averageScore: calculateAverageScore(totalScore, enteredRounds, competition.arrowsPerRound),
        lastArrows: total?.lastArrows ?? [],
      };
    })
    .sort(
      (a, b) =>
        Number(b.checkedIn) - Number(a.checkedIn) ||
        b.averageScore - a.averageScore ||
        a.name.localeCompare(b.name, 'nl'),
    );
}
