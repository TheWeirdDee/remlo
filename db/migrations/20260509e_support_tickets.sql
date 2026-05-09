-- Support tickets — internal CRM for inbound complaints / questions.
--
-- Three sources for a ticket:
--   1. Logged-in employer hits "Contact support" in the dashboard footer.
--   2. Logged-in employee hits "Contact support" in the portal footer.
--   3. Public/unauthenticated user submits via /support (e.g. someone who
--      can't log in needs help).
--
-- We capture the user's identity if they're authenticated (user_id +
-- user_role) and link the ticket to the employer they belong to so an
-- admin can pull it up directly from the employer detail page.
--
-- Status state machine: open → in_progress → resolved → closed.
-- 'closed' is for spam / duplicates / nothing-to-do; 'resolved' means we
-- shipped a fix or explanation.

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The submitter. user_id is NULL for unauthenticated submissions.
  user_id text,
  user_role text NOT NULL CHECK (user_role IN ('employer', 'employee', 'public')),
  -- The employer the ticket relates to. Auto-resolved when the submitter
  -- is an authenticated employer/employee. Nullable for public tickets that
  -- don't reference a specific employer.
  employer_id uuid REFERENCES employers(id) ON DELETE SET NULL,
  -- The employee record, if any. Helps admins jump to the right team
  -- member when an employee files a ticket about their own status (e.g.
  -- "my KYC is stuck").
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  -- Contact email. Captured even when the user is logged in, so we always
  -- have somewhere to reply.
  email text NOT NULL CHECK (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  -- Privy user_id of the admin who picked it up.
  assigned_to text,
  -- Free-text notes the assigned admin records when resolving. Visible to
  -- other admins, not to the user.
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 5000),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created
  ON support_tickets (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_employer
  ON support_tickets (employer_id, created_at DESC)
  WHERE employer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_user
  ON support_tickets (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION support_tickets_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  -- When status flips to resolved/closed for the first time, stamp resolved_at.
  IF NEW.status IN ('resolved', 'closed') AND OLD.status NOT IN ('resolved', 'closed') THEN
    NEW.resolved_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS support_tickets_touch_updated_at ON support_tickets;
CREATE TRIGGER support_tickets_touch_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION support_tickets_touch_updated_at();

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
-- Reads + writes via service role only. The public POST endpoint validates
-- input and inserts via the service-role client; the admin GET/PATCH
-- endpoints check getCallerAdmin before any query.
