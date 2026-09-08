import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'server', root: './server', environment: 'node' } },
      { test: { name: 'client', root: './client', environment: 'jsdom' } },
      { test: { name: 'shared', root: './shared', environment: 'node' } },
    ],
  },
});
