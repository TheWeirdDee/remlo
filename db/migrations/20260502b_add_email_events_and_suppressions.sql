-- Email delivery events from Resend webhooks. Stores every status change
-- for every send so we can answer "did Tomi receive the invite, when was
-- it opened, did anything bounce" without calling Resend API every time.

CREATE TABLE IF NOT EXISTS email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text UNIQUE,
  provider_message_id text,
  event_type text NOT NULL,
  recipient text NOT NULL,
  template text,
  employer_id uuid REFERENCES employers(id) ON DELETE SET NULL,
  tags jsonb,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_events_recipient
  ON email_events (recipient, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_events_employer
  ON email_events (employer_id, created_at DESC)
  WHERE employer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_events_message
  ON email_events (provider_message_id);

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

-- Email suppressions. Anyone in this table is skipped by sendEmail() to
-- protect sender reputation. Hard bounces and spam complaints insert
-- automatically via the Resend webhook handler.

CREATE TABLE IF NOT EXISTS email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('hard_bounce', 'complaint', 'unsubscribe', 'manual')),
  source_event_id uuid REFERENCES email_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_created_at
  ON email_suppressions (created_at DESC);

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
