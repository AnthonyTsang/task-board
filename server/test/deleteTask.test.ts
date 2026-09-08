import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeTaskModel } from './helpers/fakeTaskModel.js';

const ID = '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a';

describe('DELETE /api/tasks/:id', () => {
  it('returns 204 with an empty body', async () => {
    const destroy = vi.fn().mockResolvedValue(1);
    const res = await request(createApp(makeFakeTaskModel({ destroy }))).delete(`/api/tasks/${ID}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.text).toBe('');
    expect(destroy).toHaveBeenCalledWith({ where: { id: ID } });
  });

  it('returns 404 when no rows are deleted', async () => {
    const destroy = vi.fn().mockResolvedValue(0);
    const res = await request(createApp(makeFakeTaskModel({ destroy }))).delete(`/api/tasks/${ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a non-UUID id', async () => {
    const destroy = vi.fn();
    const res = await request(createApp(makeFakeTaskModel({ destroy }))).delete('/api/tasks/abc');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(destroy).not.toHaveBeenCalled();
  });
});
