import { describe, it, expect } from 'vitest';

describe('shared package structure', () => {
  it('the shared package emits no runtime value', async () => {
    // Global constraint: shared must stay types-only. A const, enum, or function
    // here would give the package runtime output and break a fresh install.
    const mod = await import('@taskboard/shared');
    expect(Object.keys(mod)).toHaveLength(0);
  });

  it('the shared package declares no main and builds no dist', async () => {
    // The real constraint, checked structurally rather than through a runtime
    // import: a `main` field or a dist/ directory means the package now needs
    // building before anything can consume it.
    const { readFileSync, existsSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    expect(pkg.main).toBeUndefined();
    expect(pkg.scripts?.build).toBeUndefined();
    expect(existsSync(new URL('../dist', import.meta.url))).toBe(false);
  });
});
