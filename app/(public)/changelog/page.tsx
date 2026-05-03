import * as React from 'react'

export const metadata = { title: 'Changelog | Remlo' }

const UPDATES = [
  {
    version: 'v0.7.6',
    date: 'May 3, 2026',
    title: 'Anchor escrow M-4 audit fix deployed',
    description: 'Approved verdicts on the remlo_escrow Anchor program now require positive confidence on-chain. Same program ID, same integrations.',
    items: [
      'require!(confidence_bps > 0) on VerdictState::Approved',
      'New InvalidConfidence error variant',
      'Devnet upgrade landed at slot 459837277',
    ],
  },
  {
    version: 'v0.7.5',
    date: 'May 3, 2026',
    title: 'Notification fan-out across the lifecycle',
    description: 'Dashboard notification bell now fires on all seven lifecycle events: payroll finalized or failed, escrow settled or refunded, council decision, KYC update, and reputation write failure.',
    items: [
      'escrow_settled and escrow_refunded fire from settleOrRefund and refundExpiredEscrow',
      'council_decision summarizes vote breakdown after consensus tallies',
      'reputation_write_failed only fires on terminal failure (5+ retries)',
      'payroll_failed surfaces actual revert reason via try/catch around writeContract',
    ],
  },
  {
    version: 'v0.7.4',
    date: 'May 3, 2026',
    title: 'Multi-rail x402 (Tempo + Base + Solana)',
    description: 'Most paid endpoints now accept payment on three chains in one 402 challenge. Agents pick whichever rail their wallet has balance on.',
    items: [
      '7 multi-rail endpoints: yield-rates, agent/pay, compliance/check, escrow/post, escrow/deliver, escrow status, memo/decode',
      'Single 402 surfaces all rails: WWW-Authenticate header for Tempo, accepts[] for Base + Solana',
      'CDP facilitator handles Base + Solana verify + settle out of band',
      'State-mutating endpoints (payroll execute, fiat off-ramp) intentionally Tempo-only',
    ],
  },
  {
    version: 'v0.7.3',
    date: 'May 3, 2026',
    title: 'Bridge KYC integration rewritten + Resend transactional email',
    description: 'Bridge KYC link flow corrected against the actual Bridge sandbox docs. Branded transactional email shipped with five templates and webhook-driven suppression.',
    items: [
      'Standalone KYC Links flow (Bridge creates customer record from submitted data)',
      'RSA-SHA256 webhook signature verification with 10-minute replay protection',
      'New bridge_kyc_link_id column for resolving kyc_link.completed events',
      'Five branded React Email templates: invite, welcome, payroll receipt, payroll failed, KYC reminder',
    ],
  },
  {
    version: 'v0.7.1',
    date: 'April 21, 2026',
    title: 'Contract redeploy with full audit fix pass',
    description: 'All five Solidity contracts redeployed on Tempo Moderato with 22-finding audit fix pass applied. Stuck-funds class of bug eliminated by enforcing memo prefix at deposit.',
    items: [
      'PayrollTreasury M-1 memo prefix enforcement',
      'PayrollBatcher H-4 optional EmployeeRegistry validation',
      'YieldRouter H-5 strategy allow-list',
      'StreamVesting H-2 unclaimed-refund queue',
      'EmployeeRegistry C-6 O(1) reverse lookup',
    ],
  },
]

export default function ChangelogPage() {
  return (
    <div className="space-y-16">
      <div className="max-w-xl">
        <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-4 tracking-tight">Changelog</h1>
        <p className="text-lg text-[var(--text-secondary)]">The latest updates, improvements, and fixes for the Remlo infrastructure.</p>
      </div>

      <div className="space-y-16">
        {UPDATES.map((u) => (
          <div key={u.version} className="relative pl-12 before:absolute before:left-[19px] before:top-2 before:bottom-0 before:w-px before:bg-[var(--border-default)] last:before:hidden">
            <div className="absolute left-0 top-1.5 h-10 w-10 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-default)] flex items-center justify-center z-10">
              <div className="h-2 w-2 rounded-full bg-[var(--accent)]" />
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-[10px] font-bold uppercase tracking-wider">{u.version}</span>
                <span className="text-sm text-[var(--text-muted)]">{u.date}</span>
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">{u.title}</h2>
              <p className="text-[var(--text-secondary)] leading-relaxed">{u.description}</p>
              <ul className="list-disc pl-6 space-y-2 text-sm text-[var(--text-secondary)] pt-2">
                {u.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
