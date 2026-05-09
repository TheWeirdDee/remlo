-- 20260509i_cron_runs.sql
--
-- Cron-invocation audit log. One row per fire, written at start + finalized
-- on completion (success/failure/no-op).
--
-- Why a dedicated table and not "compute health from feature tables":
-- a no-op cron tick (autopayroll with no due rows, indexer with no new
-- blocks) leaves zero footprint in feature tables. From the outside you
-- can't distinguish "ran cleanly with nothing to do" from "didn't fire."
-- This table makes that distinction first-class so the admin monitoring
-- UI can show real liveness instead of inferring it.
--
-- Retention: rows accumulate at ~74/day across all 4 crons (~2.2k/month).
-- Pruned by the daily process-expired-escrows tick (delete > 30d old).

CREATE TABLE IF NOT EXISTS cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable identifier for the cron — use the path leaf, e.g.
  -- 'autopayroll-tick', 'index-virtual-inflows'. Indexed for the per-cron
  -- query the monitoring UI runs.
  cron_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- 'running' is the initial state at start; flipped to a terminal state
  -- when the handler finalizes. A row stuck in 'running' past 2x
  -- maxDuration is a strong signal the function timed out or crashed
  -- mid-run — surfaced in the UI as 'crashed'.
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed', 'no_op', 'partial')),
  -- How many records the cron actually touched. 0 is fine for no_op.
  records_processed integer NOT NULL DEFAULT 0,
  -- Truncated error message for failed/partial runs. NULL for success/no_op.
  error_message text,
  -- Wall-clock duration. NULL while running.
  duration_ms integer,
  -- Per-cron extra context — autopayroll might store {due, succeeded, failed},
  -- indexer might store {fromBlock, toBlock, eventsSeen}.
  metadata jsonb
);

-- Per-cron 'most recent N' query is the dominant access pattern.
CREATE INDEX IF NOT EXISTS idx_cron_runs_name_started
  ON cron_runs (cron_name, started_at DESC);

-- Cheap "are there any failures in the last 24h" lookup for the UI.
CREATE INDEX IF NOT EXISTS idx_cron_runs_failed
  ON cron_runs (started_at DESC)
  WHERE status IN ('failed', 'partial');

-- Read-only by service role. Admin reads via the standard service-role path;
-- cron writes also via service role. No RLS policy needed beyond the table
-- being inaccessible to anon/authenticated roles by default.
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
