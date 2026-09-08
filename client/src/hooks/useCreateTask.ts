import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { TaskDto, CreateTaskInput } from '@taskboard/shared';
import { createTask, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

/**
 * Invalidate-only, deliberately not optimistic: the server generates id,
 * createdAt, and updatedAt, so an optimistic insert would need a placeholder
 * row and reconciliation. A brief spinner on submit reads as normal.
 */
export function useCreateTask(): UseMutationResult<TaskDto, ApiError, CreateTaskInput> {
  const queryClient = useQueryClient();

  return useMutation<TaskDto, ApiError, CreateTaskInput>({
    // Wrapped, not passed directly: TanStack Query 5.102.8 invokes
    // mutationFn(variables, mutationFnContext) — a second, internal argument.
    // Passing `createTask` by reference would forward that context object
    // straight into the transport layer's call signature. The wrapper keeps
    // the boundary clean: only the declared CreateTaskInput crosses it.
    mutationFn: (input: CreateTaskInput) => createTask(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
