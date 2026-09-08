import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { toDto } from '../models/Task.js';

/** GET /api/tasks — every task, newest first. No pagination, no filtering. */
export function listTasksRouter(taskModel: TaskModel): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const tasks = await taskModel.findAll({ order: [['createdAt', 'DESC']] });
    res.json(tasks.map(toDto));
  });

  return router;
}
