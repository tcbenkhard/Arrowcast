import type { SubmittedRound } from './types.js';

export function laneProgress(
  submitted: readonly SubmittedRound[],
  participantOrder: string[],
  numberOfRounds: number,
  currentRoundNumber: number,
) {
  const saved = new Set(submitted.map((round) => `${round.participantId}/${round.roundNumber}`));
  for (let number = 1; number <= numberOfRounds; number++) {
    const missing = participantOrder.find((id) => !saved.has(`${id}/${number}`));
    if (missing) return { currentParticipantId: missing, currentRoundNumber: number, completed: false };
  }
  return { currentParticipantId: null, currentRoundNumber, completed: true };
}
