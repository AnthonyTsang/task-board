import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from './renderWithClient';
import { useTasksQuery } from '../src/hooks/useTasksQuery';
import { useCreateTask } from '../src/hooks/useCreateTask';
import * as api from '../src/api/tasksApi';

const TASK = {
  id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
  title: 'Buy milk', description: null, completed: false,
  createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z',
};

function wrapperWith(queryClient = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('useTasksQuery', () => {
  it('fetches the task list', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([TASK]);
    const { wrapper } = wrapperWith();

    const { result } = renderHook(() => useTasksQuery(), { wrapper });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toEqual([TASK]);
  });

  it('surfaces an ApiError', async () => {
    vi.spyOn(api, 'listTasks').mockRejectedValue(new api.ApiError(500, 'INTERNAL_ERROR', 'boom'));
    const { wrapper } = wrapperWith();

    const { result } = renderHook(() => useTasksQuery(), { wrapper });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.error?.message).toBe('boom');
  });
});

describe('useCreateTask', () => {
  it('creates a task and invalidates the list', async () => {
    vi.spyOn(api, 'createTask').mockResolvedValue(TASK);
    const { wrapper, queryClient } = wrapperWith();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateTask(), { wrapper });
    result.current.mutate({ title: 'Buy milk' });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(api.createTask).toHaveBeenCalledWith({ title: 'Buy milk' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('exposes the error without inserting anything into the cache', async () => {
    vi.spyOn(api, 'createTask').mockRejectedValue(new api.ApiError(400, 'VALIDATION_ERROR', 'title required'));
    const { wrapper, queryClient } = wrapperWith();
    queryClient.setQueryData(['tasks'], []);

    const { result } = renderHook(() => useCreateTask(), { wrapper });
    result.current.mutate({ title: '' });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.error?.message).toBe('title required');
    expect(queryClient.getQueryData(['tasks'])).toEqual([]);
  });
});
