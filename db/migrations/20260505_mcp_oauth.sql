-- 20260505_mcp_oauth.sql
-- OAuth 2.1 + PKCE state for the Remlo MCP server.
--
-- The MCP spec (2025-06-18+) requires HTTP-transport servers to publish
-- RFC 9728 / RFC 8414 metadata and accept tokens issued via the OAuth 2.1
-- authorization-code-with-PKCE flow. These three tables hold the runtime
-- state for that flow:
--
--   mcp_oauth_clients        — RFC 7591 dynamic client registrations
--   mcp_oauth_auth_codes     — short-lived single-use authorization codes
--   mcp_oauth_refresh_tokens — long-lived rotatable refresh tokens
--
-- Access tokens are self-validating ES256 JWTs and are NOT stored.
--
-- Runtime: Supabase service role only. RLS denies anon by default; the
-- OAuth endpoints use the service role client.

-- =====================================================================
-- Clients (RFC 7591 Dynamic Client Registration)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  client_id      TEXT PRIMARY KEY,
  client_name    TEXT NOT NULL,
  redirect_uris  TEXT[] NOT NULL,
  scope          TEXT NOT NULL DEFAULT 'mcp:tools',
  -- A short note about the registering software, e.g. user agent. Not
  -- security-relevant; useful for revocation triage.
  software_id    TEXT,
  software_version TEXT,
  -- Track creation time so we can age out stale anonymous DCR rows that
  -- never went on to authorize anyone.
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
-- No anon policies. All access goes through the service role.

-- =====================================================================
-- Authorization codes
-- =====================================================================
--
-- Single-use, short-lived (10 min default). The PKCE `code_challenge`
-- is stored verbatim and verified at /oauth/token by recomputing
-- SHA256(code_verifier) and comparing. `used` is flipped on first
-- exchange to prevent replay.

CREATE TABLE IF NOT EXISTS public.mcp_oauth_auth_codes (
  code                   TEXT PRIMARY KEY,
  client_id              TEXT NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  privy_user_id          TEXT NOT NULL,
  redirect_uri           TEXT NOT NULL,
  scope                  TEXT NOT NULL,
  code_challenge         TEXT NOT NULL,
  code_challenge_method  TEXT NOT NULL,        -- always 'S256' (we reject 'plain')
  expires_at             TIMESTAMPTZ NOT NULL,
  used                   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_auth_codes_expires_idx
  ON public.mcp_oauth_auth_codes (expires_at);

ALTER TABLE public.mcp_oauth_auth_codes ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Refresh tokens
-- =====================================================================
--
-- Issued together with the first access token. Rotated on every refresh:
-- exchanging a refresh token issues a new pair and marks the old refresh
-- token revoked. `expires_at` gives us a hard upper bound (default 30d).

CREATE TABLE IF NOT EXISTS public.mcp_oauth_refresh_tokens (
  token          TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  privy_user_id  TEXT NOT NULL,
  scope          TEXT NOT NULL,
  revoked        BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_refresh_tokens_user_idx
  ON public.mcp_oauth_refresh_tokens (privy_user_id);

ALTER TABLE public.mcp_oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
