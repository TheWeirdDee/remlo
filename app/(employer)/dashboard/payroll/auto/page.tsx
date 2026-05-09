'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSendTransaction } from '@privy-io/react-auth'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  KeyRound,
  Loader2,
  Pause,
  Play,
  PlusCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { useEmployer } from '@/lib/hooks/useEmployer'
import { usePrivyAuthedFetch, usePrivyAuthedJson } from '@/lib/hooks/usePrivyAuthedFetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionHeader } from '@/components/ui/SectionHeader'

/**
 * /dashboard/payroll/auto — Auto-Payroll authorization manager.
 *
 * The employer signs ONE on-chain authorization per active row that says
 * "Remlo can spend at most $X / week from my treasury via PayrollBatcher
 * for the next N weeks." The chain enforces the cap; Remlo's cron
 * triggers each cycle without further employer prompts.
 *
 * The signing flow has two transactions:
 *   1. Employer signs `authorizeKey(...)` against the AccountKeychain
 *      precompile (this page → wallet).
 *   2. Employer reports the resulting tx hash back to Remlo — the row
 *      flips draft → active.
 *
 * Revocation is symmetric: server returns the `revokeKey(...)` calldata,
 * employer signs + broadcasts, then reports the revoke tx hash.
 */

type Status = 'draft' | 'active' | 'paused' | 'revoked' | 'expired' | 'failed'

interface Authorization {
  id: string
  status: Status
  access_key_address: string
  token_address: string
  per_period_amount: string
  period_seconds: number
  expires_at_unix: number
  scoped_target: string
  scoped_selector: string
  authorize_tx_hash: string | null
  revoke_tx_hash: string | null
  last_run_at: string | null
  last_run_status: string | null
  last_run_tx_hash: string | null
  cycles_executed: number
  notes: string | null
  created_at: string
}

interface CreateResponse {
  id: string
  accessKeyAddress: string
  authorizationCalldata: string
  authorizationTarget: string
  perPeriodAmount: string
  periodSeconds: number
  tokenAddress: string
}

const STATUS_META: Record<Status, { label: string; tint: string }> = {
  draft: {
    label: 'Awaiting on-chain signature',
    tint: 'border-[var(--status-pending)]/30 bg-[var(--status-pending)]/10 text-[var(--status-pending)]',
  },
  active: {
    label: 'Active',
    tint: 'border-[var(--status-success)]/30 bg-[var(--status-success)]/10 text-[var(--status-success)]',
  },
  paused: {
    label: 'Paused',
    tint: 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-muted)]',
  },
  revoked: {
    label: 'Revoked',
    tint: 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-muted)]',
  },
  expired: {
    label: 'Expired',
    tint: 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-muted)]',
  },
  failed: {
    label: 'Failed — review',
    tint: 'border-[var(--status-error)]/30 bg-[var(--status-error)]/10 text-[var(--status-error)]',
  },
}

function formatUsd(rawBaseUnits: string, decimals = 6): string {
  try {
    const raw = BigInt(rawBaseUnits)
    const factor = 10n ** BigInt(decimals)
    const whole = raw / factor
    return `$${whole.toLocaleString('en-US')}`
  } catch {
    return rawBaseUnits
  }
}

function formatPeriod(seconds: number): string {
  if (seconds === 86_400) return 'every day'
  if (seconds === 604_800) return 'every week'
  if (seconds === 86_400 * 14) return 'every 2 weeks'
  const days = Math.round(seconds / 86_400)
  return `every ${days} day${days === 1 ? '' : 's'}`
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export default function AutoPayrollPage(): React.ReactElement {
  const { data: employer } = useEmployer()
  const fetchJson = usePrivyAuthedJson()
  const queryClient = useQueryClient()
  const [composing, setComposing] = React.useState(false)

  const list = useQuery<{ items: Authorization[] }>({
    queryKey: ['autopayroll', employer?.id],
    queryFn: () => fetchJson(`/api/employers/${employer!.id}/autopayroll`),
    enabled: Boolean(employer?.id),
  })

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/payroll/new"
        className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to payroll
      </Link>

      <SectionHeader
        title="Auto-Payroll"
        description="Sign once. Salary runs every cycle without you logging in. The on-chain spending cap stays in your control — revoke any time."
        action={
          employer?.id && !composing ? (
            <Button onClick={() => setComposing(true)} className="gap-2">
              <PlusCircle className="h-4 w-4" />
              New authorization
            </Button>
          ) : null
        }
      />

      <ExplainerCard />

      {composing && employer?.id && (
        <ComposeForm
          employerId={employer.id}
          onCancel={() => setComposing(false)}
          onCreated={() => {
            setComposing(false)
            void queryClient.invalidateQueries({ queryKey: ['autopayroll', employer.id] })
          }}
        />
      )}

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Authorizations</h2>
          </div>
          {list.data && (
            <span className="text-xs text-[var(--text-muted)]">{list.data.items.length} total</span>
          )}
        </header>
        {list.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-xs text-[var(--text-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        ) : !list.data || list.data.items.length === 0 ? (
          <div className="px-5 py-12 text-center text-xs text-[var(--text-muted)]">
            No authorizations yet. Create one above to enable Auto-Payroll.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-default)]">
            {list.data.items.map((auth) => (
              <li key={auth.id} className="px-5 py-4">
                <AuthorizationRow auth={auth} employerId={employer!.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ExplainerCard() {
  return (
    <div className="rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-[var(--accent)]" />
        <div className="text-sm leading-6 text-[var(--text-secondary)]">
          <p className="font-medium text-[var(--text-primary)]">How this works</p>
          <ol className="mt-2 list-decimal pl-5 space-y-1">
            <li>You set a per-period spending cap (e.g. $50,000 per week) and a duration (e.g. 12 weeks).</li>
            <li>You sign one on-chain transaction at the Tempo AccountKeychain. The chain enforces the cap.</li>
            <li>Each cycle, Remlo runs your active employee roster automatically — no further prompts.</li>
            <li>You can pause or revoke any time. Revocation requires one more on-chain signature, fully under your control.</li>
          </ol>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            This is testnet-only beta. Mainnet support unlocks once Tempo's calendar-month period lands and we re-test
            the flow end-to-end.
          </p>
        </div>
      </div>
    </div>
  )
}

interface ComposeFormProps {
  employerId: string
  onCancel: () => void
  onCreated: () => void
}

function ComposeForm({ employerId, onCancel, onCreated }: ComposeFormProps) {
  const fetchJson = usePrivyAuthedJson()
  const { sendTransaction } = useSendTransaction()
  const authedFetch = usePrivyAuthedFetch()
  const [amount, setAmount] = React.useState('5000') // dollars
  const [periodSeconds, setPeriodSeconds] = React.useState(604_800) // 1 week
  const [durationWeeks, setDurationWeeks] = React.useState(12)
  const [notes, setNotes] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [pendingSign, setPendingSign] = React.useState<CreateResponse | null>(null)
  const [signing, setSigning] = React.useState(false)

  const amountNumber = Number(amount)
  const canCreate = amountNumber > 0 && periodSeconds >= 3600 && durationWeeks > 0 && !creating

  async function handleCreate() {
    if (!canCreate) return
    setCreating(true)
    try {
      const baseUnits = (BigInt(Math.round(amountNumber * 1_000_000))).toString() // 6 decimals
      const expiresAtUnix =
        Math.floor(Date.now() / 1000) + durationWeeks * 7 * 86_400
      const created = await fetchJson<CreateResponse>(
        `/api/employers/${employerId}/autopayroll`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            perPeriodAmount: baseUnits,
            periodSeconds,
            expiresAtUnix,
            notes: notes.trim() || undefined,
          }),
        },
      )
      setPendingSign(created)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create authorization')
    } finally {
      setCreating(false)
    }
  }

  async function handleSign() {
    if (!pendingSign) return
    setSigning(true)
    try {
      const receipt = await sendTransaction({
        to: pendingSign.authorizationTarget as `0x${string}`,
        data: pendingSign.authorizationCalldata as `0x${string}`,
        value: 0n,
      })
      const txHash = receipt.transactionHash
      // Confirm with server.
      const res = await authedFetch(
        `/api/employers/${employerId}/autopayroll/${pendingSign.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'confirm', authorizeTxHash: txHash }),
        },
      )
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? 'Server rejected the confirmation.')
      }
      toast.success('Auto-Payroll active. Remlo will run your next payroll cycle automatically.')
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signature failed')
    } finally {
      setSigning(false)
    }
  }

  if (pendingSign) {
    return (
      <section className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-5 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-[var(--accent)]">Step 2 of 2</p>
          <h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">
            Sign the on-chain authorization
          </h3>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Your wallet will pop up to sign one transaction at the Tempo AccountKeychain
            precompile. Until you sign, no Auto-Payroll cycle can run.
          </p>
        </div>
        <dl className="grid gap-px rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] sm:grid-cols-2">
          <Field label="Per-period cap" value={`${formatUsd(pendingSign.perPeriodAmount)} ${formatPeriod(pendingSign.periodSeconds)}`} />
          <Field label="Access key" value={pendingSign.accessKeyAddress} mono />
          <Field label="Authorize target" value={pendingSign.authorizationTarget} mono />
          <Field label="Token" value={pendingSign.tokenAddress} mono />
        </dl>
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={signing}>
            Cancel
          </Button>
          <Button onClick={handleSign} disabled={signing} className="gap-2">
            {signing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Sign and authorize
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Step 1 of 2</p>
        <h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">
          Configure the spending limit
        </h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)]">Cap per period (USD)</label>
          <Input
            type="number"
            min="1"
            step="100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50000"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)]">Period</label>
          <select
            value={periodSeconds}
            onChange={(e) => setPeriodSeconds(Number(e.target.value))}
            className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-primary)]"
          >
            <option value={86_400}>Daily</option>
            <option value={604_800}>Weekly</option>
            <option value={86_400 * 14}>Bi-weekly</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)]">Duration (weeks)</label>
          <Input
            type="number"
            min="1"
            max="52"
            value={durationWeeks}
            onChange={(e) => setDurationWeeks(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-xs text-[var(--text-muted)]">Notes (optional)</label>
          <Input
            placeholder="Q2 weekly contractor payouts"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => void handleCreate()} disabled={!canCreate} className="gap-2">
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Continue to signing
        </Button>
      </div>
    </section>
  )
}

interface AuthorizationRowProps {
  auth: Authorization
  employerId: string
}

function AuthorizationRow({ auth, employerId }: AuthorizationRowProps) {
  const queryClient = useQueryClient()
  const authedFetch = usePrivyAuthedFetch()
  const { sendTransaction } = useSendTransaction()
  const meta = STATUS_META[auth.status]

  const action = useMutation({
    mutationFn: async (
      payload: { action: 'pause' | 'resume' } | { action: 'revoke'; revokeTxHash: string },
    ) => {
      const res = await authedFetch(`/api/employers/${employerId}/autopayroll/${auth.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? 'Update failed')
      }
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['autopayroll', employerId] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Update failed'),
  })

  async function handleRevoke() {
    try {
      const res = await authedFetch(`/api/employers/${employerId}/autopayroll/${auth.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? 'Could not fetch revoke calldata.')
      }
      const { revokeCalldata, revokeTarget } = (await res.json()) as {
        revokeCalldata: string
        revokeTarget: string
      }
      const receipt = await sendTransaction({
        to: revokeTarget as `0x${string}`,
        data: revokeCalldata as `0x${string}`,
        value: 0n,
      })
      action.mutate({ action: 'revoke', revokeTxHash: receipt.transactionHash })
      toast.success('Revoke broadcast — Remlo will stop running cycles immediately.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-[10px] uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${meta.tint}`}
          >
            {meta.label}
          </span>
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {formatUsd(auth.per_period_amount)} {formatPeriod(auth.period_seconds)}
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          {auth.cycles_executed} cycle{auth.cycles_executed === 1 ? '' : 's'} run · last:{' '}
          {auth.last_run_at ? formatTimestamp(auth.last_run_at) : 'never'}
          {auth.last_run_status && ` (${auth.last_run_status})`}
        </p>
        <p className="font-mono text-[10px] text-[var(--text-muted)] truncate">
          Key: {auth.access_key_address}
        </p>
        {auth.notes && (
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{auth.notes}</p>
        )}
        {auth.last_run_status === 'failed' && (
          <p className="flex items-center gap-1 text-xs text-[var(--status-error)]">
            <AlertTriangle className="h-3 w-3" />
            Last cycle failed. Authorization paused until you investigate.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {auth.status === 'active' && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => action.mutate({ action: 'pause' })}
              disabled={action.isPending}
              className="gap-2"
            >
              <Pause className="h-3 w-3" />
              Pause
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRevoke()}
              disabled={action.isPending}
              className="gap-2"
            >
              <XCircle className="h-3 w-3" />
              Revoke
            </Button>
          </>
        )}
        {auth.status === 'paused' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => action.mutate({ action: 'resume' })}
            disabled={action.isPending}
            className="gap-2"
          >
            <Play className="h-3 w-3" />
            Resume
          </Button>
        )}
        {auth.status === 'draft' && (
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Sign to activate
          </span>
        )}
        {auth.status === 'active' && auth.cycles_executed > 0 && (
          <CheckCircle2 className="h-4 w-4 text-[var(--status-success)]" />
        )}
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-[var(--bg-surface)] px-4 py-3">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</dt>
      <dd
        className={`mt-1 break-all text-xs text-[var(--text-primary)] ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}
