import type { LogbookContext } from '@arrowcast/contracts';

const key = 'arrowcast.logbook.draft';
export interface LogbookDraft {
  context: LogbookContext;
  rounds: (string | null)[][];
  round: number;
  arrowIndex: number;
}
export function readLogbookDraft(): LogbookDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as LogbookDraft | null;
    if (
      !value?.context.entry.id ||
      !Array.isArray(value.rounds) ||
      value.rounds.length !== 10 ||
      !value.rounds.every(
        (round) =>
          Array.isArray(round) &&
          round.length === 3 &&
          round.every((arrow) => arrow === null || /^(M|[1-9]|10)$/.test(arrow)),
      ) ||
      !Number.isInteger(value.round) ||
      value.round < 0 ||
      value.round > 9 ||
      !Number.isInteger(value.arrowIndex) ||
      value.arrowIndex < 0 ||
      value.arrowIndex > 2
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function writeLogbookDraft(value: LogbookDraft | null): boolean {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
