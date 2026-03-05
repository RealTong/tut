CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  source TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_event_id
ON usage_events(event_id)
WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_events_occurred_at
ON usage_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_source_provider_model
ON usage_events(source, provider, model);

CREATE INDEX IF NOT EXISTS idx_usage_events_provider_model
ON usage_events(provider, model);

CREATE INDEX IF NOT EXISTS idx_usage_events_source
ON usage_events(source);
