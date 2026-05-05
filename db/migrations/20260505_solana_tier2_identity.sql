-- Solana Tier 2 Identity (sas_solana / solana_pubkey)
-- ===================================================
-- Adds a parallel identity flavor for Solana-native agents. Mirrors the
-- ERC-8004 ownership-proof model but with ed25519 instead of ECDSA and
-- without an on-chain ownership lookup — the Solana pubkey IS the identity,
-- so possession of the private key is the only thing to prove.
--
-- Wire format: `solana:<base58-pubkey>` as the X-Agent-Identifier value.
-- Signature header carries an ed25519 signature over the canonical Tier 2
-- transact-time message (or registration message, depending on context).
--
-- Why not bind to a SAS attestation instead of just the pubkey:
--   SAS issues credentials FROM authority TO recipient. There is no
--   "ownerOf" the way ERC-721 has. Binding identity to a SAS credential
--   would require an extra issuance step that doesn't add real auth — the
--   pubkey already uniquely identifies the agent. We can layer SAS-derived
--   reputation later as a separate capability tag.
--
-- Two tables touched:
--   1. employer_agent_authorizations: extend identity_kind enum + add
--      solana_pubkey column. Constraint: solana flavor populates pubkey,
--      not erc8004_* columns.
--   2. remlo_agent_profiles: extend erc8004_chain to allow 'solana' value
--      (already has it, just enforced). Identifier prefix becomes
--      `solana:<base58-pubkey>` instead of `erc8004:tempo:<id>`.

-- ── employer_agent_authorizations ────────────────────────────────────────

ALTER TABLE employer_agent_authorizations
  DROP CONSTRAINT IF EXISTS employer_agent_authorizations_identity_kind_check;

ALTER TABLE employer_agent_authorizations
  ADD CONSTRAINT employer_agent_authorizations_identity_kind_check
    CHECK (identity_kind IN ('hmac', 'erc8004_tempo', 'sas_solana'));

ALTER TABLE employer_agent_authorizations
  ADD COLUMN IF NOT EXISTS solana_pubkey text
    CHECK (solana_pubkey IS NULL OR solana_pubkey ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');

-- Replace the per-row identity-completeness invariant: each kind requires
-- exactly its own columns.
ALTER TABLE employer_agent_authorizations
  DROP CONSTRAINT IF EXISTS employer_agent_authorizations_identity_complete;

ALTER TABLE employer_agent_authorizations
  ADD CONSTRAINT employer_agent_authorizations_identity_complete CHECK (
    (identity_kind = 'hmac'
      AND erc8004_agent_id IS NULL
      AND erc8004_owner_address IS NULL
      AND solana_pubkey IS NULL)
    OR (identity_kind = 'erc8004_tempo'
      AND erc8004_agent_id IS NOT NULL
      AND erc8004_owner_address IS NOT NULL
      AND solana_pubkey IS NULL)
    OR (identity_kind = 'sas_solana'
      AND erc8004_agent_id IS NULL
      AND erc8004_owner_address IS NULL
      AND solana_pubkey IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_employer_agent_authorizations_solana_pubkey
  ON employer_agent_authorizations (solana_pubkey)
  WHERE solana_pubkey IS NOT NULL;

-- ── remlo_agent_profiles ─────────────────────────────────────────────────
-- The directory table. The original migration already allowed erc8004_chain
-- IN ('tempo', 'solana') — we now activate the 'solana' value by relaxing
-- the agent_identifier pattern to also accept `solana:<pubkey>`.

ALTER TABLE remlo_agent_profiles
  DROP CONSTRAINT IF EXISTS remlo_agent_profiles_agent_identifier_check;

ALTER TABLE remlo_agent_profiles
  ADD CONSTRAINT remlo_agent_profiles_agent_identifier_check
    CHECK (
      agent_identifier ~ '^erc8004:(tempo|solana):[0-9]+$'
      OR agent_identifier ~ '^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$'
    );

-- For solana profiles the `erc8004_agent_id` is unused — relax NOT NULL.
ALTER TABLE remlo_agent_profiles
  ALTER COLUMN erc8004_agent_id DROP NOT NULL;

ALTER TABLE remlo_agent_profiles
  DROP CONSTRAINT IF EXISTS remlo_agent_profiles_erc8004_agent_id_check;

ALTER TABLE remlo_agent_profiles
  ADD CONSTRAINT remlo_agent_profiles_erc8004_agent_id_check
    CHECK (erc8004_agent_id IS NULL OR erc8004_agent_id ~ '^[0-9]+$');

-- For solana profiles `owner_address` becomes the base58 pubkey rather
-- than an EVM address. The original CHECK already permits both shapes.
