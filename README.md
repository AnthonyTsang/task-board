# Task Board

A single-user task board. Express 5 + Sequelize 6 over Postgres, with a React 19 +
TanStack Query client.

Tasks are **write-once**: title and description are set at creation and never edited.
The only mutations afterwards are toggle and delete.

## Layout

```
shared/src/          types-only: TaskDto, CreateTaskInput, the error envelope. Server and
                     client both import it, so the wire shape has exactly one definition.

server/src/
  app.ts             assembles the middleware stack: JSON, API, client, 404, errors. Never
                     calls listen() — that split is what lets Supertest drive the real app
                     without binding a port.
  server.ts          the entrypoint. Loads env, connects, builds the app, listens, and
                     wires the signal handlers.
  client.ts          serves the client: Vite in development, client/dist in production.
  routes/            one module per operation — createTask, listTasks, toggleTask,
                     deleteTask. index.ts composes the four into the router app.ts mounts
                     at /api/tasks.
  db/                sequelize.ts builds the connection; constructing it opens nothing, so
                     a caller needs no reachable database. umzug.ts builds the migrator and
                     records what it applied in a SequelizeMeta table, which is why
                     `npm run migrate` is safe to re-run.
  migrations/        the numbered schema changes umzug applies. A sibling of db/, not part
                     of it — the migrator globs upward into here.
  models/Task.ts     the Sequelize model, plus the toDto() mapping from row to wire.
  config/env.ts      validates the environment once, at startup, naming what is wrong.
  lib/               HttpError, the zod request validator, and graceful shutdown.
  middleware/        the error handler that turns anything thrown into the JSON envelope.

client/src/
  api/               tasksApi.ts is the only place in the client that knows about HTTP:
                     hooks get data or an ApiError back, never a Response. queryKeys.ts
                     holds the cache keys both sides of a mutation agree on.
  hooks/             one TanStack Query hook per operation — one query, three mutations.
                     The mutations own the optimistic updates and their rollback.
  components/        six presentational pieces. TaskItem holds its own mutation instances,
                     so `isPending` is per row and no shared pending-id set is needed.
  App.tsx            owns the filter state and composes the rest.

docs/superpowers/    the approved design spec and the implementation plan built from it.
                     History rather than configuration — but the spec also carries the
                     manual verification checklist that Testing below refers to.
docs/transcript.txt  the transcript between the developer and Claude Code.
```

Each workspace keeps its tests in a sibling `test/` directory rather than beside the
source. The sections below go deeper where it matters: [API](#api),
[Serving the client](#serving-the-client), [Shutdown](#shutdown),
[Environment variables](#environment-variables), [A note on TLS](#a-note-on-tls).

## Quick start — local development

Runs against a Postgres container. Nothing touches your production database.

```bash
docker compose up -d          # start Postgres on localhost:54322
cp .env.docker.example .env   # local connection settings
npm install
npm run migrate               # create the tasks table
npm run dev                   # everything on :3000
```

Open http://localhost:3000. The Express server serves the client as well as the API,
so there is one process, one port, and one origin — no proxy and no CORS middleware.

In development it runs Vite in middleware mode, so you still get transforms and hot
module replacement; in production it serves `client/dist`. See
[Serving the client](#serving-the-client).

Only the database is containerised. The server stays on the host so `npm run dev`
keeps hot reload.

| Command | Effect |
|---|---|
| `docker compose up -d` | start the database |
| `docker compose down` | stop it, keeping your data |
| `docker compose down -v` | stop it and **delete** all local data |
| `docker compose logs -f db` | tail the database log |

The container listens on host port **54322**, not 5432, so it cannot collide with a
local Postgres install and it is obvious when a `.env` still points at Supabase.
To match your Supabase major version, set `POSTGRES_IMAGE` (e.g.
`POSTGRES_IMAGE=postgres:15-alpine docker compose up -d`).

## Production — Supabase

```bash
cp .env.example .env          # then fill in your Supabase values
npm run migrate
npm run build && npm start    # serves the built client from client/dist
```

Leave `DB_SSL` unset for Supabase. It defaults to `require`.

Production is two services: the app runs on Render, the database is Supabase. The
server binds `0.0.0.0` rather than localhost because Render's router will not reach
a process listening only on the loopback interface.

That sequence is the manual form of what pushing to `main` now does on its own — see
[Continuous deployment](#continuous-deployment).

## Continuous deployment

Two workflows in `.github/workflows/`:

| Workflow | Trigger | Effect |
|---|---|---|
| `deploy.yml` | push to `main` | install, test, migrate, then trigger a Render deploy |
| `rollback.yml` | manual (`workflow_dispatch`) | roll back one migration |

Deploy runs `npm ci` → `npm test` → write `.env` → `npm run migrate` → `POST` to the
Render deploy hook. The test step needs no credentials: no automated test executes
SQL (see [Testing](#testing)), so it gates the push without touching the database.

The `.env` the workflow writes lives only on the runner, and only so the migration
step can connect. It never reaches Render — the deployed app reads its environment
from Render's own configuration, and the build and start commands are set in the
Render dashboard, not in this repository.

Two consequences worth holding on to:

- **Migrations run against production before the new code is live.** For the length
  of the deploy window the old release is talking to the new schema, so every
  migration has to be backward compatible with the release it replaces. Dropping or
  renaming a column breaks the running app several minutes before the code that
  stopped reading it arrives; do it in two deploys, not one.
- **The runner connects to the production database directly**, so `DB_HOST` has to
  accept connections from GitHub's runner addresses. Supabase's pooler does.

The final `curl` is fire-and-forget: a green Deploy means Render accepted the
trigger, not that the deploy succeeded. Render's own dashboard is the record of that.

Neither workflow pins a Node version, so both run on whatever the runner ships, and
neither runs `npm run build` — Render builds the client and server itself.

### Secrets

Set all seven in the repository's Actions secrets:

| Secret | Purpose |
|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | the migration's connection to Supabase |
| `PORT` | written into the runner's `.env` |
| `RENDER_DEPLOY_HOOK_URL` | the Render service's deploy hook |

`DB_SSL` is deliberately absent. Left unset it defaults to `require`, which is what
Supabase needs; adding it as a secret only creates a way to get it wrong.

`PORT` is optional to the app — it defaults to 3000 — but **required here**. The
workflow writes the line unconditionally, so an unset secret produces `PORT=`, and
an empty string is not the same as an absent one: validation rejects it with
`PORT: Too small: expected number to be >0` and the Migrate step fails. Better to
delete the line than to set the secret: `migrate.ts` validates the whole environment
but never reads the port, so the secret exists only to satisfy a check for a value
nothing in that step uses — and since this `.env` never leaves the runner, it is not
where the deployed app's port comes from anyway.

### Rolling back

`rollback.yml` runs `npm run migrate:down`: one migration, nothing else. It does not
redeploy or revert code, despite the job being named `deploy` — to move the code back,
redeploy an earlier commit from Render. It is dispatch-only so it cannot fire on a
push, which is the point: it is a deliberate action taken during an incident, not
part of the pipeline.

## Switching between them

`.env` is the single active configuration; `.env.docker.example` and `.env.example`
are the two templates. Copy whichever you want over `.env`. `.env` is gitignored.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DB_HOST` | yes | — | database host |
| `DB_PORT` | yes | — | database port (`54322` locally, `5432` on Supabase) |
| `DB_NAME` | yes | — | database name |
| `DB_USER` | yes | — | database user |
| `DB_PASSWORD` | yes | — | database password |
| `PORT` | no | `3000` | port the API listens on |
| `DB_SSL` | no | `require` | `require` or `disable` |
| `DB_SSL_CA` | no | unset | path to a CA certificate; enables full TLS verification |

A missing or malformed variable exits immediately with a message naming it, rather
than failing later inside a query.

### A note on TLS

`DB_SSL` defaults to `require` deliberately: the local container does not speak TLS
and needs `disable`, but forgetting the variable in production must never silently
drop encryption. It is an enum, so `DB_SSL=false` or `=off` is rejected rather than
quietly treated as a default you did not intend.

Against Supabase with no `DB_SSL_CA`, the connection is **encrypted but the server's
identity is not verified** — Supabase's pooler presents a certificate that is not in
Node's default trust store. Set `DB_SSL_CA` to Supabase's downloadable CA certificate
to enable full verification.

## API

| Method | Path | Body | Success |
|---|---|---|---|
| `POST` | `/api/tasks` | `{ title, description? }` | `201` + task |
| `GET` | `/api/tasks` | — | `200` + task array, newest first |
| `PATCH` | `/api/tasks/:id/toggle` | none | `200` + updated task |
| `DELETE` | `/api/tasks/:id` | — | `204` |

Every error response uses one envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

`code` is one of `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `INTERNAL_ERROR` (500).

The toggle endpoint takes no body — it flips `completed` rather than setting it, as a
single atomic `UPDATE ... SET completed = NOT completed`. That makes it **not
idempotent**, which is why the client pins TanStack Query's mutation `retry` to `0`.

## Serving the client

One server serves both the API and the client. Which client depends on how the
server was started:

| Command | Mode | Client |
|---|---|---|
| `npm run dev` | development | Vite in middleware mode — transforms and HMR |
| `npm start` | production | the built files in `client/dist` |

The switch is the `--dev` flag in the server's `dev` script, not an environment
variable. `.env` is copied between the local and Supabase templates, so a mode
stored there would change how the client is served every time you swapped
templates. The flag belongs to the invocation.

Vite is imported dynamically, so production never loads it — `npm start` runs the
compiled output with devDependencies absent.

Requests under `/api` never reach the client layer. Vite's SPA fallback would
otherwise answer a mistyped `/api/taks` from a browser with `index.html`, so a bad
API path would return HTML in development and a JSON 404 in production. Everything
else falls through to `index.html`, so refreshing on a client route works.

`npm run build` must run before `npm start`. Without `client/dist` the server refuses
to start and names the missing file — rather than starting and turning every page
request into a 500, which is what a missing build looks like to an error handler.

> **Note:** the server's file watcher excludes `client/`. Vite compiles
> `vite.config.ts` to a temp file under `client/node_modules/.vite-temp/` and then
> deletes it; a watcher that sees that deletion restarts the server, which makes Vite
> do it again — an endless restart loop. Client changes are Vite's job anyway.

## Shutdown

On `SIGINT` or `SIGTERM` the API stops accepting connections, lets in-flight
requests finish, closes the database pool, and exits 0. If that has not completed
within 10 seconds it logs the timeout and exits 1 rather than hanging.

The order matters: closing the pool before requests drain would turn the last few
into connection errors. A second Ctrl-C during the drain is ignored, so it cannot
race the first shutdown's exit code.

`SIGTERM` is what a container runtime sends and is the reason this exists. Windows
never delivers it, so verify locally with Ctrl-C — and against
`npx tsx src/server.ts --dev` from `server/` rather than `npm run dev`, since
`tsx watch` intercepts signals to restart the child. Keep the `--dev`: without it
that command needs a client build.

## Commands

| Command | Effect |
|---|---|
| `npm run dev` | API and client on one port, with HMR |
| `npm start` | the same, serving the built client |
| `npm run migrate` | apply pending migrations |
| `npm run migrate:down` | roll back one migration |
| `npm test` | full test suite |
| `npm run typecheck` | type-check every workspace |
| `npm run build` | compile server, build client |

## Testing

`npm test` runs 136 tests across three workspaces. **No automated test executes SQL** —
the model is injected as a fake, so the suite is fast, offline, and needs no
credentials.

That is a deliberate tradeoff with a real cost: the migration, the snake_case column
mapping, and the atomic toggle statement are not covered by it. They are covered by the
manual checklist in `docs/superpowers/specs/2026-09-07-task-board-design.md`, which is
now cheap to rehearse against the local container before running it against Supabase.

Run that checklist after any change to the model, the migration, or the toggle query.

The same applies to the development client path. The static path and the `/api` guard
are covered by tests against a fixture build, but nothing spins up Vite, so changes to
`devClientMiddleware` or to `vite.config.ts` need `npm run dev` and a page load to
verify.
