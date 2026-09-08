import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithClient } from './renderWithClient';
import App from '../src/App';
import * as api from '../src/api/tasksApi';
import type { TaskDto } from '@taskboard/shared';

const ACTIVE: TaskDto = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Buy milk', description: null, completed: false,
  createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z',
};
const DONE: TaskDto = { ...ACTIVE, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Ship PR', completed: true };

afterEach(() => { vi.restoreAllMocks(); });

describe('App', () => {
  it('lists tasks from the API', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([ACTIVE, DONE]);
    renderWithClient(<App />);

    expect(await screen.findByText('Buy milk')).toBeInTheDocument();
    expect(screen.getByText('Ship PR')).toBeInTheDocument();
  });

  it('filters to active tasks', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([ACTIVE, DONE]);
    renderWithClient(<App />);
    await screen.findByText('Buy milk');

    await userEvent.click(screen.getByRole('tab', { name: /active/i }));

    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(screen.queryByText('Ship PR')).not.toBeInTheDocument();
  });

  it('filters to done tasks', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([ACTIVE, DONE]);
    renderWithClient(<App />);
    await screen.findByText('Buy milk');

    await userEvent.click(screen.getByRole('tab', { name: /done/i }));

    expect(screen.getByText('Ship PR')).toBeInTheDocument();
    expect(screen.queryByText('Buy milk')).not.toBeInTheDocument();
  });

  it('shows the remaining count', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([ACTIVE, DONE]);
    renderWithClient(<App />);
    expect(await screen.findByText(/1 of 2 remaining/i)).toBeInTheDocument();
  });

  it('shows a filter-specific empty state', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([DONE]);
    renderWithClient(<App />);
    await screen.findByText('Ship PR');

    await userEvent.click(screen.getByRole('tab', { name: /active/i }));
    expect(screen.getByText(/nothing active/i)).toBeInTheDocument();
  });

  it('submits a new task and clears the form', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([]);
    const create = vi.spyOn(api, 'createTask').mockResolvedValue(ACTIVE);
    renderWithClient(<App />);

    const input = await screen.findByLabelText(/task title/i);
    await userEvent.type(input, 'Buy milk');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => { expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: undefined }); });
    await waitFor(() => { expect(input).toHaveValue(''); });
  });

  it('does not submit an empty title', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([]);
    const create = vi.spyOn(api, 'createTask');
    renderWithClient(<App />);

    await screen.findByLabelText(/task title/i);
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(create).not.toHaveBeenCalled();
  });

  it('disables the title and description inputs while a create is pending, preventing a double submit', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([]);
    vi.spyOn(api, 'createTask').mockReturnValue(new Promise(() => {})); // never settles
    renderWithClient(<App />);

    const input = await screen.findByLabelText(/task title/i);
    const description = screen.getByLabelText(/description/i);
    await userEvent.type(input, 'Buy milk');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => { expect(input).toBeDisabled(); });
    expect(description).toBeDisabled();
  });

  it('does not submit a whitespace-only title', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([]);
    const create = vi.spyOn(api, 'createTask');
    renderWithClient(<App />);

    const input = await screen.findByLabelText(/task title/i);
    await userEvent.type(input, '   ');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(create).not.toHaveBeenCalled();
  });

  it('leaves typed text intact when submission fails', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([]);
    vi.spyOn(api, 'createTask').mockRejectedValue(new api.ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    renderWithClient(<App />);

    const input = await screen.findByLabelText(/task title/i);
    await userEvent.type(input, 'Buy milk');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await screen.findByRole('alert');
    expect(input).toHaveValue('Buy milk');
  });

  it('surfaces a query failure in the error banner', async () => {
    vi.spyOn(api, 'listTasks').mockRejectedValue(new api.ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    renderWithClient(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });

  it('does not show contradictory empty-state copy when the query fails', async () => {
    vi.spyOn(api, 'listTasks').mockRejectedValue(new api.ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    renderWithClient(<App />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/no tasks yet/i)).not.toBeInTheDocument();
  });

  it('surfaces a toggle failure in the row and rolls back the optimistic flip', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([ACTIVE]);
    vi.spyOn(api, 'toggleTask').mockRejectedValue(new api.ApiError(500, 'INTERNAL_ERROR', 'Toggle failed'));
    renderWithClient(<App />);
    await screen.findByText('Buy milk');

    const checkbox = screen.getByRole('checkbox', { name: /mark buy milk as done/i });
    await userEvent.click(checkbox);

    // The optimistic flip lands, then rolls back once the rejection resolves.
    expect(await screen.findByRole('alert')).toHaveTextContent('Toggle failed');
    await waitFor(() => { expect(checkbox).not.toBeChecked(); });
  });

  it('surfaces a delete failure in the row and restores the removed task', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([ACTIVE]);
    vi.spyOn(api, 'deleteTask').mockRejectedValue(new api.ApiError(500, 'INTERNAL_ERROR', 'Delete failed'));
    renderWithClient(<App />);
    await screen.findByText('Buy milk');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Buy milk' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed');
    await waitFor(() => { expect(screen.getByText('Buy milk')).toBeInTheDocument(); });
  });

  it('isolates per-row pending state: row A disabled does not disable row B', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([ACTIVE, DONE]);
    vi.spyOn(api, 'toggleTask').mockReturnValue(new Promise(() => {})); // never settles
    renderWithClient(<App />);
    await screen.findByText('Buy milk');

    const rowACheckbox = screen.getByRole('checkbox', { name: /mark buy milk as done/i });
    const rowBCheckbox = screen.getByRole('checkbox', { name: /mark ship pr as active/i });

    await userEvent.click(rowACheckbox);

    await waitFor(() => { expect(rowACheckbox).toBeDisabled(); });
    expect(rowBCheckbox).not.toBeDisabled();

    const rowADelete = screen.getByRole('button', { name: 'Delete Buy milk' });
    const rowBDelete = screen.getByRole('button', { name: 'Delete Ship PR' });
    expect(rowADelete).toBeDisabled();
    expect(rowBDelete).not.toBeDisabled();
  });
});
