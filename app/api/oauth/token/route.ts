import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { verifyPkceS256 } from '@/lib/mcp/oauth/crypto'
import {
  claimAuthCode,
  getClient,
  rotateRefreshToken,
} from '@/lib/mcp/oauth/store'
import { issueTokenPair } from '@/lib/mcp/oauth/tokens'

/**
 * POST /api/oauth/token
 *
 * RFC 6749 §4.1.3 (authorization code) + §6 (refresh token) endpoint.
 * Public client, no client_secret. PKCE is mandatory.
 *
 * Two grants supported:
 *
 *   grant_type=authorization_code
 *     code, code_verifier, redirect_uri, client_id
 *
 *   grant_type=refresh_token
 *     refresh_token, client_id
 *
 * Body content type: application/x-www-form-urlencoded (per RFC 6749).
 * We also accept application/json for ergonomic clients.
 *
 * Response:
 *   {
 *     "access_token": "<jwt>",
 *     "refresh_token": "<opaque>",
 *     "token_type": "Bearer",
 *     "expires_in": 3600,
 *     "scope": "mcp:tools"
 *   }
 *
 * CORS allowed from `*` because PKCE is the binding security property
 * for public clients.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function readBody(req: NextRequest): Promise<Record<string, string> | null> {
  const ct = req.headers.get('content-type') ?? ''
  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData()
      const out: Record<string, string> = {}
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    }
    if (ct.includes('application/json')) {
      const json = (await req.json()) as Record<string, unknown>
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    }
  } catch {
    return null
  }
  return null
}

function errResponse(status: number, error: string, description: string): Response {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: corsHeaders() },
  )
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await readBody(req)
  if (!body) {
    return errResponse(400, 'invalid_request', 'Body must be application/x-www-form-urlencoded or application/json')
  }

  const grantType = body.grant_type
  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(body)
  }
  if (grantType === 'refresh_token') {
    return handleRefreshToken(body)
  }
  return errResponse(400, 'unsupported_grant_type', `grant_type=${grantType ?? '(missing)'} is not supported`)
}

async function handleAuthorizationCode(body: Record<string, string>): Promise<Response> {
  const { code, code_verifier: codeVerifier, redirect_uri: redirectUri, client_id: clientId } = body
  if (!code || !codeVerifier || !redirectUri || !clientId) {
    return errResponse(400, 'invalid_request', 'code, code_verifier, redirect_uri, and client_id are required')
  }

  const client = await getClient(clientId)
  if (!client) {
    return errResponse(401, 'invalid_client', 'Unknown client_id')
  }

  const claimed = await claimAuthCode(code)
  if (!claimed) {
    return errResponse(400, 'invalid_grant', 'Authorization code is invalid, expired, or already used')
  }
  if (claimed.client_id !== clientId) {
    return errResponse(400, 'invalid_grant', 'Authorization code was issued to a different client')
  }
  if (claimed.redirect_uri !== redirectUri) {
    return errResponse(400, 'invalid_grant', 'redirect_uri does not match the original authorization request')
  }

  const pkceOk = await verifyPkceS256(codeVerifier, claimed.code_challenge)
  if (!pkceOk) {
    return errResponse(400, 'invalid_grant', 'PKCE code_verifier does not match code_challenge')
  }

  const pair = await issueTokenPair({
    client_id: claimed.client_id,
    privy_user_id: claimed.privy_user_id,
    scope: claimed.scope,
  })

  return NextResponse.json(pair, { headers: corsHeaders() })
}

async function handleRefreshToken(body: Record<string, string>): Promise<Response> {
  const { refresh_token: refreshToken, client_id: clientId } = body
  if (!refreshToken || !clientId) {
    return errResponse(400, 'invalid_request', 'refresh_token and client_id are required')
  }

  const client = await getClient(clientId)
  if (!client) {
    return errResponse(401, 'invalid_client', 'Unknown client_id')
  }

  const rotated = await rotateRefreshToken(refreshToken)
  if (!rotated) {
    return errResponse(400, 'invalid_grant', 'Refresh token is invalid, expired, or revoked')
  }
  if (rotated.client_id !== clientId) {
    return errResponse(400, 'invalid_grant', 'Refresh token was issued to a different client')
  }

  const pair = await issueTokenPair({
    client_id: rotated.client_id,
    privy_user_id: rotated.privy_user_id,
    scope: rotated.scope,
  })

  return NextResponse.json(pair, { headers: corsHeaders() })
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
    'cache-control': 'no-store',
  }
}
