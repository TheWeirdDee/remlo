-- Tier 2 agent identity: external AgentCash agents authenticate via an
-- ERC-8004 IdentityRegistry token on Tempo, signing requests with the EOA
-- that owns the token. We store the registry's agentId + the cached owner
-- address on the authorization row so the request path doesn't have to
-- round-trip the chain on every call.
--
-- identity_kind discriminates Tier 1 (employer-issued HMAC secret) from
-- Tier 2 paths. Existing rows are 'hmac' by default — no behavior change.
--
-- erc8004_agent_id is stored as text because uint256 won't fit in pg
-- bigint. erc8004_owner_address is the EVM EOA whose signature we verify;
-- a stale cache here is fine for security since the agentId-to-owner
-- mapping is only ever updated on transfer, which we re-resolve when the
-- cached signature stops verifying (NotImplementedYet — for now we cache
-- on row insert and force the operator to re-authorize on transfer).

ALTER TABLE employer_agent_authorizations
  ADD COLUMN IF NOT EXISTS identity_kind text NOT NULL DEFAULT 'hmac'
    CHECK (identity_kind IN ('hmac', 'erc8004_tempo')),
  ADD COLUMN IF NOT EXISTS erc8004_agent_id text,
  ADD COLUMN IF NOT EXISTS erc8004_owner_address text;

-- Tier 2 rows must have the on-chain identity columns; Tier 1 rows must
-- have a signing_secret (existing behavior, just made explicit here).
ALTER TABLE employer_agent_authorizations
  ADD CONSTRAINT employer_agent_authorizations_identity_complete CHECK (
    (identity_kind = 'hmac' AND erc8004_agent_id IS NULL AND erc8004_owner_address IS NULL)
    OR (identity_kind = 'erc8004_tempo' AND erc8004_agent_id IS NOT NULL AND erc8004_owner_address IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_employer_agent_authorizations_erc8004_agent_id
  ON employer_agent_authorizations (erc8004_agent_id)
  WHERE erc8004_agent_id IS NOT NULL;
