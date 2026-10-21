/** Values accepted by scoring. `null` represents an arrow not entered yet. */
export type ArrowScore = 'M' | `${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}` | null;

export function arrowScoreValue(score: string | null): number {
  return score === null || score === 'M' ? 0 : Number(score);
}

export function calculateRoundTotal(scores: readonly (string | null)[]): number {
  return scores.reduce((total, score) => total + arrowScoreValue(score), 0);
}

export function isValidArrowScore(score: string | null): boolean {
  return score === null || score === 'M' || /^(?:[1-9]|10)$/.test(score);
}

export function isValidRound(scores: readonly (string | null)[], arrowsPerRound: number, requireComplete: boolean): boolean {
  return scores.length === arrowsPerRound
    && scores.every(isValidArrowScore)
    && (!requireComplete || scores.every((score) => score !== null));
}

export function calculateAverageScore(totalScore: number, enteredRounds: number, arrowsPerRound: number): number {
  return enteredRounds > 0 ? totalScore / (enteredRounds * arrowsPerRound) : 0;
}
