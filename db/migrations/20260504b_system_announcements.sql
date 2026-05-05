-- System Announcements
-- ====================
-- A platform-wide messaging channel under the operator's (Remlo's) control.
-- Used for things like "Mainnet is live", "Tempo RPC degraded", "Maintenance
-- window Saturday 03:00 UTC". Distinct from per-employer notifications:
--
--   - notifications: scoped to one employer, fired by deterministic system
--     events (payroll, escrow, KYC). Lives in the bell.
--   - system_announcements: platform → audience, operator-authored, lives
--     in a top-of-page strip in the dashboard. Dismissible per-user.
--
-- Audience is one of:
--   'all'        — everyone with a logged-in session (employers, employees,
--                  admins).
--   'employers'  — only users with an active employers row.
--   'employees'  — only users with an active employees row.
--
-- We don't yet need finer slicing (per-region, per-tier). Add later as a
-- JSONB filter column if it becomes important.
--
-- published_at + expires_at gate visibility. published_at lets the operator
-- compose ahead of time; expires_at lets a maintenance banner auto-disappear
-- without a follow-up edit. Both nullable: a NULL published_at means "draft,
-- not visible yet"; a NULL expires_at means "no auto-expiry".
--
-- severity drives the banner color in the dashboard:
--   info    — neutral product update.
--   success — positive (e.g. "Mainnet is live").
--   warning — incident in progress.
--   error   — full outage / urgent.

CREATE TABLE IF NOT EXISTS system_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 600),
  link_url text CHECK (link_url IS NULL OR link_url ~ '^https?://' OR link_url ~ '^/'),
  link_label text CHECK (link_label IS NULL OR length(link_label) BETWEEN 1 AND 40),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'employers', 'employees', 'admins')),
  published_at timestamptz,
  expires_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at)
);

CREATE INDEX IF NOT EXISTS idx_system_announcements_active
  ON system_announcements (published_at DESC NULLS LAST, expires_at)
  WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_announcements_audience
  ON system_announcements (audience);

-- updated_at touch trigger
CREATE OR REPLACE FUNCTION system_announcements_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_announcements_touch_updated_at ON system_announcements;
CREATE TRIGGER system_announcements_touch_updated_at
  BEFORE UPDATE ON system_announcements
  FOR EACH ROW
  EXECUTE FUNCTION system_announcements_touch_updated_at();

ALTER TABLE system_announcements ENABLE ROW LEVEL SECURITY;
-- Reads via service role only; user-facing reads go through /api/announcements/active
-- which filters by published/expires/audience server-side.

-- Per-user dismissals so a banner doesn't reappear after a user clicks X.
-- (announcement_id, user_id) is the natural key; we don't track WHEN they
-- dismissed beyond the row's existence + a timestamp for telemetry.
CREATE TABLE IF NOT EXISTS system_announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES system_announcements(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_user
  ON system_announcement_dismissals (user_id);

ALTER TABLE system_announcement_dismissals ENABLE ROW LEVEL SECURITY;
