# Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user task board with four RESTful endpoints — create, list, toggle, delete — each backed by its own isolated route module, plus a React client showing one filterable list.

**Architecture:** An npm workspaces monorepo with three packages. `shared` holds types only and emits no JavaScript. `server` is Express 5 over Sequelize 6 against Supabase Postgres, where each of the four operations is a separate router module composed in `routes/index.ts`. `client` is Vite + React 19 with TanStack Query owning all server state. Every module that would otherwise need environment variables at import time is a factory function instead, so the whole suite runs without credentials.

**Tech Stack:** Node 24 · TypeScript 7.0.2 · Express 5 · Sequelize 6 · Umzug 3 · zod 4 · Vite 8 · React 19 · TanStack Query 5 · Tailwind 4 · Vitest 5 · Supertest 7

**Spec:** `docs/superpowers/specs/2026-09-07-task-board-design.md`

## Global Constraints

Every task's requirements implicitly include this section. These are the decisions a well-meaning implementer is most likely to "improve" into a bug.

- **TypeScript is pinned to exactly `7.0.2`** and **Vitest to exactly `5.0.0`** — no caret, no tilde. Both are freshly released majors.
- **All three workspaces set `"type": "module"`.** Vite 8 requires ESM on the client; stating it everywhere stops the `shared` import resolving differently per side.
- **`shared` must never gain a runtime value.** No `const` objects, no enums, no functions — types and interfaces only. It has `"types"` but no `"main"` and no build script. Every import from it is `import type`. Adding a runtime value silently breaks a fresh `npm install && npm run dev`.
- **Every `mutationFn` is arrow-wrapped, never passed by reference.** TanStack Query 5 calls it as
  `mutationFn(variables, { client })` — two arguments. Passing `createTask`/`toggleTask`/`deleteTask`
  directly makes spies record both, so `toHaveBeenCalledWith(oneArg)` fails. Verified against 5.102.8.
- **Mutation `retry` stays `0`.** The toggle endpoint is not idempotent; an automatic retry flips `completed` twice and lands on the wrong state.
- **`sequelize.sync()` appears nowhere.** Schema is owned by Umzug migrations. The app never issues DDL.
- **No `tailwind.config.js` and no `postcss.config.js`.** Tailwind 4 is CSS-first: the `@tailwindcss/vite` plugin plus `@import "tailwindcss";`. Those files are Tailwind 3 artifacts and their presence breaks the v4 pipeline.
- **No module-level side effects in `server/src`.** `loadEnv()`, `createSequelize(env)`, and `initTaskModel(sequelize)` are called by entrypoints, never at import time. This is what keeps the model testable without a database.
- **Tasks 1–15 require no database credentials.** Only Task 16 needs a real Supabase instance.

### Deviation from the spec, recorded deliberately

The spec's testing section says route tests mock the model "via `vi.mock`". This plan injects the model as a constructor argument instead (`createTaskRouter(taskModel)`), because the factory structure above leaves no module singleton to mock. The spec's actual requirement — no SQL executes in tests — is satisfied either way, and injection additionally lets Task 3 assert the real model's attribute mapping. Nothing else about the testing strategy changes.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | workspaces, root scripts, `vitest.config.ts` fan-out |
| `vitest.config.ts` | two projects: `server` (node env), `client` (jsdom env) |
| `tsconfig.base.json` | strict compiler options shared by all workspaces |
| `.env.example` | the seven environment variables |
| `shared/src/index.ts` | `TaskDto`, `CreateTaskInput`, `ApiErrorCode`, `ApiErrorDetail`, `ApiErrorBody` |
| `server/src/config/env.ts` | `loadEnv()` — validate env, no side effects |
| `server/src/lib/HttpError.ts` | `HttpError` + `notFound` / `validationError` helpers |
| `server/src/lib/validate.ts` | `createTaskBody`, `taskIdParam` zod schemas + `toDetails` |
| `server/src/middleware/errorHandler.ts` | the only place an error becomes a response |
| `server/src/db/sequelize.ts` | `createSequelize(env)` — construction, no connection |
| `server/src/db/umzug.ts` | `createMigrator(sequelize)` |
| `server/src/migrations/001-create-tasks.ts` | the `tasks` table, its default, its index |
| `server/src/models/Task.ts` | `initTaskModel(sequelize)`, `Task`, `TaskModel`, `toDto` |
| `server/src/routes/createTask.ts` | `POST /` |
| `server/src/routes/listTasks.ts` | `GET /` |
| `server/src/routes/toggleTask.ts` | `PATCH /:id/toggle` |
| `server/src/routes/deleteTask.ts` | `DELETE /:id` |
| `server/src/routes/index.ts` | composes the four routers |
| `server/src/app.ts` | `createApp(taskModel)` — builds, never listens |
| `server/src/server.ts` | entrypoint: `loadEnv`, connect, listen |
| `server/src/migrate.ts` | entrypoint: `loadEnv`, run migrations |
| `client/src/api/tasksApi.ts` | four transport functions + `ApiError` |
| `client/src/api/queryKeys.ts` | `taskKeys` |
| `client/src/hooks/*.ts` | one hook per operation |
| `client/src/components/*.tsx` | presentational components |

---

## Task 1: Workspace scaffold and shared types

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.env.example`
- Create: `shared/package.json`, `shared/src/index.ts`
- Create: `server/package.json`, `server/tsconfig.json`
- Create: `client/package.json`, `client/tsconfig.json`
- Test: `shared/test/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the exact type names every later task imports.

```ts
export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}
export interface CreateTaskInput { title: string; description?: string | null; }
export type ApiErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';
export interface ApiErrorDetail { path: string; message: string; }
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: ApiErrorDetail[] };
}
```

- [ ] **Step 1: Create the root workspace files**

`package.json`:

```json
{
  "name": "bmo-task-board",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev": "concurrently -n server,client -c blue,magenta \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    "migrate": "npm run migrate -w server",
    "migrate:down": "npm run migrate:down -w server",
    "test": "vitest run",
    "typecheck": "tsc -p shared --noEmit && tsc -p server --noEmit && tsc -p client --noEmit",
    "build": "npm run build -w server && npm run build -w client"
  },
  "devDependencies": {
    "concurrently": "^10.0.5",
    "typescript": "7.0.2",
    "vitest": "5.0.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  }
}
```

`vitest.config.ts` — this exact shape was verified running under Vitest 5.0.0:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'server', root: './server', environment: 'node' } },
      { test: { name: 'client', root: './client', environment: 'jsdom' } },
    ],
  },
});
```

`.env.example`:

```
# Supabase connection — create the database yourself, then fill these in.
DB_HOST=db.xxxxxxxxxxxx.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=

# API server port (optional, defaults to 3000)
PORT=3000

# Optional: path to Supabase's CA certificate. When set, TLS certificate
# verification is enabled. When unset, the connection is encrypted but the
# server's identity is not verified.
# DB_SSL_CA=./certs/supabase-ca.crt
```

- [ ] **Step 2: Create the `shared` package — types only, no build**

`shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`"types": ["node"]` is required, not optional. Without it TypeScript 7 implicitly pulls in every
`@types/*` package hoisted to the monorepo root `node_modules` — `argparse`, `express`, `chai` and the
rest — and fails on the ones it cannot resolve. The guard test also imports `node:fs`, which needs the
node types present. `server` and `client` set their own `types` arrays for the same reason.

`shared/package.json`. Note there is deliberately **no `main`** and **no `build` script**:

```json
{
  "name": "@taskboard/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }
}
```

The `default` condition is required alongside `types`. Every production import from this package is
`import type` and therefore erased, so the only runtime consumer in the entire repo is the guard test
below — and `types` is not a runtime resolution condition, so without `default` that import fails on
the exports map rather than on the thing it means to check.

`shared/src/index.ts`:

```ts
/** A task as it appears on the wire. Dates are ISO 8601 strings, not Date objects. */
export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Request body accepted by POST /api/tasks. */
export interface CreateTaskInput {
  title: string;
  description?: string | null;
}

export type ApiErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

/** Every error response from the API has exactly this shape. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  };
}
```

- [ ] **Step 3: Create the two consumer workspace manifests**

`server/package.json`:

```json
{
  "name": "@taskboard/server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=../.env src/server.ts",
    "start": "node --env-file-if-exists=../.env dist/server.js",
    "migrate": "tsx --env-file-if-exists=../.env src/migrate.ts up",
    "migrate:down": "tsx --env-file-if-exists=../.env src/migrate.ts down",
    "build": "tsc -p tsconfig.build.json"
  },
  "dependencies": {
    "@taskboard/shared": "*",
    "express": "^5.2.1",
    "pg": "^8.23.0",
    "sequelize": "^6.37.8",
    "umzug": "^3.8.3",
    "zod": "^4.5.4"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "@types/supertest": "^6.0.0",
    "supertest": "^7.2.2",
    "tsx": "^4.23.13"
  }
}
```

**`watch` must come immediately after `tsx`, before any flags.** `tsx --env-file-if-exists=… watch f.ts`
makes tsx treat `watch` as the entry filename and fail with `ERR_MODULE_NOT_FOUND`. Verified against
tsx 4.23.13. Only `dev` uses `watch`; `migrate`/`migrate:down` pass no subcommand and `start` uses
`node`, so their flag placement is already correct.

**Why `--env-file-if-exists` and why `../.env`.** `loadEnv()` reads `process.env`, and nothing
populates it on its own — tsx does not read `.env` files. These scripts run with cwd `server/`, so the
path to the root `.env` is `../.env`. The `-if-exists` variant is deliberate: plain `--env-file` aborts
with `not found` when the file is absent, which would replace Task 9's clear "Invalid environment
configuration" message with an unhelpful Node error. Both behaviours were verified against Node 24.12
and tsx 4.23.13 before this plan was written.

`server/tsconfig.json` — typechecks source *and* tests, emits nothing:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`server/tsconfig.build.json` — emits `dist/`, source only. Two configs are needed
because `rootDir: "src"` and an `include` covering `test/` are mutually exclusive:
tsc rejects files outside `rootDir`, and a single config would either fail to
compile or emit to `dist/src/` and break `node dist/server.js`.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

`client/package.json`:

```json
{
  "name": "@taskboard/client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -p tsconfig.json --noEmit && vite build", "preview": "vite preview" },
  "dependencies": {
    "@taskboard/shared": "*",
    "@tanstack/react-query": "^5.102.8",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@tanstack/react-query-devtools": "^5.102.8",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.1.1",
    "jsdom": "^30.0.1",
    "tailwindcss": "^4.3.3",
    "vite": "^8.2.2"
  }
}
```

`client/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "test/**/*.tsx"]
}
```

Client code uses `moduleResolution: "bundler"`, so **client imports are extensionless**
(`from './App'`). Server code uses `NodeNext` and **must keep `.js` extensions**
(`from './app.js'`). Do not mix the two conventions — Vite does not reliably resolve a
`.js` specifier to a `.tsx` file.

- [ ] **Step 4: Write the failing test**

`shared/test/types.test.ts` — this guards the contract shape and, more importantly, guards the "no runtime value" constraint:

```ts
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
```

**The contract types themselves get no runtime tests.** Assertions like
`const t: TaskDto = {…}; expect(t.completed).toBe(false)` are tautological at runtime — they only
check a value the test just wrote. What actually guards the contract is that `server` and `client`
both compile against these types, so renaming or dropping a field fails `npm run typecheck`. That is
strictly stronger than any runtime assertion here, and it is why this file tests only the package's
*structure*, which typechecking cannot see.

Add a third project to `vitest.config.ts` so this file runs:

```ts
{ test: { name: 'shared', root: './shared', environment: 'node' } },
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm install && npm test`
Expected: FAIL — `Cannot find module '@taskboard/shared'` or the type imports fail to resolve, because the workspace has not been linked yet.

- [ ] **Step 6: Install and make it pass**

Run: `npm install` at the root. npm links the three workspaces.

- [ ] **Step 7: Run the tests and the typecheck to verify they pass**

Run: `npm test`
Expected: PASS — 2 tests in the `shared` project.

Run: `npx tsc -p shared --noEmit`
Expected: PASS with no errors.

Verify no build output was produced: `ls shared` shows `package.json`, `src/`, `test/` — and **no `dist/`**.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.base.json vitest.config.ts .env.example shared server/package.json server/tsconfig.json client/package.json client/tsconfig.json package-lock.json
git commit -m "feat: scaffold npm workspaces with types-only shared package"
```

---

## Task 2: Env config, HttpError, error handler, and the app shell

**Files:**
- Create: `server/src/config/env.ts`
- Create: `server/src/lib/HttpError.ts`
- Create: `server/src/middleware/errorHandler.ts`
- Create: `server/src/app.ts`
- Test: `server/test/app.test.ts`, `server/test/env.test.ts`

**Interfaces:**
- Consumes: `ApiErrorCode`, `ApiErrorDetail`, `ApiErrorBody` from Task 1.
- Produces:

```ts
export interface Env {
  dbHost: string; dbPort: number; dbName: string; dbUser: string;
  dbPassword: string; port: number; dbSslCa: string | null;
}
export function loadEnv(source?: Record<string, string | undefined>): Env;

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];
  constructor(status: number, code: ApiErrorCode, message: string, details?: ApiErrorDetail[]);
}
export function notFound(message: string): HttpError;
export function validationError(message: string, details?: ApiErrorDetail[]): HttpError;

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void;
export function createApp(taskModel: TaskModel): Express;   // taskModel arrives in Task 5
```

> `loadEnv` takes its source as a parameter defaulting to `process.env`. This is what lets the test supply a fake environment, and it is why nothing here validates at import time.

- [ ] **Step 1: Write the failing test for env loading**

`server/test/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const complete = {
  DB_HOST: 'db.example.supabase.co',
  DB_PORT: '5432',
  DB_NAME: 'postgres',
  DB_USER: 'postgres',
  DB_PASSWORD: 'secret',
};

describe('loadEnv', () => {
  it('parses a complete environment', () => {
    const env = loadEnv(complete);
    expect(env.dbHost).toBe('db.example.supabase.co');
    expect(env.dbPort).toBe(5432);
    expect(env.dbSslCa).toBeNull();
  });

  it('defaults PORT to 3000 when absent', () => {
    expect(loadEnv(complete).port).toBe(3000);
  });

  it('names the missing variable in the error message', () => {
    const { DB_PASSWORD, ...incomplete } = complete;
    expect(() => loadEnv(incomplete)).toThrowError(/DB_PASSWORD/);
  });

  it('rejects a non-numeric DB_PORT', () => {
    expect(() => loadEnv({ ...complete, DB_PORT: 'not-a-number' })).toThrowError(/DB_PORT/);
  });

  it('does not read process.env when a source is supplied', () => {
    // Guards against a module-level `process.env` read sneaking back in.
    expect(() => loadEnv({})).toThrowError();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project server env`
Expected: FAIL — `Cannot find module '../src/config/env.js'`.

- [ ] **Step 3: Implement `config/env.ts`**

```ts
import { z } from 'zod';

export interface Env {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  port: number;
  dbSslCa: string | null;
}

const schema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_SSL_CA: z.string().min(1).optional(),
});

/**
 * Validates the environment and returns typed config.
 *
 * Takes its source as a parameter so tests can supply a fake environment, and
 * so nothing is validated at import time — importing this module must stay
 * free of side effects or the model becomes untestable without credentials.
 *
 * @throws Error naming every missing or malformed variable.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const e = parsed.data;
  return {
    dbHost: e.DB_HOST,
    dbPort: e.DB_PORT,
    dbName: e.DB_NAME,
    dbUser: e.DB_USER,
    dbPassword: e.DB_PASSWORD,
    port: e.PORT,
    dbSslCa: e.DB_SSL_CA ?? null,
  };
}
```

- [ ] **Step 4: Run the env tests to verify they pass**

Run: `npx vitest run --project server env`
Expected: PASS — 5 tests.

- [ ] **Step 5: Write the failing test for the error envelope**

`server/test/app.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/lib/HttpError.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

// A stand-in model; Task 5 replaces this with the shared makeFakeTaskModel helper.
const stubModel = {} as never;

describe('app-level error handling', () => {
  it('returns a JSON 404 envelope for an unmatched route', async () => {
    const res = await request(createApp(stubModel)).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('returns a 400 envelope for a malformed JSON body', async () => {
    const res = await request(createApp(stubModel))
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/JSON/i);
  });

  it('does not leak internals when an unexpected error is thrown', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.get('/boom', () => { throw new Error('SECRET connection string leaked'); });
    app.use(errorHandler);

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET/);
    expect(spy).toHaveBeenCalled();          // the real error is logged server-side
    spy.mockRestore();
  });

  it('renders an HttpError with its status, code, and details', async () => {
    const app = express();
    app.get('/bad', () => {
      throw new HttpError(400, 'VALIDATION_ERROR', 'title is required', [
        { path: 'title', message: 'Required' },
      ]);
    });
    app.use(errorHandler);

    const res = await request(app).get('/bad');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'title', message: 'Required' }]);
  });

  it('responds to the health check', async () => {
    const res = await request(createApp(stubModel)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run --project server app`
Expected: FAIL — `Cannot find module '../src/app.js'`.

- [ ] **Step 7: Implement `HttpError`, `errorHandler`, and `app.ts`**

`server/src/lib/HttpError.ts`:

```ts
import type { ApiErrorCode, ApiErrorDetail } from '@taskboard/shared';

/** An error carrying everything the error handler needs to build a response. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message: string): HttpError {
  return new HttpError(404, 'NOT_FOUND', message);
}

export function validationError(message: string, details?: ApiErrorDetail[]): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message, details);
}
```

`server/src/middleware/errorHandler.ts`:

```ts
import type { ErrorRequestHandler } from 'express';
import type { ApiErrorBody } from '@taskboard/shared';
import { HttpError } from '../lib/HttpError.js';

/**
 * The single place an error becomes a response. Route modules throw; this formats.
 *
 * Express 5 forwards rejected promises here automatically, so route handlers are
 * plain async functions with no asyncHandler wrapper.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    };
    res.status(err.status).json(body);
    return;
  }

  // express.json() raises a SyntaxError with a `body` property on malformed input.
  if (err instanceof SyntaxError && 'body' in err) {
    const body: ApiErrorBody = {
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON in request body' },
    };
    res.status(400).json(body);
    return;
  }

  // Anything unexpected: log the truth, return nothing revealing.
  console.error('Unhandled error:', err);
  const body: ApiErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  };
  res.status(500).json(body);
};
```

`server/src/app.ts` — routes arrive in Task 5; the mount point is left ready:

```ts
import express, { type Express } from 'express';
import type { ApiErrorBody } from '@taskboard/shared';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * Builds the Express application. Deliberately does not call listen() — that is
 * server.ts's job, and the split is what lets Supertest drive the real app
 * without binding a port.
 *
 * The task model is injected rather than imported so tests can supply a fake.
 */
export function createApp(_taskModel: unknown): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });

  // Task 5 mounts the tasks router here.

  app.use((_req, res) => {
    const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
    res.status(404).json(body);
  });

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run --project server`
Expected: PASS — 10 tests (5 env, 5 app).

- [ ] **Step 9: Commit**

```bash
git add server/src/config server/src/lib server/src/middleware server/src/app.ts server/test
git commit -m "feat: add env loading, error contract, and app shell"
```

---

## Task 3: Sequelize instance, Task model, and migration

**Files:**
- Create: `server/src/db/sequelize.ts`
- Create: `server/src/db/umzug.ts`
- Create: `server/src/models/Task.ts`
- Create: `server/src/migrations/001-create-tasks.ts`
- Test: `server/test/taskModel.test.ts`

**Interfaces:**
- Consumes: `Env` from Task 2, `TaskDto` from Task 1.
- Produces:

```ts
export function createSequelize(env: Env): Sequelize;            // constructs, does not connect
export class Task extends Model<InferAttributes<Task>, InferCreationAttributes<Task>> { … }
export type TaskModel = typeof Task;
export function initTaskModel(sequelize: Sequelize): TaskModel;
export function toDto(task: Task): TaskDto;                      // Date -> ISO string
export function createMigrator(sequelize: Sequelize): Umzug<QueryInterface>;
```

> Verified empirically before writing this plan: `new Sequelize({…})` opens no connection, so the test below constructs a throwaway instance pointed at a nonexistent host and asserts the real attribute mapping — no credentials, no network.

- [ ] **Step 1: Write the failing test**

`server/test/taskModel.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project server taskModel`
Expected: FAIL — `Cannot find module '../src/models/Task.js'`.

- [ ] **Step 3: Implement `db/sequelize.ts`**

```ts
import { readFileSync } from 'node:fs';
import { Sequelize } from 'sequelize';
import type { Env } from '../config/env.js';

/**
 * Builds a Sequelize instance. Construction opens no connection — the first
 * query does — so callers may build one without a reachable database.
 *
 * Supabase requires SSL. Its pooler presents a certificate that is not in Node's
 * default trust store, so verification is off unless DB_SSL_CA supplies the CA.
 * That default encrypts the connection but does not verify the server identity.
 */
export function createSequelize(env: Env): Sequelize {
  const ssl = env.dbSslCa
    ? { require: true, rejectUnauthorized: true, ca: readFileSync(env.dbSslCa, 'utf8') }
    : { require: true, rejectUnauthorized: false };

  return new Sequelize({
    dialect: 'postgres',
    host: env.dbHost,
    port: env.dbPort,
    database: env.dbName,
    username: env.dbUser,
    password: env.dbPassword,
    dialectOptions: { ssl },
    logging: false,
  });
}
```

- [ ] **Step 4: Implement `models/Task.ts`**

```ts
import {
  DataTypes, Model, type Sequelize,
  type InferAttributes, type InferCreationAttributes, type CreationOptional,
} from 'sequelize';
import type { TaskDto } from '@taskboard/shared';

export class Task extends Model<InferAttributes<Task>, InferCreationAttributes<Task>> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare description: string | null;
  declare completed: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export type TaskModel = typeof Task;

/**
 * Initializes the model against a Sequelize instance and returns it.
 *
 * A factory rather than a module singleton: importing this file must not require
 * environment variables, or the model becomes untestable without credentials.
 */
export function initTaskModel(sequelize: Sequelize): TaskModel {
  Task.init(
    {
      // No defaultValue here on purpose — the migration's gen_random_uuid() owns
      // id generation, and Postgres returns the value via RETURNING.
      id: { type: DataTypes.UUID, primaryKey: true },
      title: { type: DataTypes.TEXT, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'tasks', underscored: true, timestamps: true },
  );
  return Task;
}

/** Converts a model row into the wire representation, Dates becoming ISO strings. */
export function toDto(task: Task): TaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    completed: task.completed,
    createdAt: new Date(task.createdAt).toISOString(),
    updatedAt: new Date(task.updatedAt).toISOString(),
  };
}
```

- [ ] **Step 5: Run the model tests to verify they pass**

Run: `npx vitest run --project server taskModel`
Expected: PASS — 6 tests. No network access occurs.

- [ ] **Step 6: Write the migration**

`server/src/migrations/001-create-tasks.ts`:

```ts
import { DataTypes, type QueryInterface, Sequelize } from 'sequelize';

export async function up({ context }: { context: QueryInterface }): Promise<void> {
  await context.createTable('tasks', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    },
    title: { type: DataTypes.TEXT, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
  });

  // The list endpoint always orders by this column.
  await context.addIndex('tasks', ['created_at'], { name: 'tasks_created_at_idx' });
}

export async function down({ context }: { context: QueryInterface }): Promise<void> {
  await context.removeIndex('tasks', 'tasks_created_at_idx');
  await context.dropTable('tasks');
}
```

- [ ] **Step 7: Implement `db/umzug.ts`**

```ts
import { Umzug, SequelizeStorage } from 'umzug';
import type { Sequelize, QueryInterface } from 'sequelize';

/**
 * Builds the migrator. Applied migrations are recorded in a SequelizeMeta table
 * inside the database, so `up` is safe to re-run.
 */
export function createMigrator(sequelize: Sequelize): Umzug<QueryInterface> {
  return new Umzug({
    migrations: { glob: ['../migrations/*.ts', { cwd: import.meta.dirname }] },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console,
  });
}
```

- [ ] **Step 8: Run the whole server suite and commit**

Run: `npx vitest run --project server`
Expected: PASS — 16 tests.

```bash
git add server/src/db server/src/models server/src/migrations server/test/taskModel.test.ts
git commit -m "feat: add Sequelize instance, Task model, and initial migration"
```

---

## Task 4: Request validation schemas

**Files:**
- Create: `server/src/lib/validate.ts`
- Test: `server/test/validate.test.ts`

**Interfaces:**
- Consumes: `ApiErrorDetail` from Task 1, `validationError` from Task 2.
- Produces — **use these exact export names**; later tasks import them verbatim:

```ts
export const createTaskBody: z.ZodType<{ title: string; description: string | null }>;
export const taskIdParam: z.ZodType<{ id: string }>;
export function toDetails(error: z.ZodError): ApiErrorDetail[];
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, message: string): T;
```

> The behaviour below was verified against zod 4.5.4 before this plan was written: `.trim()` applies before `.min(1)`, so `'   '` fails; and `.nullish().transform()` maps absent, `null`, and `''` all to `null`. The error strings in the assertions are the real ones zod emits.

- [ ] **Step 1: Write the failing test**

`server/test/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTaskBody, taskIdParam, parseOrThrow, toDetails } from '../src/lib/validate.js';
import { HttpError } from '../src/lib/HttpError.js';

describe('createTaskBody', () => {
  it('trims the title', () => {
    expect(createTaskBody.parse({ title: '  Buy milk  ' }).title).toBe('Buy milk');
  });

  it('rejects an empty title', () => {
    expect(createTaskBody.safeParse({ title: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only title, because trim runs before the length check', () => {
    expect(createTaskBody.safeParse({ title: '     ' }).success).toBe(false);
  });

  it('rejects a title longer than 200 characters', () => {
    expect(createTaskBody.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
  });

  it('accepts a title of exactly 200 characters', () => {
    expect(createTaskBody.safeParse({ title: 'a'.repeat(200) }).success).toBe(true);
  });

  it('coerces an absent description to null', () => {
    expect(createTaskBody.parse({ title: 'x' }).description).toBeNull();
  });

  it('coerces an explicit null description to null', () => {
    expect(createTaskBody.parse({ title: 'x', description: null }).description).toBeNull();
  });

  it('coerces an empty-string description to null', () => {
    // An untouched description input submits "". Without this the table fills
    // with a mix of NULL and '' rows that the client renders differently.
    expect(createTaskBody.parse({ title: 'x', description: '' }).description).toBeNull();
  });

  it('coerces a whitespace-only description to null', () => {
    expect(createTaskBody.parse({ title: 'x', description: '   ' }).description).toBeNull();
  });

  it('keeps a real description, trimmed', () => {
    expect(createTaskBody.parse({ title: 'x', description: '  note  ' }).description).toBe('note');
  });

  it('rejects a description longer than 2000 characters', () => {
    expect(createTaskBody.safeParse({ title: 'x', description: 'a'.repeat(2001) }).success).toBe(false);
  });
});

describe('taskIdParam', () => {
  it('accepts a UUID', () => {
    expect(taskIdParam.safeParse({ id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a' }).success).toBe(true);
  });

  it('rejects a non-UUID, so a bad id never reaches Postgres as a failed cast', () => {
    expect(taskIdParam.safeParse({ id: 'abc' }).success).toBe(false);
  });
});

describe('parseOrThrow', () => {
  it('returns parsed data on success', () => {
    expect(parseOrThrow(createTaskBody, { title: 'x' }, 'bad').title).toBe('x');
  });

  it('throws a 400 HttpError carrying field-level details', () => {
    try {
      parseOrThrow(createTaskBody, { title: '' }, 'Invalid task');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const e = err as HttpError;
      expect(e.status).toBe(400);
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.details?.[0]?.path).toBe('title');
    }
  });
});

describe('toDetails', () => {
  it('joins nested paths with dots', () => {
    const result = createTaskBody.safeParse({ title: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toDetails(result.error)).toEqual([
        { path: 'title', message: expect.stringContaining('Too small') },
      ]);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project server validate`
Expected: FAIL — `Cannot find module '../src/lib/validate.js'`.

- [ ] **Step 3: Implement `lib/validate.ts`**

```ts
import { z } from 'zod';
import type { ApiErrorDetail } from '@taskboard/shared';
import { validationError } from './HttpError.js';

/**
 * Body accepted by POST /api/tasks.
 *
 * `.trim()` runs before `.min(1)`, so a whitespace-only title is rejected.
 * Absent, null, and empty-string descriptions all normalize to null so the
 * column never holds a mix of NULL and ''.
 */
export const createTaskBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});

/** Route params for the two :id endpoints. */
export const taskIdParam = z.object({ id: z.uuid() });

/** Flattens zod issues into the API's error `details` array. */
export function toDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Parses input or throws a 400 HttpError carrying field-level details. */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw validationError(message, toDetails(result.error));
  }
  return result.data;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server validate`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/validate.ts server/test/validate.test.ts
git commit -m "feat: add request validation schemas"
```

---

## Task 5: POST /api/tasks — create

**Files:**
- Create: `server/src/routes/createTask.ts`
- Create: `server/src/routes/index.ts`
- Create: `server/test/helpers/fakeTaskModel.ts`
- **Modify:** `server/src/app.ts` — mount the tasks router
- Test: `server/test/createTask.test.ts`

**Interfaces:**
- Consumes: `TaskModel`, `toDto` (Task 3); `createTaskBody`, `parseOrThrow` (Task 4).
- Produces:

```ts
export function createTaskRouter(taskModel: TaskModel): Router;      // routes/createTask.ts
export function createTasksRouter(taskModel: TaskModel): Router;     // routes/index.ts
export function makeFakeTaskModel(overrides?: Partial<FakeTaskModel>): TaskModel;
export function createApp(taskModel: TaskModel): Express;            // app.ts, now typed
```

> **`server/src/routes/index.ts` is created here and modified by Tasks 6, 7, and 8.** Each of those adds one `.use(...)` line. Do not recreate the file — read it first and add to it.

- [ ] **Step 1: Write the shared fake-model helper**

`server/test/helpers/fakeTaskModel.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

`server/test/createTask.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeTaskModel, fakeRow } from './helpers/fakeTaskModel.js';

describe('POST /api/tasks', () => {
  it('creates a task and returns 201 with the DTO', async () => {
    const create = vi.fn().mockResolvedValue(fakeRow());
    const app = createApp(makeFakeTaskModel({ create }));

    const res = await request(app).post('/api/tasks').send({ title: 'Buy milk' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
      title: 'Buy milk',
      description: null,
      completed: false,
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
    });
    expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: null });
  });

  it('trims the title before persisting', async () => {
    const create = vi.fn().mockResolvedValue(fakeRow());
    const app = createApp(makeFakeTaskModel({ create }));

    await request(app).post('/api/tasks').send({ title: '  Buy milk  ' });

    expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: null });
  });

  it('persists a description when one is supplied', async () => {
    const create = vi.fn().mockResolvedValue(fakeRow({ description: 'from the corner shop' }));
    const app = createApp(makeFakeTaskModel({ create }));

    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Buy milk', description: 'from the corner shop' });

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: 'from the corner shop' });
  });

  it('stores an empty-string description as null', async () => {
    const create = vi.fn().mockResolvedValue(fakeRow());
    const app = createApp(makeFakeTaskModel({ create }));

    await request(app).post('/api/tasks').send({ title: 'Buy milk', description: '' });

    expect(create).toHaveBeenCalledWith({ title: 'Buy milk', description: null });
  });

  it('rejects a missing title with 400 and field details', async () => {
    const create = vi.fn();
    const res = await request(createApp(makeFakeTaskModel({ create }))).post('/api/tasks').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('title');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only title with 400', async () => {
    const res = await request(createApp(makeFakeTaskModel())).post('/api/tasks').send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a title longer than 200 characters with 400', async () => {
    const res = await request(createApp(makeFakeTaskModel()))
      .post('/api/tasks').send({ title: 'a'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('rejects a description longer than 2000 characters with 400', async () => {
    const res = await request(createApp(makeFakeTaskModel()))
      .post('/api/tasks').send({ title: 'ok', description: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run --project server createTask`
Expected: FAIL — `Cannot find module './helpers/fakeTaskModel.js'` resolves, but `createApp` does not yet mount `/api/tasks`, so the create test returns 404.

- [ ] **Step 4: Implement the route**

`server/src/routes/createTask.ts`:

```ts
import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { toDto } from '../models/Task.js';
import { createTaskBody, parseOrThrow } from '../lib/validate.js';

/** POST /api/tasks — creates a task. */
export function createTaskRouter(taskModel: TaskModel): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const body = parseOrThrow(createTaskBody, req.body, 'Invalid task');
    const task = await taskModel.create({ title: body.title, description: body.description });
    res.status(201).json(toDto(task));
  });

  return router;
}
```

`server/src/routes/index.ts` — Tasks 6–8 each add one line here:

```ts
import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { createTaskRouter } from './createTask.js';

/** Composes the per-operation routers. Each operation lives in its own module. */
export function createTasksRouter(taskModel: TaskModel): Router {
  const router = Router();
  router.use(createTaskRouter(taskModel));
  return router;
}
```

- [ ] **Step 5: Modify `app.ts` to mount the router and take a typed model**

Replace the `createApp` signature and the placeholder comment:

```ts
import express, { type Express } from 'express';
import type { ApiErrorBody } from '@taskboard/shared';
import type { TaskModel } from './models/Task.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createTasksRouter } from './routes/index.js';

export function createApp(taskModel: TaskModel): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.use('/api/tasks', createTasksRouter(taskModel));

  app.use((_req, res) => {
    const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
    res.status(404).json(body);
  });

  app.use(errorHandler);
  return app;
}
```

In `server/test/app.test.ts`, replace `const stubModel = {} as never;` with an import of the helper:

```ts
import { makeFakeTaskModel } from './helpers/fakeTaskModel.js';
const stubModel = makeFakeTaskModel();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project server`
Expected: PASS — 40 tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes server/src/app.ts server/test
git commit -m "feat: add POST /api/tasks create endpoint"
```

---

## Task 6: GET /api/tasks — list

**Files:**
- Create: `server/src/routes/listTasks.ts`
- **Modify:** `server/src/routes/index.ts` — add one `.use(...)` line, keeping the existing create mount
- Test: `server/test/listTasks.test.ts`

**Interfaces:**
- Consumes: `TaskModel`, `toDto` (Task 3); `createTasksRouter` (Task 5).
- Produces: `export function listTasksRouter(taskModel: TaskModel): Router;`

- [ ] **Step 1: Write the failing test**

`server/test/listTasks.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeTaskModel, fakeRow } from './helpers/fakeTaskModel.js';

describe('GET /api/tasks', () => {
  it('returns 200 and an array of DTOs', async () => {
    const findAll = vi.fn().mockResolvedValue([
      fakeRow({ id: '11111111-1111-4111-8111-111111111111', title: 'Newer' }),
      fakeRow({ id: '22222222-2222-4222-8222-222222222222', title: 'Older' }),
    ]);
    const res = await request(createApp(makeFakeTaskModel({ findAll }))).get('/api/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('Newer');
    expect(res.body[0].createdAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('orders by createdAt descending', async () => {
    const findAll = vi.fn().mockResolvedValue([]);
    await request(createApp(makeFakeTaskModel({ findAll }))).get('/api/tasks');

    expect(findAll).toHaveBeenCalledWith({ order: [['createdAt', 'DESC']] });
  });

  it('returns an empty array when there are no tasks', async () => {
    const findAll = vi.fn().mockResolvedValue([]);
    const res = await request(createApp(makeFakeTaskModel({ findAll }))).get('/api/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('surfaces an unexpected model failure as a generic 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const findAll = vi.fn().mockRejectedValue(new Error('SECRET connection refused'));
    const res = await request(createApp(makeFakeTaskModel({ findAll }))).get('/api/tasks');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET/);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project server listTasks`
Expected: FAIL — 404, because `GET /` is not mounted.

- [ ] **Step 3: Implement the route**

`server/src/routes/listTasks.ts`:

```ts
import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { toDto } from '../models/Task.js';

/** GET /api/tasks — every task, newest first. No pagination, no filtering. */
export function listTasksRouter(taskModel: TaskModel): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const tasks = await taskModel.findAll({ order: [['createdAt', 'DESC']] });
    res.json(tasks.map(toDto));
  });

  return router;
}
```

- [ ] **Step 4: Modify `routes/index.ts` — read it first, then add one line**

The file already mounts `createTaskRouter`. Add the import and the new `.use`:

```ts
import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { createTaskRouter } from './createTask.js';
import { listTasksRouter } from './listTasks.js';

export function createTasksRouter(taskModel: TaskModel): Router {
  const router = Router();
  router.use(createTaskRouter(taskModel));
  router.use(listTasksRouter(taskModel));
  return router;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project server`
Expected: PASS — 44 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/listTasks.ts server/src/routes/index.ts server/test/listTasks.test.ts
git commit -m "feat: add GET /api/tasks list endpoint"
```

---

## Task 7: PATCH /api/tasks/:id/toggle — toggle

**Files:**
- Create: `server/src/routes/toggleTask.ts`
- **Modify:** `server/src/routes/index.ts` — add one `.use(...)` line, keeping the two existing mounts
- Test: `server/test/toggleTask.test.ts`

**Interfaces:**
- Consumes: `TaskModel`, `toDto` (Task 3); `taskIdParam`, `parseOrThrow` (Task 4).
- Produces: `export function toggleTaskRouter(taskModel: TaskModel): Router;`

> The update runs as one atomic statement — `SET completed = NOT completed … RETURNING *` — so two concurrent toggles cannot both read `false` and both write `true`. Sequelize returns `[affectedCount, affectedRows]` when `returning: true`; zero affected rows means the task does not exist.

- [ ] **Step 1: Write the failing test**

`server/test/toggleTask.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeTaskModel, fakeRow } from './helpers/fakeTaskModel.js';

const ID = '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a';

describe('PATCH /api/tasks/:id/toggle', () => {
  it('returns 200 with the updated task', async () => {
    const update = vi.fn().mockResolvedValue([1, [fakeRow({ completed: true })]]);
    const res = await request(createApp(makeFakeTaskModel({ update })))
      .patch(`/api/tasks/${ID}/toggle`);

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
    expect(res.body.id).toBe(ID);
  });

  it('flips the column in a single atomic statement rather than reading first', async () => {
    const findAll = vi.fn();
    const update = vi.fn().mockResolvedValue([1, [fakeRow({ completed: true })]]);
    await request(createApp(makeFakeTaskModel({ update, findAll })))
      .patch(`/api/tasks/${ID}/toggle`);

    // No read-modify-write: the handler must not fetch the row first.
    expect(findAll).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);

    const [values, options] = update.mock.calls[0]!;
    expect(String(values.completed.val ?? values.completed)).toContain('NOT completed');
    expect(options).toMatchObject({ where: { id: ID }, returning: true });
  });

  it('ignores any request body — the endpoint flips, it does not set', async () => {
    const update = vi.fn().mockResolvedValue([1, [fakeRow({ completed: true })]]);
    const res = await request(createApp(makeFakeTaskModel({ update })))
      .patch(`/api/tasks/${ID}/toggle`)
      .send({ completed: false });

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });

  it('returns 404 when no rows are affected', async () => {
    const update = vi.fn().mockResolvedValue([0, []]);
    const res = await request(createApp(makeFakeTaskModel({ update })))
      .patch(`/api/tasks/${ID}/toggle`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // Pins the route's own 404, not the app's catch-all, which emits the same
    // status and code. Without these, removing the mount leaves this test green.
    expect(res.body.error.message).toContain(ID);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for a non-UUID id, never letting it reach Postgres', async () => {
    const update = vi.fn();
    const res = await request(createApp(makeFakeTaskModel({ update })))
      .patch('/api/tasks/abc/toggle');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project server toggleTask`
Expected: FAIL — 404 on every case, because the route is not mounted.

- [ ] **Step 3: Implement the route**

`server/src/routes/toggleTask.ts`:

```ts
import { Router } from 'express';
import { literal } from 'sequelize';
import type { TaskModel, Task } from '../models/Task.js';
import { toDto } from '../models/Task.js';
import { taskIdParam, parseOrThrow } from '../lib/validate.js';
import { notFound } from '../lib/HttpError.js';

/**
 * PATCH /api/tasks/:id/toggle — flips `completed`.
 *
 * Takes no body: this endpoint toggles, it does not set. That makes it
 * non-idempotent, which is why the client pins mutation retry to 0.
 *
 * The flip is one atomic UPDATE, avoiding the lost-update race where two
 * concurrent toggles both read false and both write true.
 *
 * If Sequelize's attribute validation rejects the Literal against a BOOLEAN
 * column at runtime, the fallback is a raw query — see the spec's
 * "Implementation note" under Toggle semantics.
 */
export function toggleTaskRouter(taskModel: TaskModel): Router {
  const router = Router();

  router.patch('/:id/toggle', async (req, res) => {
    const { id } = parseOrThrow(taskIdParam, req.params, 'Invalid task id');

    const [affected, rows] = (await taskModel.update(
      { completed: literal('NOT completed') } as never,
      { where: { id }, returning: true },
    )) as unknown as [number, Task[]];

    if (affected === 0 || rows.length === 0) {
      throw notFound(`No task with id ${id}`);
    }

    res.json(toDto(rows[0]!));
  });

  return router;
}
```

- [ ] **Step 4: Modify `routes/index.ts` — read it first, then add one line**

```ts
import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { createTaskRouter } from './createTask.js';
import { listTasksRouter } from './listTasks.js';
import { toggleTaskRouter } from './toggleTask.js';

export function createTasksRouter(taskModel: TaskModel): Router {
  const router = Router();
  router.use(createTaskRouter(taskModel));
  router.use(listTasksRouter(taskModel));
  router.use(toggleTaskRouter(taskModel));
  return router;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project server`
Expected: PASS — 49 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/toggleTask.ts server/src/routes/index.ts server/test/toggleTask.test.ts
git commit -m "feat: add PATCH /api/tasks/:id/toggle endpoint"
```

---

## Task 8: DELETE /api/tasks/:id — delete

**Files:**
- Create: `server/src/routes/deleteTask.ts`
- **Modify:** `server/src/routes/index.ts` — add one `.use(...)` line, keeping the three existing mounts
- Test: `server/test/deleteTask.test.ts`

**Interfaces:**
- Consumes: `TaskModel` (Task 3); `taskIdParam`, `parseOrThrow` (Task 4).
- Produces: `export function deleteTaskRouter(taskModel: TaskModel): Router;`

- [ ] **Step 1: Write the failing test**

`server/test/deleteTask.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeTaskModel } from './helpers/fakeTaskModel.js';

const ID = '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a';

describe('DELETE /api/tasks/:id', () => {
  it('returns 204 with an empty body', async () => {
    const destroy = vi.fn().mockResolvedValue(1);
    const res = await request(createApp(makeFakeTaskModel({ destroy }))).delete(`/api/tasks/${ID}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.text).toBe('');
    expect(destroy).toHaveBeenCalledWith({ where: { id: ID } });
  });

  it('returns 404 when no rows are deleted', async () => {
    const destroy = vi.fn().mockResolvedValue(0);
    const res = await request(createApp(makeFakeTaskModel({ destroy }))).delete(`/api/tasks/${ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // Pins the route's own 404, not the app's catch-all, which emits the same
    // status and code. Without these, removing the mount leaves this test green.
    expect(res.body.error.message).toContain(ID);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for a non-UUID id', async () => {
    const destroy = vi.fn();
    const res = await request(createApp(makeFakeTaskModel({ destroy }))).delete('/api/tasks/abc');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(destroy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project server deleteTask`
Expected: FAIL — 404, because the route is not mounted.

- [ ] **Step 3: Implement the route**

`server/src/routes/deleteTask.ts`:

```ts
import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { taskIdParam, parseOrThrow } from '../lib/validate.js';
import { notFound } from '../lib/HttpError.js';

/** DELETE /api/tasks/:id — removes a task. Returns 204 with no body. */
export function deleteTaskRouter(taskModel: TaskModel): Router {
  const router = Router();

  router.delete('/:id', async (req, res) => {
    const { id } = parseOrThrow(taskIdParam, req.params, 'Invalid task id');

    const deleted = await taskModel.destroy({ where: { id } });
    if (deleted === 0) {
      throw notFound(`No task with id ${id}`);
    }

    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: Modify `routes/index.ts` — read it first, then add the final line**

```ts
import { Router } from 'express';
import type { TaskModel } from '../models/Task.js';
import { createTaskRouter } from './createTask.js';
import { listTasksRouter } from './listTasks.js';
import { toggleTaskRouter } from './toggleTask.js';
import { deleteTaskRouter } from './deleteTask.js';

/** Composes the four per-operation routers. */
export function createTasksRouter(taskModel: TaskModel): Router {
  const router = Router();
  router.use(createTaskRouter(taskModel));
  router.use(listTasksRouter(taskModel));
  router.use(toggleTaskRouter(taskModel));
  router.use(deleteTaskRouter(taskModel));
  return router;
}
```

- [ ] **Step 5: Run the full server suite to verify it passes**

Run: `npx vitest run --project server`
Expected: PASS — 52 tests. All four endpoints are now mounted.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/deleteTask.ts server/src/routes/index.ts server/test/deleteTask.test.ts
git commit -m "feat: add DELETE /api/tasks/:id endpoint"
```

---

## Task 9: Server and migration entrypoints

**Files:**
- Create: `server/src/server.ts`
- Create: `server/src/migrate.ts`
- Test: manual — run the two commands with no `.env` present

**Interfaces:**
- Consumes: `loadEnv` (Task 2); `createSequelize`, `initTaskModel`, `createMigrator` (Task 3); `createApp` (Task 5).
- Produces: no exports. These are the only two modules that call `loadEnv()`.

> **This task needs no database credentials.** Its gate is that both commands fail with a clear, named error when the environment is absent — proving the config path works. Connecting to real Supabase happens in Task 16.

- [ ] **Step 1: Implement `server.ts`**

```ts
import { loadEnv } from './config/env.js';
import { createSequelize } from './db/sequelize.js';
import { initTaskModel } from './models/Task.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const sequelize = createSequelize(env);

  // Fail fast on a bad connection rather than at the first request.
  await sequelize.authenticate();

  const taskModel = initTaskModel(sequelize);
  const app = createApp(taskModel);

  const server = app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });

  // listen() doesn't throw synchronously on a bind failure — it emits 'error' on
  // the returned server. Without this handler that becomes an uncaught exception
  // and dumps a stack trace instead of the clean message every other failure mode
  // here produces. Note both env branches fail before listen() is reached, so no
  // amount of testing those paths surfaces this one.
  server.on('error', (err: Error) => {
    console.error(`Failed to bind port ${env.port}: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Implement `migrate.ts`**

```ts
import { loadEnv } from './config/env.js';
import { createSequelize } from './db/sequelize.js';
import { createMigrator } from './db/umzug.js';

async function main(): Promise<void> {
  const direction = process.argv[2] ?? 'up';
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`Unknown migration direction "${direction}" — expected "up" or "down"`);
  }

  const sequelize = createSequelize(loadEnv());
  const migrator = createMigrator(sequelize);

  const applied = direction === 'up'
    ? await migrator.up()
    : await migrator.down();

  console.log(
    applied.length === 0
      ? 'No migrations to run.'
      : `Applied: ${applied.map((m) => m.name).join(', ')}`,
  );

  await sequelize.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify both entrypoints fail cleanly with no environment**

Run (with no `.env` file present): `npm run migrate`
Expected: exit code 1, and a message listing each missing variable by name:

```
Invalid environment configuration:
  DB_HOST: Invalid input: expected string, received undefined
  DB_PORT: ...
```

It must **not** print a stack trace or hang trying to connect.

Run: `npm run dev -w server`
Expected: the same clear message, exit code 1.

- [ ] **Step 4: Verify the success branch — that a present `.env` is actually read**

Testing only the missing-env path above would pass whether or not `.env` loading works at all. This
step distinguishes the two, and still needs no real credentials.

Create a root `.env` with syntactically valid but fake values:

```
DB_HOST=nowhere.invalid
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=fake
```

Run: `npm run migrate`
Expected: a **connection** error mentioning `nowhere.invalid` — `getaddrinfo ENOTFOUND` or similar.

That failure is the pass condition: it proves the variables were loaded and the code got as far as
dialling the database. If instead you see "Invalid environment configuration", the `.env` is not being
read — check that the script carries `--env-file-if-exists=../.env` and that the path resolves from
`server/`, which is the cwd `npm run -w server` uses.

Delete this scratch `.env` afterwards, or replace it with real Supabase values in Task 16.

- [ ] **Step 5: Verify no import-time side effects leaked in**

Run: `npx vitest run --project server`
Expected: PASS — 52 tests, unchanged. If adding these entrypoints broke tests, something now validates the environment at import time; find it and move it inside a function.

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts server/src/migrate.ts
git commit -m "feat: add server and migration entrypoints"
```

---

## Task 10: Client scaffold

**Files:**
- Create: `client/vite.config.ts`, `client/index.html`
- Create: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/index.css`
- Create: `client/test/setup.ts`, `client/test/scaffold.test.tsx`
- **Modify:** `vitest.config.ts` — add the client setup file
- Test: `client/test/scaffold.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `export default function App(): JSX.Element;` and a configured `QueryClient` in `main.tsx`.

> **No credentials needed.** The gate is that the app renders and a Tailwind utility class is applied.

- [ ] **Step 1: Create the Vite config**

`client/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin in development, so the server needs no CORS middleware.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
});
```

There is deliberately **no `tailwind.config.js`** and **no `postcss.config.js`** — Tailwind 4 is configured from CSS.

- [ ] **Step 2: Create the HTML entry and stylesheet**

`client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Task Board</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`client/src/index.css` — the whole Tailwind 4 configuration:

```css
@import "tailwindcss";

@theme {
  --color-surface: oklch(0.98 0.005 260);
  --color-surface-raised: oklch(1 0 0);
}
```

- [ ] **Step 3: Create `main.tsx` with the QueryClient**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App';
import './index.css';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 3 },
    // MUST stay 0. The toggle endpoint is not idempotent — a retry would flip
    // `completed` twice and land on the wrong state.
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Write the failing test**

`client/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Add the setup file to the client project in the root `vitest.config.ts`:

```ts
{ test: { name: 'client', root: './client', environment: 'jsdom', setupFiles: ['./test/setup.ts'], globals: true } },
```

`client/test/scaffold.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

describe('App scaffold', () => {
  it('renders the board heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /task board/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run --project client`
Expected: FAIL — `Cannot find module '../src/App'`.

- [ ] **Step 6: Create a minimal `App.tsx`**

```tsx
export default function App() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Task Board</h1>
    </main>
  );
}
```

- [ ] **Step 7: Verify the test passes and Tailwind compiles**

Run: `npx vitest run --project client`
Expected: PASS — 1 test.

Run: `npm run build -w client`
Expected: build succeeds and emits a CSS file containing generated utility classes. If Tailwind is misconfigured the build succeeds but the CSS is nearly empty — check that `dist/assets/*.css` is more than a few hundred bytes.

- [ ] **Step 8: Commit**

```bash
git add client/vite.config.ts client/index.html client/src client/test vitest.config.ts
git commit -m "feat: scaffold Vite + React + Tailwind client"
```

---

## Task 11: API transport layer

**Files:**
- Create: `client/src/api/tasksApi.ts`, `client/src/api/queryKeys.ts`
- Test: `client/test/tasksApi.test.ts`

**Interfaces:**
- Consumes: `TaskDto`, `CreateTaskInput`, `ApiErrorBody`, `ApiErrorCode` (Task 1).
- Produces — **exact names**, imported verbatim by Tasks 12 and 13:

```ts
export const taskKeys: { all: readonly ['tasks'] };

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];
}
export function listTasks(): Promise<TaskDto[]>;
export function createTask(input: CreateTaskInput): Promise<TaskDto>;
export function toggleTask(id: string): Promise<TaskDto>;
export function deleteTask(id: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

`client/test/tasksApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listTasks, createTask, toggleTask, deleteTask, ApiError } from '../src/api/tasksApi';

const TASK = {
  id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
  title: 'Buy milk',
  description: null,
  completed: false,
  createdAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:00:00.000Z',
};

function stubFetch(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('tasksApi', () => {
  it('listTasks GETs /api/tasks', async () => {
    const fetchMock = stubFetch([TASK]);
    await expect(listTasks()).resolves.toEqual([TASK]);
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'GET' }));
  });

  it('createTask POSTs a JSON body', async () => {
    const fetchMock = stubFetch(TASK, { status: 201 });
    await expect(createTask({ title: 'Buy milk' })).resolves.toEqual(TASK);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/tasks');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ title: 'Buy milk' });
  });

  it('toggleTask PATCHes the toggle path with no body', async () => {
    const fetchMock = stubFetch({ ...TASK, completed: true });
    await expect(toggleTask(TASK.id)).resolves.toMatchObject({ completed: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/tasks/${TASK.id}/toggle`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBeUndefined();
  });

  it('deleteTask DELETEs and resolves with nothing on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });
    vi.stubGlobal('fetch', fetchMock);

    // A 204 has no body — parsing it as JSON would throw.
    await expect(deleteTask(TASK.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`/api/tasks/${TASK.id}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('unwraps the error envelope into a typed ApiError', async () => {
    stubFetch(
      { error: { code: 'VALIDATION_ERROR', message: 'title must be 1-200 characters', details: [{ path: 'title', message: 'Too small' }] } },
      { status: 400 },
    );

    await expect(createTask({ title: '' })).rejects.toBeInstanceOf(ApiError);
    await expect(createTask({ title: '' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'title must be 1-200 characters',
    });
  });

  it('falls back to a generic message when the body is not an envelope', async () => {
    stubFetch('<html>502 Bad Gateway</html>', { status: 502 });
    await expect(listTasks()).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project client tasksApi`
Expected: FAIL — `Cannot find module '../src/api/tasksApi'`.

- [ ] **Step 3: Implement `queryKeys.ts`**

```ts
/** The single query key for the task list. */
export const taskKeys = {
  all: ['tasks'] as const,
};
```

- [ ] **Step 4: Implement `tasksApi.ts`**

```ts
import type {
  TaskDto, CreateTaskInput, ApiErrorBody, ApiErrorCode, ApiErrorDetail,
} from '@taskboard/shared';

/** A failed API call, with the server's error envelope unwrapped. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' && value !== null && 'error' in value &&
    typeof (value as ApiErrorBody).error?.message === 'string'
  );
}

/**
 * The only place in the client that knows about HTTP. Components and hooks
 * receive either data or an ApiError — never a Response.
 */
async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init);

  if (!response.ok) {
    let body: unknown;
    try { body = await response.json(); } catch { body = null; }

    if (isErrorBody(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message, body.error.details);
    }
    throw new ApiError(response.status, 'INTERNAL_ERROR', `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function listTasks(): Promise<TaskDto[]> {
  return request<TaskDto[]>('/api/tasks', { method: 'GET' });
}

export function createTask(input: CreateTaskInput): Promise<TaskDto> {
  return request<TaskDto>('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Flips `completed`. Sends no body — the endpoint toggles, it does not set. */
export function toggleTask(id: string): Promise<TaskDto> {
  return request<TaskDto>(`/api/tasks/${id}/toggle`, { method: 'PATCH' });
}

export function deleteTask(id: string): Promise<void> {
  return request<void>(`/api/tasks/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project client`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/api client/test/tasksApi.test.ts
git commit -m "feat: add client API transport layer"
```

---

## Task 12: Query and create hooks

**Files:**
- Create: `client/src/hooks/useTasksQuery.ts`, `client/src/hooks/useCreateTask.ts`
- Create: `client/test/renderWithClient.tsx`
- Test: `client/test/useCreateTask.test.tsx`

**Interfaces:**
- Consumes: `listTasks`, `createTask`, `taskKeys` (Task 11).
- Produces:

```ts
export function useTasksQuery(): UseQueryResult<TaskDto[], ApiError>;
export function useCreateTask(): UseMutationResult<TaskDto, ApiError, CreateTaskInput>;
export function renderWithClient(ui: ReactElement): { queryClient: QueryClient } & RenderResult;
export function createTestQueryClient(): QueryClient;
```

- [ ] **Step 1: Write the test helper**

`client/test/renderWithClient.tsx`:

```tsx
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
  return { queryClient, ...render(ui, { wrapper }) };
}
```

> **`vi.spyOn(api, 'listTasks')` — verified, not assumed.** This task and Tasks 13–15 all depend on
> spying against ESM namespace exports, which is a sharp edge that has shifted across Vitest majors.
> It was tested directly against Vitest 5.0.0 before implementation began, covering all four things
> these tasks need: the spy installs on a namespace export; a consumer module importing that function
> sees the replacement through its live binding; `mockResolvedValue` works on an async export; and
> `mockImplementation` can branch on an argument to return two *distinct unsettled* promises, later
> settling one resolved and one rejected — which is exactly Task 13's concurrent-rows pattern. All
> four pass. Ship these tasks as written.
>
> If a spy ever does fail with `Cannot redefine property`, replace that file's spies with
> `vi.mock('../src/api/tasksApi', ...)` — do not switch the hooks to indirect calls just to satisfy a
> test framework.

- [ ] **Step 2: Write the failing test**

`client/test/useCreateTask.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from './renderWithClient';
import { useTasksQuery } from '../src/hooks/useTasksQuery';
import { useCreateTask } from '../src/hooks/useCreateTask';
import * as api from '../src/api/tasksApi';

const TASK = {
  id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
  title: 'Buy milk', description: null, completed: false,
  createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z',
};

function wrapperWith(queryClient = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('useTasksQuery', () => {
  it('fetches the task list', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue([TASK]);
    const { wrapper } = wrapperWith();

    const { result } = renderHook(() => useTasksQuery(), { wrapper });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toEqual([TASK]);
  });

  it('surfaces an ApiError', async () => {
    vi.spyOn(api, 'listTasks').mockRejectedValue(new api.ApiError(500, 'INTERNAL_ERROR', 'boom'));
    const { wrapper } = wrapperWith();

    const { result } = renderHook(() => useTasksQuery(), { wrapper });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.error?.message).toBe('boom');
  });
});

describe('useCreateTask', () => {
  it('creates a task and invalidates the list', async () => {
    vi.spyOn(api, 'createTask').mockResolvedValue(TASK);
    const { wrapper, queryClient } = wrapperWith();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateTask(), { wrapper });
    result.current.mutate({ title: 'Buy milk' });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(api.createTask).toHaveBeenCalledWith({ title: 'Buy milk' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('exposes the error without inserting anything into the cache', async () => {
    vi.spyOn(api, 'createTask').mockRejectedValue(new api.ApiError(400, 'VALIDATION_ERROR', 'title required'));
    const { wrapper, queryClient } = wrapperWith();
    queryClient.setQueryData(['tasks'], []);

    const { result } = renderHook(() => useCreateTask(), { wrapper });
    result.current.mutate({ title: '' });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.error?.message).toBe('title required');
    expect(queryClient.getQueryData(['tasks'])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run --project client useCreateTask`
Expected: FAIL — `Cannot find module '../src/hooks/useTasksQuery'`.

- [ ] **Step 4: Implement the two hooks**

`client/src/hooks/useTasksQuery.ts`:

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { TaskDto } from '@taskboard/shared';
import { listTasks, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

/** The single source of task data. Retry stays at the default — GET is idempotent. */
export function useTasksQuery(): UseQueryResult<TaskDto[], ApiError> {
  return useQuery<TaskDto[], ApiError>({
    queryKey: taskKeys.all,
    queryFn: listTasks,
  });
}
```

`client/src/hooks/useCreateTask.ts`:

```ts
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { TaskDto, CreateTaskInput } from '@taskboard/shared';
import { createTask, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

/**
 * Invalidate-only, deliberately not optimistic: the server generates id,
 * createdAt, and updatedAt, so an optimistic insert would need a placeholder
 * row and reconciliation. A brief spinner on submit reads as normal.
 */
export function useCreateTask(): UseMutationResult<TaskDto, ApiError, CreateTaskInput> {
  const queryClient = useQueryClient();

  return useMutation<TaskDto, ApiError, CreateTaskInput>({
    // Arrow-wrapped, not passed by reference: TanStack Query 5 invokes
    // mutationFn(variables, { client }) with TWO arguments, which would leak the
    // second into spy assertions like toHaveBeenCalledWith({ title }).
    mutationFn: (input) => createTask(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project client`
Expected: PASS — 11 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks client/test/renderWithClient.tsx client/test/useCreateTask.test.tsx
git commit -m "feat: add task query and create hooks"
```

---

## Task 13: Toggle and delete hooks with per-entry optimistic rollback

**Files:**
- Create: `client/src/hooks/useToggleTask.ts`, `client/src/hooks/useDeleteTask.ts`
- Test: `client/test/useToggleTask.test.tsx`

**Interfaces:**
- Consumes: `toggleTask`, `deleteTask`, `taskKeys`, `ApiError` (Task 11); `createTestQueryClient` (Task 12).
- Produces:

```ts
export function useToggleTask(): UseMutationResult<TaskDto, ApiError, string, { previous: TaskDto | undefined }>;
export function useDeleteTask(): UseMutationResult<void, ApiError, string, { previous: TaskDto | undefined; index: number }>;
```

> **This is the highest-risk task in the plan.** TanStack's documented optimistic-update example snapshots the entire query result and restores it wholesale on error. That pattern is wrong here: two rows can be in flight at once, and restoring a whole-list snapshot erases a concurrent row's optimistic change. Each mutation must keep **only the affected task's prior value** in its context. Test 3 below is the regression test; a single-mutation test cannot catch this.

- [ ] **Step 1: Write the failing test**

`client/test/useToggleTask.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createTestQueryClient } from './renderWithClient';
import { useToggleTask } from '../src/hooks/useToggleTask';
import { useDeleteTask } from '../src/hooks/useDeleteTask';
import * as api from '../src/api/tasksApi';
import type { TaskDto } from '@taskboard/shared';

const A: TaskDto = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Task A', description: null, completed: false,
  createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z',
};
const B: TaskDto = { ...A, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Task B' };

function seeded(tasks: TaskDto[]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(['tasks'], tasks);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const read = (qc: QueryClient) => qc.getQueryData<TaskDto[]>(['tasks']) ?? [];
const byId = (qc: QueryClient, id: string) => read(qc).find((t) => t.id === id);

afterEach(() => { vi.restoreAllMocks(); });

describe('useToggleTask', () => {
  it('applies the flip optimistically, before the request resolves', async () => {
    let release!: (v: TaskDto) => void;
    vi.spyOn(api, 'toggleTask').mockReturnValue(new Promise((res) => { release = res; }));
    const { queryClient, wrapper } = seeded([A]);

    const { result } = renderHook(() => useToggleTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    // The cache reflects the flip while the request is still in flight.
    await waitFor(() => { expect(byId(queryClient, A.id)?.completed).toBe(true); });

    act(() => { release({ ...A, completed: true }); });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
  });

  it('rolls back on error', async () => {
    vi.spyOn(api, 'toggleTask').mockRejectedValue(new api.ApiError(404, 'NOT_FOUND', 'gone'));
    const { queryClient, wrapper } = seeded([A]);

    const { result } = renderHook(() => useToggleTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(byId(queryClient, A.id)?.completed).toBe(false);
  });

  it('rolling back a failed row does not erase a concurrent row still in flight', async () => {
    // REGRESSION TEST. A whole-list snapshot restore would revert B along with A,
    // because B's optimistic change landed after A's snapshot was taken.
    //
    // Note on calling mutate() twice on one hook instance: each call builds its own
    // Mutation carrying its own onMutate/onError context, which is exactly the
    // behaviour under test. `result.current` only ever tracks the LATEST mutation,
    // so it will not reflect A's failure — that is expected, not a bug. Assertions
    // therefore read the cache, never result.current. Do not "fix" this by
    // rendering two hook instances; that would stop testing shared-cache contention.
    let failA!: (e: unknown) => void;
    let passB!: (v: TaskDto) => void;

    vi.spyOn(api, 'toggleTask').mockImplementation((id: string) =>
      id === A.id
        ? new Promise((_res, rej) => { failA = rej; })
        : new Promise((res) => { passB = res; }),
    );

    const { queryClient, wrapper } = seeded([A, B]);
    const { result } = renderHook(() => useToggleTask(), { wrapper });

    act(() => { result.current.mutate(A.id); });
    await waitFor(() => { expect(byId(queryClient, A.id)?.completed).toBe(true); });

    act(() => { result.current.mutate(B.id); });
    await waitFor(() => { expect(byId(queryClient, B.id)?.completed).toBe(true); });

    act(() => { failA(new api.ApiError(500, 'INTERNAL_ERROR', 'boom')); });

    await waitFor(() => { expect(byId(queryClient, A.id)?.completed).toBe(false); });
    // B must still hold its optimistic value — it is in flight and will succeed.
    expect(byId(queryClient, B.id)?.completed).toBe(true);

    act(() => { passB({ ...B, completed: true }); });
  });

  it('leaves other rows untouched when one row toggles successfully', async () => {
    vi.spyOn(api, 'toggleTask').mockResolvedValue({ ...A, completed: true });
    const { queryClient, wrapper } = seeded([A, B]);

    const { result } = renderHook(() => useToggleTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(byId(queryClient, B.id)?.completed).toBe(false);
  });
});

describe('useDeleteTask', () => {
  it('removes the row optimistically', async () => {
    let release!: () => void;
    vi.spyOn(api, 'deleteTask').mockReturnValue(new Promise<void>((res) => { release = () => res(); }));
    const { queryClient, wrapper } = seeded([A, B]);

    const { result } = renderHook(() => useDeleteTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    await waitFor(() => { expect(read(queryClient)).toHaveLength(1); });
    expect(byId(queryClient, B.id)).toBeDefined();

    act(() => { release(); });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
  });

  it('reinserts only the removed row on error, at its original position', async () => {
    vi.spyOn(api, 'deleteTask').mockRejectedValue(new api.ApiError(404, 'NOT_FOUND', 'gone'));
    const { queryClient, wrapper } = seeded([A, B]);

    const { result } = renderHook(() => useDeleteTask(), { wrapper });
    act(() => { result.current.mutate(A.id); });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(read(queryClient).map((t) => t.id)).toEqual([A.id, B.id]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project client useToggleTask`
Expected: FAIL — `Cannot find module '../src/hooks/useToggleTask'`.

- [ ] **Step 3: Implement `useToggleTask.ts`**

```ts
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { TaskDto } from '@taskboard/shared';
import { toggleTask, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

interface ToggleContext {
  previous: TaskDto | undefined;
}

/**
 * Optimistically flips `completed`, rolling back ONE ENTRY on error.
 *
 * Deliberately not TanStack's documented whole-list snapshot pattern: two rows
 * can be in flight at once, and restoring a whole-list snapshot would erase a
 * concurrent row's optimistic change. Only the affected task's prior value is
 * kept in context.
 */
export function useToggleTask(): UseMutationResult<TaskDto, ApiError, string, ToggleContext> {
  const queryClient = useQueryClient();

  return useMutation<TaskDto, ApiError, string, ToggleContext>({
    // Arrow-wrapped — see useCreateTask: mutationFn receives (variables, { client }).
    mutationFn: (id) => toggleTask(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });

      const list = queryClient.getQueryData<TaskDto[]>(taskKeys.all);
      const previous = list?.find((task) => task.id === id);

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) =>
        current?.map((task) =>
          task.id === id ? { ...task, completed: !task.completed } : task,
        ),
      );

      return { previous };
    },

    onError: (_err, id, context) => {
      // Restore only this task, leaving every other row's in-flight state intact.
      const previous = context?.previous;
      if (!previous) return;

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) =>
        current?.map((task) => (task.id === id ? previous : task)),
      );
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
```

- [ ] **Step 4: Implement `useDeleteTask.ts`**

```ts
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { TaskDto } from '@taskboard/shared';
import { deleteTask, type ApiError } from '../api/tasksApi';
import { taskKeys } from '../api/queryKeys';

interface DeleteContext {
  previous: TaskDto | undefined;
  index: number;
}

/**
 * Optimistically removes the row, reinserting ONLY that row at its original
 * position on error. Same reasoning as useToggleTask: never restore a
 * whole-list snapshot, or concurrent in-flight changes get erased.
 */
export function useDeleteTask(): UseMutationResult<void, ApiError, string, DeleteContext> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string, DeleteContext>({
    // Arrow-wrapped — see useCreateTask: mutationFn receives (variables, { client }).
    mutationFn: (id) => deleteTask(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });

      const list = queryClient.getQueryData<TaskDto[]>(taskKeys.all) ?? [];
      const index = list.findIndex((task) => task.id === id);
      const previous = index >= 0 ? list[index] : undefined;

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) =>
        current?.filter((task) => task.id !== id),
      );

      return { previous, index };
    },

    onError: (_err, _id, context) => {
      if (!context?.previous || context.index < 0) return;

      queryClient.setQueryData<TaskDto[]>(taskKeys.all, (current) => {
        const next = [...(current ?? [])];
        next.splice(context.index, 0, context.previous!);
        return next;
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project client`
Expected: PASS — 17 tests. The concurrent-rows test must pass; if it fails with `Task B completed: false`, the rollback is restoring a whole-list snapshot.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useToggleTask.ts client/src/hooks/useDeleteTask.ts client/test/useToggleTask.test.tsx
git commit -m "feat: add toggle and delete hooks with per-entry optimistic rollback"
```

---

## Task 14: Task list presentation

**Files:**
- Create: `client/src/components/TaskItem.tsx`, `client/src/components/TaskList.tsx`, `client/src/components/EmptyState.tsx`
- Test: `client/test/TaskItem.test.tsx`

**Interfaces:**
- Consumes: `useToggleTask`, `useDeleteTask` (Task 13); `TaskDto` (Task 1).
- Produces:

```tsx
export function TaskItem({ task }: { task: TaskDto }): JSX.Element;
export function TaskList({ tasks }: { tasks: TaskDto[] }): JSX.Element;
export function EmptyState({ filter }: { filter: Filter }): JSX.Element;
export type Filter = 'all' | 'active' | 'done';
```

> `TaskItem` calls `useToggleTask()` and `useDeleteTask()` itself, so each row owns its own mutation instance and gets per-row `isPending` for free. No shared pending-id set.

- [ ] **Step 1: Write the failing test**

`client/test/TaskItem.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithClient } from './renderWithClient';
import { TaskItem } from '../src/components/TaskItem';
import * as api from '../src/api/tasksApi';
import type { TaskDto } from '@taskboard/shared';

const TASK: TaskDto = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Buy milk', description: null, completed: false,
  createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z',
};

afterEach(() => { vi.restoreAllMocks(); });

describe('TaskItem', () => {
  it('renders the title', () => {
    renderWithClient(<TaskItem task={TASK} />);
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it('renders a description when present', () => {
    renderWithClient(<TaskItem task={{ ...TASK, description: 'from the corner shop' }} />);
    expect(screen.getByText('from the corner shop')).toBeInTheDocument();
  });

  it('renders no description element when it is null', () => {
    renderWithClient(<TaskItem task={TASK} />);
    expect(screen.queryByTestId('task-description')).not.toBeInTheDocument();
  });

  it('shows an unchecked checkbox for an active task', () => {
    renderWithClient(<TaskItem task={TASK} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('strikes through a completed task', () => {
    renderWithClient(<TaskItem task={{ ...TASK, completed: true }} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByTestId('task-title').className).toContain('line-through');
  });

  it('calls toggleTask when the checkbox is clicked', async () => {
    const spy = vi.spyOn(api, 'toggleTask').mockResolvedValue({ ...TASK, completed: true });
    renderWithClient(<TaskItem task={TASK} />);

    await userEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => { expect(spy).toHaveBeenCalledWith(TASK.id); });
  });

  it('disables the checkbox while its own toggle is pending', async () => {
    vi.spyOn(api, 'toggleTask').mockReturnValue(new Promise(() => {}));  // never settles
    renderWithClient(<TaskItem task={TASK} />);

    await userEvent.click(screen.getByRole('checkbox'));
    // Prevents a rapid double-click queueing two flips of a non-idempotent endpoint.
    await waitFor(() => { expect(screen.getByRole('checkbox')).toBeDisabled(); });
  });

  it('calls deleteTask when the delete button is clicked', async () => {
    const spy = vi.spyOn(api, 'deleteTask').mockResolvedValue(undefined);
    renderWithClient(<TaskItem task={TASK} />);

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => { expect(spy).toHaveBeenCalledWith(TASK.id); });
  });

  it('gives the delete button an accessible name naming the task', () => {
    renderWithClient(<TaskItem task={TASK} />);
    expect(screen.getByRole('button', { name: 'Delete Buy milk' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project client TaskItem`
Expected: FAIL — `Cannot find module '../src/components/TaskItem'`.

- [ ] **Step 3: Implement `TaskItem.tsx`**

```tsx
import type { TaskDto } from '@taskboard/shared';
import { useToggleTask } from '../hooks/useToggleTask';
import { useDeleteTask } from '../hooks/useDeleteTask';

/**
 * One row. Owns its own mutation instances, so `isPending` is per-row and no
 * shared pending-id set is needed.
 */
export function TaskItem({ task }: { task: TaskDto }) {
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  const busy = toggle.isPending || remove.isPending;

  return (
    <li className="flex items-start gap-3 border-b border-neutral-200 px-1 py-3 last:border-0 dark:border-neutral-800">
      <input
        type="checkbox"
        checked={task.completed}
        disabled={busy}
        onChange={() => { toggle.mutate(task.id); }}
        aria-label={`Mark ${task.title} as ${task.completed ? 'active' : 'done'}`}
        className="mt-1 size-4 shrink-0 accent-neutral-900 disabled:opacity-40 dark:accent-neutral-100"
      />

      <div className="min-w-0 flex-1">
        <p
          data-testid="task-title"
          className={
            task.completed
              ? 'line-through text-neutral-400 dark:text-neutral-600'
              : 'text-neutral-900 dark:text-neutral-100'
          }
        >
          {task.title}
        </p>
        {task.description !== null && (
          <p
            data-testid="task-description"
            className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400"
          >
            {task.description}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => { remove.mutate(task.id); }}
        aria-label={`Delete ${task.title}`}
        className="shrink-0 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-neutral-800"
      >
        ✕
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Implement `TaskList.tsx` and `EmptyState.tsx`**

`client/src/components/EmptyState.tsx`:

```tsx
export type Filter = 'all' | 'active' | 'done';

const MESSAGES: Record<Filter, string> = {
  all: 'No tasks yet. Add one above to get started.',
  active: 'Nothing active — everything is done.',
  done: 'Nothing completed yet.',
};

export function EmptyState({ filter }: { filter: Filter }) {
  return (
    <p className="px-1 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
      {MESSAGES[filter]}
    </p>
  );
}
```

`client/src/components/TaskList.tsx`:

```tsx
import type { TaskDto } from '@taskboard/shared';
import { TaskItem } from './TaskItem';

export function TaskList({ tasks }: { tasks: TaskDto[] }) {
  return (
    <ul className="mt-2">
      {tasks.map((task) => <TaskItem key={task.id} task={task} />)}
    </ul>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project client`
Expected: PASS — 26 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/components client/test/TaskItem.test.tsx
git commit -m "feat: add task list presentation components"
```

---

## Task 15: Form, filters, error banner, and App wiring

**Files:**
- Create: `client/src/components/TaskForm.tsx`, `client/src/components/FilterTabs.tsx`, `client/src/components/ErrorBanner.tsx`
- **Modify:** `client/src/App.tsx` — replace the scaffold with the full board
- **Modify:** `client/test/scaffold.test.tsx` — it now needs a QueryClientProvider
- Test: `client/test/App.test.tsx`

**Interfaces:**
- Consumes: `useTasksQuery`, `useCreateTask` (Task 12); `TaskList`, `EmptyState`, `Filter` (Task 14).
- Produces:

```tsx
export function TaskForm(): JSX.Element;
export function FilterTabs({ value, onChange, counts }: {
  value: Filter; onChange: (f: Filter) => void; counts: Record<Filter, number>;
}): JSX.Element;
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

`client/test/App.test.tsx`:

```tsx
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

  it('surfaces a query failure in the error banner', async () => {
    vi.spyOn(api, 'listTasks').mockRejectedValue(new api.ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    renderWithClient(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project client App`
Expected: FAIL — the scaffold `App` renders only a heading, so every query fails to find its element.

- [ ] **Step 3: Implement `ErrorBanner.tsx` and `FilterTabs.tsx`**

`client/src/components/ErrorBanner.tsx`:

```tsx
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="shrink-0 opacity-60 hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  );
}
```

`client/src/components/FilterTabs.tsx`:

```tsx
import type { Filter } from './EmptyState';

const TABS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
];

/** Filtering is client-side, so the API stays at exactly four endpoints. */
export function FilterTabs({
  value, onChange, counts,
}: { value: Filter; onChange: (f: Filter) => void; counts: Record<Filter, number> }) {
  return (
    <div role="tablist" aria-label="Filter tasks" className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          onClick={() => { onChange(tab.value); }}
          className={
            value === tab.value
              ? '-mb-px border-b-2 border-neutral-900 px-3 py-2 text-sm font-medium text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
              : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }
        >
          {tab.label}
          <span className="ml-1.5 text-xs opacity-60">{counts[tab.value]}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement `TaskForm.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { useCreateTask } from '../hooks/useCreateTask';
import { ErrorBanner } from './ErrorBanner';

/** Creates a task. Title and description are write-once — nothing edits them later. */
export function TaskForm() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateTask();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === '') return;

    create.mutate(
      { title: title.trim(), description: description.trim() || undefined },
      {
        onSuccess: () => {
          setTitle('');
          setDescription('');
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-2">
      {create.isError && <ErrorBanner message={create.error.message} onDismiss={() => { create.reset(); }} />}

      <div className="flex gap-2">
        <input
          id="task-title"
          aria-label="Task title"
          value={title}
          onChange={(e) => { setTitle(e.target.value); }}
          placeholder="What needs doing?"
          maxLength={200}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>

      <textarea
        id="task-description"
        aria-label="Description (optional)"
        value={description}
        onChange={(e) => { setDescription(e.target.value); }}
        placeholder="Description (optional)"
        rows={2}
        maxLength={2000}
        className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
      />
    </form>
  );
}
```

- [ ] **Step 5: Replace `App.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useTasksQuery } from './hooks/useTasksQuery';
import { TaskForm } from './components/TaskForm';
import { FilterTabs } from './components/FilterTabs';
import { TaskList } from './components/TaskList';
import { EmptyState, type Filter } from './components/EmptyState';
import { ErrorBanner } from './components/ErrorBanner';

export default function App() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data: tasks, isPending, isError, error } = useTasksQuery();

  const all = useMemo(() => tasks ?? [], [tasks]);

  const counts = useMemo<Record<Filter, number>>(() => ({
    all: all.length,
    active: all.filter((t) => !t.completed).length,
    done: all.filter((t) => t.completed).length,
  }), [all]);

  const visible = useMemo(() => {
    if (filter === 'active') return all.filter((t) => !t.completed);
    if (filter === 'done') return all.filter((t) => t.completed);
    return all;
  }, [all, filter]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Task Board
      </h1>

      <TaskForm />

      {isError && <ErrorBanner message={error.message} />}

      <FilterTabs value={filter} onChange={setFilter} counts={counts} />

      {isPending ? (
        <p className="px-1 py-8 text-center text-sm text-neutral-500">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <TaskList tasks={visible} />
      )}

      <p className="mt-4 px-1 text-sm text-neutral-500 dark:text-neutral-400">
        {counts.active} of {counts.all} remaining
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Update the scaffold test, which now needs a provider**

Replace the body of `client/test/scaffold.test.tsx`:

```tsx
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
```

- [ ] **Step 7: Run the whole suite and the typecheck**

Run: `npm test`
Expected: PASS — 88 tests across the three projects (2 shared, 52 server, 34 client).

Run: `npm run typecheck`
Expected: PASS with no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src client/test
git commit -m "feat: add task form, filters, error banner, and board wiring"
```

---

## Task 16: Manual verification against Supabase

**Files:**
- Create: `README.md`
- Test: manual — this is the only task requiring real credentials

**Interfaces:**
- Consumes: everything.
- Produces: a verified running application.

> **This is where the automated suite's known gap gets closed.** No test in Tasks 1–15 executes SQL, so the migration, the `underscored` column mapping, and the `SET completed = NOT completed … RETURNING *` statement have never run. A mocked model will happily confirm a toggle that fails against real Postgres.

- [ ] **Step 1: Write the README**

`README.md`:

````markdown
# Task Board

A single-user task board. Express 5 + Sequelize 6 over Supabase Postgres, with a
React 19 + TanStack Query client.

## Setup

1. Create a Postgres database in Supabase.
2. Copy `.env.example` to `.env` **at the repository root** and fill in the five
   `DB_*` variables from your Supabase project's connection settings. The server
   scripts load it via `--env-file-if-exists=../.env`, relative to `server/`.
3. Install and migrate:

```bash
npm install
npm run migrate
npm run dev
```

The API listens on `http://localhost:3000` and the client on `http://localhost:5173`,
which proxies `/api` to the server.

## API

| Method | Path | Body | Success |
|---|---|---|---|
| `POST` | `/api/tasks` | `{ title, description? }` | `201` + task |
| `GET` | `/api/tasks` | — | `200` + task array, newest first |
| `PATCH` | `/api/tasks/:id/toggle` | none | `200` + updated task |
| `DELETE` | `/api/tasks/:id` | — | `204` |

Tasks are write-once: title and description are set at creation and never edited.

## Commands

| Command | Effect |
|---|---|
| `npm run dev` | server and client together |
| `npm run migrate` | apply pending migrations |
| `npm run migrate:down` | roll back one migration |
| `npm test` | full test suite |
| `npm run typecheck` | type-check every workspace |
| `npm run build` | compile server, build client |

## A note on TLS

Supabase requires SSL, and its pooler presents a certificate that is not in Node's
default trust store. By default the connection is **encrypted but not verified**.
Set `DB_SSL_CA` to the path of Supabase's CA certificate to enable full verification.

## Testing gap

No automated test executes SQL — the model is injected as a fake. The migration,
the snake_case column mapping, and the atomic toggle statement are covered by the
manual checklist in `docs/superpowers/specs/2026-09-07-task-board-design.md`.
Run it after any change to the model, the migration, or the toggle query.
````

- [ ] **Step 2: Run the migration against real Supabase**

Run: `npm run migrate`
Expected: `Applied: 001-create-tasks`.

In the Supabase table editor, confirm `tasks` and `SequelizeMeta` both exist.

- [ ] **Step 3: Verify the column naming**

In the Supabase table editor, confirm the columns are `id`, `title`, `description`, `completed`, `created_at`, `updated_at` — **snake_case, not camelCase**. If they are camelCase, `underscored: true` is missing from the model.

- [ ] **Step 4: Verify create, with and without a description**

Run: `npm run dev`, open `http://localhost:5173`.

- Add a task with a title only. It appears in the list, unchecked. In Supabase, its `description` is `NULL` — **not** an empty string.
- Add a task with a title and a description. Both persist and the description renders under the title.

- [ ] **Step 5: Verify the toggle round trip**

- Click the checkbox. It flips **immediately**, before the network settles — that is the optimistic update.
- Refresh the browser. The task is still completed, which proves the `NOT completed` statement actually executed. If it reverts, the atomic update silently failed — apply the raw-query fallback in the spec's "Implementation note".
- Toggle it back and refresh again. It is active.

- [ ] **Step 6: Verify delete and the filters**

- Delete a task. The row disappears and stays gone after a refresh.
- Click through All / Active / Done and confirm each shows the right subset and the right empty-state message.

- [ ] **Step 7: Verify error handling against a stopped server**

Stop the API server, leaving the client running. Click a toggle.
Expected: the checkbox flips, then rolls back, and an error banner appears. Other rows are unaffected.

Restart the server and confirm the list recovers.

- [ ] **Step 8: Verify rollback**

Run: `npm run migrate:down`
Expected: the `tasks` table is dropped cleanly, with no foreign-key or index errors.

Then run `npm run migrate` again to restore it.

- [ ] **Step 9: Commit**

```bash
git add README.md
git commit -m "docs: add README and record manual verification"
```

---

## Verification summary

After Task 16, all of the following hold:

- `npm test` passes — 88 tests: 2 shared, 52 server, 34 client
- `npm run typecheck` passes with no errors
- `npm run build` produces `server/dist` and `client/dist`; `shared` has no `dist`
- All nine manual checklist steps from the spec pass against real Supabase
- The four endpoints behave as specified, each from its own route module
