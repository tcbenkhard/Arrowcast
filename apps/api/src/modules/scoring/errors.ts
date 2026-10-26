export class ScoringError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: 'SCORING_NOT_STARTED',
  ) {
    super(message);
  }
}
