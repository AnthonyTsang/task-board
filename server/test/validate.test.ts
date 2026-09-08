import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createTaskBody, taskIdParam, parseOrThrow, toDetails } from '../src/lib/validate.js';
import { HttpError } from '../src/lib/HttpError.js';

describe('createTaskBody', () => {
  it('trims the title', () => {
    expect(createTaskBody.parse({ title: '  Buy milk  ' }).title).toBe('Buy milk');
  });

  it('rejects an empty title', () => {
    expect(createTaskBody.safeParse({ title: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only title, because trim runs before the length check', () => {
    expect(createTaskBody.safeParse({ title: '     ' }).success).toBe(false);
  });

  it('rejects a title longer than 200 characters', () => {
    expect(createTaskBody.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
  });

  it('accepts a title of exactly 200 characters', () => {
    expect(createTaskBody.safeParse({ title: 'a'.repeat(200) }).success).toBe(true);
  });

  it('coerces an absent description to null', () => {
    expect(createTaskBody.parse({ title: 'x' }).description).toBeNull();
  });

  it('coerces an explicit null description to null', () => {
    expect(createTaskBody.parse({ title: 'x', description: null }).description).toBeNull();
  });

  it('coerces an empty-string description to null', () => {
    // An untouched description input submits "". Without this the table fills
    // with a mix of NULL and '' rows that the client renders differently.
    expect(createTaskBody.parse({ title: 'x', description: '' }).description).toBeNull();
  });

  it('coerces a whitespace-only description to null', () => {
    expect(createTaskBody.parse({ title: 'x', description: '   ' }).description).toBeNull();
  });

  it('keeps a real description, trimmed', () => {
    expect(createTaskBody.parse({ title: 'x', description: '  note  ' }).description).toBe('note');
  });

  it('rejects a description longer than 2000 characters', () => {
    expect(createTaskBody.safeParse({ title: 'x', description: 'a'.repeat(2001) }).success).toBe(false);
  });
});

describe('taskIdParam', () => {
  it('accepts a UUID', () => {
    expect(taskIdParam.safeParse({ id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a' }).success).toBe(true);
  });

  it('rejects a non-UUID, so a bad id never reaches Postgres as a failed cast', () => {
    expect(taskIdParam.safeParse({ id: 'abc' }).success).toBe(false);
  });
});

describe('parseOrThrow', () => {
  it('returns parsed data on success', () => {
    expect(parseOrThrow(createTaskBody, { title: 'x' }, 'bad').title).toBe('x');
  });

  it('throws a 400 HttpError carrying field-level details', () => {
    try {
      parseOrThrow(createTaskBody, { title: '' }, 'Invalid task');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const e = err as HttpError;
      expect(e.status).toBe(400);
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.details?.[0]?.path).toBe('title');
    }
  });
});

describe('toDetails', () => {
  it('maps a flat path to its field name', () => {
    const result = createTaskBody.safeParse({ title: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toDetails(result.error)).toEqual([
        { path: 'title', message: expect.stringContaining('Too small') },
      ]);
    }
  });

  it('joins nested paths with dots', () => {
    const nestedSchema = z.object({ a: z.object({ b: z.string() }) });
    const result = nestedSchema.safeParse({ a: { b: 1 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const details = toDetails(result.error);
      expect(details).toHaveLength(1);
      expect(details[0]!.path).toBe('a.b');
    }
  });
});
