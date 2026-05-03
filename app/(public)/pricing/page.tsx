import * as React from 'react'
import { Check, Info } from 'lucide-react'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'

export const metadata = { title: 'Pricing | Remlo' }

const PLANS = [
  {
    name: 'Starter',
    price: '0',
    description: 'For teams exploring local crypto payroll.',
    features: ['Up to 5 employees', 'Manual execution', 'Basic compliance screening', 'Email support'],
  },
  {
    name: 'Pro',
    price: '99',
    popular: true,
    description: 'For growing companies with global teams.',
    features: ['Unlimited employees', 'AI-native compliance', 'Priority support', 'Basic API access', 'Payroll scheduling'],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'Bespoke infrastructure for large organizations.',
    features: ['Custom compliance rules', 'Dedicated account manager', 'SLA guarantees', 'Full API + Webhooks', 'Audit logs'],
  },
]

export default function PricingPage() {
  return (
    <div className="space-y-16">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-4 tracking-tight">Transparent Pricing</h1>
        <p className="text-lg text-[var(--text-secondary)]">Choose the plan that fits your current payroll volume. No hidden wire fees, ever.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        {PLANS.map((plan) => (
          <div 
            key={plan.name}
            className={`relative p-8 rounded-2xl border ${plan.popular ? 'border-[var(--accent)] bg-[var(--accent-subtle)]/5 ring-1 ring-[var(--accent)]' : 'border-[var(--border-default)] bg-[var(--bg-surface)]'} flex flex-col`}
          >
            {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] text-[10px] font-bold uppercase tracking-wider">
                Most Popular
              </span>
            )}
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">{plan.name}</h3>
            <div className="flex items-baseline gap-1 mb-4">
              {plan.price !== 'Custom' && <span className="text-2xl font-medium text-[var(--text-secondary)]">$</span>}
              <span className="text-5xl font-bold text-[var(--text-primary)] tracking-tight">{plan.price}</span>
              {plan.price !== 'Custom' && <span className="text-[var(--text-muted)]">/mo</span>}
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-8 flex-1">{plan.description}</p>
            <ul className="space-y-4 mb-8">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
                  <Check className="h-4 w-4 text-[var(--accent)] shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <button className={`w-full h-11 rounded-xl font-semibold transition-opacity hover:opacity-90 ${plan.popular ? 'bg-[var(--accent)] text-[var(--accent-foreground)]' : 'bg-[var(--bg-overlay)] text-[var(--text-primary)] border border-[var(--border-default)]'}`}>
              Get Started
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-8">
        <div className="flex items-center gap-3 mb-6">
          <Info className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-xl font-bold text-[var(--text-primary)]">Pay per call. Pay on any chain.</h2>
        </div>
        <p className="text-[var(--text-secondary)] mb-8">
          Agents and developers access Remlo&apos;s on-chain infrastructure via HTTP 402 micro-payments. No subscription required. Most paid endpoints accept USDC on Tempo, Base, or Solana in parallel. Your wallet picks whichever chain has balance; the server verifies via the right facilitator and runs the handler.
        </p>
        <div className="grid sm:grid-cols-3 gap-6 mb-8">
          <div className="space-y-1">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-bold">Read or query</p>
            <p className="text-[var(--text-primary)] font-mono font-bold">$0.01</p>
            <p className="text-xs text-[var(--text-muted)]">Yield rates, memo decode, escrow status</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-bold">Action</p>
            <p className="text-[var(--text-primary)] font-mono font-bold">$0.02 to $0.10</p>
            <p className="text-xs text-[var(--text-muted)]">Compliance check, escrow post / deliver, agent pay</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-bold">Heavy execution</p>
            <p className="text-[var(--text-primary)] font-mono font-bold">$0.25 to $1.00</p>
            <p className="text-xs text-[var(--text-muted)]">Full payroll run, fiat off-ramp</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 border-t border-[var(--border-default)] pt-6">
          <RailPill chain="Tempo" stable="USDC.e" protocol="mpp" />
          <RailPill chain="Base" stable="USDC" protocol="x402" />
          <RailPill chain="Solana" stable="USDC" protocol="x402" />
        </div>
      </div>

      <p className="text-center text-xs text-[var(--text-muted)]">
        Browse the full endpoint catalogue at <a href="https://www.remlo.xyz/openapi.json" className="text-[var(--accent)] hover:underline">openapi.json</a> or via <code className="font-mono">npx -y agentcash@latest discover https://www.remlo.xyz</code>.
      </p>

      <div className="mx-auto max-w-xl">
        <WaitlistForm
          source="pricing"
          variant="card"
          heading="Want production-tier rails?"
          description="We're rolling Pro and Enterprise out by application. Drop your email and we'll reach out when production payroll is ready for your team."
          ctaLabel="Request access"
        />
      </div>
    </div>
  )
}

function RailPill({ chain, stable, protocol }: { chain: string; stable: string; protocol: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
      <div>
        <span className="font-bold text-[var(--text-primary)]">{chain}</span>
        <span className="text-[var(--text-muted)]"> · {stable}</span>
      </div>
      <span className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
        {protocol}
      </span>
    </div>
  )
}
