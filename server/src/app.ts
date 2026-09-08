import express, { type Express } from 'express';
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
 */
export function createApp(taskModel: TaskModel): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.use('/api/tasks', createTasksRouter(taskModel));

  app.use((_req, res) => {
    const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
    res.status(404).json(body);
  });

  app.use(errorHandler);
  return app;
}
