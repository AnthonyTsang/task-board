import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { createTaskRouter } from './createTask.js';

/** Composes the per-operation routers. Each operation lives in its own module. */
export function createTasksRouter(taskModel: TaskModel): Router {
  const router = Router();
  router.use(createTaskRouter(taskModel));
  return router;
}
