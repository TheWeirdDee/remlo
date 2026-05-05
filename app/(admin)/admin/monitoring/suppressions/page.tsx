'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Search, ShieldOff, Trash2, UserMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePrivyAuthedFetch, usePrivyAuthedJson } from '@/lib/hooks/usePrivyAuthedFetch'

type Reason = 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual'

interface Suppression {
  email: string
  reason: Reason
  source_event_id: string | null
  created_at: string
}

interface ListResponse {
  items: Suppression[]
  next_cursor: string | null
  stats: {
    total: number
    byReason: Record<Reason, number>
  }
}

const REASON_LABEL: Record<Reason, string> = {
  hard_bounce: 'Hard bounce',
  complaint: 'Complaint',
  unsubscribe: 'Unsubscribe',
  manual: 'Manual',
}

const REASON_TINT: Record<Reason, string> = {
  hard_bounce: 'border-[var(--status-error)]/30 bg-[var(--status-error)]/10 text-[var(--status-error)]',
  complaint: 'border-[var(--status-error)]/30 bg-[var(--status-error)]/10 text-[var(--status-error)]',
  unsubscribe:
    'border-[var(--status-pending)]/30 bg-[var(--status-pending)]/10 text-[var(--status-pending)]',
  manual: 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]',
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export default function SuppressionsAdminPage(): React.ReactElement {
  const fetchJson = usePrivyAuthedJson()
  const authedFetch = usePrivyAuthedFetch()
  const qc = useQueryClient()
  const [search, setSearch] = React.useState('')
  const [reason, setReason] = React.useState<Reason | 'all'>('all')
  const [adding, setAdding] = React.useState(false)
  const [addEmail, setAddEmail] = React.useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const queryKey = ['admin-suppressions', debouncedSearch, reason] as const
  const list = useQuery<ListResponse>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (reason !== 'all') params.set('reason', reason)
      params.set('limit', '100')
      return fetchJson(`/api/admin/email-suppressions?${params.toString()}`)
    },
  })

  const remove = useMutation({
    mutationFn: async (email: string) =>
      authedFetch(`/api/admin/email-suppressions/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success('Suppression removed. Future sends will resume.')
      void qc.invalidateQueries({ queryKey: ['admin-suppressions'] })
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Remove failed'),
  })

  const add = useMutation({
    mutationFn: async (email: string) =>
      fetchJson('/api/admin/email-suppressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason: 'manual' }),
      }),
    onSuccess: () => {
      toast.success('Address added to suppression list.')
      setAddEmail('')
      setAdding(false)
      void qc.invalidateQueries({ queryKey: ['admin-suppressions'] })
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Add failed'),
  })

  const stats = list.data?.stats
  const items = list.data?.items ?? []

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldOff className="h-5 w-5 text-[var(--text-muted)]" />
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Email suppressions</h1>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)] max-w-2xl">
            Recipients we will not send to. Hard bounces and spam complaints insert
            automatically via the Resend webhook. Manual entries are added by admins
            for proactive blocks. Removing an entry resumes sends; if the underlying
            problem persists, it will re-suppress on the next bounce/complaint.
          </p>
        </div>
        <Button onClick={() => setAdding((v) => !v)}>
          <UserMinus className="h-4 w-4" />
          Add manual
        </Button>
      </header>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Hard bounces" value={stats.byReason.hard_bounce} />
          <StatCard label="Complaints" value={stats.byReason.complaint} />
          <StatCard label="Manual" value={stats.byReason.manual} />
        </div>
      )}

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = addEmail.trim()
            if (trimmed.length === 0) return
            add.mutate(trimmed)
          }}
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 flex items-center gap-2"
        >
          <Input
            type="email"
            placeholder="bouncing-address@example.com"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            className="flex-1"
            autoFocus
          />
          <Button type="submit" disabled={add.isPending || addEmail.trim().length === 0}>
            {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Suppress
          </Button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="h-10 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="pl-9"
          />
        </div>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as Reason | 'all')}
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="all">All reasons</option>
          <option value="hard_bounce">Hard bounces</option>
          <option value="complaint">Complaints</option>
          <option value="unsubscribe">Unsubscribes</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden">
        {list.isLoading ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">
            {debouncedSearch || reason !== 'all'
              ? 'No suppressions match your filter.'
              : 'No suppressions. Deliverability looks clean.'}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-default)]">
            {items.map((row) => (
              <li
                key={row.email}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-[var(--text-primary)] truncate">
                      {row.email}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wider rounded-md border px-1.5 py-0.5 font-semibold ${REASON_TINT[row.reason]}`}
                    >
                      {REASON_LABEL[row.reason]}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Added {new Date(row.created_at).toLocaleString()}
                    {row.source_event_id ? ` · event ${row.source_event_id.slice(0, 8)}` : ''}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => remove.mutate(row.email)}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
        {value.toLocaleString()}
      </div>
    </div>
  )
}
