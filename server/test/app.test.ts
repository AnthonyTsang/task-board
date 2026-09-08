import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/lib/HttpError.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { makeFakeTaskModel } from './helpers/fakeTaskModel.js';

const stubModel = makeFakeTaskModel();

describe('app-level error handling', () => {
  it('returns a JSON 404 envelope for an unmatched route', async () => {
    const res = await request(createApp(stubModel)).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('returns a 400 envelope for a malformed JSON body', async () => {
    const res = await request(createApp(stubModel))
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/JSON/i);
  });

  it('does not leak internals when an unexpected error is thrown', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.get('/boom', () => { throw new Error('SECRET connection string leaked'); });
    app.use(errorHandler);

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET/);
    expect(spy).toHaveBeenCalled();          // the real error is logged server-side
    spy.mockRestore();
  });

  it('renders an HttpError with its status, code, and details', async () => {
    const app = express();
    app.get('/bad', () => {
      throw new HttpError(400, 'VALIDATION_ERROR', 'title is required', [
        { path: 'title', message: 'Required' },
      ]);
    });
    app.use(errorHandler);

    const res = await request(app).get('/bad');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'title', message: 'Required' }]);
  });

  it('responds to the health check', async () => {
    const res = await request(createApp(stubModel)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
