/**
 * lib/tempo/access-keys.ts — TIP-1011 access key helpers.
 *
 * The model:
 *   - Remlo generates a fresh secp256k1 keypair (the "access key")
 *   - Employer signs an `authorizeKey(...)` tx onchain at the Tempo
 *     AccountKeychain precompile (0xAAAA…) granting the access key
 *     periodic spending limits + scoped call rules
 *   - Each pay cycle, Remlo signs payroll txs with the access-key private
 *     key (NOT the employer's)
 *   - The chain enforces: (a) cap not yet exceeded for current period,
 *     (b) target/selector is allow-listed, (c) within expiry window
 *
 * The access-key private key is stored encrypted-at-rest in
 * `autopayroll_authorizations.access_key_encrypted`. The encryption key is
 * `AUTOPAYROLL_ENCRYPTION_KEY` (32-byte hex env var). AES-256-GCM with a
 * fresh 12-byte IV per row. If the env var rotates, we re-wrap on first
 * read; old keys stay decryptable until the second rotation.
 *
 * SECURITY: this module is server-only. The encryption key MUST live only
 * in production env (not committed). Loss of the env key means every active
 * authorization is dead-letter — but onchain the key remains revocable by
 * the employer (`revokeKey` is admin-only and the employer is the admin).
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { encodeFunctionData, type Address, type Hex } from 'viem'
import { TEMPO_SYSTEM_CONTRACTS } from '@/lib/tempo/system-contracts'

// ─── KeyAuthorization construction ───────────────────────────────────────────

export interface TokenLimit {
  /** TIP-20 token address. */
  token: Address
  /** Per-period cap (raw uint256, base units). */
  amount: bigint
  /**
   * Period seconds. 0 = one-time cap; >0 = recurring (resets when block
   * timestamp crosses the period boundary). Tempo today supports fixed
   * durations (86400 / 604800 etc); calendar months land in a future
   * T-upgrade.
   */
  period: bigint
}

export interface SelectorRule {
  /** First 4 bytes of the selector. */
  selector: Hex
  /** Allowed recipients. Empty array = any recipient. */
  recipients: Address[]
}

export interface CallScope {
  target: Address
  selectorRules: SelectorRule[]
}

export type AccessKeySignatureType = 0 | 1 | 2 // secp256k1 | P256 | WebAuthn

export interface KeyRestrictions {
  /**
   * Unix seconds when the key expires. Use `2n ** 64n - 1n` for
   * non-expiring (pre-T3 used 0; T3 reverts on 0).
   */
  expiry: bigint
  /** Whether spending limits are enforced (true for our flow). */
  enforceLimits: boolean
  /** Per-token periodic spending caps. */
  limits: TokenLimit[]
  /** When true, allowedCalls is ignored and any call is permitted. */
  allowAnyCalls: boolean
  /** Granular per-target/selector/recipient allow rules. */
  allowedCalls: CallScope[]
}

/**
 * Tempo AccountKeychain `authorizeKey(address, uint8, KeyRestrictions)`
 * ABI fragment. Selector after T3 is `0x980a6025` — pre-T3 selectors
 * (`0x54063a55`, `0x203e2736`) revert with `LegacyAuthorizeKeySelectorChanged`.
 */
const AUTHORIZE_KEY_ABI = [
  {
    type: 'function',
    name: 'authorizeKey',
    inputs: [
      { name: 'keyId', type: 'address' },
      { name: 'signatureType', type: 'uint8' },
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'expiry', type: 'uint64' },
          { name: 'enforceLimits', type: 'bool' },
          {
            name: 'limits',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'period', type: 'uint64' },
            ],
          },
          { name: 'allowAnyCalls', type: 'bool' },
          {
            name: 'allowedCalls',
            type: 'tuple[]',
            components: [
              { name: 'target', type: 'address' },
              {
                name: 'selectorRules',
                type: 'tuple[]',
                components: [
                  { name: 'selector', type: 'bytes4' },
                  { name: 'recipients', type: 'address[]' },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeKey',
    inputs: [{ name: 'keyId', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export interface BuildAuthorizeKeyCalldata {
  accessKeyAddress: Address
  signatureType: AccessKeySignatureType
  restrictions: KeyRestrictions
}

/**
 * Encode the calldata an employer signs to authorize a Remlo access key.
 * The frontend takes this, wraps it in the employer's wallet send, and
 * submits to the AccountKeychain precompile.
 */
export function buildAuthorizeKeyCalldata(input: BuildAuthorizeKeyCalldata): Hex {
  return encodeFunctionData({
    abi: AUTHORIZE_KEY_ABI,
    functionName: 'authorizeKey',
    args: [
      input.accessKeyAddress,
      input.signatureType,
      {
        expiry: input.restrictions.expiry,
        enforceLimits: input.restrictions.enforceLimits,
        limits: input.restrictions.limits.map((l) => ({
          token: l.token,
          amount: l.amount,
          period: l.period,
        })),
        allowAnyCalls: input.restrictions.allowAnyCalls,
        allowedCalls: input.restrictions.allowedCalls.map((c) => ({
          target: c.target,
          selectorRules: c.selectorRules.map((r) => ({
            selector: r.selector,
            recipients: r.recipients,
          })),
        })),
      },
    ],
  })
}

export function buildRevokeKeyCalldata(accessKeyAddress: Address): Hex {
  return encodeFunctionData({
    abi: AUTHORIZE_KEY_ABI,
    functionName: 'revokeKey',
    args: [accessKeyAddress],
  })
}

export const ACCOUNT_KEYCHAIN_ADDRESS = TEMPO_SYSTEM_CONTRACTS.accountKeychain

// ─── Key generation ──────────────────────────────────────────────────────────

export interface GeneratedAccessKey {
  privateKey: Hex
  address: Address
}

/** Generate a fresh access keypair for a new authorization. */
export function generateAccessKey(): GeneratedAccessKey {
  const privateKey = generatePrivateKey()
  const address = privateKeyToAccount(privateKey).address
  return { privateKey, address }
}

// ─── Encryption-at-rest ──────────────────────────────────────────────────────

interface EncryptedKey {
  /** Schema version — bump on encryption-format change. */
  v: 1
  /** Base64 IV (12 bytes). */
  iv: string
  /** Base64 AES-256-GCM ciphertext + auth tag concat. */
  ct: string
}

// Allocate fresh ArrayBuffer-backed Uint8Arrays so WebCrypto's strict
// `BufferSource` typing accepts them. Writing into `new Uint8Array(n)`
// yields `Uint8Array<ArrayBufferLike>` which TS rejects in some lib.dom
// versions; we copy into an explicitly-`ArrayBuffer` view.
function freshUint8(size: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(size))
}

function getEncryptionKeyBytes(): Uint8Array<ArrayBuffer> {
  const hex = process.env.AUTOPAYROLL_ENCRYPTION_KEY
  if (!hex) {
    throw new Error(
      '[access-keys] AUTOPAYROLL_ENCRYPTION_KEY not set. ' +
        'Generate with `openssl rand -hex 32` and set in env before enabling Auto-Payroll.',
    )
  }
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length !== 64) {
    throw new Error('[access-keys] AUTOPAYROLL_ENCRYPTION_KEY must be 32 bytes (64 hex chars).')
  }
  const out = freshUint8(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return Buffer.from(str, 'binary').toString('base64')
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = Buffer.from(b64, 'base64').toString('binary')
  const out = freshUint8(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encryptAccessKey(privateKey: Hex): Promise<EncryptedKey> {
  const keyBytes = getEncryptionKeyBytes()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const iv = freshUint8(12)
  crypto.getRandomValues(iv)
  const ptText = new TextEncoder().encode(privateKey)
  const plaintext = freshUint8(ptText.byteLength)
  plaintext.set(ptText)
  const ctBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext)
  const ct = new Uint8Array(ctBuffer)
  return { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(ct) }
}

export async function decryptAccessKey(envelope: EncryptedKey): Promise<Hex> {
  if (envelope.v !== 1) {
    throw new Error(`[access-keys] Unsupported envelope version: ${envelope.v}`)
  }
  const keyBytes = getEncryptionKeyBytes()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const iv = base64ToBytes(envelope.iv)
  const ct = base64ToBytes(envelope.ct)
  const ptBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct)
  return new TextDecoder().decode(new Uint8Array(ptBuffer)) as Hex
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * The non-expiring sentinel per TIP-1011 T3. Use this when an employer
 * authorizes "until I revoke" rather than a hard expiry date.
 */
export const NON_EXPIRING_KEY = (2n ** 64n - 1n) as bigint

/** Standard period helpers. */
export const PERIOD_DAY = 86_400n as bigint
export const PERIOD_WEEK = 604_800n as bigint
