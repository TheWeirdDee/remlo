'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Hash,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import { SectionHeader } from '@/components/ui/SectionHeader'
import {
  AdminReasonGuard,
  useReasonedAuthedJson,
} from '@/components/admin/AdminReasonGuard'
import { TEMPO_EXPLORER_URL } from '@/lib/constants'

interface PayrollDetail {
  run: {
    id: string
    employer_id: string
    status: string
    total_amount: number | null
    employee_count: number | null
    tx_hash: string | null
    finalized_at: string | null
    settlement_time_ms: number | null
    chain: string | null
    created_at: string
  }
  employer: {
    id: string
    company_name: string
    owner_user_id: string
  } | null
  breakdown: {
    confirmed: number
    pending: number
    failed: number
    total: number
    totalAmount: number
  }
  recipients: Array<{
    id: string
    employee_id: string | null
    name: string
    email: string | null
    wallet_address: string | null
    kyc_status: string | null
    amount: number
    status: string
    tx_hash: string | null
    created_at: string
  }>
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

const STATUS_BADGE: Record<string, { tint: string; label: string }> = {
  confirmed: { tint: 'text-[var(--status-success)] border-[var(--status-success)]/30 bg-[var(--status-success)]/10', label: 'Confirmed' },
  pending: { tint: 'text-[var(--status-pending)] border-[var(--status-pending)]/30 bg-[var(--status-pending)]/10', label: 'Pending' },
  failed: { tint: 'text-[var(--status-error)] border-[var(--status-error)]/30 bg-[var(--status-error)]/10', label: 'Failed' },
}

export default function PayrollDetailPage(): React.ReactElement {
  const params = useParams<{ runId: string }>()
  const runId = params.runId

  return (
    <AdminReasonGuard
      resourceKey={`payroll_run:${runId}`}
      purpose="View payroll run detail"
      cancelHref="/admin"
      context={
        <>
          <strong>Scope of this view:</strong> per-recipient payment breakdown including names,
          emails, wallet addresses, KYC status, and individual transaction hashes for this run.
        </>
      }
    >
      <PayrollDetailBody runId={runId} />
    </AdminReasonGuard>
  )
}

function PayrollDetailBody({ runId }: { runId: string }): React.ReactElement {
  const fetchJson = useReasonedAuthedJson()

  const detail = useQuery<PayrollDetail>({
    queryKey: ['admin-payroll', runId],
    queryFn: () => fetchJson(`/api/admin/payroll/${runId}`),
    enabled: Boolean(runId),
  })

  if (detail.isLoading) {
    return <div className="h-96 animate-pulse rounded-2xl bg-[var(--bg-subtle)]" />
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          Could not load payroll run.
        </div>
      </div>
    )
  }

  const { run, employer, breakdown, recipients } = detail.data
  const explorerUrl = run.tx_hash ? `${TEMPO_EXPLORER_URL}/tx/${run.tx_hash}` : null

  return (
    <div className="space-y-6">
      {employer ? (
        <Link
          href={`/admin/employers/${employer.id}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {employer.company_name}
        </Link>
      ) : (
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      )}

      <SectionHeader
        title="Payroll run"
        description={
          employer
            ? `${employer.company_name} · ${formatDate(run.created_at)} · status: ${run.status}`
            : `${formatDate(run.created_at)} · status: ${run.status}`
        }
      />

      {/* Top tiles */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Recipients"
          value={breakdown.total}
          hint={`Run was created with ${run.employee_count ?? 0}`}
          icon={Users}
        />
        <SummaryTile
          label="Confirmed"
          value={breakdown.confirmed}
          icon={CheckCircle2}
          tone="success"
        />
        <SummaryTile
          label="Pending"
          value={breakdown.pending}
          icon={Clock}
          tone={breakdown.pending > 0 ? 'warning' : 'default'}
        />
        <SummaryTile
          label="Failed"
          value={breakdown.failed}
          icon={XCircle}
          tone={breakdown.failed > 0 ? 'error' : 'default'}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryTile label="Total amount" value={formatCurrency(breakdown.totalAmount)} icon={Wallet} />
        <SummaryTile
          label="Run status"
          value={run.status}
          icon={CheckCircle2}
          tone={run.status === 'failed' ? 'error' : run.status === 'confirmed' ? 'success' : 'default'}
        />
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">Tx hash</p>
            <Hash className="h-4 w-4 text-[var(--text-muted)]" />
          </div>
          {run.tx_hash ? (
            <a
              href={explorerUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 break-all font-mono text-xs text-[var(--accent)] hover:underline"
            >
              {run.tx_hash}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-muted)]">No tx hash yet.</p>
          )}
        </div>
      </div>

      {/* Recipients table */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Per-recipient breakdown</h2>
          <span className="text-xs text-[var(--text-muted)]">{recipients.length} rows</span>
        </header>
        {recipients.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-[var(--text-muted)]">
            No payment items recorded for this run.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-base)]">
                <tr className="text-left">
                  {['Recipient', 'Wallet', 'KYC', 'Amount', 'Status', 'Tx'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {recipients.map((r) => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending
                  return (
                    <tr key={r.id}>
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-[var(--text-primary)]">{r.name}</p>
                        {r.email && <p className="text-xs text-[var(--text-muted)]">{r.email}</p>}
                      </td>
                      <td className="px-5 py-3">
                        {r.wallet_address ? (
                          <span className="font-mono text-xs text-[var(--text-secondary)]">
                            {r.wallet_address.slice(0, 8)}…{r.wallet_address.slice(-6)}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">No wallet</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {r.kyc_status === 'approved' ? (
                          <span className="text-[var(--status-success)]">approved</span>
                        ) : r.kyc_status === 'rejected' ? (
                          <span className="text-[var(--status-error)]">rejected</span>
                        ) : (
                          <span className="text-[var(--text-muted)]">{r.kyc_status ?? 'pending'}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-sm text-[var(--text-primary)]">
                        {formatCurrency(r.amount)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-[10px] uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${badge.tint}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {r.tx_hash ? (
                          <a
                            href={`${TEMPO_EXPLORER_URL}/tx/${r.tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-[var(--accent)] hover:underline"
                          >
                            {r.tx_hash.slice(0, 10)}…
                          </a>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: number | string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'warning' | 'error' | 'success'
}) {
  const valueClass =
    tone === 'error'
      ? 'text-[var(--status-error)]'
      : tone === 'warning'
        ? 'text-[var(--status-pending)]'
        : tone === 'success'
          ? 'text-[var(--status-success)]'
          : 'text-[var(--text-primary)]'
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</p>
        <Icon className="h-4 w-4 text-[var(--text-muted)]" />
      </div>
      <p className={`mt-3 text-2xl font-semibold ${valueClass}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  )
}
