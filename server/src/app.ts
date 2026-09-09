import express, { type Express, type RequestHandler } from 'express';
import type { ApiErrorBody } from '@taskboard/shared';
import type { TaskModel } from './models/Task.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createTasksRouter } from './routes/index.js';

/**
 * Builds the Express application. Deliberately does not call listen() — that is
 * server.ts's job, and the split is what lets Supertest drive the real app
 * without binding a port.
 *
 * The task model is injected rather than imported so tests can supply a fake.
 *
 * The client layer is injected the same way and defaults to empty, which keeps
 * the API testable without a built client on disk.
 */
export function createApp(taskModel: TaskModel, clientMiddleware: RequestHandler[] = []): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.use('/api/tasks', createTasksRouter(taskModel));

  // Between the API and the 404 on purpose: the client layer declines /api
  // paths, so an unknown one still falls through to the JSON envelope below
  // rather than being answered with index.html.
  for (const middleware of clientMiddleware) app.use(middleware);

  app.use((_req, res) => {
    const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
    res.status(404).json(body);
  });

  app.use(errorHandler);
  return app;
}
