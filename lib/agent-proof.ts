/**
 * Proof-of-possession for agent-to-agent MPP requests.
 *
 * An agent authenticates by sending:
 *   X-Agent-Identifier: <pre-registered identifier>
 *   X-Agent-Timestamp: <unix ms>
 *   X-Agent-Signature: <hex HMAC-SHA256 over `${timestamp}.${rawBody}` using signing_secret>
 *
 * Server:
 *   1. Looks up the authorization by (employer_id, agent_identifier).
 *   2. Rejects if the signing_secret is null (agent must rotate first).
 *   3. Rejects if |now - timestamp| > 300_000 ms (replay window).
 *   4. Recomputes HMAC and timing-safe compares.
 *
 * This closes the "leaked identifier = impersonation" window from the audit.
 */
import crypto from 'crypto'

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
