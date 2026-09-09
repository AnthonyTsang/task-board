# Task Board

A single-user task board. Express 5 + Sequelize 6 over Postgres, with a React 19 +
TanStack Query client.

Tasks are **write-once**: title and description are set at creation and never edited.
The only mutations afterwards are toggle and delete.

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
