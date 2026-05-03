/**
 * Proof-of-possession for agent-to-agent MPP requests.
 *
 * Two flavors live here:
 *
 *   Tier 1 (HMAC) — employer issues a signing_secret from the dashboard. The
 *   agent HMACs `${timestamp}.${rawBody}` with that secret. Cheap, stateless,
 *   no chain round-trip.
 *
 *   Tier 2 (ECDSA) — agent registered on the ERC-8004 IdentityRegistry on
 *   Tempo. The agent signs a canonical Remlo message with the EOA that owns
 *   the agentId, and the server recovers the signer and compares to the
 *   cached owner address on the authorization row.
 *
 * Both flavors:
 *   - require X-Agent-Timestamp + X-Agent-Signature headers
 *   - reject if |now - timestamp| > 300_000 ms (5-minute replay window)
 *   - hash the raw request body so signatures are bound to exact bytes
 *
 * Why a 5-minute window? Long enough for clock skew across regions, short
 * enough that a leaked Authorization header can't be replayed indefinitely.
 */
import crypto from 'crypto'
import { recoverMessageAddress, type Hex } from 'viem'

const MAX_SKEW_MS = 5 * 60 * 1000

export interface AgentProofInput {
  rawBody: string
  timestampHeader: string | null
  signatureHeader: string | null
  signingSecret: string | null
}

export type AgentProofResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403; code: string; error: string }

/** Tier 1 HMAC verification. Unchanged from the original implementation. */
export function verifyAgentProof(input: AgentProofInput): AgentProofResult {
  if (!input.signingSecret) {
    return {
      ok: false,
      status: 403,
      code: 'SIGNING_SECRET_NOT_SET',
      error: 'This agent has no signing_secret. Rotate from the dashboard before calling.',
    }
  }
  if (!input.timestampHeader || !input.signatureHeader) {
    return {
      ok: false,
      status: 401,
      code: 'MISSING_PROOF_HEADERS',
      error: 'X-Agent-Timestamp and X-Agent-Signature are required',
    }
  }

  const tsMs = Number(input.timestampHeader)
  if (!Number.isFinite(tsMs)) {
    return { ok: false, status: 400, code: 'BAD_TIMESTAMP', error: 'X-Agent-Timestamp must be unix ms' }
  }
  if (Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
    return { ok: false, status: 401, code: 'STALE_TIMESTAMP', error: 'Timestamp outside 5 min window' }
  }

  const expected = crypto
    .createHmac('sha256', input.signingSecret)
    .update(`${input.timestampHeader}.${input.rawBody}`)
    .digest('hex')

  const providedBuf = Buffer.from(input.signatureHeader, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (providedBuf.length !== expectedBuf.length) {
    return { ok: false, status: 401, code: 'BAD_SIGNATURE', error: 'Invalid signature' }
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, status: 401, code: 'BAD_SIGNATURE', error: 'Invalid signature' }
  }

  return { ok: true }
}

export interface Tier2AgentProofInput {
  /** HTTP method, uppercase. */
  method: string
  /** Full request URL — includes scheme, host, path, query. */
  url: string
  rawBody: string
  timestampHeader: string | null
  signatureHeader: string | null
  /** EOA on file as the ERC-8004 token owner. Must be 0x-prefixed lowercase. */
  expectedOwner: string | null
}

/**
 * Build the canonical Remlo Tier 2 sign message. Importing this from clients
 * (the AgentCash SDK, our own dashboard helpers) is what guarantees the
 * server and the signer hash exactly the same bytes.
 *
 * Format is intentionally simple — line-delimited, named fields. Don't
 * change without bumping a version line at the top.
 */
export function buildTier2SignMessage(input: {
  method: string
  url: string
  timestampMs: string
  rawBody: string
}): string {
  const bodyHash = crypto.createHash('sha256').update(input.rawBody).digest('hex')
  return [
    'Remlo MPP Tier 2 v1',
    `Method: ${input.method.toUpperCase()}`,
    `URL: ${input.url}`,
    `Timestamp: ${input.timestampMs}`,
    `Body-SHA256: ${bodyHash}`,
  ].join('\n')
}

/**
 * Tier 2 proof verification. Recovers the signer from the X-Agent-Signature
 * header and compares against `expectedOwner` (the cached owner address from
 * the ERC-8004 IdentityRegistry).
 */
export async function verifyTier2AgentProof(
  input: Tier2AgentProofInput,
): Promise<AgentProofResult> {
  if (!input.expectedOwner) {
    return {
      ok: false,
      status: 403,
      code: 'TIER2_OWNER_NOT_CACHED',
      error: 'Tier 2 authorization is missing erc8004_owner_address.',
    }
  }
  if (!input.timestampHeader || !input.signatureHeader) {
    return {
      ok: false,
      status: 401,
      code: 'MISSING_PROOF_HEADERS',
      error: 'X-Agent-Timestamp and X-Agent-Signature are required',
    }
  }
  const tsMs = Number(input.timestampHeader)
  if (!Number.isFinite(tsMs)) {
    return { ok: false, status: 400, code: 'BAD_TIMESTAMP', error: 'X-Agent-Timestamp must be unix ms' }
  }
  if (Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
    return { ok: false, status: 401, code: 'STALE_TIMESTAMP', error: 'Timestamp outside 5 min window' }
  }
  if (!input.signatureHeader.startsWith('0x')) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_SIGNATURE_FORMAT',
      error: 'X-Agent-Signature must be 0x-prefixed hex',
    }
  }

  const message = buildTier2SignMessage({
    method: input.method,
    url: input.url,
    timestampMs: input.timestampHeader,
    rawBody: input.rawBody,
  })

  let recovered: string
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: input.signatureHeader as Hex,
    })
  } catch {
    return { ok: false, status: 401, code: 'BAD_SIGNATURE', error: 'Invalid signature' }
  }

  if (recovered.toLowerCase() !== input.expectedOwner.toLowerCase()) {
    return {
      ok: false,
      status: 401,
      code: 'SIGNER_MISMATCH',
      error: 'Recovered signer does not match the registered agent owner.',
    }
  }
  return { ok: true }
}
