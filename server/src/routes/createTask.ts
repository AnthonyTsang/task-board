import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { toDto } from '../models/Task.js';
import { createTaskBody, parseOrThrow } from '../lib/validate.js';

/** POST /api/tasks — creates a task. */
export function createTaskRouter(taskModel: TaskModel): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const body = parseOrThrow(createTaskBody, req.body, 'Invalid task');
    const task = await taskModel.create({ title: body.title, description: body.description });
    res.status(201).json(toDto(task));
  });

  return router;
}
