import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { TaskDto } from '@taskboard/shared';
import { deleteTask, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

interface DeleteContext {
  previous: TaskDto | undefined;
  index: number;
}

/**
 * Optimistically removes the row, reinserting ONLY that row at its original
 * position on error. Same reasoning as useToggleTask: never restore a
 * whole-list snapshot, or concurrent in-flight changes get erased.
 */
export function useDeleteTask(): UseMutationResult<void, ApiError, string, DeleteContext> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string, DeleteContext>({
    // Arrow-wrapped — see useCreateTask: mutationFn receives (variables, { client }).
    mutationFn: (id) => deleteTask(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });

      const list = queryClient.getQueryData<TaskDto[]>(taskKeys.all) ?? [];
      const index = list.findIndex((task) => task.id === id);
      const previous = index >= 0 ? list[index] : undefined;

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) =>
        current?.filter((task) => task.id !== id),
      );

      return { previous, index };
    },

    onError: (_err, _id, context) => {
      if (!context?.previous || context.index < 0) return;

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) => {
        const next = [...(current ?? [])];
        next.splice(context.index, 0, context.previous!);
        return next;
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
