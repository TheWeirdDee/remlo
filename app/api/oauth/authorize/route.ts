import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { encodeAuthRequest, validateAuthorizationRequest } from '@/lib/mcp/oauth/flow'

/**
 * GET /api/oauth/authorize
 *
 * RFC 6749 §4.1 authorization endpoint with mandatory PKCE (RFC 7636
 * S256). Validates the request, then redirects the user-agent to the
 * consent UI with a signed `req` token carrying the validated state.
 *
 * Errors before client/redirect validation render directly (RFC 6749
 * §4.1.2.1: don't redirect to an unverified URI). After validation,
 * errors redirect to the registered redirect_uri with `error` +
 * `error_description` query params.
 *
 * The consent step at `/oauth/consent` is a Next.js page that uses
 * Privy hooks client-side. After approval it POSTs to /api/oauth/consent
 * with the user's Privy bearer + the auth request token.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP_BASE = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz').replace(/\/$/, '')

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const params = url.searchParams

  const result = await validateAuthorizationRequest({
    response_type: params.get('response_type'),
    client_id: params.get('client_id'),
    redirect_uri: params.get('redirect_uri'),
    scope: params.get('scope'),
    state: params.get('state'),
    code_challenge: params.get('code_challenge'),
    code_challenge_method: params.get('code_challenge_method'),
  })

  if (!result.ok) {
    if (result.mode === 'render') {
      return NextResponse.json(
        { error: result.error, error_description: result.error_description },
        { status: 400 },
      )
    }
    // Redirect-channel error.
    const target = new URL(result.redirect_uri!)
    target.searchParams.set('error', result.error)
    target.searchParams.set('error_description', result.error_description)
    if (result.state) target.searchParams.set('state', result.state)
    return NextResponse.redirect(target.toString(), { status: 302 })
  }

  const reqToken = await encodeAuthRequest(result.req)

  const consentUrl = new URL(`${APP_BASE}/oauth/consent`)
  consentUrl.searchParams.set('req', reqToken)

  return NextResponse.redirect(consentUrl.toString(), { status: 302 })
}
