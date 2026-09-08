import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createTestQueryClient } from './renderWithClient';
import { useToggleTask } from '../src/hooks/useToggleTask';
import { useDeleteTask } from '../src/hooks/useDeleteTask';
import * as api from '../src/api/tasksApi';
import type { TaskDto } from '@taskboard/shared';

const A: TaskDto = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Task A', description: null, completed: false,
  createdAt: '2026-09-07T10:00:02.000Z', updatedAt: '2026-09-07T10:00:02.000Z',
};
const B: TaskDto = {
  ...A, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Task B',
  createdAt: '2026-09-07T10:00:01.000Z', updatedAt: '2026-09-07T10:00:01.000Z',
};
// C has an id sorting after B lexically only by coincidence of the alphabet used
// here; what matters is createdAt, which is strictly older than both A and B —
// the server's newest-first (createdAt DESC) ordering is [A, B, C].
const C: TaskDto = {
  ...A, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Task C',
  createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z',
};

function seeded(tasks: TaskDto[]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(['tasks'], tasks);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const read = (qc: QueryClient) => qc.getQueryData<TaskDto[]>(['tasks']) ?? [];
const byId = (qc: QueryClient, id: string) => read(qc).find((t) => t.id === id);

afterEach(() => { vi.restoreAllMocks(); });

describe('useToggleTask', () => {
  it('applies the flip optimistically, before the request resolves', async () => {
    let release!: (v: TaskDto) => void;
    vi.spyOn(api, 'toggleTask').mockReturnValue(new Promise((res) => { release = res; }));
    const { queryClient, wrapper } = seeded([A]);

    const { result } = renderHook(() => useToggleTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    // The cache reflects the flip while the request is still in flight.
    await waitFor(() => { expect(byId(queryClient, A.id)?.completed).toBe(true); });

    act(() => { release({ ...A, completed: true }); });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
  });

  it('rolls back on error', async () => {
    vi.spyOn(api, 'toggleTask').mockRejectedValue(new api.ApiError(404, 'NOT_FOUND', 'gone'));
    const { queryClient, wrapper } = seeded([A]);

    const { result } = renderHook(() => useToggleTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(byId(queryClient, A.id)?.completed).toBe(false);
  });

  it('rolling back a failed row does not erase a concurrent row still in flight', async () => {
    // REGRESSION TEST. A whole-list snapshot restore would revert B along with A,
    // because B's optimistic change landed after A's snapshot was taken.
    //
    // Note on calling mutate() twice on one hook instance: each call builds its own
    // Mutation carrying its own onMutate/onError context, which is exactly the
    // behaviour under test. `result.current` only ever tracks the LATEST mutation,
    // so it will not reflect A's failure — that is expected, not a bug. Assertions
    // therefore read the cache, never result.current. Do not "fix" this by
    // rendering two hook instances; that would stop testing shared-cache contention.
    let failA!: (e: unknown) => void;
    let passB!: (v: TaskDto) => void;

    vi.spyOn(api, 'toggleTask').mockImplementation((id: string) =>
      id === A.id
        ? new Promise((_res, rej) => { failA = rej; })
        : new Promise((res) => { passB = res; }),
    );

    const { queryClient, wrapper } = seeded([A, B]);
    const { result } = renderHook(() => useToggleTask(), { wrapper });

    act(() => { result.current.mutate(A.id); });
    await waitFor(() => { expect(byId(queryClient, A.id)?.completed).toBe(true); });

    act(() => { result.current.mutate(B.id); });
    await waitFor(() => { expect(byId(queryClient, B.id)?.completed).toBe(true); });

    act(() => { failA(new api.ApiError(500, 'INTERNAL_ERROR', 'boom')); });

    await waitFor(() => { expect(byId(queryClient, A.id)?.completed).toBe(false); });
    // B must still hold its optimistic value — it is in flight and will succeed.
    expect(byId(queryClient, B.id)?.completed).toBe(true);

    act(() => { passB({ ...B, completed: true }); });
  });

  it('leaves other rows untouched when one row toggles successfully', async () => {
    vi.spyOn(api, 'toggleTask').mockResolvedValue({ ...A, completed: true });
    const { queryClient, wrapper } = seeded([A, B]);

    const { result } = renderHook(() => useToggleTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(byId(queryClient, B.id)?.completed).toBe(false);
  });
});

describe('useDeleteTask', () => {
  it('removes the row optimistically', async () => {
    let release!: () => void;
    vi.spyOn(api, 'deleteTask').mockReturnValue(new Promise<void>((res) => { release = () => res(); }));
    const { queryClient, wrapper } = seeded([A, B]);

    const { result } = renderHook(() => useDeleteTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    await waitFor(() => { expect(read(queryClient)).toHaveLength(1); });
    expect(byId(queryClient, B.id)).toBeDefined();

    act(() => { release(); });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
  });

  it('reinserts only the removed row on error, at its original position', async () => {
    vi.spyOn(api, 'deleteTask').mockRejectedValue(new api.ApiError(404, 'NOT_FOUND', 'gone'));
    const { queryClient, wrapper } = seeded([A, B]);

    const { result } = renderHook(() => useDeleteTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(read(queryClient).map((t) => t.id)).toEqual([A.id, B.id]);
  });

  it('preserves row order when two concurrent deletes both fail', async () => {
    // REGRESSION TEST. An index captured at onMutate time goes stale the
    // instant another in-flight delete removes a row ahead of it: the second
    // delete's `index` is relative to an already-shrunk list, not the list's
    // true original order. Restoring by that stale index on rollback produces
    // the wrong final order even though no row is lost.
    //
    // Same shared-cache-contention shape as the toggle concurrent-rows test:
    // two mutate() calls on one hook instance, each with its own onMutate/
    // onError context. Assertions read the cache, never result.current.
    let failA!: (e: unknown) => void;
    let failC!: (e: unknown) => void;

    vi.spyOn(api, 'deleteTask').mockImplementation((id: string) =>
      id === A.id
        ? new Promise<void>((_res, rej) => { failA = rej; })
        : new Promise<void>((_res, rej) => { failC = rej; }),
    );

    const { queryClient, wrapper } = seeded([A, B, C]);
    const { result } = renderHook(() => useDeleteTask(), { wrapper });

    act(() => { result.current.mutate(A.id); });
    await waitFor(() => { expect(read(queryClient).map((t) => t.id)).toEqual([B.id, C.id]); });

    act(() => { result.current.mutate(C.id); });
    await waitFor(() => { expect(read(queryClient).map((t) => t.id)).toEqual([B.id]); });

    act(() => { failA(new api.ApiError(500, 'INTERNAL_ERROR', 'boom')); });
    await waitFor(() => { expect(read(queryClient).map((t) => t.id)).toContain(A.id); });

    act(() => { failC(new api.ApiError(500, 'INTERNAL_ERROR', 'boom')); });

    // Both rollbacks landed — the list must be back in its original order,
    // not whatever order the stale indices happened to produce.
    await waitFor(() => {
      expect(read(queryClient).map((t) => t.id)).toEqual([A.id, B.id, C.id]);
    });
  });
});
