import { useMemo, useState } from 'react';
import { useTasksQuery } from './hooks/useTasksQuery';
import { TaskForm } from './components/TaskForm';
import { FilterTabs } from './components/FilterTabs';
import { TaskList } from './components/TaskList';
import { EmptyState, type Filter } from './components/EmptyState';
import { ErrorBanner } from './components/ErrorBanner';

export default function App() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data: tasks, isPending, isError, error } = useTasksQuery();

  const all = useMemo(() => tasks ?? [], [tasks]);

  const counts = useMemo<Record<Filter, number>>(() => ({
    all: all.length,
    active: all.filter((t) => !t.completed).length,
    done: all.filter((t) => t.completed).length,
  }), [all]);

  const visible = useMemo(() => {
    if (filter === 'active') return all.filter((t) => !t.completed);
    if (filter === 'done') return all.filter((t) => t.completed);
    return all;
  }, [all, filter]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Task Board
      </h1>

      <TaskForm />

      {isError && <ErrorBanner message={error.message} />}

      <FilterTabs value={filter} onChange={setFilter} counts={counts} />

      {isPending ? (
        <p className="px-1 py-8 text-center text-sm text-neutral-500">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <TaskList tasks={visible} />
      )}

      <p className="mt-4 px-1 text-sm text-neutral-500 dark:text-neutral-400">
        {counts.active} of {counts.all} remaining
      </p>
    </main>
  );
}
