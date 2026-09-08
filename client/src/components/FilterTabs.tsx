import type { Filter } from './EmptyState';

const TABS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
];

/** Filtering is client-side, so the API stays at exactly four endpoints. */
export function FilterTabs({
  value, onChange, counts,
}: { value: Filter; onChange: (f: Filter) => void; counts: Record<Filter, number> }) {
  return (
    <div role="tablist" aria-label="Filter tasks" className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          onClick={() => { onChange(tab.value); }}
          className={
            value === tab.value
              ? '-mb-px border-b-2 border-neutral-900 px-3 py-2 text-sm font-medium text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
              : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }
        >
          {tab.label}
          <span className="ml-1.5 text-xs opacity-60">{counts[tab.value]}</span>
        </button>
      ))}
    </div>
  );
}
