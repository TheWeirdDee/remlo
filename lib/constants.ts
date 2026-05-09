/**
 * lib/constants.ts — backward-compatible re-exports of Tempo network +
 * system-contract addresses.
 *
 * The actual sources of truth are `lib/tempo/network.ts` (per-network
 * config, env-driven) and `lib/tempo/system-contracts.ts` (predeployed
 * addresses, identical on every network). Existing call sites can keep
 * using these names; new code should import from the structured modules
 * directly so it gets the richer types.
 */

import { getTempoNetwork } from '@/lib/tempo/network'
import { TEMPO_SYSTEM_CONTRACTS, TEMPO_TOKENS } from '@/lib/tempo/system-contracts'

const NETWORK = getTempoNetwork()

export const TEMPO_CHAIN_ID = NETWORK.chainId
export const TEMPO_RPC_URL = NETWORK.rpcUrl
export const TEMPO_EXPLORER_URL = NETWORK.explorerUrl
export const TEMPO_SPONSOR_URL = NETWORK.sponsorUrl ?? ''

// TIP-20 stablecoins. pathUSD / Alpha / Beta live at the same address on
// all networks; only Theta is testnet-faucet-only.
export const PATHUSD_ADDRESS = TEMPO_TOKENS.pathUsd
export const ALPHAUSD_ADDRESS = TEMPO_TOKENS.alphaUsd
export const BETAUSD_ADDRESS = TEMPO_TOKENS.betaUsd

// Protocol precompiles (predeployed, identical on every network).
export const TIP403_REGISTRY = TEMPO_SYSTEM_CONTRACTS.tip403Registry
export const TIP20_FACTORY = TEMPO_SYSTEM_CONTRACTS.tip20Factory
export const ACCOUNT_KEYCHAIN = TEMPO_SYSTEM_CONTRACTS.accountKeychain
export const NONCE_PRECOMPILE = TEMPO_SYSTEM_CONTRACTS.noncePrecompile

// Deployed Remlo contracts. Network-specific deployments belong in env.
// Defaults are the testnet (Moderato) deployments from 2026-03-25 — the
// only reason they live here is so local dev works without per-developer
// .env. Mainnet deployments MUST be supplied via env.
export const PAYROLL_TREASURY_ADDRESS = (process.env.NEXT_PUBLIC_PAYROLL_TREASURY ??
  '0xeFac4A0cC3D54903746e811f6cd45DD7F43A43a5') as `0x${string}`
export const PAYROLL_BATCHER_ADDRESS = (process.env.NEXT_PUBLIC_PAYROLL_BATCHER ??
  '0x90657d3F18abaB8B1b105779601644dF7ce4ee65') as `0x${string}`
export const EMPLOYEE_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_EMPLOYEE_REGISTRY ??
  '0xe7DdA49d250e014769F5d2C840146626Bf153BC4') as `0x${string}`
export const STREAM_VESTING_ADDRESS = (process.env.NEXT_PUBLIC_STREAM_VESTING ??
  '0x83ac4D8E7957F9DCD2e18F22EbD8b83c2BDD3021') as `0x${string}`
export const YIELD_ROUTER_ADDRESS = (process.env.NEXT_PUBLIC_YIELD_ROUTER ??
  '0x78B0548c7bb5B51135BBC87382f131d85abf1061') as `0x${string}`
