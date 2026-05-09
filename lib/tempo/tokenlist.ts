/**
 * lib/tempo/tokenlist.ts — fetch and cache Tempo's official token list.
 *
 * Tempo publishes a Uniswap-token-list-compatible registry per network at
 * `tokenlist.tempo.xyz/list/<chain_id>`. Use this as the single source of
 * truth for token metadata (name, symbol, decimals, logo) when the UI
 * needs to display a token Remlo doesn't itself enumerate. Don't hard-code
 * symbols / icons in components — fetch them.
 *
 * Caching: in-memory per-process, 10-minute TTL. The list changes on the
 * order of days/weeks (a new stablecoin issuer onboarding is a press
 * release, not a daily event), so a cold cache miss every 10 min is fine.
 *
 * Source: docs.tempo.xyz/quickstart/tokenlist
 */

import { getTempoNetwork } from '@/lib/tempo/network'

export interface TempoToken {
  name: string
  symbol: string
  decimals: number
  chainId: number
  address: `0x${string}`
  logoURI?: string
  extensions?: {
    chain?: string
    label?: string
    coingeckoId?: string
    bridgeInfo?: Record<string, unknown>
  }
}

interface TokenListResponse {
  $schema?: string
  name: string
  logoURI?: string
  timestamp: string
  version: { major: number; minor: number; patch: number }
  tokens: TempoToken[]
}

const TEN_MINUTES_MS = 10 * 60 * 1000

interface CacheEntry {
  fetchedAt: number
  list: TokenListResponse
}

const cache = new Map<number, CacheEntry>()

/**
 * Fetch the active network's token list. Cached for 10 min per chain ID.
 *
 * Returns `null` (NOT throws) when the upstream is unavailable — token
 * metadata is decorative; failing the whole request because the icon
 * service is down would be wrong. Callers fall back to address-only
 * display in that case.
 */
export async function getTempoTokenList(
  chainId?: number,
): Promise<TokenListResponse | null> {
  const id = chainId ?? getTempoNetwork().chainId
  const cached = cache.get(id)
  if (cached && Date.now() - cached.fetchedAt < TEN_MINUTES_MS) {
    return cached.list
  }
  try {
    const res = await fetch(`https://tokenlist.tempo.xyz/list/${id}`, {
      // Keep the request snappy — 5s is plenty for a static JSON file.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.warn('[tempo/tokenlist] upstream non-2xx', { id, status: res.status })
      return cached?.list ?? null
    }
    const list = (await res.json()) as TokenListResponse
    cache.set(id, { fetchedAt: Date.now(), list })
    return list
  } catch (err) {
    console.warn('[tempo/tokenlist] fetch failed', err)
    return cached?.list ?? null
  }
}

/**
 * Lookup a single token by address (case-insensitive). Returns the token
 * record from the active network's list, or null if unknown / list
 * unreachable.
 */
export async function getTempoToken(address: string): Promise<TempoToken | null> {
  const list = await getTempoTokenList()
  if (!list) return null
  const target = address.toLowerCase()
  return list.tokens.find((t) => t.address.toLowerCase() === target) ?? null
}

/**
 * Logo URL helper. Tempo serves SVGs from
 * `https://tokenlist.tempo.xyz/icon/<chain_id>/<address>`. Avoid hitting
 * the JSON list when all you want is an icon.
 */
export function tokenLogoUrl(address: string, chainId?: number): string {
  const id = chainId ?? getTempoNetwork().chainId
  return `https://tokenlist.tempo.xyz/icon/${id}/${address.toLowerCase()}`
}

/**
 * Same as `tokenLogoUrl` but for the chain itself rather than a specific
 * token. Useful for chain-badge components.
 */
export function chainLogoUrl(chainId?: number): string {
  const id = chainId ?? getTempoNetwork().chainId
  return `https://tokenlist.tempo.xyz/icon/${id}`
}
