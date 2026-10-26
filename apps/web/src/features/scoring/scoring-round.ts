import type { ScoringContext } from '@arrowcast/contracts';

export interface RoundSelection {
  participantId: string;
  roundNumber: number;
}

export function findScoringRound(context: ScoringContext, selection: RoundSelection | null) {
  return context.rounds.find(
    (round) => round.participantId === selection?.participantId && round.roundNumber === selection.roundNumber,
  );
}
