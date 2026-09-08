import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

describe('App scaffold', () => {
  it('renders the board heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /task board/i })).toBeInTheDocument();
  });
});
