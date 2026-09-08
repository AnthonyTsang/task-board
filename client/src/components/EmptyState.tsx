export type Filter = 'all' | 'active' | 'done';

const MESSAGES: Record<Filter, string> = {
  all: 'No tasks yet. Add one above to get started.',
  active: 'Nothing active — everything is done.',
  done: 'Nothing completed yet.',
};

export function EmptyState({ filter }: { filter: Filter }) {
  return (
    <p className="px-1 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
      {MESSAGES[filter]}
    </p>
  );
}
