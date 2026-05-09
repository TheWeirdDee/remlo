/**
 * lib/tempo/policy-admin.ts — TIP-403 policy mutations performed by the
 * Remlo agent on behalf of employers.
 *
 * For every employer that has a `tip403_policy_id` set, the Remlo agent
 * holds admin rights on that policy and is responsible for adding /
 * removing employees as their KYC status changes. The bridge webhook
 * (`kyc_link.completed`) is the primary trigger.
 *
 * Why these mutations are server-side: the policy admin key is the agent
 * wallet (REMLO_AGENT_PRIVATE_KEY), never user-held. We sign + broadcast
 * here, then return the tx hash so callers can audit-log it.
 *
 * Failure semantics: writes are best-effort. If RPC is down or the agent
 * lacks admin rights on a policy, we log the error and return null. We
 * never throw — the upstream webhook must keep flowing.
 */

import { type Address, type Hex } from 'viem'
import { tip403Registry, getServerWalletClient } from '@/lib/contracts'
import { TEMPO_SYSTEM_CONTRACTS } from '@/lib/tempo/system-contracts'
import { TIP403RegistryABI } from '@/lib/abis/TIP403Registry'

interface ModifyResult {
  txHash: Hex
  policyId: bigint
  addresses: Address[]
  add: boolean
}

function getAgentKey(): Hex | null {
  const key = process.env.REMLO_AGENT_PRIVATE_KEY
  if (!key || !key.startsWith('0x')) return null
  return key as Hex
}

/**
 * Add or remove addresses from a policy's whitelist. Used when a token's
 * policy is configured as a Whitelist (only listed addresses pass).
 *
 * Returns null when the agent key isn't configured, the policy admin is
 * someone other than the agent, or the RPC fails. Caller logs and moves
 * on — never blocks the upstream flow.
 */
export async function modifyPolicyWhitelist(args: {
  policyId: bigint
  addresses: Address[]
  add: boolean
}): Promise<ModifyResult | null> {
  if (args.addresses.length === 0) return null

  const key = getAgentKey()
  if (!key) {
    console.warn('[policy-admin] REMLO_AGENT_PRIVATE_KEY not set — skipping whitelist modify')
    return null
  }

  // Verify the agent is the policy admin before broadcasting; saves a
  // failed tx (and explorer noise) when the policy is owned elsewhere.
  let isAdmin = false
  try {
    const admin = (await tip403Registry.read.getPolicyAdmin([args.policyId])) as Address
    const wallet = getServerWalletClient(key)
    isAdmin = admin.toLowerCase() === wallet.account.address.toLowerCase()
    if (!isAdmin) {
      console.warn('[policy-admin] agent is not policy admin', {
        policyId: args.policyId.toString(),
        admin,
        agent: wallet.account.address,
      })
      return null
    }
  } catch (err) {
    console.warn('[policy-admin] getPolicyAdmin read failed', err)
    return null
  }

  try {
    const wallet = getServerWalletClient(key)
    const txHash = await wallet.writeContract({
      address: TEMPO_SYSTEM_CONTRACTS.tip403Registry,
      abi: TIP403RegistryABI,
      functionName: 'modifyPolicyWhitelist',
      args: [args.policyId, args.addresses, args.add],
    })
    return { txHash, policyId: args.policyId, addresses: args.addresses, add: args.add }
  } catch (err) {
    console.error('[policy-admin] modifyPolicyWhitelist write failed', {
      policyId: args.policyId.toString(),
      error: err instanceof Error ? err.message : err,
    })
    return null
  }
}

/**
 * Add an address to the whitelist. Convenience wrapper for the most
 * common call (one new KYC-approved employee at a time).
 */
export async function whitelistAddress(args: {
  policyId: bigint
  address: Address
}): Promise<ModifyResult | null> {
  return modifyPolicyWhitelist({
    policyId: args.policyId,
    addresses: [args.address],
    add: true,
  })
}

/**
 * Remove an address from the whitelist (for example when an employee is
 * terminated and the employer wants their wallet blocked from future
 * disbursements).
 */
export async function unwhitelistAddress(args: {
  policyId: bigint
  address: Address
}): Promise<ModifyResult | null> {
  return modifyPolicyWhitelist({
    policyId: args.policyId,
    addresses: [args.address],
    add: false,
  })
}
