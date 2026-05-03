-- Notifications table for the dashboard header bell.
-- Each row is a single event surfaced to one employer admin.
-- The header reads the latest 50 + unread count and marks them read on click.

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'payroll_finalized',
    'payroll_failed',
    'escrow_settled',
    'escrow_refunded',
    'council_decision',
    'kyc_update',
    'reputation_write_failed'
  )),
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
  link text,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_employer_unread
  ON notifications (employer_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_employer_recent
  ON notifications (employer_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Service role inserts (server-side handlers and cron jobs).
-- No public read/write policy — the GET endpoint queries via service role
-- after authenticating the employer admin via getAuthorizedEmployer.
