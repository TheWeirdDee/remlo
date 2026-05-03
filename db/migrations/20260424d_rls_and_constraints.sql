-- Hardening migration (audit H-6, M-4, M-5).
--
-- Adds:
--   1. Row-Level Security on sensitive tables that previously relied solely
--      on the app for access control. The service-role client (used by
--      server code) still bypasses RLS — this is defense-in-depth, not a
--      replacement for the app gate.
--   2. Unique constraints on (employer.owner_user_id, active) and
--      (employees.employer_id, email) to make role lookups unambiguous and
--      prevent duplicate invites.
--   3. CHECK constraints on status/enum-ish text columns so typos cannot
--      silently enter production.
--
-- Safe to run on production — all operations are idempotent and
-- NOT VALID where schema-compatible to avoid locking the table during
-- constraint backfill.

-- ─── RLS enable (default deny; service role bypasses) ───────────────────────

ALTER TABLE IF EXISTS payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS compliance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS mpp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS employer_agent_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reputation_writes ENABLE ROW LEVEL SECURITY;

-- Optional read policies scoped to the owning employer — uncomment once
-- you migrate role lookup off the service-role client.
--
-- CREATE POLICY payroll_runs_owner_read ON payroll_runs FOR SELECT
--   USING (employer_id IN (SELECT id FROM employers WHERE owner_user_id = auth.uid()));
-- CREATE POLICY payment_items_owner_read ON payment_items FOR SELECT
--   USING (payroll_run_id IN (
--     SELECT id FROM payroll_runs WHERE employer_id IN (
--       SELECT id FROM employers WHERE owner_user_id = auth.uid())));

-- ─── Unique constraints ────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_employers_owner_active
  ON employers (owner_user_id)
  WHERE active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employer_email
  ON employees (employer_id, lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_items_run_employee
  ON payment_items (payroll_run_id, employee_id);

-- ─── CHECK constraints (enum-ish validation) ───────────────────────────────

DO $$ BEGIN
  ALTER TABLE employees
    ADD CONSTRAINT ck_employees_kyc_status
    CHECK (kyc_status IS NULL OR kyc_status IN ('pending', 'approved', 'rejected', 'expired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE employees
    ADD CONSTRAINT ck_employees_pay_frequency
    CHECK (pay_frequency IS NULL OR pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE payroll_runs
    ADD CONSTRAINT ck_payroll_runs_status
    CHECK (status IN ('draft', 'pending', 'submitted', 'completed', 'failed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE payment_items
    ADD CONSTRAINT ck_payment_items_status
    CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
