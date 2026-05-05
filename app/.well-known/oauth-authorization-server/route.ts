import { NextResponse } from 'next/server'

/**
 * GET /.well-known/oauth-authorization-server
 *
 * RFC 8414 (OAuth 2.0 Authorization Server Metadata). This is the
 * authorization-server-side counterpart to RFC 9728's protected-resource
 * metadata. We expose it so MCP clients can drive a full OAuth 2.1 flow
 * once the `/api/oauth/authorize` + `/api/oauth/token` endpoints are
 * shipped (Phase 3).
 *
 * For Phase 1+2 the metadata is **published** but the auth/token
 * endpoints return 503 with a documented "manual token issuance" path.
 * Clients that prefer the manual flow can read the `Issue Token` link in
 * the dashboard and paste the JWT into their MCP config.
 */

export const dynamic = 'force-static'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz'

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      issuer: BASE,
      authorization_endpoint: `${BASE}/api/oauth/authorize`,
      token_endpoint: `${BASE}/api/oauth/token`,
      registration_endpoint: `${BASE}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp:tools'],
      service_documentation: `${BASE}/docs/mpp-api/mcp-server`,
    },
    {
      headers: {
        'cache-control': 'public, max-age=300',
        'content-type': 'application/json',
      },
    },
  )
}
