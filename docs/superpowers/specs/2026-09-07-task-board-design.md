# Task Board — Design Spec

**Date:** 2026-09-07
**Status:** Approved, ready for implementation planning

## Purpose

A single-user task board. Four operations, each exposed as its own RESTful endpoint backed by its own
isolated handler module: create a task, list tasks, toggle a task's completed status, delete a task.
The client is a single-page React app showing one list with All / Active / Done filter tabs.

Tasks are **write-once**: title and description are set at creation and never edited afterward. The
only mutations after creation are toggle and delete. This is deliberate — it keeps the API to exactly
the four operations specified. Correcting a typo means deleting the task and re-adding it.

## Scope

**In scope:** the four endpoints, the Postgres schema and its migration, the React client, unit tests
for every route module, and a manual verification checklist covering what the mocked tests cannot reach.

**Out of scope:** authentication, multi-user support, pagination, task editing, drag-and-drop
reordering, due dates, tags, deployment, and CI configuration.

## Stack

Versions verified against the npm registry on 2026-09-07.

| Concern | Choice | Version | Note |
|---|---|---|---|
| Runtime | Node.js | 24.12 | npm 11.19 workspaces |
| Language | TypeScript | 7.0.x | strict mode across all workspaces; see note below |
| Server | Express | 5.2.x | forwards async rejections to the error handler natively |
| ORM | Sequelize | 6.37.x | v7 is still alpha; v6 is the stable line |
| DB driver | `pg` | 8.x | |
| Migrations | Umzug | 3.x | Sequelize storage backend |
| Validation | zod | 4.x | request bodies and route params |
| Database | Supabase (PostgreSQL) | — | provisioned manually by the user |
| Client build | Vite | 8.x | |
| UI | React | 19.2.x | |
| Server state | TanStack Query | 5.102.x | `@tanstack/react-query` |
| Styling | Tailwind CSS | 4.3.x | CSS-first — no `tailwind.config.js` |
| Testing | Vitest 5.x + Supertest 7.x + React Testing Library | — | |
| Dev runner | tsx | 4.23.x | `tsx watch` for the server |
| Task runner | concurrently | 10.x | runs server and client together |

TypeScript's current stable release is 7.0.2 — the native compiler, not the 5.x line. This project uses
it: nothing here depends on decorators, namespaces, or other features the native port treats differently,
and Vite 8 and Node 24 are contemporaries of it. If a toolchain incompatibility surfaces during
implementation, falling back to the 5.9 line is a `package.json` change with no source impact, since no
code in this design uses version-specific syntax.

Sequelize 7 is deliberately avoided: as of this date it has only alpha releases. `sequelize-typescript`
is not used either — Sequelize 6's `InferAttributes` / `InferCreationAttributes` generics provide typed
models without decorators or an extra dependency.

Tailwind 4 is configured CSS-first via the `@tailwindcss/vite` plugin and `@import "tailwindcss";`.
There is **no** `tailwind.config.js` and **no** `postcss.config.js` — those are Tailwind 3 artifacts.
Any design tokens go in an `@theme` block in `index.css`.

## Repository layout

npm workspaces. A `shared` package holds the API contract types so the client and server cannot drift —
a field renamed on one side fails to compile on the other.

```
bmo-task-board/
  package.json                 workspaces: shared, server, client
  .gitignore
  .env.example
  docs/superpowers/specs/

  shared/
    package.json
    src/index.ts               TaskDto, CreateTaskInput, ApiErrorBody, ApiErrorCode

  server/
    package.json
    src/
      config/env.ts            load + validate env vars, fail fast
      db/sequelize.ts          Sequelize instance (postgres + SSL)
      db/umzug.ts              migrator wiring
      migrations/001-create-tasks.ts
      models/Task.ts           Sequelize model + inferred attribute types
      lib/HttpError.ts         typed error carrying status + code
      lib/validate.ts          zod schemas: createTaskBody, taskIdParam
      routes/createTask.ts     POST   /api/tasks
      routes/listTasks.ts      GET    /api/tasks
      routes/toggleTask.ts     PATCH  /api/tasks/:id/toggle
      routes/deleteTask.ts     DELETE /api/tasks/:id
      routes/index.ts          mounts the four routers under /api/tasks
      middleware/errorHandler.ts
      app.ts                   builds the Express app — does not listen
      server.ts                loads env, calls listen()
    test/
      createTask.test.ts  listTasks.test.ts  toggleTask.test.ts  deleteTask.test.ts

  client/
    package.json
    vite.config.ts             @tailwindcss/vite plugin + /api proxy
    src/
      api/tasksApi.ts          4 transport functions
      api/queryKeys.ts         taskKeys
      hooks/useTasksQuery.ts   useCreateTask.ts  useToggleTask.ts  useDeleteTask.ts
      components/              TaskForm TaskList TaskItem FilterTabs EmptyState ErrorBanner
      App.tsx  main.tsx  index.css
    test/
      renderWithClient.tsx     RTL helper wrapping QueryClientProvider
      useToggleTask.test.tsx  TaskItem.test.tsx
```

`app.ts` builds and returns the Express app but never calls `listen()`; `server.ts` does. This split is
what lets Supertest drive the real application in tests without binding a port.

### Module boundaries

Each of the four route modules exports an Express `Router` carrying exactly one route. They share only
the `Task` model and the error types — no route module imports another. Any one can be read, modified,
or tested in isolation. The client mirrors this: one hook per operation, and `tasksApi.ts` holds all
HTTP knowledge so no component ever inspects `response.ok`.

## Configuration

The application accepts these environment variables and creates no database resources of its own:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DB_HOST` | yes | — | Supabase host |
| `DB_PORT` | yes | — | Supabase port |
| `DB_NAME` | yes | — | database name |
| `DB_USER` | yes | — | database user |
| `DB_PASSWORD` | yes | — | database password |
| `PORT` | no | `3000` | port the API server listens on |
| `DB_SSL_CA` | no | unset | path to a CA certificate; enables full TLS verification |

`config/env.ts` validates all of these at startup with zod. A missing or malformed variable exits the
process immediately with a message naming the offending variable, rather than surfacing later as a
connection failure mid-request.

### TLS to Supabase — a deliberate weakening

Supabase requires SSL, and its connection pooler presents a certificate that is not in Node's default
trust store. The default configuration is therefore:

```ts
dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
```

This **encrypts the connection but does not verify the server's identity**, leaving it theoretically
open to a man-in-the-middle. It is the widely used Supabase configuration and is the default here so
the app works without extra setup. Setting `DB_SSL_CA` to the path of Supabase's downloadable CA
certificate switches `rejectUnauthorized` to `true` and enables full verification. This tradeoff is
recorded here rather than left implicit in a config file.

## Data model

Table `tasks`. The model sets `underscored: true`, so database columns are snake_case (natural in the
Supabase table editor) while the TypeScript model and the JSON API use camelCase.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `title` | `text` | not null |
| `description` | `text` | nullable |
| `completed` | `boolean` | not null, default `false` |
| `created_at` | `timestamptz` | not null, indexed |
| `updated_at` | `timestamptz` | not null |

`created_at` is indexed because the list endpoint always orders by it.

Model definition uses Sequelize 6's inference generics:

```ts
class Task extends Model<InferAttributes<Task>, InferCreationAttributes<Task>> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare description: string | null;
  declare completed: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
```

### Migrations

Umzug 3 with a Sequelize storage backend records applied migrations in a `SequelizeMeta` table inside
the Supabase database. `001-create-tasks.ts` creates the table, its default, and the `created_at` index,
and its `down` drops the table.

- `npm run migrate` applies pending migrations
- `npm run migrate:down` rolls back one

**The application server never issues DDL.** `sequelize.sync()` is not called anywhere. If the table is
missing, the first query fails loudly rather than the app silently mutating a hosted schema.

## API

Base path `/api/tasks`. All responses are JSON except `204`, which has an empty body.

### Task representation

```json
{
  "id": "9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a",
  "title": "Buy milk",
  "description": null,
  "completed": false,
  "createdAt": "2026-09-07T10:00:00.000Z",
  "updatedAt": "2026-09-07T10:00:00.000Z"
}
```

### Endpoints

| Method | Path | Request | Success | Failures |
|---|---|---|---|---|
| `POST` | `/api/tasks` | `{ title, description? }` | `201` + Task | `400` invalid body |
| `GET` | `/api/tasks` | — | `200` + `Task[]` | — |
| `PATCH` | `/api/tasks/:id/toggle` | no body | `200` + updated Task | `400` malformed id · `404` not found |
| `DELETE` | `/api/tasks/:id` | — | `204` empty | `400` malformed id · `404` not found |

`GET /api/tasks` returns every task ordered by `created_at` descending. There is no pagination and no
filter query parameter — filtering is done client-side.

### Validation rules

Defined once in `lib/validate.ts` as zod schemas, applied per route module:

- `title` — required, trimmed, 1 to 200 characters after trimming
- `description` — optional, at most 2000 characters; absent or `null` both store `NULL`
- `:id` — must parse as a UUID

Validating `:id` matters beyond tidiness: without it, a request to `/api/tasks/abc` reaches Postgres as
an invalid uuid cast and surfaces as a `500` instead of the correct `400`.

### Toggle semantics

The toggle endpoint takes no request body and flips `completed` to its opposite. It executes as a single
atomic statement rather than a read-then-write:

```sql
UPDATE tasks SET completed = NOT completed WHERE id = $1 RETURNING *
```

Via Sequelize: `Task.update({ completed: literal('NOT completed') }, { where: { id }, returning: true })`.
Zero affected rows means the task does not exist, which becomes a `404`.

This avoids the lost-update race in which two concurrent toggles both read `false` and both write `true`.

**Known tradeoff — the toggle is not idempotent.** Replaying the request flips the value again, so a
retry after an ambiguous failure can land on the wrong state. Given a single user and no auth this is
acceptable. It is mitigated on the client, and the client-side constraint that follows from it is
recorded under "Client" below.

### Error contract

Every error response uses one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title must be 1-200 characters",
    "details": [{ "path": "title", "message": "String must contain at least 1 character" }]
  }
}
```

`details` is present only on validation errors.

| Code | Status | Cause |
|---|---|---|
| `VALIDATION_ERROR` | 400 | failed zod validation, or a malformed JSON request body |
| `NOT_FOUND` | 404 | no task with that id, or no matching route |
| `INTERNAL_ERROR` | 500 | anything unexpected |

Route modules throw `HttpError`; `middleware/errorHandler.ts` is the only place that formats a response.
Three cases are handled explicitly because each otherwise leaks internals to the client:

1. **Malformed JSON** in a request body returns a `400` in the envelope above, not Express's default
   HTML error page.
2. **Unexpected errors** — including a dropped Supabase connection — log the full stack server-side and
   return a generic `INTERNAL_ERROR` message with no internal detail.
3. **Unmatched routes** return a JSON `404` in the same envelope.

Express 5 forwards rejected promises to the error handler automatically, so there is no `asyncHandler`
wrapper: route handlers are plain `async` functions that throw.

## Client

### Data flow

TanStack Query owns all server state. There is no `useState` mirror of the task list.

```
TaskForm    -> useCreateTask  -> POST   /api/tasks           -> invalidate ['tasks']
TaskList    <- useTasksQuery  <- GET    /api/tasks
TaskItem    -> useToggleTask  -> PATCH  /api/tasks/:id/toggle -> optimistic + invalidate
TaskItem    -> useDeleteTask  -> DELETE /api/tasks/:id        -> optimistic + invalidate
```

`tasksApi.ts` is pure transport — it contains no React and no cache logic, and it unwraps the error
envelope into a typed `ApiError` so components never touch `response.ok`. Each hook wraps exactly one
transport function, mirroring the four route modules.

Query key: `taskKeys.all = ['tasks']`, defined in `api/queryKeys.ts`.

### Per-row mutation state

`TaskItem` calls `useToggleTask()` and `useDeleteTask()` itself, so each row gets its own mutation
instance and its own `isPending`. No shared pending-id set is needed. Mutation hook instances are cheap;
this is the idiomatic way to obtain per-item pending state.

### Optimistic updates

- **Toggle and delete are optimistic.** `onMutate` cancels in-flight queries, snapshots the cache,
  applies the change; `onError` restores the snapshot; `onSettled` invalidates `['tasks']`. Without
  this the checkbox waits two round trips (the mutation, then the refetch).
- **Create is invalidate-only.** The server generates `id`, `createdAt`, and `updatedAt`, so an
  optimistic insert would need a placeholder row and subsequent reconciliation. A brief spinner on form
  submit reads as normal behavior.

### Query client configuration — a constraint, not a preference

```ts
new QueryClient({
  defaultOptions: {
    queries:   { retry: 3 },  // TanStack default; GET is idempotent
    mutations: { retry: 0 },  // TanStack default — MUST NOT be raised
  },
})
```

Mutation retry must remain `0`. Because the toggle endpoint is not idempotent, an automatic retry would
flip `completed` twice and leave the task in the wrong state. This is recorded explicitly so the setting
is not later "improved" into a bug.

While a row's toggle mutation is pending, its checkbox is disabled — this prevents a rapid double-click
from queueing two flips.

### Filtering

Filter state (`'all' | 'active' | 'done'`) is local React state in `App`, with the displayed list derived
from the cached query data. No query parameter is sent, and the API stays at exactly four endpoints.

### Layout

A single vertical list, not a multi-column board:

```
[ new task title...                    ] [ Add ]
[ description (optional)               ]

  All | Active | Done

  [ ] Buy milk                        x
  [ ] Write spec                      x
  [x] Ship PR          (struck through) x
  [x] Fix bug          (struck through) x

  2 of 4 remaining
```

Completed tasks are struck through in place. `EmptyState` renders when the list is empty, with copy that
distinguishes "no tasks yet" from "no tasks match this filter". `ErrorBanner` surfaces query and mutation
errors using the `message` from the error envelope.

## Development workflow

Vite's dev server proxies `/api` to `http://localhost:3000`. The browser therefore sees a single origin,
and **the server carries no CORS middleware at all**.

| Command | Effect |
|---|---|
| `npm install` | installs all three workspaces from the root |
| `npm run migrate` | applies pending migrations to Supabase |
| `npm run dev` | runs server and client concurrently |
| `npm test` | runs server and client test suites |
| `npm run build` | compiles `shared` and `server` with `tsc`, builds `client` with Vite |

The server runs under `tsx watch` in development. `.env.example` lists all seven variables; `.env` is
gitignored. `@tanstack/react-query-devtools` is a dev-only dependency.

## Testing

### Automated

Server tests use Vitest and Supertest against the real Express app from `app.ts`, with `models/Task`
mocked via `vi.mock`. One test file per route module, matching the module isolation. Coverage:

- `createTask` — 201 with a valid body; 400 for empty, whitespace-only, and over-length titles; 400 for
  an over-length description; description omitted and description `null` both accepted
- `listTasks` — 200 with an array; empty array when there are no tasks; ordering by `createdAt` desc
- `toggleTask` — 200 with the updated task; 404 when zero rows are affected; 400 for a non-UUID id
- `deleteTask` — 204 with an empty body; 404 when zero rows are affected; 400 for a non-UUID id
- error handling — malformed JSON returns a 400 envelope; an unmatched route returns a 404 envelope; a
  thrown non-`HttpError` returns a generic 500 that does not leak the stack

Client tests use Vitest and React Testing Library with `fetch` stubbed, via a `renderWithClient` helper
that wraps components in a `QueryClientProvider` configured with `retry: false` — without that, tests of
failure paths hang while TanStack retries. Coverage is deliberately light: the toggle hook's optimistic
update and its rollback on error, and `TaskItem` rendering plus its disabled state while pending.

### What the automated tests do not cover

Per the decision to run no database in tests, **no SQL is ever executed by the suite**. The migration,
the Sequelize attribute mapping, and specifically the `SET completed = NOT completed ... RETURNING *`
statement are never exercised — a mocked model will confirm a toggle that would fail against real
Postgres. The `underscored` camelCase-to-snake_case mapping is likewise unverified.

### Manual verification checklist

Run once against the real Supabase database after implementation, and after any change to the model,
the migration, or the toggle query:

1. `npm run migrate` completes; the `tasks` and `SequelizeMeta` tables appear in the Supabase table editor
2. Column names in Supabase are snake_case (`created_at`, not `createdAt`)
3. Create a task with a title only — it appears in the list, `completed` is `false`, `description` is `NULL`
4. Create a task with a title and description — both persist
5. Toggle it — the checkbox flips immediately (optimistic), and the row still reads as completed after a
   browser refresh
6. Toggle it back — it returns to active and survives a refresh
7. Delete it — the row disappears and stays gone after a refresh
8. Stop the API server, then click a toggle — the checkbox flips, then rolls back, and `ErrorBanner` appears
9. `npm run migrate:down` drops the table cleanly

Closing this gap later requires no application changes: a Postgres testcontainer can be pointed at the
same migration and model.

## Decisions and their reasons

| Decision | Reason |
|---|---|
| Sequelize 6, not 7 | v7 has only alpha releases as of 2026-09-07 |
| No `sequelize-typescript` | v6 inference generics give typed models without an extra dependency |
| Umzug migrations, not `sync()` | the app should not hold DDL authority over a hosted database |
| No test database | chosen tradeoff: fast, offline, credential-free tests; the gap is covered manually |
| Separate route module per action | the requested API separation, and each unit stays independently testable |
| Dedicated `/toggle` endpoint | toggle is its own operation, not a general update |
| Tasks are write-once | keeps the API to exactly the four specified operations |
| Client-side filtering | avoids a fifth endpoint shape and a query parameter |
| Vite proxy, not CORS | one origin in development means no CORS middleware to misconfigure |
| Atomic `NOT completed` update | prevents the lost-update race between concurrent toggles |
| Mutation retry pinned to 0 | the toggle is not idempotent; a retry would double-flip |
| `shared` workspace for DTOs | the API contract becomes compiler-enforced on both sides |
