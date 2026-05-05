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
import { PublicKey } from '@solana/web3.js'

const MAX_SKEW_MS = 5 * 60 * 1000

export interface AgentProofInput {
  rawBody: string
  timestampHeader: string | null
  signatureHeader: string | null
  signingSecret: string | null
}

export type AgentProofResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 500; code: string; error: string }

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

/**
 * Wrap a raw 32-byte Ed25519 public key in an SPKI DER envelope so Node's
 * `crypto.verify` accepts it. The `302a300506032b6570032100` prefix is the
 * fixed ASN.1 header for an OID-tagged Ed25519 SubjectPublicKeyInfo.
 */
function ed25519PublicKeyFromRaw(raw32: Buffer): crypto.KeyObject {
  if (raw32.length !== 32) {
    throw new Error(`Ed25519 raw public key must be 32 bytes, got ${raw32.length}`)
  }
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex')
  const spki = Buffer.concat([spkiPrefix, raw32])
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
}

export interface Tier2SolanaProofInput {
  /** HTTP method, uppercase. */
  method: string
  /** Full request URL — includes scheme, host, path, query. */
  url: string
  rawBody: string
  timestampHeader: string | null
  signatureHeader: string | null
  /** Base58 Solana pubkey on file as the agent identity. */
  expectedPubkey: string | null
}

/**
 * Tier 2 (Solana) proof verification. The wire format mirrors the EVM Tier
 * 2 path closely so the canonical sign message is the same — only the
 * signature scheme and identity check differ:
 *
 *   - Identifier: `solana:<base58 pubkey>`
 *   - Signature: 64-byte Ed25519 over the canonical Tier 2 message.
 *     Sent as base58-encoded text in `X-Agent-Signature` (more natural for
 *     Solana clients than 0x-hex), or 0x-hex if a client prefers EVM-style
 *     transport. Both decoded the same way before verify.
 *   - Identity check: the signature must verify against the on-file
 *     `solana_pubkey`. There is no on-chain ownerOf lookup; the pubkey IS
 *     the identity. Possession of the private key is the proof.
 */
export async function verifyTier2SolanaProof(
  input: Tier2SolanaProofInput,
): Promise<AgentProofResult> {
  if (!input.expectedPubkey) {
    return {
      ok: false,
      status: 403,
      code: 'TIER2_PUBKEY_NOT_CACHED',
      error: 'Tier 2 (Solana) authorization is missing solana_pubkey.',
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

  // Decode signature: accept 0x-hex (EVM-style) OR base58 (Solana-native).
  let sigBytes: Buffer
  try {
    if (input.signatureHeader.startsWith('0x')) {
      sigBytes = Buffer.from(input.signatureHeader.slice(2), 'hex')
    } else {
      // Solana web3.js's PublicKey static methods don't decode bs58 raw, but
      // bs58 is exposed indirectly. Use bs58 decode via a small inline impl
      // rather than adding the dep — base58 of a 64-byte signature is ~88
      // chars, decode using btoa-style is wrong, must do real bs58.
      sigBytes = Buffer.from(bs58Decode(input.signatureHeader))
    }
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'BAD_SIGNATURE_FORMAT',
      error: 'X-Agent-Signature must be 0x-hex or base58.',
    }
  }
  if (sigBytes.length !== 64) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_SIGNATURE_LENGTH',
      error: `Ed25519 signatures are 64 bytes; got ${sigBytes.length}.`,
    }
  }

  // Decode pubkey: must be valid base58, exactly 32 bytes.
  let pubkeyRaw: Buffer
  try {
    pubkeyRaw = Buffer.from(new PublicKey(input.expectedPubkey).toBytes())
  } catch {
    return {
      ok: false,
      status: 500,
      code: 'BAD_STORED_PUBKEY',
      error: 'Stored solana_pubkey is not a valid base58 32-byte key.',
    }
  }

  const message = Buffer.from(
    buildTier2SignMessage({
      method: input.method,
      url: input.url,
      timestampMs: input.timestampHeader,
      rawBody: input.rawBody,
    }),
    'utf-8',
  )

  let valid = false
  try {
    const keyObject = ed25519PublicKeyFromRaw(pubkeyRaw)
    valid = crypto.verify(null, message, keyObject, sigBytes)
  } catch {
    valid = false
  }
  if (!valid) {
    return {
      ok: false,
      status: 401,
      code: 'BAD_SIGNATURE',
      error: 'Ed25519 signature did not verify against the registered Solana pubkey.',
    }
  }
  return { ok: true }
}

/**
 * Minimal base58 decode. Solana addresses use the Bitcoin alphabet
 * (`123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz` — note
 * absence of `0`, `O`, `I`, `l`). 64-byte signatures are ~87–88 chars.
 *
 * Lifted from the @solana/web3.js spec; we include it inline to avoid a new
 * dep on `bs58`. Throws on invalid characters.
 */
function bs58Decode(input: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const ALPHABET_MAP = new Map<string, number>()
  for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP.set(ALPHABET[i], i)
  if (input.length === 0) return new Uint8Array(0)
  let zeros = 0
  while (zeros < input.length && input[zeros] === '1') zeros++
  const bytes: number[] = []
  for (let i = zeros; i < input.length; i++) {
    const value = ALPHABET_MAP.get(input[i])
    if (value === undefined) {
      throw new Error(`Invalid base58 character: ${input[i]}`)
    }
    let carry = value
    for (let j = 0; j < bytes.length; j++) {
      const x = bytes[j] * 58 + carry
      bytes[j] = x & 0xff
      carry = x >> 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (let i = 0; i < zeros; i++) bytes.push(0)
  return new Uint8Array(bytes.reverse())
}
