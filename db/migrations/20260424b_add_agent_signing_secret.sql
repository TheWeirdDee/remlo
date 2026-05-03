-- Add a signing_secret to employer_agent_authorizations so that agent-pay
-- requests require proof-of-possession (HMAC over body + timestamp) in
-- addition to presenting the agent_identifier header. Previously, any
-- party who learned the identifier could impersonate the agent up to its
-- per-tx cap; the secret closes that gap.
--
-- Backward compat: nullable column so existing rows stay valid. Until
-- rotated, the route will reject calls that cannot produce an HMAC proof
-- (see lib/agent-proof.ts).

ALTER TABLE employer_agent_authorizations
  ADD COLUMN IF NOT EXISTS signing_secret text,
  ADD COLUMN IF NOT EXISTS signing_secret_rotated_at timestamptz;

COMMENT ON COLUMN employer_agent_authorizations.signing_secret IS
  'Random 32-byte hex. Agent HMACs (body + X-Agent-Timestamp) with this secret and sends result as X-Agent-Signature. Server rejects any request that cannot prove possession.';
