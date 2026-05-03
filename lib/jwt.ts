/**
 * lib/jwt.ts — runtime-agnostic Privy JWT verification.
 *
 * Runs on both Node and Edge using Web Crypto only (no PrivyClient, no node:crypto).
 * Privy signs auth tokens with ES256 (ECDSA over P-256). The public verification
 * key is app-specific and published in the Privy dashboard — set it in
 * PRIVY_VERIFICATION_KEY as a PEM SPKI string.
 *
 * Fail-closed: if PRIVY_VERIFICATION_KEY is not configured OR the signature does
 * not verify OR the token is expired, verifyPrivyToken returns null. Callers
 * MUST treat null as "unauthenticated" and return 401.
 */

export interface PrivyClaims {
  sub: string
  exp?: number
  iss?: string
  aud?: string
}

let cachedKey: Promise<CryptoKey | null> | null = null

function base64UrlDecode(input: string): ArrayBuffer {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const bin = atob(padded)
  const buf = new ArrayBuffer(bin.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i)
  return buf
}

function decodePemSpki(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const buf = new ArrayBuffer(bin.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i)
  return buf
}

async function loadVerificationKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey
  cachedKey = (async () => {
    const pem = process.env.PRIVY_VERIFICATION_KEY
    if (!pem) {
      console.error('[jwt] PRIVY_VERIFICATION_KEY is not set — all Privy JWTs will fail verification')
      return null
    }
    try {
      const spki = decodePemSpki(pem.replace(/\\n/g, '\n'))
      return await crypto.subtle.importKey(
        'spki',
        spki,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      )
    } catch (err) {
      console.error('[jwt] failed to import PRIVY_VERIFICATION_KEY:', err)
      return null
    }
  })()
  return cachedKey
}

/**
 * Verify a Privy JWT. Returns the claims on success, null on any failure
 * (missing key, malformed token, bad signature, expired).
 *
 * Runtime-agnostic: uses Web Crypto only, so it works on Next.js edge
 * middleware AND Node API routes without modification.
 */
export async function verifyPrivyToken(token: string): Promise<PrivyClaims | null> {
  if (!token || typeof token !== 'string') return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, signatureB64] = parts

  // Parse header to confirm ES256
  let header: { alg?: string; typ?: string }
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(base64UrlDecode(headerB64)))) as typeof header
  } catch {
    return null
  }
  if (header.alg !== 'ES256') return null

  // Parse payload
  let payload: { sub?: string; exp?: number; iss?: string; aud?: string }
  try {
    payload = JSON.parse(new TextDecoder().decode(new Uint8Array(base64UrlDecode(payloadB64)))) as typeof payload
  } catch {
    return null
  }
  if (!payload.sub) return null
  if (payload.exp && payload.exp * 1000 < Date.now()) return null

  const key = await loadVerificationKey()
  if (!key) return null

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`).buffer as ArrayBuffer
  const signature = base64UrlDecode(signatureB64)

  try {
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      data,
    )
    if (!ok) return null
  } catch {
    return null
  }

  return { sub: payload.sub, exp: payload.exp, iss: payload.iss, aud: payload.aud }
}

export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null
  if (!authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}
