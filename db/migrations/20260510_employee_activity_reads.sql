-- Persist employee activity acknowledgement state.
--
-- Employee activity is derived from authoritative domain tables
-- (payment_items, compliance_events, virtual_address_inflows, announcements),
-- so we store a single per-employee high-water mark instead of duplicating
-- every projected item into a second notification table.

CREATE TABLE IF NOT EXISTS employee_activity_reads (
  employee_id uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_activity_reads_seen
  ON employee_activity_reads (employee_id, last_seen_at DESC);

ALTER TABLE employee_activity_reads ENABLE ROW LEVEL SECURITY;

-- Service-role only. Portal API routes authenticate the caller via Privy and
-- update this table server-side.
