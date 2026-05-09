'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { usePrivyAuthedFetch } from '@/lib/hooks/usePrivyAuthedFetch'

/**
 * Pre-flight every selected recipient against the token's TIP-403 policy
 * before the employer hits "Execute". Runs server-side reads only — no
 * funds move. The panel renders quietly when everyone passes; loudly when
 * anyone is blocked.
 *
 * Skipped on non-Tempo chains (Solana doesn't have a TIP-403 equivalent).
 */

export interface CompliancePreflightPanelProps {
  employerId: string
  employeeIds: string[]
  chain: 'tempo' | 'solana'
}

interface PreflightResult {
  address: string
  ok: boolean
  policy: { id: string; type: string }
  authorization: {
    legacy: boolean
    sender: boolean
    recipient: boolean
    mintRecipient: boolean
  }
}

interface PreflightResponse {
  network: string
  results: PreflightResult[]
  summary: { total: number; ok: number; blocked: number }
}

export function CompliancePreflightPanel({
  employerId,
  employeeIds,
  chain,
}: CompliancePreflightPanelProps) {
  const authedFetch = usePrivyAuthedFetch()

  const query = useQuery<PreflightResponse>({
    queryKey: ['compliance-preflight', employerId, employeeIds.join(','), chain],
    queryFn: async () => {
      const res = await authedFetch(
        `/api/employers/${employerId}/compliance/preflight`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeIds }),
        },
      )
      if (!res.ok) {
        throw new Error(`Pre-flight failed (${res.status})`)
      }
      return res.json()
    },
    enabled: chain === 'tempo' && employeeIds.length > 0,
    retry: false,
  })

  if (chain !== 'tempo') return null

  if (query.isLoading) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking TIP-403 compliance for {employeeIds.length}{' '}
        {employeeIds.length === 1 ? 'recipient' : 'recipients'}…
      </div>
    )
  }

  if (query.isError) {
    // Pre-flight failure shouldn't block the run — surface a soft note.
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 flex items-start gap-2 text-xs text-[var(--text-muted)]">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        Could not pre-check compliance. Payroll will still run; the chain enforces compliance natively
        and any blocked recipient will revert the transfer.
      </div>
    )
  }

  const { summary, results } = query.data ?? { summary: { total: 0, ok: 0, blocked: 0 }, results: [] }
  const blocked = results.filter((r) => !r.ok)

  if (summary.total === 0) return null

  if (summary.blocked === 0) {
    return (
      <div className="rounded-lg border border-[var(--status-success)]/30 bg-[var(--status-success)]/5 px-4 py-3 flex items-start gap-2">
        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--status-success)]" />
        <div className="text-xs leading-5">
          <span className="font-medium text-[var(--text-primary)]">
            All {summary.total} recipients clear TIP-403.
          </span>{' '}
          <span className="text-[var(--text-muted)]">
            Policy {results[0]?.policy.id ?? '—'} · {results[0]?.policy.type ?? '—'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--status-error)]" />
        <div className="text-xs leading-5">
          <span className="font-medium text-[var(--text-primary)]">
            {summary.blocked} of {summary.total} recipients will fail compliance.
          </span>{' '}
          <span className="text-[var(--text-muted)]">
            The on-chain transfer will revert for blocked addresses. Resolve before running, or remove
            them from this batch.
          </span>
        </div>
      </div>
      <ul className="pl-5 space-y-0.5">
        {blocked.slice(0, 8).map((r) => (
          <li key={r.address} className="text-[11px] text-[var(--status-error)]">
            <span className="font-mono">{r.address.slice(0, 10)}…{r.address.slice(-6)}</span> —{' '}
            {r.authorization.sender ? '' : 'sender ✗ '}
            {r.authorization.recipient ? '' : 'recipient ✗'}
          </li>
        ))}
        {blocked.length > 8 && (
          <li className="text-[11px] text-[var(--status-error)]">
            …and {blocked.length - 8} more.
          </li>
        )}
      </ul>
    </div>
  )
}
