import { randomToken, signEs256Jwt, verifyEs256Jwt, type JwtClaims } from './crypto'
import { saveRefreshToken } from './store'

/**
 * lib/mcp/oauth/tokens.ts — issue + verify Remlo MCP access/refresh tokens.
 *
 * Access tokens are ES256 JWTs containing the resource binding required
 * by RFC 9728:
 *
 *   iss = https://www.remlo.xyz
 *   aud = https://www.remlo.xyz/api/mcp        (resource indicator)
 *   sub = <Privy user id>                       (the human who authorized)
 *   client_id = <DCR client id>
 *   scope = "mcp:tools"
 *   iat / exp                                    (1 hour TTL by default)
 *   jti = random per-token id
 *
 * Refresh tokens are opaque random strings persisted in
 * `mcp_oauth_refresh_tokens` with a 30-day expiry, rotated on every
 * refresh.
 *
 * Audience validation is critical: the same Privy `sub` could authorize
 * tokens for multiple resources in the future. By pinning `aud` to
 * /api/mcp here, transit-level auth at /api/mcp can hard-reject tokens
 * issued for other audiences.
 */

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 // 1 hour
const ISSUER = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz').replace(/\/$/, '')
const RESOURCE_AUDIENCE = `${ISSUER}/api/mcp`

export interface IssuedTokenPair {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
}

export async function issueTokenPair(input: {
  client_id: string
  privy_user_id: string
  scope: string
}): Promise<IssuedTokenPair> {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = await signEs256Jwt({
    iss: ISSUER,
    aud: RESOURCE_AUDIENCE,
    sub: input.privy_user_id,
    client_id: input.client_id,
    scope: input.scope,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomToken(16),
  })

  const refreshToken = randomToken(48)
  await saveRefreshToken({
    token: refreshToken,
    client_id: input.client_id,
    privy_user_id: input.privy_user_id,
    scope: input.scope,
  })

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: input.scope,
  }
}

export interface AccessTokenClaims {
  sub: string
  client_id: string
  scope: string
  exp: number
  jti: string
}

/**
 * Verify a Remlo-issued MCP access token. Returns the claims if valid,
 * null otherwise. Enforces:
 *   - ES256 signature against MCP_OAUTH_PUBLIC_KEY
 *   - issuer == ISSUER
 *   - audience == RESOURCE_AUDIENCE (/api/mcp)
 *   - exp not in the past
 *   - sub + client_id + scope present
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  const claims = await verifyEs256Jwt(token)
  if (!claims) return null
  if (claims.iss !== ISSUER) return null
  if (claims.aud !== RESOURCE_AUDIENCE) return null
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null
  if (typeof claims.client_id !== 'string') return null
  if (typeof claims.scope !== 'string') return null
  if (typeof claims.exp !== 'number') return null
  if (typeof claims.jti !== 'string') return null
  return {
    sub: claims.sub,
    client_id: claims.client_id,
    scope: claims.scope,
    exp: claims.exp,
    jti: claims.jti,
  }
}

export const MCP_TOKEN_ISSUER = ISSUER
export const MCP_TOKEN_AUDIENCE = RESOURCE_AUDIENCE
export type { JwtClaims }
