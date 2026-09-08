import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeTaskModel, fakeRow } from './helpers/fakeTaskModel.js';

describe('GET /api/tasks', () => {
  it('returns 200 and an array of DTOs', async () => {
    const findAll = vi.fn().mockResolvedValue([
      fakeRow({ id: '11111111-1111-4111-8111-111111111111', title: 'Newer' }),
      fakeRow({ id: '22222222-2222-4222-8222-222222222222', title: 'Older' }),
    ]);
    const res = await request(createApp(makeFakeTaskModel({ findAll }))).get('/api/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('Newer');
    expect(res.body[0].createdAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('orders by createdAt descending', async () => {
    const findAll = vi.fn().mockResolvedValue([]);
    await request(createApp(makeFakeTaskModel({ findAll }))).get('/api/tasks');

    expect(findAll).toHaveBeenCalledWith({ order: [['createdAt', 'DESC']] });
  });

  it('returns an empty array when there are no tasks', async () => {
    const findAll = vi.fn().mockResolvedValue([]);
    const res = await request(createApp(makeFakeTaskModel({ findAll }))).get('/api/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('surfaces an unexpected model failure as a generic 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const findAll = vi.fn().mockRejectedValue(new Error('SECRET connection refused'));
    const res = await request(createApp(makeFakeTaskModel({ findAll }))).get('/api/tasks');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET/);
    spy.mockRestore();
  });
});
