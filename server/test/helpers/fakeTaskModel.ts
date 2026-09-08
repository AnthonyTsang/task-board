import { vi } from 'vitest';
import type { TaskModel } from '../../src/models/Task.js';

export interface FakeTaskModel {
  create: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

/**
 * A task model with every method stubbed. No SQL executes anywhere in the suite —
 * the migration and the real queries are covered by Task 16's manual checklist.
 */
export function makeFakeTaskModel(overrides: Partial<FakeTaskModel> = {}): TaskModel {
  const fake: FakeTaskModel = {
    create: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  };
  return fake as unknown as TaskModel;
}

/** A model row shaped like Sequelize returns one (Dates, not ISO strings). */
export function fakeRow(over: Partial<Record<string, unknown>> = {}) {
  const now = new Date('2026-09-07T10:00:00.000Z');
  return {
    id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
    title: 'Buy milk',
    description: null,
    completed: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}
