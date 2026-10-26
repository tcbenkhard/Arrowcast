import { ApplicationError } from '../../shared/errors.js';

export class ParticipantImportError extends ApplicationError {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message, statusCode);
  }
}
