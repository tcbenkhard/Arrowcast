/** An expected application failure that can be translated at the transport boundary. */
export class ApplicationError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
