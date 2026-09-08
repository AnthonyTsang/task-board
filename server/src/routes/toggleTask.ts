import { Router } from 'express';
import { literal } from 'sequelize';
import type { TaskModel, Task } from '../models/Task.js';
import { toDto } from '../models/Task.js';
import { taskIdParam, parseOrThrow } from '../lib/validate.js';
import { notFound } from '../lib/HttpError.js';

/**
 * PATCH /api/tasks/:id/toggle — flips `completed`.
 *
 * Takes no body: this endpoint toggles, it does not set. That makes it
 * non-idempotent, which is why the client pins mutation retry to 0.
 *
 * The flip is one atomic UPDATE, avoiding the lost-update race where two
 * concurrent toggles both read false and both write true.
 *
 * If Sequelize's attribute validation rejects the Literal against a BOOLEAN
 * column at runtime, the fallback is a raw query — see the spec's
 * "Implementation note" under Toggle semantics.
 */
export function toggleTaskRouter(taskModel: TaskModel): Router {
  const router = Router();

  router.patch('/:id/toggle', async (req, res) => {
    const { id } = parseOrThrow(taskIdParam, req.params, 'Invalid task id');

    const [affected, rows] = (await taskModel.update(
      { completed: literal('NOT completed') } as never,
      { where: { id }, returning: true },
    )) as unknown as [number, Task[]];

    if (affected === 0 || rows.length === 0) {
      throw notFound(`No task with id ${id}`);
    }

    res.json(toDto(rows[0]!));
  });

  return router;
}
