/**
 * lib/tempo/balance.ts — TIP-20 balance reads for Tempo.
 *
 * NEVER use `eth_getBalance` on Tempo. Per docs.tempo.xyz/quickstart/evm-compatibility,
 * `eth_getBalance` returns a sentinel constant on every Tempo network — Tempo has
 * no native gas token, so a "balance" only makes sense relative to a TIP-20.
 *
 * The two flows we care about:
 *   1. Read a known-token balance (e.g. pathUSD treasury, USDC.e on mainnet).
 *      Use `getTip20Balance(account, token)`.
 *   2. Read a user's "displayable" balance — what they'd see in a wallet UI.
 *      Use `getDisplayBalance(account)`. Resolves the user's preferred fee
 *      token via the FeeManager precompile (TIP-1007 `getFeeToken()`) and
 *      falls back to pathUSD when the user has no preference set.
 *
 * The helpers return raw bigints + a formatted string so callers don't have
 * to remember TIP-20 decimals. pathUSD/Alpha/Beta/Theta are all 6 decimals;
 * non-USD stablecoins like a future EUR TIP-20 might differ — `decimals`
 * is read on-chain when not pre-known.
 */

import { type Address, type PublicClient, formatUnits } from 'viem'
import { publicClient } from '@/lib/contracts'
import { TEMPO_SYSTEM_CONTRACTS, TEMPO_TOKENS } from '@/lib/tempo/system-contracts'

const Tip20ReadAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'currency',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const

const FeeManagerReadAbi = [
  // TIP-1007 fee-token introspection. Returns address(0) in simulation
  // (`eth_call`); callers must handle that case explicitly.
  {
    type: 'function',
    name: 'getFeeToken',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserToken',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

export interface BalanceReading {
  /** Raw on-chain balance, no decimal scaling. */
  raw: bigint
  /** TIP-20 contract address. */
  token: Address
  /** Token decimals as reported by the contract. */
  decimals: number
  /** Token symbol (e.g. "pathUSD"). */
  symbol: string
  /** Human-readable amount, e.g. "1234.56". */
  formatted: string
}

/**
 * Read the balance of `account` for a specific TIP-20 token. Single round
 * trip via Multicall3-friendly batched calls when the supplied client
 * supports it; otherwise three plain reads.
 */
export async function getTip20Balance(
  account: Address,
  token: Address,
  client: PublicClient = publicClient as unknown as PublicClient,
): Promise<BalanceReading> {
  const [raw, decimals, symbol] = await Promise.all([
    client.readContract({
      address: token,
      abi: Tip20ReadAbi,
      functionName: 'balanceOf',
      args: [account],
    }) as Promise<bigint>,
    client.readContract({
      address: token,
      abi: Tip20ReadAbi,
      functionName: 'decimals',
    }) as Promise<number>,
    client.readContract({
      address: token,
      abi: Tip20ReadAbi,
      functionName: 'symbol',
    }) as Promise<string>,
  ])

  return {
    raw,
    token,
    decimals,
    symbol,
    formatted: formatUnits(raw, decimals),
  }
}

/**
 * Resolve the user's preferred fee token via the FeeManager. Falls back to
 * pathUSD when the user has no preference set. Used to drive any wallet UI
 * that shows "your balance" without specifying a token.
 */
export async function resolveUserFeeToken(
  account: Address,
  client: PublicClient = publicClient as unknown as PublicClient,
): Promise<Address> {
  try {
    const userToken = (await client.readContract({
      address: TEMPO_SYSTEM_CONTRACTS.feeManager,
      abi: FeeManagerReadAbi,
      functionName: 'getUserToken',
      args: [account],
    })) as Address
    if (userToken && userToken !== '0x0000000000000000000000000000000000000000') {
      return userToken
    }
  } catch (err) {
    console.warn('[tempo/balance] getUserToken failed; falling back to pathUSD', err)
  }
  return TEMPO_TOKENS.pathUsd as Address
}

/**
 * Wallet-UI-grade balance read: figure out the user's preferred fee token
 * automatically, then read the balance in that token. Use this when you
 * need to display "$X" without knowing which stablecoin the user prefers.
 *
 * Pin a specific token via `options.token` if the caller already knows.
 */
export async function getDisplayBalance(
  account: Address,
  options: { token?: Address; client?: PublicClient } = {},
): Promise<BalanceReading> {
  const client = options.client ?? (publicClient as unknown as PublicClient)
  const token = options.token ?? (await resolveUserFeeToken(account, client))
  return getTip20Balance(account, token, client)
}

/**
 * Format a raw TIP-20 amount with USD decoration when the user-facing
 * surface is dollar-denominated. Unlike viem's `formatUnits`, this caps
 * trailing zeros and clamps to a sensible display precision (currency UIs
 * almost never want > 6 fractional digits).
 */
export function formatUsdAmount(raw: bigint, decimals = 6, fractionDigits = 2): string {
  const numeric = Number(formatUnits(raw, decimals))
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numeric)
}
