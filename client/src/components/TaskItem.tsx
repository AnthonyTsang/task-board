import type { TaskDto } from '@taskboard/shared';
import { useToggleTask } from '../hooks/useToggleTask';
import { useDeleteTask } from '../hooks/useDeleteTask';
import { ErrorBanner } from './ErrorBanner';

/**
 * One row. Owns its own mutation instances, so `isPending` is per-row and no
 * shared pending-id set is needed. Toggle and delete errors are surfaced here
 * too, right below the row that failed, so the user knows which task it was.
 */
export function TaskItem({ task }: { task: TaskDto }) {
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  const busy = toggle.isPending || remove.isPending;

  return (
    <li className="border-b border-neutral-200 px-1 py-3 last:border-0 dark:border-neutral-800">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={task.completed}
          disabled={busy}
          onChange={() => { toggle.mutate(task.id); }}
          aria-label={`Mark ${task.title} as ${task.completed ? 'active' : 'done'}`}
          className="mt-1 size-4 shrink-0 accent-neutral-900 disabled:opacity-40 dark:accent-neutral-100"
        />

        <div className="min-w-0 flex-1">
          <p
            data-testid="task-title"
            className={
              task.completed
                ? 'line-through text-neutral-400 dark:text-neutral-600'
                : 'text-neutral-900 dark:text-neutral-100'
            }
          >
            {task.title}
          </p>
          {task.description !== null && (
            <p
              data-testid="task-description"
              className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400"
            >
              {task.description}
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => { remove.mutate(task.id); }}
          aria-label={`Delete ${task.title}`}
          className="shrink-0 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-neutral-800"
        >
          ✕
        </button>
      </div>

      {toggle.isError && (
        <ErrorBanner message={toggle.error.message} onDismiss={() => { toggle.reset(); }} />
      )}
      {remove.isError && (
        <ErrorBanner message={remove.error.message} onDismiss={() => { remove.reset(); }} />
      )}
    </li>
  );
}
