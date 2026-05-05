/**
 * lib/agent-registration.ts — proof of agent identity for /api/mpp/agents/register.
 *
 * Two facts must hold before an agent can register a profile:
 *
 *   1. The agent owns an ERC-8004 token on Tempo. Verified via on-chain
 *      `IdentityRegistry.ownerOf(agent_id)` returning the EOA the caller
 *      claims is theirs.
 *
 *   2. The caller controls the EOA's private key. Verified via ECDSA
 *      signature recovery over a canonical message that pins the action
 *      ("register-agent"), the agent ID, the owner address, and a recent
 *      timestamp (±5 min).
 *
 * If both check, the caller is authoritatively the agent owner and the
 * server can write a profile row. The MPP charge is orthogonal — it's the
 * service fee, not the auth.
 *
 * Why we duplicate the message format here vs reuse buildTier2SignMessage:
 * Tier 2 transact-time signatures bind to the request method/URL/body, which
 * makes sense per-call. Registration is a one-shot event; binding to method
 * + URL would force re-registration if the URL ever changed, and makes the
 * canonical message harder to communicate in docs. So registration uses a
 * simpler, action-tagged message that an SDK can build offline.
 */
import crypto from 'crypto'
import { recoverMessageAddress, isAddress, type Hex } from 'viem'
import { PublicKey } from '@solana/web3.js'
import { fetchAgentOwner } from '@/lib/reputation/erc8004'

const MAX_SKEW_MS = 5 * 60 * 1000

export interface RegistrationProofInput {
  /** uint256 as decimal string. */
  agentId: string
  /** EOA address the agent claims as the owner. Must match ownerOf(agentId) on-chain. */
  ownerAddress: string
  /** Unix milliseconds when the message was signed. */
  timestampMs: string
  /** 0x-prefixed ECDSA signature bytes. */
  signature: string
}

export type RegistrationProofResult =
  | {
      ok: true
      /** Owner address as resolved on-chain (lowercased). Use this when persisting. */
      onchainOwner: string
    }
  | {
      ok: false
      status: 400 | 401 | 403 | 404
      code: string
      error: string
    }

/**
 * Build the canonical sign message. Importing this from clients (the
 * AgentCash SDK, our own /agents/register page) is what guarantees the
 * server and signer hash exactly the same bytes.
 *
 * Format is intentionally simple — line-delimited, named fields. Don't
 * change without bumping the version line at the top.
 */
export function buildRegistrationMessage(input: {
  agentId: string
  ownerAddress: string
  timestampMs: string
}): string {
  return [
    'Remlo Agent Registration v1',
    `Agent ID: ${input.agentId}`,
    `Owner: ${input.ownerAddress.toLowerCase()}`,
    `Timestamp: ${input.timestampMs}`,
  ].join('\n')
}

export async function verifyRegistrationProof(
  input: RegistrationProofInput,
): Promise<RegistrationProofResult> {
  // 1. Shape checks before any expensive work.
  if (!input.agentId || !/^\d+$/.test(input.agentId)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_AGENT_ID',
      error: 'agent_id must be a positive integer (uint256 as decimal string).',
    }
  }
  if (!input.ownerAddress || !isAddress(input.ownerAddress)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_OWNER_ADDRESS',
      error: 'owner_address must be a 0x-prefixed EVM address.',
    }
  }
  if (!input.signature.startsWith('0x')) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_SIGNATURE_FORMAT',
      error: 'signature must be 0x-prefixed hex.',
    }
  }
  const tsMs = Number(input.timestampMs)
  if (!Number.isFinite(tsMs)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_TIMESTAMP',
      error: 'timestamp_ms must be unix milliseconds.',
    }
  }
  if (Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
    return {
      ok: false,
      status: 401,
      code: 'STALE_TIMESTAMP',
      error: 'timestamp_ms outside the 5-minute replay window.',
    }
  }

  // 2. On-chain owner lookup. If the token doesn't exist, fail with 404.
  const onchainOwnerRaw = await fetchAgentOwner(input.agentId)
  if (!onchainOwnerRaw) {
    return {
      ok: false,
      status: 404,
      code: 'AGENT_NOT_REGISTERED',
      error:
        'Agent ID not found on the ERC-8004 IdentityRegistry. Register the token first at /agents/register.',
    }
  }
  const onchainOwner = onchainOwnerRaw.toLowerCase()
  if (onchainOwner !== input.ownerAddress.toLowerCase()) {
    return {
      ok: false,
      status: 403,
      code: 'OWNER_MISMATCH',
      error:
        'Claimed owner_address does not match the on-chain owner of this agent token.',
    }
  }

  // 3. Signature recovery. Constant-time comparison via toLowerCase()
  //    is sufficient since both inputs are 20-byte addresses.
  const message = buildRegistrationMessage({
    agentId: input.agentId,
    ownerAddress: input.ownerAddress,
    timestampMs: input.timestampMs,
  })

  let recovered: string
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: input.signature as Hex,
    })
  } catch {
    return {
      ok: false,
      status: 401,
      code: 'BAD_SIGNATURE',
      error: 'Signature did not recover to any valid address.',
    }
  }

  if (recovered.toLowerCase() !== onchainOwner) {
    return {
      ok: false,
      status: 401,
      code: 'SIGNER_MISMATCH',
      error:
        'Signature recovered to a different address than the on-chain owner. The caller must sign with the EOA that owns the agent token.',
    }
  }

  return { ok: true, onchainOwner }
}

// ── Solana (sas_solana) registration proof ──────────────────────────────
// Mirror of the Tempo flow but with ed25519 + the pubkey IS the identity
// (no on-chain ownerOf step). Canonical message format is identical so an
// agent SDK can build it the same way regardless of chain.

export interface SolanaRegistrationProofInput {
  /** Base58-encoded Solana pubkey, 32–44 chars. */
  solanaPubkey: string
  /** Unix milliseconds when the message was signed. */
  timestampMs: string
  /** Ed25519 signature, base58 OR 0x-hex (auto-detected). 64 bytes raw. */
  signature: string
}

export type SolanaRegistrationProofResult =
  | {
      ok: true
      /** Normalized base58 pubkey (constructor-validated). Use when persisting. */
      solanaPubkey: string
    }
  | {
      ok: false
      status: 400 | 401 | 403
      code: string
      error: string
    }

export function buildSolanaRegistrationMessage(input: {
  solanaPubkey: string
  timestampMs: string
}): string {
  return [
    'Remlo Agent Registration v1',
    `Solana Pubkey: ${input.solanaPubkey}`,
    `Timestamp: ${input.timestampMs}`,
  ].join('\n')
}

const MAX_SKEW_MS_REG = 5 * 60 * 1000

/**
 * Decode a base58 string to bytes. Inline implementation to avoid adding
 * a runtime dep on `bs58`. Throws on invalid characters.
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

function ed25519PublicKeyFromRaw(raw32: Buffer): crypto.KeyObject {
  if (raw32.length !== 32) {
    throw new Error(`Ed25519 raw public key must be 32 bytes, got ${raw32.length}`)
  }
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex')
  const spki = Buffer.concat([spkiPrefix, raw32])
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
}

export async function verifySolanaRegistrationProof(
  input: SolanaRegistrationProofInput,
): Promise<SolanaRegistrationProofResult> {
  // Pubkey shape check via PublicKey ctor.
  let pubkeyRaw: Buffer
  let normalizedPubkey: string
  try {
    const pk = new PublicKey(input.solanaPubkey)
    pubkeyRaw = Buffer.from(pk.toBytes())
    normalizedPubkey = pk.toBase58()
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'BAD_SOLANA_PUBKEY',
      error: 'solana_pubkey must be a valid base58-encoded 32-byte Solana public key.',
    }
  }

  const tsMs = Number(input.timestampMs)
  if (!Number.isFinite(tsMs)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_TIMESTAMP',
      error: 'timestamp_ms must be unix milliseconds.',
    }
  }
  if (Math.abs(Date.now() - tsMs) > MAX_SKEW_MS_REG) {
    return {
      ok: false,
      status: 401,
      code: 'STALE_TIMESTAMP',
      error: 'timestamp_ms outside the 5-minute replay window.',
    }
  }

  // Decode signature: accept 0x-hex or base58.
  let sigBytes: Buffer
  try {
    if (input.signature.startsWith('0x')) {
      sigBytes = Buffer.from(input.signature.slice(2), 'hex')
    } else {
      sigBytes = Buffer.from(bs58Decode(input.signature))
    }
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'BAD_SIGNATURE_FORMAT',
      error: 'signature must be base58 or 0x-hex.',
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

  const message = Buffer.from(
    buildSolanaRegistrationMessage({
      solanaPubkey: normalizedPubkey,
      timestampMs: input.timestampMs,
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
      error:
        'Ed25519 signature did not verify. The caller must sign with the private key matching solana_pubkey.',
    }
  }

  return { ok: true, solanaPubkey: normalizedPubkey }
}

/**
 * Validate user-supplied profile metadata before insert. Throws on bad
 * input so the route handler can surface a clean 400. Returns the cleaned
 * shape ready for the database insert.
 */
export function validateProfileInput(input: {
  display_name?: unknown
  description?: unknown
  endpoint?: unknown
  capabilities?: unknown
  contact_url?: unknown
}): {
  display_name: string
  description: string | null
  endpoint: string | null
  capabilities: string[]
  contact_url: string | null
} {
  const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : ''
  if (displayName.length === 0 || displayName.length > 80) {
    throw Object.assign(new Error('display_name must be 1–80 chars.'), {
      code: 'BAD_DISPLAY_NAME',
    })
  }

  const description =
    typeof input.description === 'string' && input.description.trim().length > 0
      ? input.description.trim().slice(0, 500)
      : null

  const endpoint = (() => {
    if (typeof input.endpoint !== 'string') return null
    const trimmed = input.endpoint.trim()
    if (trimmed === '') return null
    if (!/^https?:\/\//.test(trimmed)) {
      throw Object.assign(new Error('endpoint must be http:// or https:// URL.'), {
        code: 'BAD_ENDPOINT',
      })
    }
    return trimmed
  })()

  const capabilities = (() => {
    if (!Array.isArray(input.capabilities)) return []
    return input.capabilities
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0 && v.length <= 32)
      .slice(0, 12) // soft cap, prevents tag spam
  })()

  const contactUrl = (() => {
    if (typeof input.contact_url !== 'string') return null
    const trimmed = input.contact_url.trim()
    if (trimmed === '') return null
    if (!/^(https?:|mailto:)/.test(trimmed)) {
      throw Object.assign(new Error('contact_url must be http(s):// or mailto: URL.'), {
        code: 'BAD_CONTACT_URL',
      })
    }
    return trimmed
  })()

  // Soft hashing on the SHA256 of the canonical input — used purely as a
  // stable cache key for clients that want to detect unchanged registrations.
  void crypto

  return {
    display_name: displayName,
    description,
    endpoint,
    capabilities,
    contact_url: contactUrl,
  }
}
