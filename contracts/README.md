# Remlo Contracts

Solidity contracts and ERC-8004 trustless-agent registries for the Tempo settlement layer. Built with Foundry.

The Solana side of Remlo (the `remlo_escrow` Anchor program plus four SAS schemas) lives under [`../solana/`](../solana/), not here.

## What's in here

| Contract | File | Purpose |
|---|---|---|
| `PayrollTreasury` | [`src/PayrollTreasury.sol`](src/PayrollTreasury.sol) | Per-employer stablecoin custody with memo-indexed deposits. The deposit memo's first 8 bytes must equal `bytes8(keccak256(employerAdminWallet))` (audit fix M-1). |
| `PayrollBatcher` | [`src/PayrollBatcher.sol`](src/PayrollBatcher.sol) | Atomic multi-employee payroll distribution. `MAX_BATCH_SIZE = 500` (M-3). Optional `EmployeeRegistry.isEmployedBy` per-recipient validation when registry is wired (H-4). |
| `EmployeeRegistry` | [`src/EmployeeRegistry.sol`](src/EmployeeRegistry.sol) | Employee identity anchoring with O(1) reverse lookup (C-6). TIP-403 registry address is immutable (M-2). |
| `StreamVesting` | [`src/StreamVesting.sol`](src/StreamVesting.sol) | Native Tempo streaming compensation. Failed cancel-time refunds queue under `unclaimedEmployerRefunds` for `claimEmployerRefund` (H-2). |
| `YieldRouter` | [`src/YieldRouter.sol`](src/YieldRouter.sol) | Treasury idle-balance routing with strategy allow-list (H-5). `setYieldConfig` and `rebalance` are `onlyEmployerAdmin` (C-2, C-5). |
| `erc8004/IdentityRegistry` | [`src/erc8004/IdentityRegistry.sol`](src/erc8004/IdentityRegistry.sol) | UUPS-upgradeable ERC-8004 identity registry. |
| `erc8004/ReputationRegistry` | [`src/erc8004/ReputationRegistry.sol`](src/erc8004/ReputationRegistry.sol) | UUPS-upgradeable. Receives `giveFeedback` writes from settled work. |
| `erc8004/ValidationRegistry` | [`src/erc8004/ValidationRegistry.sol`](src/erc8004/ValidationRegistry.sol) | UUPS-upgradeable. Read path wired in dashboard; writes deferred to Phase 2. |
| `utils/SafeTIP20` | [`src/utils/SafeTIP20.sol`](src/utils/SafeTIP20.sol) | Wrapper handling non-compliant TIP-20 tokens that don't return a boolean (H-1). Used by every contract that moves tokens. |

## Live deployments

Tempo Moderato (chainId `42431`):

```
PayrollTreasury           0xEC73B9762b13148C54De792d70a2DB48690fD1F7
PayrollBatcher            0xeEBa523F0AB45838F4e2c2872cEd0d5512bb4e88
EmployeeRegistry          0x2B8fC6eACBd89a7B01bB400cDd492ff0CE931a7e
StreamVesting             0xEEd5bab5A4A09fd59610513C95E106D285c87A2F
YieldRouter               0x718B2bBfC6434AcaD06416Ad6d51dC6B0A7e3d42
ERC-8004 Identity         0x1279d568C096937f73E1624B160A42eD67f7a485
ERC-8004 Reputation       0x9f514D7ad37507630541a5557dF325EC0eDC4ad7
ERC-8004 Validation       0x2eeC2CA27E8428c409516E9418bb7F6560553B78
```

Currency: USDC.e at `0x20C000000000000000000000b9537d11c60E8b50` (6 decimals).

RPC: `https://rpc.moderato.tempo.xyz`.

## Build

Tempo runs `tempo-foundry` (a Tempo-aware fork of Foundry). The standard `forge build` also works for type-checking but the `--tempo` flags are needed for deploy.

```bash
forge build
```

## Test

```bash
forge test
```

Coverage includes payroll batching, vesting arithmetic, yield router math, and ERC-8004 feedback writes. See [`test/`](test/) for the full suite.

## Deploy

The deploy script in [`script/Deploy.s.sol`](script/Deploy.s.sol) deploys all five contracts in dependency order, then wires `Treasury.setBatcher(batcher)` and `Batcher.setEmployeeRegistry(registry)`.

```bash
export DEPLOYER_PRIVATE_KEY=0x...   # must own enough pathUSD for deploy gas
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.moderato.tempo.xyz \
  --tempo.fee-token=0x20C000000000000000000000b9537d11c60E8b50 \
  --gas-limit 30000000 \
  --broadcast
```

After deploy, regenerate ABIs from forge build artifacts so the frontend picks up the new function signatures:

```bash
pnpm tsx ../scripts/regenerate-abis.ts
```

This refreshes the five files under [`../lib/abis/`](../lib/abis/). `lib/constants.ts` reads addresses from `NEXT_PUBLIC_*` environment variables, so the frontend keeps working as long as you update the env to point at the new addresses.

## Audit history

The current deployment incorporates the resolutions for the 22-finding internal audit conducted in Ship 7.1 (2026-04-21). Per-finding resolutions are documented at the top of each affected source file. Summary:

- **6 Critical fixes (C-1 through C-6).** Aggregate accounting (`totalAccountedPayToken`), TIP-403 registry immutability, allocation-rebalance authorization, employer ID O(1) lookup, sweepUnaccounted gating.
- **5 High fixes (H-1 through H-5).** SafeTIP20 token handling, employer refund queue, return value semantics, employee validation in batcher, yield strategy allow-list.
- **6 Medium fixes (M-1 through M-6).** Memo prefix enforcement, immutable registries, batch size cap, allocation_rebalance no-op stub, Unlocked event, employerId indexed in PaymentSent.
- **5 Low fixes** deferred to Phase 2 (multisig hardening, additional event emissions).

The Anchor program M-4 fix (require `confidence_bps > 0` for Approved verdicts) deployed 2026-05-03 to devnet at the same program ID `2CY3JQfkXpyTT8QBiHfKnashxGJ37ctDvqcgi7ggWiAA`.

## Foundry primer

Common commands:

```bash
forge build              # Compile
forge test -vvv          # Test with traces on failure
forge fmt                # Format
forge snapshot           # Gas snapshot (compare across changes)
anvil                    # Local test node
cast call <addr> "fn(arg)(ret)" <args>            # Read state
cast send <addr> "fn(arg)" <args> --private-key   # Write state
```

Full reference: <https://book.getfoundry.sh/>.
