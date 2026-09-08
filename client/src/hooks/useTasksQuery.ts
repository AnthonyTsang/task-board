import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { TaskDto } from '@taskboard/shared';
import { listTasks, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

/** The single source of task data. Retry stays at the default — GET is idempotent. */
export function useTasksQuery(): UseQueryResult<TaskDto[], ApiError> {
  return useQuery<TaskDto[], ApiError>({
    queryKey: taskKeys.all,
    queryFn: listTasks,
  });
}
