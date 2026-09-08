import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { TaskDto } from '@taskboard/shared';
import { toggleTask, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

interface ToggleContext {
  previous: TaskDto | undefined;
}

/**
 * Optimistically flips `completed`, rolling back ONE ENTRY on error.
 *
 * Deliberately not TanStack's documented whole-list snapshot pattern: two rows
 * can be in flight at once, and restoring a whole-list snapshot would erase a
 * concurrent row's optimistic change. Only the affected task's prior value is
 * kept in context.
 */
export function useToggleTask(): UseMutationResult<TaskDto, ApiError, string, ToggleContext> {
  const queryClient = useQueryClient();

  return useMutation<TaskDto, ApiError, string, ToggleContext>({
    // Arrow-wrapped — see useCreateTask: mutationFn receives (variables, { client }).
    mutationFn: (id) => toggleTask(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });

      const list = queryClient.getQueryData<TaskDto[]>(taskKeys.all);
      const previous = list?.find((task) => task.id === id);

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) =>
        current?.map((task) =>
          task.id === id ? { ...task, completed: !task.completed } : task,
        ),
      );

      return { previous };
    },

    onError: (_err, id, context) => {
      // Restore only this task, leaving every other row's in-flight state intact.
      const previous = context?.previous;
      if (!previous) return;

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) =>
        current?.map((task) => (task.id === id ? previous : task)),
      );
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
