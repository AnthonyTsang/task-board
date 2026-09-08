import type { ApiErrorCode, ApiErrorDetail } from '@taskboard/shared';

/** An error carrying everything the error handler needs to build a response. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message: string): HttpError {
  return new HttpError(404, 'NOT_FOUND', message);
}

export function validationError(message: string, details?: ApiErrorDetail[]): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message, details);
}
