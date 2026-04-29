# tut

Chinese version: [README-ZH.md](./README-ZH.md)

`tut` is a token usage tracking service for local AI coding agents. It runs on Cloudflare Workers, stores normalized events in D1, exposes query APIs, and ships with a built-in dashboard.

## Features

- Normalize usage events into a shared schema: `model`, `provider`, `source`, `input`, `output`, `cacheRead`, `cacheWrite`
- Ingest a single event, an array of events, or `{ "events": [...] }` / `{ "data": [...] }`
- Query raw events, summaries, grouped breakdowns, and ranked dimensions
- View usage trends in the built-in dashboard
- Sync local agent logs with the bundled local sync script

## Built-in Source Support

The bundled `scripts/sync-local.mjs` currently supports:

- `claude`: `~/.claude/projects/**/*.jsonl`
- `codex`: `~/.codex/sessions/**/*.jsonl` and `~/.codex/archived_sessions/**/*.jsonl`
- `hermes`: `$HERMES_HOME/state.db` with fallback to `~/.hermes/state.db` (token fields only)
- `opencode`: `~/.local/share/opencode/opencode.db` plus legacy JSON storage

Not currently supported by the bundled sync script:

- `droid`
- `pi`
- `kimi`

The ingest API itself is generic. If another tool can send valid usage events to `POST /api/v1/usage`, `tut` can store and query them even without a built-in local parser.

## Requirements

- Node.js and npm for the Worker app
- Bun for `npm run sync:local`
- Cloudflare Wrangler
- A Cloudflare D1 database

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create a D1 database named `tut`:

```bash
npx wrangler d1 create tut
```

3. Put the returned `database_id` into `d1_databases[0].database_id` in [wrangler.jsonc](./wrangler.jsonc).

4. Apply migrations:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

If you only need local development, the local migration is enough. Run the remote migration before deploying.

5. Configure the ingest API key:

```bash
npx wrangler secret put INGEST_API_KEY
```

6. Start the local dev server:

```bash
npm run dev
```

If you use a different D1 database name, update the migration scripts in [package.json](./package.json) or run Wrangler manually.

## Dashboard

The dashboard is served at `/`.

- `?lang=en` or `?lang=zh`
- `?theme=light` or `?theme=dark`
- Theme and language preferences are persisted in `localStorage`

Examples:

```text
/
/?lang=zh
/?theme=dark
/?lang=zh&theme=dark
```

## API

### `GET /health`

Returns service health and whether `INGEST_API_KEY` is configured.

### `POST /api/v1/usage`

Ingest usage events.

- Accepts a single object, an array, `{ "events": [...] }`, or `{ "data": [...] }`
- Maximum `1000` events per request
- Authentication:
  - `Authorization: Bearer <INGEST_API_KEY>`
  - `x-api-key: <INGEST_API_KEY>`

Event fields:

- Required: `model`, `provider`, `source`
- Token counters: `input`, `output`, `cacheRead`, `cacheWrite`
- Optional: `eventId`, `occurredAt`, `metadata`

Metadata notes:

- `metadata` can be a JSON object, array, or JSON-encoded string
- Sensitive filepath keys such as `filePath`, `filepath`, and `file_path` are stripped before storage

Example:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/usage \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <INGEST_API_KEY>' \
  -d '{
    "events": [
      {
        "eventId": "evt_001",
        "model": "claude-sonnet-4",
        "provider": "anthropic",
        "source": "claude",
        "input": 1200,
        "output": 380,
        "cacheRead": 900,
        "cacheWrite": 120,
        "occurredAt": "2026-03-06T00:30:00Z",
        "metadata": { "project": "tut" }
      }
    ]
  }'
```

### `GET /api/v1/usage`

Returns paginated event details.

Common query params:

- `model`, `provider`, `source` as comma-separated filters
- `from`, `to`
- `limit`, `offset`
- `order=asc|desc`
- `sortBy=occurredAt|total|input|output|cacheRead|cacheWrite|createdAt`

### `GET /api/v1/usage/summary`

Returns aggregate totals and time bounds for the current filter set.

### `GET /api/v1/usage/breakdown`

Returns grouped aggregates.

- `by=source,provider,model,date` in any combination
- `sortBy=tokens|events|input|output|cacheRead|cacheWrite|source|provider|model|date`
- `order=asc|desc`
- `limit`, `offset`

### `GET /api/v1/usage/dimensions`

Returns ranked totals for `source`, `provider`, and `model`.

## Local Sync

Dry run:

```bash
npm run sync:local -- --dry-run
```

Upload to a deployed Worker:

```bash
export TUT_API_TOKEN=<INGEST_API_KEY>
npm run sync:local -- --endpoint https://<your-worker-domain>/api/v1/usage
```

Common flags:

- `--sources claude,codex,opencode,hermes`
- `--since 2026-03-01`
- `--full`
- `--batch-size 200`
- `--state-file <path>`
- `--token <token>`

Default checkpoint file:

- `~/.config/tut/sync-state.json`

## Build and Deploy

Build:

```bash
npm run build
```

Deploy:

```bash
npm run deploy
```

## Migrations

- [migrations/0001_init_usage_events.sql](./migrations/0001_init_usage_events.sql)
- [migrations/0002_redact_filepath_metadata.sql](./migrations/0002_redact_filepath_metadata.sql)
