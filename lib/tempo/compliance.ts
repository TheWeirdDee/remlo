/**
 * lib/tempo/compliance.ts — TIP-403 transfer-policy reads, used to pre-flight
 * payments before they hit the chain.
 *
 * Why pre-flight: every TIP-20 transfer on Tempo runs through the issuer's
 * configured TIP-403 policy. If our PayrollBatcher tries to push USD to a
 * wallet that's NOT on the issuer's whitelist, the on-chain call reverts
 * with `PolicyForbids`. We'd waste gas and confuse the operator. Pre-flight
 * lets the dashboard say "this employee will fail compliance — cleared
 * recipients: yes / no" before payroll runs.
 *
 * Reserved policy IDs:
 *   0 — always-reject
 *   1 — always-allow
 *
 * Since T2 (TIP-1015), policies can be COMPOUND — distinct sender / recipient
 * / mint-recipient sub-policies. The simple `isAuthorized(policyId, addr)`
 * call is preserved as a legacy shorthand that's equivalent to
 * `isAuthorizedSender && isAuthorizedRecipient`. We surface all three in the
 * pre-flight response so an admin can see exactly which leg fails.
 */

import { type Address } from 'viem'
import { publicClient, tip403Registry } from '@/lib/contracts'
import { TEMPO_TOKENS } from '@/lib/tempo/system-contracts'

const Tip20PolicyAbi = [
  {
    type: 'function',
    name: 'transferPolicyId',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const

export type PolicyType = 'unknown' | 'simple_whitelist' | 'simple_blacklist' | 'compound' | 'reserved_reject' | 'reserved_allow'

export interface CompliancePreflight {
  /** Network-aware result timestamp. */
  checkedAt: string
  /** The address being pre-flighted. */
  address: Address
  /** Token whose policy gates the transfer. */
  token: {
    address: Address
    symbol: string
  }
  /** TIP-403 policy info for the token. */
  policy: {
    id: string
    exists: boolean
    type: PolicyType
    admin?: Address
  }
  /** Authorization booleans. `legacy` is the simple `isAuthorized`. */
  authorization: {
    legacy: boolean
    sender: boolean
    recipient: boolean
    mintRecipient: boolean
  }
  /** Convenience: true iff the transfer would succeed both ways. */
  ok: boolean
}

function policyTypeFromCode(code: number, policyId: bigint): PolicyType {
  if (policyId === 0n) return 'reserved_reject'
  if (policyId === 1n) return 'reserved_allow'
  switch (code) {
    case 0:
      return 'simple_whitelist'
    case 1:
      return 'simple_blacklist'
    case 2:
      return 'compound'
    default:
      return 'unknown'
  }
}

/**
 * Pre-flight a (wallet, token) pair against the token's TIP-403 policy.
 *
 * Defaults to pathUSD when no token is supplied — that's Remlo's canonical
 * payroll asset. Callers passing a different token should ensure it's a
 * TIP-20 (this function will throw on non-TIP-20 contracts since they
 * don't expose `transferPolicyId`).
 */
export async function getCompliancePreflight(
  address: Address,
  options: { token?: Address } = {},
): Promise<CompliancePreflight> {
  const token = (options.token ?? TEMPO_TOKENS.pathUsd) as Address

  const [policyIdRaw, symbol] = await Promise.all([
    publicClient.readContract({
      address: token,
      abi: Tip20PolicyAbi,
      functionName: 'transferPolicyId',
    }) as Promise<bigint>,
    publicClient.readContract({
      address: token,
      abi: Tip20PolicyAbi,
      functionName: 'symbol',
    }) as Promise<string>,
  ])

  const policyId = policyIdRaw

  // Reserved policies short-circuit (saves four reads).
  if (policyId === 0n) {
    return {
      checkedAt: new Date().toISOString(),
      address,
      token: { address: token, symbol },
      policy: { id: '0', exists: true, type: 'reserved_reject' },
      authorization: { legacy: false, sender: false, recipient: false, mintRecipient: false },
      ok: false,
    }
  }
  if (policyId === 1n) {
    return {
      checkedAt: new Date().toISOString(),
      address,
      token: { address: token, symbol },
      policy: { id: '1', exists: true, type: 'reserved_allow' },
      authorization: { legacy: true, sender: true, recipient: true, mintRecipient: true },
      ok: true,
    }
  }

  const [exists, dataResult, legacy, sender, recipient, mintRecipient] = await Promise.all([
    tip403Registry.read.policyExists([policyId]) as Promise<boolean>,
    tip403Registry.read.policyData([policyId]).catch(() => null) as Promise<
      readonly [number, Address] | null
    >,
    tip403Registry.read.isAuthorized([policyId, address]).catch(() => false) as Promise<boolean>,
    tip403Registry.read
      .isAuthorizedSender([policyId, address])
      .catch(() => false) as Promise<boolean>,
    tip403Registry.read
      .isAuthorizedRecipient([policyId, address])
      .catch(() => false) as Promise<boolean>,
    tip403Registry.read
      .isAuthorizedMintRecipient([policyId, address])
      .catch(() => false) as Promise<boolean>,
  ])

  const policyType = dataResult ? policyTypeFromCode(dataResult[0], policyId) : 'unknown'
  const admin = dataResult?.[1]

  return {
    checkedAt: new Date().toISOString(),
    address,
    token: { address: token, symbol },
    policy: {
      id: policyId.toString(),
      exists,
      type: policyType,
      admin,
    },
    authorization: {
      legacy,
      sender,
      recipient,
      mintRecipient,
    },
    ok: sender && recipient,
  }
}

/**
 * Pre-flight a batch of addresses against the same token policy. Reads
 * are issued concurrently — a 50-row payroll pre-flight is one round-trip
 * of fanout, not 50 sequential calls.
 */
export async function getCompliancePreflightBatch(
  addresses: ReadonlyArray<Address>,
  options: { token?: Address } = {},
): Promise<CompliancePreflight[]> {
  return Promise.all(addresses.map((addr) => getCompliancePreflight(addr, options)))
}
