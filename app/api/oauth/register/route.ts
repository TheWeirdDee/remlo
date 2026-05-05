import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { randomToken } from '@/lib/mcp/oauth/crypto'
import { saveClient } from '@/lib/mcp/oauth/store'

/**
 * POST /api/oauth/register
 *
 * RFC 7591 Dynamic Client Registration. MCP clients (Claude Desktop,
 * Cursor, ATXP, Sponge MCP probe, etc.) hit this once on first connect
 * to obtain a `client_id`. We issue public clients only — no
 * `client_secret` because PKCE is the binding security property for
 * authorization-code grants.
 *
 * Request body (all optional except `redirect_uris`):
 *   {
 *     "client_name": "Cursor",
 *     "redirect_uris": ["http://localhost:3742/oauth/callback"],
 *     "scope": "mcp:tools",         // defaults to "mcp:tools"
 *     "software_id": "cursor.so",
 *     "software_version": "0.43.1"
 *   }
 *
 * Response:
 *   {
 *     "client_id": "remlo-mcp-<random>",
 *     "client_name": "...",
 *     "redirect_uris": [...],
 *     "scope": "mcp:tools",
 *     "token_endpoint_auth_method": "none",
 *     "grant_types": ["authorization_code", "refresh_token"],
 *     "response_types": ["code"]
 *   }
 *
 * No rate limit — DCR rows are cheap and the auth code flow throttles
 * abuse downstream (each code requires user consent).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RegisterRequest {
  client_name?: unknown
  redirect_uris?: unknown
  scope?: unknown
  software_id?: unknown
  software_version?: unknown
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0)
}

function isValidRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    // Allow http only on localhost / 127.0.0.1 for native client loopback redirects
    if (u.protocol === 'http:') {
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
    }
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: RegisterRequest
  try {
    body = (await req.json()) as RegisterRequest
  } catch {
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: 'Body must be valid JSON' },
      { status: 400, headers: corsHeaders() },
    )
  }

  const clientName =
    typeof body.client_name === 'string' && body.client_name.trim().length > 0
      ? body.client_name.trim().slice(0, 200)
      : 'Unnamed MCP client'

  const redirectUris = isStringArray(body.redirect_uris) ? body.redirect_uris : []
  if (redirectUris.length === 0) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must contain at least one entry' },
      { status: 400, headers: corsHeaders() },
    )
  }
  for (const uri of redirectUris) {
    if (!isValidRedirectUri(uri)) {
      return NextResponse.json(
        {
          error: 'invalid_redirect_uri',
          error_description: `Invalid redirect_uri: ${uri}. Use https://, or http://localhost / 127.0.0.1 / [::1] for native clients.`,
        },
        { status: 400, headers: corsHeaders() },
      )
    }
  }

  const scope = typeof body.scope === 'string' && body.scope.length > 0 ? body.scope : 'mcp:tools'
  if (scope !== 'mcp:tools') {
    return NextResponse.json(
      { error: 'invalid_scope', error_description: 'Only `mcp:tools` is supported in this version' },
      { status: 400, headers: corsHeaders() },
    )
  }

  const clientId = `remlo-mcp-${randomToken(12)}`
  const software_id = typeof body.software_id === 'string' ? body.software_id.slice(0, 200) : undefined
  const software_version =
    typeof body.software_version === 'string' ? body.software_version.slice(0, 100) : undefined

  const client = await saveClient({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    scope,
    software_id,
    software_version,
  })

  return NextResponse.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      scope: client.scope,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
    },
    { status: 201, headers: corsHeaders() },
  )
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }
}
