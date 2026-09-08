import { describe, it, expect } from 'vitest';
import { Sequelize } from 'sequelize';
import { initTaskModel, toDto } from '../src/models/Task.js';

/** A Sequelize instance is constructed lazily — this opens no socket. */
function throwawaySequelize(): Sequelize {
  return new Sequelize({
    dialect: 'postgres',
    host: 'nowhere.invalid',
    database: 'x', username: 'u', password: 'p',
    logging: false,
  });
}

describe('Task model', () => {
  const Task = initTaskModel(throwawaySequelize());
  const attrs = Task.getAttributes();

  it('maps to the tasks table', () => {
    expect(Task.getTableName()).toBe('tasks');
  });

  it('maps camelCase attributes to snake_case columns', () => {
    expect(attrs.createdAt.field).toBe('created_at');
    expect(attrs.updatedAt.field).toBe('updated_at');
  });

  it('requires a title and allows a null description', () => {
    expect(attrs.title.allowNull).toBe(false);
    expect(attrs.description.allowNull).toBe(true);
  });

  it('defaults completed to false and makes it non-null', () => {
    expect(attrs.completed.allowNull).toBe(false);
    expect(attrs.completed.defaultValue).toBe(false);
  });

  it('leaves id generation to the database', () => {
    // Global constraint: the migration owns gen_random_uuid(). Setting a model-side
    // defaultValue too gives two owners of id generation.
    expect(attrs.id.primaryKey).toBe(true);
    expect(attrs.id.defaultValue).toBeUndefined();
  });

  it('toDto converts Date fields to ISO strings', () => {
    const created = new Date('2026-09-07T10:00:00.000Z');
    const row = {
      id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
      title: 'Buy milk',
      description: null,
      completed: false,
      createdAt: created,
      updatedAt: created,
    } as never;

    expect(toDto(row)).toEqual({
      id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
      title: 'Buy milk',
      description: null,
      completed: false,
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
    });
  });
});
