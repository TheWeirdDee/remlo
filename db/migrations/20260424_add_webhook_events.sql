-- Idempotency table for inbound webhooks (Bridge, Tempo).
-- Every webhook handler writes the source + external event id before running
-- side effects. Duplicate inserts are no-ops (PK conflict) and the handler
-- returns 200 { replayed: true } without re-running.

CREATE TABLE IF NOT EXISTS webhook_events (
  source text NOT NULL CHECK (source IN ('bridge', 'tempo')),
  external_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  event_type text,
  PRIMARY KEY (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
  ON webhook_events (received_at DESC);

-- RLS: never readable/writable from a user session. Service role only.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
