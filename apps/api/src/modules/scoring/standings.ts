import type { ScoringStanding } from '@arrowcast/contracts';
import { calculateAverageScore } from '@arrowcast/scoring';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import {
  arrowScores,
  competitionParticipants,
  competitions,
  lanes,
  participants,
  roundScores,
  scorecards,
} from '../../db/schema.js';

export function scoringStandings(
  db: Pick<AppDatabase, 'select'>,
  competition: typeof competitions.$inferSelect,
): ScoringStanding[] {
  const people = db
    .select({
      participantId: participants.id,
      checkedIn: competitionParticipants.checkedIn,
      name: participants.name,
      laneNumber: lanes.number,
      targetLetter: competitionParticipants.targetLetter,
    })
    .from(competitionParticipants)
    .innerJoin(participants, eq(participants.id, competitionParticipants.participantId))
    .leftJoin(lanes, eq(lanes.id, competitionParticipants.laneId))
    .where(eq(competitionParticipants.competitionId, competition.id))
    .all();
  const scores = db
    .select({ participantId: scorecards.participantId, roundId: roundScores.id, symbol: arrowScores.symbol })
    .from(scorecards)
    .innerJoin(roundScores, and(eq(roundScores.scorecardId, scorecards.id), eq(roundScores.status, 'submitted')))
    .leftJoin(arrowScores, eq(arrowScores.roundScoreId, roundScores.id))
    .where(eq(scorecards.competitionId, competition.id))
    .orderBy(roundScores.roundNumber, arrowScores.arrowIndex)
    .all();
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
