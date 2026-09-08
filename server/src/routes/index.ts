import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { createTaskRouter } from './createTask.js';
import { listTasksRouter } from './listTasks.js';
import { toggleTaskRouter } from './toggleTask.js';
import { deleteTaskRouter } from './deleteTask.js';

/** Composes the per-operation routers. Each operation lives in its own module. */
export function createTasksRouter(taskModel: TaskModel): Router {
  const router = Router();
  router.use(createTaskRouter(taskModel));
  router.use(listTasksRouter(taskModel));
  router.use(toggleTaskRouter(taskModel));
  router.use(deleteTaskRouter(taskModel));
  return router;
}
