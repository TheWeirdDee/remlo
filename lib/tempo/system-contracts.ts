/**
 * lib/tempo/system-contracts.ts — Tempo's enshrined / predeployed contracts.
 *
 * Per `docs.tempo.xyz/quickstart/predeployed-contracts`, these addresses are
 * IDENTICAL on every Tempo network (mainnet, testnet, devnet) — they're
 * baked into genesis. They're constants, not env vars.
 *
 * The TIP-20 stablecoin set differs per network:
 *   - pathUSD lives at the same address everywhere (the "first stablecoin
 *     deployed on Tempo," issued by Bridge 1:1 USD reserves)
 *   - Alpha/Beta/ThetaUSD are testnet-only faucet tokens
 *
 * Anything Remlo deploys (PayrollBatcher, Treasury, etc.) is NOT here —
 * those are in `lib/constants.ts` and read from env so the deployer of
 * each network can publish their own.
 *
 * Source: docs.tempo.xyz/quickstart/predeployed-contracts (verified 2026-05-09)
 */

export const TEMPO_SYSTEM_CONTRACTS = {
  /** TIP-20 token factory — `createToken(...)` for new stablecoins. */
  tip20Factory: '0x20Fc000000000000000000000000000000000000',

  /** Fee Manager — user/validator fee token resolution + fee swaps. */
  feeManager: '0xfeec000000000000000000000000000000000000',

  /** Stablecoin DEX — enshrined orderbook. */
  stablecoinDex: '0xdec0000000000000000000000000000000000000',

  /** TIP-403 Policy Registry — transfer policy lookups + admin. */
  tip403Registry: '0x403c000000000000000000000000000000000000',

  /** Signature Verifier (TIP-1020) — secp256k1 / P256 / WebAuthn precompile. */
  signatureVerifier: '0x5165300000000000000000000000000000000000',

  /** Address Registry (TIP-1022) — virtual-address master resolution. */
  addressRegistry: '0xFDC0000000000000000000000000000000000000',

  /** Account Keychain — TIP-1011 access keys with periodic spending limits. */
  accountKeychain: '0xAAAAAAAA00000000000000000000000000000000',

  /** Nonce precompile (ASCII "NONCE"). */
  noncePrecompile: '0x4E4F4E4345000000000000000000000000000000',

  /** Tempo State precompile — read finalized Tempo state from inside zones. */
  tempoState: '0x1c00000000000000000000000000000000000000',

  /** ERC-8004 Identity Registry — Tempo's enshrined trustless-agents identity. */
  erc8004Identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',

  /** ERC-8004 Reputation Registry — feedback / `getSummary` / `readFeedback`. */
  erc8004Reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',

  /** Multicall3 — canonical EVM batch reads. */
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',

  /** CreateX — deterministic deployment factory. */
  createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',

  /** Permit2. */
  permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',

  /** Arachnid Create2 Factory. */
  arachnidCreate2: '0x4e59b44847b379578588920cA78FbF26c0B4956C',

  /** Safe Deployer. */
  safeDeployer: '0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7',
} as const satisfies Record<string, `0x${string}`>

/**
 * TIP-20 stablecoins on Tempo. pathUSD is the same address everywhere;
 * the AlphaUSD/BetaUSD/ThetaUSD faucet tokens are testnet-only but live
 * at deterministic addresses we can hard-code.
 */
export const TEMPO_TOKENS = {
  /** Tempo's reference USD stablecoin, issued by Bridge against USDC.e reserves. */
  pathUsd: '0x20c0000000000000000000000000000000000000',
  /** Testnet faucet token. */
  alphaUsd: '0x20c0000000000000000000000000000000000001',
  /** Testnet faucet token. */
  betaUsd: '0x20c0000000000000000000000000000000000002',
  /** Testnet faucet token. */
  thetaUsd: '0x20c0000000000000000000000000000000000003',
} as const satisfies Record<string, `0x${string}`>

/**
 * Bridged tokens that live on Tempo via LayerZero / Stargate. Source:
 * docs.tempo.xyz/guide/bridge-layerzero. Mainnet addresses are documented;
 * testnet equivalents are not enumerated by Tempo as of 2026-05-09 — leave
 * undefined and let the live tokenlist (lib/tempo/tokenlist.ts) be the
 * source of truth.
 */
export const TEMPO_BRIDGED_TOKENS_MAINNET = {
  /** Stargate-bridged USDC. */
  usdcE: '0x20C000000000000000000000b9537d11c60E8b50',
  /** Stargate-bridged EURC. */
  eurcE: '0x20c0000000000000000000001621e21F71CF12fb',
  /** OFT-bridged USDT0 (OKX). */
  usdt0: '0x20c00000000000000000000014f22ca97301eb73',
  /** OFT-bridged frxUSD. */
  frxUsd: '0x20c0000000000000000000003554d28269e0f3c2',
} as const satisfies Record<string, `0x${string}`>

/**
 * The 12-byte prefix Tempo reserves for TIP-20 contracts (TIP-1047).
 * CREATE / CREATE2 / EIP-7702 to anything starting with this silently
 * revert — never deploy to a `0x20c000…` address.
 */
export const TIP20_RESERVED_PREFIX = '0x20C000000000000000000000' as const

/**
 * Magic bytes [4:14] of every TIP-20 virtual address (TIP-1022). When a
 * recipient address matches, the token contract resolves via the Address
 * Registry to the master.
 */
export const VIRTUAL_ADDRESS_MAGIC = '0xFDFDFDFDFDFDFDFDFDFD' as const
