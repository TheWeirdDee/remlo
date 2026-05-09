'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePrivy } from '@privy-io/react-auth'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cog,
  Pause,
  Sparkles,
  XOctagon,
} from 'lucide-react'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { usePrivyAuthedJson } from '@/lib/hooks/usePrivyAuthedFetch'

/**
 * /admin/crons — operational pulse for the four background jobs.
 *
 * Polls /api/admin/crons every 15s. The API returns per-cron health
 * derived from the cron_runs audit table (one row per fire, populated
 * via lib/cron-runs.ts withCronRun wrapper).
 *
 * Each cron card shows: traffic-light status, last run summary, expected
 * next run, last-24h success/failure tally, and an expandable timeline
 * of recent runs with errors inline.
 */

type Health = 'green' | 'yellow' | 'red' | 'unknown'

interface CronRunRow {
  id: string
  cron_name: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'success' | 'failed' | 'no_op' | 'partial'
  records_processed: number
  error_message: string | null
  duration_ms: number | null
  metadata: unknown
}

interface CronHealth {
  name: string
  path: string
  schedule: string
  description: string
  cadenceSeconds: number
  maxDurationSeconds: number
  health: Health
  lastRun: CronRunRow | null
  nextExpectedAt: string | null
  staleSeconds: number | null
  last24h: {
    total: number
    success: number
    no_op: number
    failed: number
    partial: number
    crashed: number
  }
  recent: CronRunRow[]
}

interface AdminCronsResponse {
  crons: CronHealth[]
  overall: Health
  generatedAt: string
}

export default function AdminCronsPage() {
  const { ready, authenticated } = usePrivy()
  const fetchJson = usePrivyAuthedJson()

  const { data, isLoading, error } = useQuery<AdminCronsResponse>({
    queryKey: ['admin', 'crons'],
    queryFn: () => fetchJson('/api/admin/crons'),
    enabled: ready && authenticated,
    refetchInterval: 15_000,
    retry: false,
  })

  if (isLoading) {
    return <div className="h-96 animate-pulse rounded-2xl bg-[var(--bg-subtle)]" />
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
        <p className="text-sm text-red-400">
          Could not load cron health. {error instanceof Error ? error.message : 'Unknown error.'}
        </p>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Cron jobs"
        description="Live status of background jobs from the cron_runs audit table. Polls every 15 seconds. Vercel triggers each cron on its own schedule; this view is for confirming they actually fired and what they did."
      />

      <OverallSummary overall={data.overall} crons={data.crons} generatedAt={data.generatedAt} />

      <div className="space-y-4">
        {data.crons.map((cron) => (
          <CronCard key={cron.name} cron={cron} />
        ))}
      </div>
    </div>
  )
}

function OverallSummary({
  overall,
  crons,
  generatedAt,
}: {
  overall: Health
  crons: CronHealth[]
  generatedAt: string
}) {
  const totals = crons.reduce(
    (acc, c) => {
      acc.success += c.last24h.success
      acc.no_op += c.last24h.no_op
      acc.failed += c.last24h.failed + c.last24h.partial
      acc.crashed += c.last24h.crashed
      return acc
    },
    { success: 0, no_op: 0, failed: 0, crashed: 0 },
  )
  const tone = healthTone(overall)
  return (
    <div className={`rounded-2xl border ${tone.border} ${tone.bg} p-5`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <HealthDot health={overall} size="lg" />
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Overall cron health
            </p>
            <p className={`text-lg font-semibold ${tone.text}`}>{healthLabel(overall)}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-6 text-sm">
          <Stat label="Success (24h)" value={totals.success} accent="text-emerald-400" />
          <Stat label="No-op (24h)" value={totals.no_op} accent="text-[var(--text-muted)]" />
          <Stat label="Failed (24h)" value={totals.failed} accent="text-red-400" />
          <Stat label="Crashed" value={totals.crashed} accent="text-red-400" />
        </div>
      </div>
      <p className="mt-4 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Updated {new Date(generatedAt).toLocaleTimeString()}
      </p>
    </div>
  )
}

function CronCard({ cron }: { cron: CronHealth }) {
  const [expanded, setExpanded] = React.useState(false)
  const tone = healthTone(cron.health)

  return (
    <div className={`rounded-2xl border ${tone.border} bg-[var(--bg-surface)] overflow-hidden`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-5 hover:bg-[var(--bg-subtle)]/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <HealthDot health={cron.health} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{cron.name}</h3>
                <code className="text-[10px] rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[var(--text-muted)]">
                  {cron.schedule}
                </code>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">{cron.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-xs">
            <RunSummary cron={cron} />
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <FactPill label="Success (24h)" value={cron.last24h.success} accent="text-emerald-400" />
          <FactPill label="No-op (24h)" value={cron.last24h.no_op} accent="text-[var(--text-muted)]" />
          <FactPill
            label="Failed (24h)"
            value={cron.last24h.failed + cron.last24h.partial}
            accent="text-red-400"
          />
          <FactPill label="Crashed" value={cron.last24h.crashed} accent="text-red-400" />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-default)] p-5 bg-[var(--bg-base)]/40 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <Field label="Last fired">
              {cron.lastRun
                ? `${formatRelative(cron.lastRun.started_at)} (${new Date(cron.lastRun.started_at).toLocaleString()})`
                : 'never'}
            </Field>
            <Field label="Next expected">
              {cron.nextExpectedAt
                ? `${formatRelative(cron.nextExpectedAt)} (${new Date(cron.nextExpectedAt).toLocaleTimeString()})`
                : '—'}
            </Field>
            <Field label="Stale">
              {cron.staleSeconds !== null && cron.staleSeconds > 0
                ? `${formatDuration(cron.staleSeconds)} past expected`
                : 'on schedule'}
            </Field>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
              Recent runs (last 24h)
            </p>
            {cron.recent.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No fires in the last 24 hours.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-default)] rounded-lg border border-[var(--border-default)] overflow-hidden">
                {cron.recent.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RunRow({ run }: { run: CronRunRow }) {
  const [showError, setShowError] = React.useState(false)
  const Icon = statusIcon(run.status)
  const tone = statusTone(run.status)
  const meta = run.metadata as Record<string, unknown> | null

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Icon className={`h-4 w-4 ${tone}`} />
          <div className="min-w-0">
            <p className="text-sm text-[var(--text-primary)]">
              {run.status === 'running' ? 'In flight' : run.status.replace('_', '-')} ·{' '}
              <span className="text-[var(--text-muted)]">
                {run.records_processed} record{run.records_processed === 1 ? '' : 's'}
              </span>
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">
              {new Date(run.started_at).toLocaleString()}
              {run.duration_ms !== null && ` · ${formatDurationMs(run.duration_ms)}`}
            </p>
          </div>
        </div>
        {run.error_message && (
          <button
            type="button"
            onClick={() => setShowError((v) => !v)}
            className="text-[10px] underline text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {showError ? 'hide error' : 'show error'}
          </button>
        )}
      </div>
      {showError && run.error_message && (
        <pre className="mt-2 text-[10px] bg-[var(--bg-subtle)] rounded p-2 text-red-300 overflow-x-auto whitespace-pre-wrap">
          {run.error_message}
        </pre>
      )}
      {meta && Object.keys(meta).length > 0 && (
        <details className="mt-2">
          <summary className="text-[10px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)]">
            metadata
          </summary>
          <pre className="mt-1 text-[10px] bg-[var(--bg-subtle)] rounded p-2 overflow-x-auto">
            {JSON.stringify(meta, null, 2)}
          </pre>
        </details>
      )}
    </li>
  )
}

function RunSummary({ cron }: { cron: CronHealth }) {
  if (!cron.lastRun) {
    return <span className="text-[var(--text-muted)]">no runs yet</span>
  }
  const t = formatRelative(cron.lastRun.started_at)
  return (
    <span className="text-[var(--text-secondary)]">
      Last: <span className="text-[var(--text-primary)]">{t}</span>
    </span>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</p>
      <p className={`text-2xl font-semibold ${accent}`}>{value}</p>
    </div>
  )
}

function FactPill({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)]/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</p>
      <p className={`text-base font-semibold mt-0.5 ${accent}`}>{value}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] mb-1">{label}</p>
      <p className="text-[var(--text-primary)]">{children}</p>
    </div>
  )
}

function HealthDot({ health, size = 'md' }: { health: Health; size?: 'md' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5'
  const color =
    health === 'green'
      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
      : health === 'yellow'
        ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
        : health === 'red'
          ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
          : 'bg-[var(--text-muted)]'
  return <span className={`inline-block rounded-full ${sizeClass} ${color}`} />
}

function healthTone(h: Health) {
  switch (h) {
    case 'green':
      return { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400' }
    case 'yellow':
      return { border: 'border-amber-400/30', bg: 'bg-amber-400/5', text: 'text-amber-400' }
    case 'red':
      return { border: 'border-red-500/30', bg: 'bg-red-500/5', text: 'text-red-400' }
    default:
      return {
        border: 'border-[var(--border-default)]',
        bg: 'bg-[var(--bg-subtle)]/40',
        text: 'text-[var(--text-muted)]',
      }
  }
}

function healthLabel(h: Health) {
  return h === 'green'
    ? 'All crons healthy'
    : h === 'yellow'
      ? 'One or more crons running stale — Vercel may be skipping fires'
      : h === 'red'
        ? 'Crons in error state — see details below'
        : 'Insufficient data — first fire pending'
}

function statusIcon(status: CronRunRow['status']) {
  switch (status) {
    case 'success':
      return CheckCircle2
    case 'no_op':
      return Sparkles
    case 'failed':
      return XOctagon
    case 'partial':
      return AlertCircle
    case 'running':
      return Activity
  }
  return Cog
}

function statusTone(status: CronRunRow['status']) {
  switch (status) {
    case 'success':
      return 'text-emerald-400'
    case 'no_op':
      return 'text-[var(--text-muted)]'
    case 'failed':
      return 'text-red-400'
    case 'partial':
      return 'text-amber-400'
    case 'running':
      return 'text-blue-400'
  }
  return 'text-[var(--text-muted)]'
}

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) {
    const futureSec = Math.floor(-ms / 1000)
    return `in ${formatDuration(futureSec)}`
  }
  const sec = Math.floor(ms / 1000)
  return `${formatDuration(sec)} ago`
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

function formatDurationMs(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// Pause icon import is here to satisfy the icon registry — referenced in
// case future status enum gains a 'paused' entry.
void Pause
void Clock3
