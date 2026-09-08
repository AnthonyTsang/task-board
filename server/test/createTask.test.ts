import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeTaskModel, fakeRow } from './helpers/fakeTaskModel.js';

describe('POST /api/tasks', () => {
  it('creates a task and returns 201 with the DTO', async () => {
    const create = vi.fn().mockResolvedValue(fakeRow());
    const app = createApp(makeFakeTaskModel({ create }));

    const res = await request(app).post('/api/tasks').send({ title: 'Buy milk' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
      title: 'Buy milk',
      description: null,
      completed: false,
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
    });
    expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: null });
  });

  it('trims the title before persisting', async () => {
    const create = vi.fn().mockResolvedValue(fakeRow());
    const app = createApp(makeFakeTaskModel({ create }));

    await request(app).post('/api/tasks').send({ title: '  Buy milk  ' });

    expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: null });
  });

  it('persists a description when one is supplied', async () => {
    const create = vi.fn().mockResolvedValue(fakeRow({ description: 'from the corner shop' }));
    const app = createApp(makeFakeTaskModel({ create }));

    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Buy milk', description: 'from the corner shop' });

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: 'from the corner shop' });
  });

  it('stores an empty-string description as null', async () => {
    const create = vi.fn().mockResolvedValue(fakeRow());
    const app = createApp(makeFakeTaskModel({ create }));

    await request(app).post('/api/tasks').send({ title: 'Buy milk', description: '' });

    expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: null });
  });

  it('rejects a missing title with 400 and field details', async () => {
    const create = vi.fn();
    const res = await request(createApp(makeFakeTaskModel({ create }))).post('/api/tasks').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('title');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only title with 400', async () => {
    const res = await request(createApp(makeFakeTaskModel())).post('/api/tasks').send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a title longer than 200 characters with 400', async () => {
    const res = await request(createApp(makeFakeTaskModel()))
      .post('/api/tasks').send({ title: 'a'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('rejects a description longer than 2000 characters with 400', async () => {
    const res = await request(createApp(makeFakeTaskModel()))
      .post('/api/tasks').send({ title: 'ok', description: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
  });
});
