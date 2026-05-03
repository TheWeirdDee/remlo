-- Secure invite + KYC tokens. Previously the `employees.id` UUID was used as
-- both the invite-preview key and the KYC-start key. Any leak of that id let
-- an attacker enumerate invites, front-run the claim, and open the victim's
-- KYC flow. Audit findings C-10, H-4, H-7.
--
-- This migration adds:
--   invite_token_hash   — sha256 of a random 32-byte token (stored hashed)
--   invite_token_expires_at — TTL, default 14 days
--   invite_claimed_at   — set on successful claim (tombstone)
--   kyc_token_hash      — sha256 of a random 32-byte token used to start KYC
--
-- Token values themselves are never written to the DB — only their sha256.
-- Rotate existing employees by regenerating tokens from the dashboard.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_invite_token_hash
  ON employees (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_kyc_token_hash
  ON employees (kyc_token_hash)
  WHERE kyc_token_hash IS NOT NULL;

-- Rate-limit table: every invite endpoint hit is recorded. A simple sliding
-- window is enforced at the app layer against this.
CREATE TABLE IF NOT EXISTS invite_attempts (
  id bigserial PRIMARY KEY,
  ip_hash text NOT NULL,
  token_hash text,
  success boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_attempts_ip_hash_time
  ON invite_attempts (ip_hash, attempted_at DESC);

ALTER TABLE invite_attempts ENABLE ROW LEVEL SECURITY;
