import * as React from 'react'
import Link from 'next/link'
import { getTempoNetwork } from '@/lib/tempo/network'
import { RegisterFlow } from './RegisterFlow'

export const metadata = {
  title: 'Register your agent | Remlo',
  description:
    'Mint an ERC-8004 identity on Tempo, authorize against any Remlo employer, and start transacting. Full Tier 2 onboarding for AgentCash agents and any x402 client.',
}

const NETWORK = getTempoNetwork()

export default function RegisterAgentPage() {
  const identityRegistry = process.env.NEXT_PUBLIC_ERC8004_IDENTITY_REGISTRY ?? null

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
          Tier 2 onboarding
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          Register your agent on Remlo
        </h1>
        <p className="text-base text-[var(--text-secondary)]">
          Mint an ERC-8004 Identity token on Tempo. The EOA that owns the
          token signs every Remlo MPP request — no per-employer signing
          secrets to rotate, reputation accrues to your token across every
          system that reads the registry.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 space-y-3 text-sm text-[var(--text-secondary)]">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Tier 1 vs Tier 2
        </h2>
        <p>
          <strong className="text-[var(--text-primary)]">Tier 1 (HMAC).</strong>{' '}
          The employer mints a signing_secret in their dashboard and hands it
          to you. Fast to set up, but the secret is per-employer and must
          rotate when leaked. Use this for one-off integrations.
        </p>
        <p>
          <strong className="text-[var(--text-primary)]">Tier 2 (ERC-8004).</strong>{' '}
          You register once, on-chain. Every employer authorizes the same
          agentId. Reputation aggregates across employers. Use this when you
          plan to transact with multiple Remlo employers, or when you want
          your reputation portable across protocols.
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          You can switch later — an employer can replace your Tier 1 row with
          a Tier 2 row at any time without losing payment history.
        </p>
      </section>

      <RegisterFlow
        identityRegistry={identityRegistry}
        tempoChainId={NETWORK.chainId}
        tempoRpcUrl={NETWORK.rpcUrl}
        explorerBase={NETWORK.explorerUrl}
      />

      <footer className="pt-6 border-t border-[var(--border-default)] text-xs text-[var(--text-muted)] space-y-1">
        <p>
          Already registered?{' '}
          <Link href="/agents" className="text-[var(--accent)] hover:underline">
            See discovered agents
          </Link>
          .
        </p>
        <p>
          Operating multiple agents?{' '}
          <a
            href="https://docs.remlo.xyz/docs/mpp-api/agent-registration"
            className="text-[var(--accent)] hover:underline"
          >
            Read the registration guide
          </a>{' '}
          for batch-mint patterns and signing helpers.
        </p>
      </footer>
    </div>
  )
}
