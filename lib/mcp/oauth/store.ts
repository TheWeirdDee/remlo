import { createServerClient } from '@/lib/supabase-server'

/**
 * lib/mcp/oauth/store.ts — Supabase persistence layer for OAuth flow.
 *
 * Three resource types live here:
 *
 *   - Clients (RFC 7591 DCR): persistent, never expire. Cleaned out only
 *     by an admin sweep.
 *   - Auth codes: short-lived (10 min), single-use. Marked `used` on
 *     first redemption to prevent replay.
 *   - Refresh tokens: longer-lived (30d default), rotated on each refresh
 *     (old token marked `revoked`, new token issued).
 *
 * All access goes through the service role client. RLS denies anon by
 * default, so these tables are not exposed to the public Supabase API.
 */

const AUTH_CODE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// ---------- Client (DCR) ----------

export interface RegisteredClient {
  client_id: string
  client_name: string
  redirect_uris: string[]
  scope: string
  software_id: string | null
  software_version: string | null
  created_at: string
}

export async function saveClient(input: {
  client_id: string
  client_name: string
  redirect_uris: string[]
  scope: string
  software_id?: string
  software_version?: string
}): Promise<RegisteredClient> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('mcp_oauth_clients')
    .insert({
      client_id: input.client_id,
      client_name: input.client_name,
      redirect_uris: input.redirect_uris,
      scope: input.scope,
      software_id: input.software_id ?? null,
      software_version: input.software_version ?? null,
    })
    .select('*')
    .single()
  if (error || !data) {
    throw new Error(`Failed to register OAuth client: ${error?.message ?? 'no data'}`)
  }
  return data as RegisteredClient
}

export async function getClient(clientId: string): Promise<RegisteredClient | null> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('mcp_oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  return (data as RegisteredClient | null) ?? null
}

// ---------- Authorization codes ----------

export interface AuthCodeRecord {
  code: string
  client_id: string
  privy_user_id: string
  redirect_uri: string
  scope: string
  code_challenge: string
  code_challenge_method: string
  expires_at: string
  used: boolean
  created_at: string
}

export async function saveAuthCode(input: {
  code: string
  client_id: string
  privy_user_id: string
  redirect_uri: string
  scope: string
  code_challenge: string
}): Promise<void> {
  const supabase = createServerClient()
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString()
  const { error } = await supabase.from('mcp_oauth_auth_codes').insert({
    code: input.code,
    client_id: input.client_id,
    privy_user_id: input.privy_user_id,
    redirect_uri: input.redirect_uri,
    scope: input.scope,
    code_challenge: input.code_challenge,
    code_challenge_method: 'S256',
    expires_at: expiresAt,
    used: false,
  })
  if (error) throw new Error(`Failed to save auth code: ${error.message}`)
}

/**
 * Atomically claim an auth code: mark `used=true` only if it's currently
 * `used=false` AND not expired. Returns the row on success, null otherwise.
 *
 * The single-use guarantee depends on the database — Postgres serializes
 * concurrent UPDATEs to the same row, so two simultaneous redemptions
 * race for the WHERE-clause match and only one wins.
 */
export async function claimAuthCode(code: string): Promise<AuthCodeRecord | null> {
  const supabase = createServerClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('mcp_oauth_auth_codes')
    .update({ used: true })
    .eq('code', code)
    .eq('used', false)
    .gte('expires_at', nowIso)
    .select('*')
    .maybeSingle()
  if (error) {
    return null
  }
  return (data as AuthCodeRecord | null) ?? null
}

// ---------- Refresh tokens ----------

export interface RefreshTokenRecord {
  token: string
  client_id: string
  privy_user_id: string
  scope: string
  revoked: boolean
  expires_at: string
  created_at: string
}

export async function saveRefreshToken(input: {
  token: string
  client_id: string
  privy_user_id: string
  scope: string
}): Promise<void> {
  const supabase = createServerClient()
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString()
  const { error } = await supabase.from('mcp_oauth_refresh_tokens').insert({
    token: input.token,
    client_id: input.client_id,
    privy_user_id: input.privy_user_id,
    scope: input.scope,
    revoked: false,
    expires_at: expiresAt,
  })
  if (error) throw new Error(`Failed to save refresh token: ${error.message}`)
}

/**
 * Atomically rotate a refresh token: mark old as revoked AND return the
 * row only if it was currently active and not expired. Caller is
 * responsible for issuing the new token + saveRefreshToken.
 */
export async function rotateRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
  const supabase = createServerClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('mcp_oauth_refresh_tokens')
    .update({ revoked: true })
    .eq('token', token)
    .eq('revoked', false)
    .gte('expires_at', nowIso)
    .select('*')
    .maybeSingle()
  if (error) return null
  return (data as RefreshTokenRecord | null) ?? null
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const supabase = createServerClient()
  await supabase
    .from('mcp_oauth_refresh_tokens')
    .update({ revoked: true })
    .eq('token', token)
}
