import { describe, it, expect } from 'vitest';
import { Sequelize, literal } from 'sequelize';
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

  it('leaves id generation to the database, via an inline SQL default', () => {
    // Global constraint: the migration owns gen_random_uuid() as the column default.
    // A bare `primaryKey: true` with no defaultValue is NOT the same as "no default
    // on the model" — Sequelize still seeds the attribute to `null` on build() and
    // binds that explicit NULL into the INSERT. In Postgres an explicit NULL
    // *suppresses* the column default, so `id uuid NOT NULL DEFAULT gen_random_uuid()`
    // raises `23502 null value in column "id" violates not-null constraint` on every
    // insert. Declaring `defaultValue: literal('gen_random_uuid()')` makes Sequelize
    // render the function call inline in the SQL instead of binding a value, so the
    // database still owns id generation (one owner) while the column is never left
    // NULL. Do not switch to DataTypes.UUIDV4 — that moves generation into the app,
    // giving id generation two owners.
    expect(attrs.id.primaryKey).toBe(true);
    expect(attrs.id.defaultValue).toEqual(literal('gen_random_uuid()'));
  });

  it('generates an INSERT that calls gen_random_uuid() inline and binds no null id', () => {
    // Regression test for the finding above, pinned at the actual SQL Sequelize
    // would send. Renders the query with the QueryGenerator directly from a
    // built (not saved) instance — no connection is opened, so this stays
    // deterministic and fast.
    //
    // Task.build() skips timestamps (only Task.create()/save() set those), so
    // this isn't byte-identical to the real INSERT the create endpoint sends.
    // It was cross-checked against the real path once, by hand, outside this
    // suite: monkeypatching the postgres dialect's Query#run and the abstract
    // ConnectionManager#getConnection to capture the SQL immediately before it
    // would hit a real socket, then calling Task.create({ title: 'Buy milk' }).
    // That produced
    //   INSERT INTO "tasks" ("id","title","completed","created_at","updated_at")
    //   VALUES (gen_random_uuid(),$1,$2,$3,$4) RETURNING ...
    // with bind ['Buy milk', false, <createdAt>, <updatedAt>] — gen_random_uuid()
    // inline, no null anywhere in the bind array, confirming this build()-based
    // proxy exercises the same id-generation code path the real create() does.
    // That harness isn't committed here: it requires importing sequelize's
    // internal dialect modules, which ship no .d.ts (only `./lib/*` types are
    // published, and postgres/query.js isn't among them), so keeping it in the
    // suite would mean typing it as `unknown`/`any` or reaching past the
    // public API in a way that's one dependency bump from silently breaking.
    // The synchronous queryGenerator.insertQuery() call below stays within
    // Sequelize's public QueryInterface surface.
    //
    // Sequelize's own types declare `queryGenerator` as `unknown` (it is an
    // internal, dialect-specific object), so this local interface describes
    // only the one method this test calls.
    interface QueryGeneratorLike {
      insertQuery(
        table: string,
        values: Record<string, unknown>,
        attributes: ReturnType<typeof Task.getAttributes>,
      ): { query: string; bind: unknown[] };
    }

    const instance = Task.build({ title: 'Buy milk' });
    const queryGenerator = throwawaySequelize().getQueryInterface().queryGenerator as QueryGeneratorLike;
    const { query, bind } = queryGenerator.insertQuery('tasks', instance.dataValues, attrs);

    expect(query).toContain('gen_random_uuid()');
    expect(bind).not.toContain(null);
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
