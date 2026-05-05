import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { extractBearerToken, verifyPrivyToken } from '@/lib/jwt'
import { randomToken } from '@/lib/mcp/oauth/crypto'
import { decodeAuthRequest } from '@/lib/mcp/oauth/flow'
import { saveAuthCode } from '@/lib/mcp/oauth/store'

/**
 * POST /api/oauth/consent
 *
 * The user clicked Approve or Deny on the consent page. For Approve,
 * we re-verify the signed authorization request token, verify the user's
 * Privy bearer (so we know who is consenting), generate a single-use
 * authorization code bound to the PKCE challenge, and return the
 * redirect URL the browser should navigate to.
 *
 * For Deny, no Privy bearer is required — we simply redirect back to
 * the client's `redirect_uri` with `error=access_denied`.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ConsentBody {
  req?: unknown
  decision?: unknown
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: ConsentBody
  try {
    body = (await req.json()) as ConsentBody
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Body must be valid JSON' },
      { status: 400 },
    )
  }

  const reqToken = typeof body.req === 'string' ? body.req : null
  const decision = body.decision === 'approve' ? 'approve' : body.decision === 'deny' ? 'deny' : null
  if (!reqToken || !decision) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing req or decision' },
      { status: 400 },
    )
  }

  const decoded = await decodeAuthRequest(reqToken)
  if (!decoded) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Authorization request expired or tampered' },
      { status: 400 },
    )
  }

  if (decision === 'deny') {
    const target = new URL(decoded.redirect_uri)
    target.searchParams.set('error', 'access_denied')
    target.searchParams.set('error_description', 'User denied the authorization request')
    if (decoded.state) target.searchParams.set('state', decoded.state)
    return NextResponse.json({ redirect_to: target.toString() })
  }

  // Approve path: must be authenticated.
  const bearer = extractBearerToken(req.headers.get('authorization'))
  if (!bearer) {
    return NextResponse.json(
      { error: 'login_required', error_description: 'Privy bearer token required to approve' },
      { status: 401 },
    )
  }
  const claims = await verifyPrivyToken(bearer)
  if (!claims || !claims.sub) {
    return NextResponse.json(
      { error: 'login_required', error_description: 'Invalid or expired Privy bearer' },
      { status: 401 },
    )
  }

  const code = randomToken(32)
  await saveAuthCode({
    code,
    client_id: decoded.client_id,
    privy_user_id: claims.sub,
    redirect_uri: decoded.redirect_uri,
    scope: decoded.scope,
    code_challenge: decoded.code_challenge,
  })

  const target = new URL(decoded.redirect_uri)
  target.searchParams.set('code', code)
  if (decoded.state) target.searchParams.set('state', decoded.state)

  return NextResponse.json({ redirect_to: target.toString() })
}
