/**
 * lib/tempo/network.ts — single source of truth for which Tempo network we're on.
 *
 * One env var (`TEMPO_NETWORK`) controls everything: chain ID, RPC URL,
 * explorer URL, sponsor URL, the addresses of system contracts that vary
 * by network. Every other file in the app should derive from this — never
 * hard-code a chain ID, an RPC URL, or an explorer URL.
 *
 * Why a separate module from `constants.ts`: `constants.ts` is now a thin
 * compatibility shim that re-exports values from here, so existing imports
 * keep working while new code can pull the richer typed config via
 * `getTempoNetwork()`.
 *
 * Default is `testnet` (Moderato). Mainnet is opt-in via env to make sure
 * we never accidentally route real-funds traffic to the wrong rail.
 *
 * Sources:
 *   - docs.tempo.xyz/quickstart/connection-details
 *   - docs.tempo.xyz/quickstart/predeployed-contracts
 */

import { defineChain, type Chain } from 'viem'

export type TempoNetworkName = 'mainnet' | 'testnet' | 'devnet'

export interface TempoNetwork {
  /** Stable identifier — `mainnet` | `testnet` | `devnet`. */
  name: TempoNetworkName
  /** Human-readable name shown in dashboards / logs. */
  displayName: string
  /** EVM chain ID. */
  chainId: number
  /** HTTP JSON-RPC endpoint. */
  rpcUrl: string
  /** Optional WebSocket RPC. */
  wsUrl?: string
  /** Block explorer base URL (no trailing slash). */
  explorerUrl: string
  /** Sponsor URL for sponsored-fee flows on this network, if available. */
  sponsorUrl?: string
  /** Convenience flags so callers don't have to compare string names. */
  isMainnet: boolean
  isTestnet: boolean
  /** Token list endpoint for this network (tokenlist.tempo.xyz). */
  tokenListUrl: string
  /** Faucet URL (testnet only). */
  faucetUrl?: string
}

/**
 * The three networks Tempo runs.
 *
 * Predeployed system contracts (TIP-403 registry, FeeManager, AccountKeychain,
 * Stablecoin DEX, Address Registry, ERC-8004 registries, pathUSD) live at the
 * SAME addresses on every network — those constants live in
 * `lib/tempo/system-contracts.ts`. Per-network state belongs here.
 */
export const TEMPO_NETWORKS = {
  mainnet: {
    name: 'mainnet',
    displayName: 'Tempo Mainnet',
    chainId: 4217,
    rpcUrl: 'https://rpc.tempo.xyz',
    wsUrl: 'wss://rpc.tempo.xyz',
    explorerUrl: 'https://explore.tempo.xyz',
    isMainnet: true,
    isTestnet: false,
    tokenListUrl: 'https://tokenlist.tempo.xyz/list/4217',
  },
  testnet: {
    name: 'testnet',
    displayName: 'Tempo Moderato',
    chainId: 42431,
    rpcUrl: 'https://rpc.moderato.tempo.xyz',
    wsUrl: 'wss://rpc.moderato.tempo.xyz',
    explorerUrl: 'https://explore.testnet.tempo.xyz',
    sponsorUrl: 'https://sponsor.moderato.tempo.xyz',
    isMainnet: false,
    isTestnet: true,
    tokenListUrl: 'https://tokenlist.tempo.xyz/list/42431',
    faucetUrl: 'https://wallet.tempo.xyz',
  },
  devnet: {
    name: 'devnet',
    displayName: 'Tempo Devnet',
    chainId: 31318,
    rpcUrl: 'https://rpc.devnet.tempo.xyz',
    explorerUrl: 'https://explore.devnet.tempo.xyz',
    isMainnet: false,
    isTestnet: false,
    tokenListUrl: 'https://tokenlist.tempo.xyz/list/31318',
  },
} as const satisfies Record<TempoNetworkName, TempoNetwork>

const DEFAULT_NETWORK: TempoNetworkName = 'testnet'

let cachedSelection: TempoNetwork | null = null
let cachedSelectionName: TempoNetworkName | null = null

/**
 * Returns the active Tempo network. Reads `TEMPO_NETWORK` once and caches.
 *
 * The env value is normalised — `TEMPO_NETWORK=Mainnet` and
 * `TEMPO_NETWORK=mainnet ` both resolve. Anything unrecognised falls back
 * to testnet with a warning so a misspelled env doesn't silently move
 * traffic to mainnet.
 */
export function getTempoNetwork(): TempoNetwork {
  if (cachedSelection) return cachedSelection
  const raw = (process.env.TEMPO_NETWORK ?? DEFAULT_NETWORK).trim().toLowerCase()
  if (raw === 'mainnet' || raw === 'testnet' || raw === 'devnet') {
    cachedSelectionName = raw
    cachedSelection = TEMPO_NETWORKS[raw]
    return cachedSelection
  }
  console.warn(
    `[tempo/network] Unknown TEMPO_NETWORK="${raw}" — falling back to "${DEFAULT_NETWORK}".`,
  )
  cachedSelectionName = DEFAULT_NETWORK
  cachedSelection = TEMPO_NETWORKS[DEFAULT_NETWORK]
  return cachedSelection
}

/** For tests + the rare site that needs to flip networks at runtime. */
export function _resetTempoNetworkCache(): void {
  cachedSelection = null
  cachedSelectionName = null
}

/**
 * Build a viem `Chain` for the active Tempo network. Tempo has no native
 * gas token — we keep `nativeCurrency` set to USD purely so wagmi/viem UI
 * helpers display "USD" rather than ETH if they ever fall through to the
 * native currency code path. Real balance reads must go through TIP-20
 * tokens (see `lib/tempo/balance.ts`).
 */
export function getTempoChain(): Chain {
  const network = getTempoNetwork()
  return defineChain({
    id: network.chainId,
    name: network.displayName,
    nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 6 },
    rpcUrls: {
      default: { http: [network.rpcUrl] },
    },
    blockExplorers: {
      default: { name: 'Tempo Explorer', url: network.explorerUrl },
    },
    testnet: network.isTestnet || network.name === 'devnet',
  })
}

/**
 * Compose an explorer URL for a tx, address, or block.
 *
 * Centralised because Tempo explorer paths are bog-standard
 * (`/tx/<hash>`, `/address/<addr>`) but every page in the app builds the
 * URL by hand today, which means any future explorer-URL change would
 * require touching ~30 files instead of one.
 */
export function tempoExplorerUrl(
  kind: 'tx' | 'address' | 'block',
  value: string,
): string {
  return `${getTempoNetwork().explorerUrl}/${kind}/${value}`
}

/**
 * Hard-fail guard for code paths that must not run against mainnet — used
 * by sandbox / faucet flows.
 */
export function assertNotMainnet(reason: string): void {
  const network = getTempoNetwork()
  if (network.isMainnet) {
    throw new Error(
      `[tempo/network] Refusing to run on mainnet (${reason}). ` +
        'This code path is testnet/devnet only.',
    )
  }
}
