import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { taskIdParam, parseOrThrow } from '../lib/validate.js';
import { notFound } from '../lib/HttpError.js';

/** DELETE /api/tasks/:id — removes a task. Returns 204 with no body. */
export function deleteTaskRouter(taskModel: TaskModel): Router {
  const router = Router();

  router.delete('/:id', async (req, res) => {
    const { id } = parseOrThrow(taskIdParam, req.params, 'Invalid task id');

    const deleted = await taskModel.destroy({ where: { id } });
    if (deleted === 0) {
      throw notFound(`No task with id ${id}`);
    }

    res.status(204).end();
  });

  return router;
}
