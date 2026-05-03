import * as React from 'react'

export const metadata = { title: 'About | Remlo' }

export default function AboutPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-8 tracking-tight">About Remlo</h1>
      <p className="text-xl text-[var(--text-secondary)] mb-12 italic border-l-2 border-[var(--accent)] pl-6">
        Borderless work needs borderless money. Remlo gives companies, employees, and autonomous agents the same payment substrate.
      </p>

      <div className="space-y-12">
        <section>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">The problem</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Cross-border payroll is broken. Wires take three to five days, lose 6% to FX spreads, and cost $25 to $75 each in intermediary fees. The infrastructure assumes everyone you pay has a local bank account compatible with your local rails. That assumption fails the moment your team is genuinely global, and it fails completely when the entity you&apos;re paying is an autonomous agent rather than a human.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">The solution</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            One stack, three primitives, two settlement chains. Companies pay teams in stablecoins on Tempo or Solana with sub-second finality. Agents pay our APIs in USDC on Tempo, Base, or Solana via the open x402 protocol. Every settled payment writes portable on-chain reputation that any other system can read. Funds are custodied by the protocol, not by Remlo. Compliance is on-chain rather than bolted on.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">Our vision</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Every economic participant deserves money that moves at the speed of the work it represents. Whether a contractor in Lagos clears their first paycheck in seconds or an autonomous agent collects $0.05 for serving a compliance report, the rails should be the same. Remlo is the infrastructure for that future.
          </p>
        </section>
      </div>
    </article>
  )
}
