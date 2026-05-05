-- Remlo Agent Profiles
-- =====================
-- The directory of agents that have registered themselves with Remlo via
-- POST /api/mpp/agents/register. Identity is anchored to an ERC-8004 token
-- on Tempo (chain_id 4217 mainnet / 42431 testnet). Remlo does not custody
-- the identity — registry contracts do. This table is purely the marketing /
-- discovery / capabilities layer that lets employers browse who's available
-- and lets MPPscan-style explorers list registered agents.
--
-- Why a separate table from employer_agent_authorizations:
--   - employer_agent_authorizations is per-(employer, agent) and stores
--     spend caps + signing secrets (Tier 1) or cached owner address (Tier 2).
--   - remlo_agent_profiles is a global agent record. One row per registered
--     agent. Many employers may authorize the same row.
--
-- Why agent_identifier is the primary key (not a synthetic uuid):
--   - The agent's natural identifier is `erc8004:tempo:<agent_id>`. Storing
--     it as PK lets us upsert on re-registration without a separate lookup.
--   - It's stable across employers and across the agent's lifecycle, which
--     is exactly the property a directory needs.
--
-- registered_via captures the rail the agent paid the registration fee on.
-- Useful for analytics ("how many agents discovered us via Solana") without
-- joining external receipt logs.

CREATE TABLE IF NOT EXISTS remlo_agent_profiles (
  agent_identifier text PRIMARY KEY CHECK (agent_identifier ~ '^erc8004:(tempo|solana):[0-9]+$'),
  erc8004_agent_id text NOT NULL CHECK (erc8004_agent_id ~ '^[0-9]+$'),
  erc8004_chain text NOT NULL DEFAULT 'tempo' CHECK (erc8004_chain IN ('tempo', 'solana')),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[a-f0-9]{40}$' OR owner_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 500),
  endpoint text CHECK (endpoint IS NULL OR endpoint ~ '^https?://'),
  capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  contact_url text CHECK (contact_url IS NULL OR contact_url ~ '^(https?:|mailto:)'),
  registered_via text NOT NULL DEFAULT 'tempo' CHECK (registered_via IN ('tempo', 'base', 'solana')),
  registration_tx_id text,
  active boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Last time the agent re-registered or refreshed metadata. Used in the
  -- directory to surface fresh agents above stale ones.
  last_refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remlo_agent_profiles_active_refreshed
  ON remlo_agent_profiles (active, last_refreshed_at DESC)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_remlo_agent_profiles_owner
  ON remlo_agent_profiles (owner_address);

-- Capabilities are searchable as a text array; GIN supports @> and contains.
CREATE INDEX IF NOT EXISTS idx_remlo_agent_profiles_capabilities
  ON remlo_agent_profiles USING gin (capabilities);

-- updated_at touch on every UPDATE, last_refreshed_at advances on every
-- explicit re-registration call (handled at the application layer so the
-- update doesn't always advance it on cosmetic edits).
CREATE OR REPLACE FUNCTION remlo_agent_profiles_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS remlo_agent_profiles_touch_updated_at ON remlo_agent_profiles;
CREATE TRIGGER remlo_agent_profiles_touch_updated_at
  BEFORE UPDATE ON remlo_agent_profiles
  FOR EACH ROW
  EXECUTE FUNCTION remlo_agent_profiles_touch_updated_at();

-- RLS: directory reads are public (anon role select). Writes only via service role.
ALTER TABLE remlo_agent_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS remlo_agent_profiles_public_read ON remlo_agent_profiles;
CREATE POLICY remlo_agent_profiles_public_read
  ON remlo_agent_profiles
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- Service role bypasses RLS implicitly, no explicit policy needed for writes.
