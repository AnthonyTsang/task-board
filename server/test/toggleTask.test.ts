import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeTaskModel, fakeRow } from './helpers/fakeTaskModel.js';

const ID = '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a';

describe('PATCH /api/tasks/:id/toggle', () => {
  it('returns 200 with the updated task', async () => {
    const update = vi.fn().mockResolvedValue([1, [fakeRow({ completed: true })]]);
    const res = await request(createApp(makeFakeTaskModel({ update })))
      .patch(`/api/tasks/${ID}/toggle`);

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
    expect(res.body.id).toBe(ID);
  });

  it('flips the column in a single atomic statement rather than reading first', async () => {
    const findAll = vi.fn();
    const update = vi.fn().mockResolvedValue([1, [fakeRow({ completed: true })]]);
    await request(createApp(makeFakeTaskModel({ update, findAll })))
      .patch(`/api/tasks/${ID}/toggle`);

    // No read-modify-write: the handler must not fetch the row first.
    expect(findAll).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);

    const [values, options] = update.mock.calls[0]!;
    expect(String(values.completed.val ?? values.completed)).toContain('NOT completed');
    expect(options).toMatchObject({ where: { id: ID }, returning: true });
  });

  it('ignores any request body — the endpoint flips, it does not set', async () => {
    const update = vi.fn().mockResolvedValue([1, [fakeRow({ completed: true })]]);
    const res = await request(createApp(makeFakeTaskModel({ update })))
      .patch(`/api/tasks/${ID}/toggle`)
      .send({ completed: false });

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });

  it('returns 404 when no rows are affected', async () => {
    const update = vi.fn().mockResolvedValue([0, []]);
    const res = await request(createApp(makeFakeTaskModel({ update })))
      .patch(`/api/tasks/${ID}/toggle`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // Pins the route's own 404, not the app's catch-all (same status/code):
    // the message must name the id, and update must have actually run.
    expect(res.body.error.message).toContain(ID);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for a non-UUID id, never letting it reach Postgres', async () => {
    const update = vi.fn();
    const res = await request(createApp(makeFakeTaskModel({ update })))
      .patch('/api/tasks/abc/toggle');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(update).not.toHaveBeenCalled();
  });
});
