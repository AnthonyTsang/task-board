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
npm run dev                   # API on :3000, client on :5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the API, so the
browser sees one origin and the server needs no CORS middleware.

Only the database is containerised. The API and Vite stay on the host so `npm run dev`
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
npm run dev                   # or: npm run build && npm start
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

## Commands

| Command | Effect |
|---|---|
| `npm run dev` | server and client together |
| `npm run migrate` | apply pending migrations |
| `npm run migrate:down` | roll back one migration |
| `npm test` | full test suite |
| `npm run typecheck` | type-check every workspace |
| `npm run build` | compile server, build client |

## Testing

`npm test` runs 111 tests across three workspaces. **No automated test executes SQL** —
the model is injected as a fake, so the suite is fast, offline, and needs no
credentials.

That is a deliberate tradeoff with a real cost: the migration, the snake_case column
mapping, and the atomic toggle statement are not covered by it. They are covered by the
manual checklist in `docs/superpowers/specs/2026-09-07-task-board-design.md`, which is
now cheap to rehearse against the local container before running it against Supabase.

Run that checklist after any change to the model, the migration, or the toggle query.
