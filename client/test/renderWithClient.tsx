import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * `retry: false` is essential: without it, tests of failure paths hang while
 * TanStack retries in the background.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: 0 },
    },
  });
}

export function renderWithClient(ui: ReactElement): { queryClient: QueryClient } & RenderResult {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  // Assigned to a local first, not spread inline: under TypeScript 7.0.2,
  // spreading `render(...)` directly inside an object literal that's
  // contextually typed against this intersection return type breaks the
  // `Queries` generic's default-parameter inference, silently dropping the
  // query-method properties from the inferred type. Binding the call result
  // first sidesteps that contextual-typing pass; runtime behavior is identical.
  const result = render(ui, { wrapper });
  return { queryClient, ...result };
}
