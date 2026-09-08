import type { ErrorRequestHandler } from 'express';
import type { ApiErrorBody } from '@taskboard/shared';
import { HttpError } from '../lib/HttpError.js';

/**
 * The single place an error becomes a response. Route modules throw; this formats.
 *
 * Express 5 forwards rejected promises here automatically, so route handlers are
 * plain async functions with no asyncHandler wrapper.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    };
    res.status(err.status).json(body);
    return;
  }

  // express.json() raises a SyntaxError with a `body` property on malformed input.
  if (err instanceof SyntaxError && 'body' in err) {
    const body: ApiErrorBody = {
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON in request body' },
    };
    res.status(400).json(body);
    return;
  }

  // Anything unexpected: log the truth, return nothing revealing.
  console.error('Unhandled error:', err);
  const body: ApiErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  };
  res.status(500).json(body);
};
