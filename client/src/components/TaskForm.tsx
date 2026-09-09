import { useState, type FormEvent } from 'react';
import { useCreateTask } from '../hooks/useCreateTask';
import { ErrorBanner } from './ErrorBanner';

/** Creates a task. Title and description are write-once — nothing edits them later. */
export function TaskForm() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateTask();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === '') return;

    create.mutate(
      { title: title.trim(), description: description.trim() || undefined },
      {
        onSuccess: () => {
          setTitle('');
          setDescription('');
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-2">
      {create.isError && <ErrorBanner message={create.error.message} onDismiss={() => { create.reset(); }} />}

      <div className="flex gap-2">
        <input
          aria-label="Task title"
          value={title}
          onChange={(e) => { setTitle(e.target.value); }}
          placeholder="What needs doing?"
          maxLength={200}
          disabled={create.isPending}
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-100"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>

      <textarea
        aria-label="Description (optional)"
        value={description}
        onChange={(e) => { setDescription(e.target.value); }}
        placeholder="Description (optional)"
        rows={2}
        maxLength={2000}
        disabled={create.isPending}
        className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-100"
      />
    </form>
  );
}
