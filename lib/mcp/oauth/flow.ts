import { signEs256Jwt, verifyEs256Jwt } from './crypto'
import { getClient, type RegisteredClient } from './store'

/**
 * lib/mcp/oauth/flow.ts — orchestration helpers for the auth code flow.
 *
 * The /authorize → consent → /token flow has to thread a small amount of
 * state through three round trips: client_id, redirect_uri, scope,
 * code_challenge, state. We encode that state as a short-lived signed
 * JWT (`AuthRequestToken`) so the consent page can't be tricked into
 * approving a different client than the one /authorize validated, and
 * the consent endpoint doesn't need to repeat the URL-validation work.
 *
 * The token is signed with the same ES256 keypair as access tokens but
 * with a distinct issuer claim (`remlo-mcp:authz-req`) so it can't be
 * mistaken for an access token.
 */

const AUTH_REQUEST_TTL_SECONDS = 10 * 60 // 10 minutes
const AUTH_REQUEST_ISSUER = 'remlo-mcp:authz-req'

export interface AuthRequest {
  client_id: string
  redirect_uri: string
  scope: string
  code_challenge: string
  state?: string
  /** Loopback PKCE clients usually omit `state`; we still preserve it. */
  nonce?: string
}

export interface AuthRequestRecord extends AuthRequest {
  iat: number
  exp: number
}

export async function encodeAuthRequest(req: AuthRequest): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signEs256Jwt({
    iss: AUTH_REQUEST_ISSUER,
    iat: now,
    exp: now + AUTH_REQUEST_TTL_SECONDS,
    client_id: req.client_id,
    redirect_uri: req.redirect_uri,
    scope: req.scope,
    code_challenge: req.code_challenge,
    state: req.state,
    nonce: req.nonce,
  })
}

export async function decodeAuthRequest(token: string): Promise<AuthRequestRecord | null> {
  const claims = await verifyEs256Jwt(token)
  if (!claims) return null
  if (claims.iss !== AUTH_REQUEST_ISSUER) return null
  if (typeof claims.client_id !== 'string') return null
  if (typeof claims.redirect_uri !== 'string') return null
  if (typeof claims.scope !== 'string') return null
  if (typeof claims.code_challenge !== 'string') return null
  if (typeof claims.iat !== 'number') return null
  if (typeof claims.exp !== 'number') return null
  return {
    client_id: claims.client_id,
    redirect_uri: claims.redirect_uri,
    scope: claims.scope,
    code_challenge: claims.code_challenge,
    state: typeof claims.state === 'string' ? claims.state : undefined,
    nonce: typeof claims.nonce === 'string' ? claims.nonce : undefined,
    iat: claims.iat,
    exp: claims.exp,
  }
}

// ---------- Authorization-request validation ----------

export interface AuthorizationRequestParams {
  response_type: string | null
  client_id: string | null
  redirect_uri: string | null
  scope: string | null
  state: string | null
  code_challenge: string | null
  code_challenge_method: string | null
}

export type AuthorizationValidationResult =
  | { ok: true; client: RegisteredClient; req: AuthRequest }
  | {
      ok: false
      // Per RFC 6749 §4.1.2.1: errors that can be safely communicated to
      // the user-agent via redirect get redirected; errors before
      // client/redirect validation get rendered directly.
      mode: 'redirect' | 'render'
      error: string
      error_description: string
      redirect_uri?: string
      state?: string | null
    }

export async function validateAuthorizationRequest(
  params: AuthorizationRequestParams,
): Promise<AuthorizationValidationResult> {
  if (!params.client_id) {
    return {
      ok: false,
      mode: 'render',
      error: 'invalid_request',
      error_description: 'client_id is required',
    }
  }

  const client = await getClient(params.client_id)
  if (!client) {
    return {
      ok: false,
      mode: 'render',
      error: 'invalid_client',
      error_description: 'Unknown client_id',
    }
  }

  if (!params.redirect_uri) {
    return {
      ok: false,
      mode: 'render',
      error: 'invalid_request',
      error_description: 'redirect_uri is required',
    }
  }

  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return {
      ok: false,
      mode: 'render',
      error: 'invalid_request',
      error_description: 'redirect_uri is not registered for this client',
    }
  }

  // From here on errors can use the redirect channel.
  const baseFail = (error: string, error_description: string): AuthorizationValidationResult => ({
    ok: false,
    mode: 'redirect',
    error,
    error_description,
    redirect_uri: params.redirect_uri ?? undefined,
    state: params.state,
  })

  if (params.response_type !== 'code') {
    return baseFail(
      'unsupported_response_type',
      `response_type=${params.response_type ?? '(missing)'} is not supported (only "code")`,
    )
  }
  if (!params.code_challenge) {
    return baseFail('invalid_request', 'code_challenge is required (PKCE is mandatory)')
  }
  if (params.code_challenge_method !== 'S256') {
    return baseFail(
      'invalid_request',
      `code_challenge_method=${params.code_challenge_method ?? '(missing)'} is not supported (only S256)`,
    )
  }

  const scope = (params.scope ?? client.scope).trim() || 'mcp:tools'
  if (scope !== 'mcp:tools') {
    return baseFail('invalid_scope', 'Only `mcp:tools` is supported')
  }

  return {
    ok: true,
    client,
    req: {
      client_id: client.client_id,
      redirect_uri: params.redirect_uri,
      scope,
      code_challenge: params.code_challenge,
      state: params.state ?? undefined,
    },
  }
}
