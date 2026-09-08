import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithClient } from './renderWithClient';
import App from '../src/App';
import * as api from '../src/api/tasksApi';

describe('App scaffold', () => {
  it('renders the board heading', () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([]);
    renderWithClient(<App />);
    expect(screen.getByRole('heading', { name: /task board/i })).toBeInTheDocument();
  });
});
