import { NextResponse } from 'next/server'

/**
 * GET /.well-known/oauth-protected-resource
 *
 * RFC 9728 (OAuth 2.0 Protected Resource Metadata) endpoint. The MCP spec
 * (2026-revision) directs HTTP MCP servers to publish this so clients can
 * discover the authorization server(s) that issue tokens for them.
 *
 * Remlo's MCP server validates bearer JWTs from Privy. For Phase 1 we
 * point clients at Privy as the authorization server and document the
 * manual token-issuance flow at `${BASE}/dashboard/integrations/mcp`.
 * Phase 3 will add a full RFC 6749 + RFC 7636 (PKCE) auth code flow at
 * `/api/oauth/authorize` + `/api/oauth/token`.
 */

export const dynamic = 'force-static'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz'

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      resource: `${BASE}/api/mcp`,
      authorization_servers: [BASE],
      bearer_methods_supported: ['header'],
      resource_documentation: `${BASE}/docs/mpp-api/mcp-server`,
      resource_signing_alg_values_supported: ['ES256'],
      scopes_supported: ['mcp:tools'],
    },
    {
      headers: {
        'cache-control': 'public, max-age=300',
        'content-type': 'application/json',
      },
    },
  )
}
