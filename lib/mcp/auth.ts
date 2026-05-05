import { extractBearerToken, verifyPrivyToken } from '@/lib/jwt'
import { verifyAccessToken } from '@/lib/mcp/oauth/tokens'

/**
 * lib/mcp/auth.ts — MCP transport-level authentication.
 *
 * The MCP spec requires HTTP transports to use OAuth 2.1 for client
 * identification. We implement this in two layers:
 *
 *   1. **Bearer token validation** (this file) — every authenticated MCP
 *      request must carry an `Authorization: Bearer <jwt>` header. The JWT
 *      can be a Privy auth token (for user-scoped agents) or a
 *      Remlo-issued MCP token (for autonomous agents). Both are ES256-
 *      signed JWTs and verifiable via Web Crypto.
 *
 *   2. **OAuth 2.1 metadata + client registration** (`app/api/.well-known/`
 *      and `app/api/oauth/`) — surface the discovery URLs the MCP spec
 *      requires so off-the-shelf MCP clients (Claude Desktop, Cursor, etc.)
 *      can negotiate tokens without manual configuration.
 *
 * Three modes are supported:
 *
 * - **Production (`MCP_AUTH_MODE=oauth`, default):** bearer required, must
 *   validate. Anonymous requests get a 401 with a `WWW-Authenticate: Bearer`
 *   challenge pointing at the metadata URL.
 * - **Public (`MCP_AUTH_MODE=public`):** any caller, any token (or none).
 *   Free read tools still work; paid tools enforce payment + identity at
 *   the inner handler regardless. Use only for fully-public MCP demos.
 * - **Stdio (no env var):** detected via the `MCP_TRANSPORT=stdio` env or
 *   absence of an HTTP request. Used for local Claude Desktop dev. Bypasses
 *   bearer validation entirely.
 *
 * Identity from the bearer is forwarded to the underlying route handler
 * via a `cookie` header carrying the Privy session token, so `requireEmployerCaller`
 * still works without modification.
 */

export type McpAuthMode = 'oauth' | 'public'

export function getMcpAuthMode(): McpAuthMode {
  const raw = process.env.MCP_AUTH_MODE?.toLowerCase()
  if (raw === 'public') return 'public'
  return 'oauth'
}

export interface McpAuthSuccess {
  ok: true
  /** The verified subject (Privy user ID for user-scoped tokens). */
  subject: string | null
  /** The original bearer token, forwarded to inner handlers as needed. */
  bearer: string | null
}

export interface McpAuthFailure {
  ok: false
  status: 401 | 403
  body: { error: string; code: string; metadata_url?: string }
  headers: Record<string, string>
}

export type McpAuthResult = McpAuthSuccess | McpAuthFailure

/**
 * Validate a bearer token from an MCP request. Mode is read from
 * `MCP_AUTH_MODE`. Returns either a success with subject info or a
 * structured failure the caller turns into a 401 Response.
 */
export async function authenticateMcpRequest(req: Request): Promise<McpAuthResult> {
  const mode = getMcpAuthMode()
  const bearer = extractBearerToken(req.headers.get('authorization'))

  if (mode === 'public') {
    return { ok: true, subject: null, bearer }
  }

  if (!bearer) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'Bearer token required',
        code: 'MISSING_BEARER',
        metadata_url: getOAuthMetadataUrl(),
      },
      headers: {
        'www-authenticate': `Bearer realm="remlo-mcp", resource_metadata="${getOAuthMetadataUrl()}"`,
      },
    }
  }

  // Two acceptable bearer flavors:
  //  (1) Privy JWT — the user is authenticating directly (e.g. via the dashboard
  //      "Issue MCP token" affordance). Subject = Privy user ID.
  //  (2) Remlo MCP access token — issued by /api/oauth/token after a full
  //      OAuth 2.1 PKCE flow. Subject = Privy user ID; client_id = the
  //      registered MCP client. Audience-bound to /api/mcp.
  const mcpClaims = await verifyAccessToken(bearer)
  if (mcpClaims) {
    return { ok: true, subject: mcpClaims.sub, bearer }
  }

  const privyClaims = await verifyPrivyToken(bearer)
  if (privyClaims) {
    return { ok: true, subject: privyClaims.sub, bearer }
  }

  return {
    ok: false,
    status: 401,
    body: {
      error: 'Invalid or expired bearer token',
      code: 'INVALID_BEARER',
      metadata_url: getOAuthMetadataUrl(),
    },
    headers: {
      'www-authenticate': `Bearer realm="remlo-mcp", resource_metadata="${getOAuthMetadataUrl()}"`,
    },
  }
}

export function getOAuthMetadataUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz'
  return `${base}/.well-known/oauth-protected-resource`
}
