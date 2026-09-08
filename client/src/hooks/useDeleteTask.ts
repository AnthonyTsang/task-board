import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { TaskDto } from '@taskboard/shared';
import { deleteTask, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

interface DeleteContext {
  previous: TaskDto | undefined;
}

/**
 * Optimistically removes the row, reinserting ONLY that row on error. Same
 * reasoning as useToggleTask: never restore a whole-list snapshot, or
 * concurrent in-flight changes get erased.
 *
 * Reinsertion is NOT by the index captured at onMutate time. That index goes
 * stale the instant another in-flight delete removes a row ahead of it — it's
 * relative to an already-shrunk list, not the list's true original order. Two
 * concurrent deletes that both fail can then land the rolled-back row in the
 * wrong slot even though nothing was lost (see the "preserves row order"
 * regression test). Instead, the rolled-back row is reinserted at the
 * position that preserves createdAt-descending order — the server's actual
 * ordering invariant (newest first) — which is stable no matter what else
 * moved in the meantime.
 */
export function useDeleteTask(): UseMutationResult<void, ApiError, string, DeleteContext> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string, DeleteContext>({
    // Arrow-wrapped — see useCreateTask: mutationFn receives (variables, { client }).
    mutationFn: (id) => deleteTask(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });

      const list = queryClient.getQueryData<TaskDto[]>(taskKeys.all) ?? [];
      const previous = list.find((task) => task.id === id);

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) =>
        current?.filter((task) => task.id !== id),
      );

      return { previous };
    },

    onError: (_err, _id, context) => {
      const { previous } = context ?? {};
      if (!previous) return;

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) => {
        const next = [...(current ?? [])];
        // Find the first row older than `previous` (createdAt DESC order) and
        // insert immediately before it; if none is older, it belongs at the end.
        const insertAt = next.findIndex((task) => task.createdAt < previous.createdAt);
        next.splice(insertAt < 0 ? next.length : insertAt, 0, previous);
        return next;
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
