import { z } from 'zod';
import type { ApiErrorDetail } from '@taskboard/shared';
import { validationError } from './HttpError.js';

/**
 * Body accepted by POST /api/tasks.
 *
 * `.trim()` runs before `.min(1)`, so a whitespace-only title is rejected.
 * Absent, null, and empty-string descriptions all normalize to null so the
 * column never holds a mix of NULL and ''.
 */
export const createTaskBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});

/** Route params for the two :id endpoints. */
export const taskIdParam = z.object({ id: z.uuid() });

/** Flattens zod issues into the API's error `details` array. */
export function toDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Parses input or throws a 400 HttpError carrying field-level details. */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw validationError(message, toDetails(result.error));
  }
  return result.data;
}
