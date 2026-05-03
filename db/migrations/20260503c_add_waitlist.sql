-- Waitlist with double opt-in.
--
-- Flow:
--   1. Visitor submits email on a landing page
--   2. Row inserted with confirm_token + confirmed_at = null
--   3. Confirmation email sent (Resend); link goes to /api/waitlist/confirm?token=...
--   4. Click sets confirmed_at + (best-effort) syncs to Resend Audiences for broadcasts
--
-- Why double opt-in: avoids someone signing up someone else's email, keeps
-- our deliverability score clean, satisfies CAN-SPAM/GDPR. Operator pays a
-- small conversion-rate tax in exchange for a list that actually emails well.
--
-- email is stored lower-cased + trimmed at the application layer; we add a
-- check constraint so a misbehaving caller can't bypass that.

CREATE TABLE IF NOT EXISTS waitlist_subscribers (
  email text PRIMARY KEY CHECK (email = lower(email) AND length(email) >= 5),
  confirm_token text NOT NULL UNIQUE,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  source text NOT NULL DEFAULT 'unknown',
  referrer text,
  ip_inet inet,
  resend_contact_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_confirmed_at ON waitlist_subscribers (confirmed_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_source ON waitlist_subscribers (source);

-- updated_at touch trigger so we can ORDER BY recent activity later.
CREATE OR REPLACE FUNCTION waitlist_subscribers_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS waitlist_subscribers_touch_updated_at ON waitlist_subscribers;
CREATE TRIGGER waitlist_subscribers_touch_updated_at
  BEFORE UPDATE ON waitlist_subscribers
  FOR EACH ROW
  EXECUTE FUNCTION waitlist_subscribers_touch_updated_at();

-- RLS: nobody reads this directly; the API uses the service role.
ALTER TABLE waitlist_subscribers ENABLE ROW LEVEL SECURITY;
