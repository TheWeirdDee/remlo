'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, ExternalLink, Users, Wallet, AlertCircle, FileDown, Loader2, Sheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PayrollBadge } from '@/components/employee/PayrollBadge'
import { useEmployer } from '@/lib/hooks/useEmployer'
import { usePayrollRun } from '@/lib/hooks/useDashboard'
import { usePrivyAuthedFetch } from '@/lib/hooks/usePrivyAuthedFetch'
import { TEMPO_EXPLORER_URL } from '@/lib/constants'
import { cn } from '@/lib/utils'

const SOLANA_EXPLORER_URL = 'https://explorer.solana.com'

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function shortHash(hash: string): string {
  if (hash.length <= 18) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

function explorerLinkForChain(chain: string, txOrSig: string): string {
  if (chain === 'solana') {
    return `${SOLANA_EXPLORER_URL}/tx/${txOrSig}?cluster=devnet`
  }
  return `${TEMPO_EXPLORER_URL}/tx/${txOrSig}`
}

export default function PayrollRunDetailsPage({ params }: { params: Promise<{ runId: string }> }) {
  const router = useRouter()
  const resolvedParams = React.use(params)
  const runId = resolvedParams.runId

  const { data: employer } = useEmployer()
  const { data, isLoading, error } = usePayrollRun(employer?.id, runId)

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="outline"
          onClick={() => router.back()}
          className="mb-4 gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Payroll
        </Button>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Payroll Run Details
            </h1>
            <p className="font-mono text-xs text-[var(--text-muted)] mt-1">{runId}</p>
          </div>
          {employer?.id && data && (
            <ExportButtons employerId={employer.id} runId={runId} />
          )}
        </div>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          Loading payroll run…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[var(--status-error)] bg-red-500/5 p-5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-[var(--status-error)] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">Failed to load run</p>
            <p className="text-xs text-[var(--text-muted)]">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        </div>
      )}

      {data && <PayrollRunContent run={data.run} items={data.items} />}
    </div>
  )
}

function PayrollRunContent({
  run,
  items,
}: {
  run: NonNullable<ReturnType<typeof usePayrollRun>['data']>['run']
  items: NonNullable<ReturnType<typeof usePayrollRun>['data']>['items']
}) {
  const completedCount = items.filter((it) => it.status === 'confirmed' || it.status === 'completed').length
  const failedCount = items.filter((it) => it.status === 'failed').length
  const pendingCount = items.length - completedCount - failedCount

  return (
    <>
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PayrollBadge status={run.status} />
            <span className="text-xs text-[var(--text-muted)]">
              Created {formatDateTime(run.created_at)}
            </span>
          </div>
          {run.chain && (
            <span className="text-xs font-mono uppercase tracking-wide text-[var(--text-muted)]">
              {run.chain}
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryStat
            label="Total amount"
            value={formatCurrency(run.total_amount)}
          />
          <SummaryStat
            label="Employees"
            value={String(run.employee_count ?? items.length)}
            icon={<Users className="h-4 w-4 text-[var(--text-muted)]" />}
          />
          <SummaryStat
            label="Settlement"
            value={
              run.settlement_time_ms !== null
                ? `${(run.settlement_time_ms / 1000).toFixed(2)}s`
                : run.finalized_at
                  ? formatDateTime(run.finalized_at)
                  : 'In progress'
            }
          />
        </div>

        {run.tx_hash && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-subtle)]">
            <Wallet className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
            <span className="text-xs text-[var(--text-muted)]">Batch tx</span>
            <a
              href={explorerLinkForChain(run.chain ?? 'tempo', run.tx_hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 font-mono text-xs text-[var(--accent)] hover:underline"
            >
              {shortHash(run.tx_hash)}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {run.mpp_receipt_hash && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-subtle)]">
            <span className="text-xs text-[var(--text-muted)]">MPP receipt</span>
            <span className="ml-auto font-mono text-xs text-[var(--text-secondary)]">
              {shortHash(run.mpp_receipt_hash)}
            </span>
          </div>
        )}

        {(completedCount > 0 || failedCount > 0 || pendingCount > 0) && (
          <div className="flex items-center gap-4 pt-1 text-xs">
            {completedCount > 0 && (
              <span className="text-[var(--status-success)]">{completedCount} paid</span>
            )}
            {pendingCount > 0 && (
              <span className="text-[var(--status-pending)]">{pendingCount} pending</span>
            )}
            {failedCount > 0 && (
              <span className="text-[var(--status-error)]">{failedCount} failed</span>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <div className="px-5 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Itemized payouts</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {items.length} {items.length === 1 ? 'employee' : 'employees'} in this batch
          </p>
        </div>

        {items.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
            No payment items recorded for this run.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-default)]">
            {items.map((item) => (
              <PaymentItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function SummaryStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
      <p className="text-base font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  )
}

function PaymentItemRow({
  item,
}: {
  item: NonNullable<ReturnType<typeof usePayrollRun>['data']>['items'][number]
}) {
  const displayName = item.employee_name || item.employee_email || 'Unknown employee'
  const txOrSig = item.tx_hash ?? item.solana_signature
  const isFailed = item.status === 'failed'

  return (
    <li className="px-5 py-3.5 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
            {displayName}
          </p>
          <PayrollBadge status={item.status} />
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          {item.employee_email && item.employee_name && (
            <span className="truncate">{item.employee_email}</span>
          )}
          {item.wallet_address && (
            <span className="font-mono">
              {item.wallet_address.slice(0, 6)}…{item.wallet_address.slice(-4)}
            </span>
          )}
        </div>
        {isFailed && item.policy_rejection_reason && (
          <p className="mt-1 text-xs text-[var(--status-error)]">
            {item.policy_rejection_reason}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span
          className={cn(
            'font-mono text-sm font-semibold',
            isFailed ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]',
          )}
        >
          {formatCurrency(item.amount)}
        </span>
        {txOrSig ? (
          <a
            href={explorerLinkForChain(item.chain ?? 'tempo', txOrSig)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-[var(--accent)] hover:underline"
          >
            {shortHash(txOrSig)}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">No tx</span>
        )}
      </div>
    </li>
  )
}

/**
 * ExportButtons — PDF + CSV download for the current run.
 *
 * Privy auth is bearer-based, so a plain <a href> can't fetch the file
 * directly. We hit the API with the auth fetcher, blob the response, and
 * trigger a download from a hidden anchor. Both buttons share state so the
 * spinner + disabled feedback applies to whichever the user clicked.
 */
function ExportButtons({ employerId, runId }: { employerId: string; runId: string }) {
  const authedFetch = usePrivyAuthedFetch()
  const [busy, setBusy] = React.useState<null | 'pdf' | 'csv'>(null)

  async function download(format: 'pdf' | 'csv') {
    if (busy) return
    setBusy(format)
    try {
      const response = await authedFetch(
        `/api/employers/${employerId}/payroll/${runId}/export?format=${format}`,
      )
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `Could not export ${format.toUpperCase()}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `payroll-${runId.slice(0, 8)}-${stamp}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void download('pdf')}
        disabled={busy !== null}
        className="gap-2"
      >
        {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
        Export PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void download('csv')}
        disabled={busy !== null}
        className="gap-2"
      >
        {busy === 'csv' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sheet className="h-3.5 w-3.5" />}
        Export CSV
      </Button>
    </div>
  )
}
