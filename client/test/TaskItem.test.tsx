import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithClient } from './renderWithClient';
import { TaskItem } from '../src/components/TaskItem';
import * as api from '../src/api/tasksApi';
import type { TaskDto } from '@taskboard/shared';

const TASK: TaskDto = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Buy milk', description: null, completed: false,
  createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z',
};

afterEach(() => { vi.restoreAllMocks(); });

describe('TaskItem', () => {
  it('renders the title', () => {
    renderWithClient(<TaskItem task={TASK} />);
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it('renders a description when present', () => {
    renderWithClient(<TaskItem task={{ ...TASK, description: 'from the corner shop' }} />);
    expect(screen.getByText('from the corner shop')).toBeInTheDocument();
  });

  it('renders no description element when it is null', () => {
    renderWithClient(<TaskItem task={TASK} />);
    expect(screen.queryByTestId('task-description')).not.toBeInTheDocument();
  });

  it('shows an unchecked checkbox for an active task', () => {
    renderWithClient(<TaskItem task={TASK} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('strikes through a completed task', () => {
    renderWithClient(<TaskItem task={{ ...TASK, completed: true }} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByTestId('task-title').className).toContain('line-through');
  });

  it('calls toggleTask when the checkbox is clicked', async () => {
    const spy = vi.spyOn(api, 'toggleTask').mockResolvedValue({ ...TASK, completed: true });
    renderWithClient(<TaskItem task={TASK} />);

    await userEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => { expect(spy).toHaveBeenCalledWith(TASK.id); });
  });

  it('disables the checkbox while its own toggle is pending', async () => {
    vi.spyOn(api, 'toggleTask').mockReturnValue(new Promise(() => {}));  // never settles
    renderWithClient(<TaskItem task={TASK} />);

    await userEvent.click(screen.getByRole('checkbox'));
    // Prevents a rapid double-click queueing two flips of a non-idempotent endpoint.
    await waitFor(() => { expect(screen.getByRole('checkbox')).toBeDisabled(); });
  });

  it('calls deleteTask when the delete button is clicked', async () => {
    const spy = vi.spyOn(api, 'deleteTask').mockResolvedValue(undefined);
    renderWithClient(<TaskItem task={TASK} />);

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => { expect(spy).toHaveBeenCalledWith(TASK.id); });
  });

  it('gives the delete button an accessible name naming the task', () => {
    renderWithClient(<TaskItem task={TASK} />);
    expect(screen.getByRole('button', { name: 'Delete Buy milk' })).toBeInTheDocument();
  });
});
