'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePrivy } from '@privy-io/react-auth'
import { toast } from 'sonner'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Inbox,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'
import { usePrivyAuthedFetch, usePrivyAuthedJson } from '@/lib/hooks/usePrivyAuthedFetch'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type UserRole = 'employer' | 'employee' | 'public'

interface SupportTicket {
  id: string
  user_id: string | null
  user_role: UserRole
  employer_id: string | null
  employee_id: string | null
  email: string
  subject: string
  body: string
  status: TicketStatus
  assigned_to: string | null
  resolution_note: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  employerName: string | null
  employeeName: string | null
}

const STATUS_META: Record<
  TicketStatus,
  { label: string; tint: string; icon: React.ComponentType<{ className?: string }> }
> = {
  open: {
    label: 'Open',
    tint: 'text-[var(--status-pending)] bg-[var(--status-pending)]/10 border-[var(--status-pending)]/30',
    icon: Inbox,
  },
  in_progress: {
    label: 'In progress',
    tint: 'text-[var(--accent)] bg-[var(--accent)]/10 border-[var(--accent)]/30',
    icon: Clock,
  },
  resolved: {
    label: 'Resolved',
    tint: 'text-[var(--status-success)] bg-[var(--status-success)]/10 border-[var(--status-success)]/30',
    icon: CheckCircle2,
  },
  closed: {
    label: 'Closed',
    tint: 'text-[var(--text-muted)] bg-[var(--bg-subtle)] border-[var(--border-default)]',
    icon: ChevronRight,
  },
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export default function AdminSupportPage(): React.ReactElement {
  const fetchJson = usePrivyAuthedJson()
  const [statusFilter, setStatusFilter] = React.useState<'' | TicketStatus>('open')
  const [search, setSearch] = React.useState('')

  const params = new URLSearchParams()
  if (statusFilter) params.set('status', statusFilter)
  if (search.trim()) params.set('search', search.trim())
  const queryString = params.toString()

  const list = useQuery<{ items: SupportTicket[] }>({
    queryKey: ['admin-support-tickets', queryString],
    queryFn: () => fetchJson(`/api/admin/support-tickets${queryString ? `?${queryString}` : ''}`),
  })

  const items = list.data?.items ?? []
  const tabs: Array<{ key: '' | TicketStatus; label: string }> = [
    { key: 'open', label: 'Open' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'closed', label: 'Closed' },
    { key: '', label: 'All' },
  ]

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Support inbox"
        description="Tickets filed via the in-app Contact support flow. Click a row to expand, claim it, and resolve."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1">
          {tabs.map((tab) => {
            const active = statusFilter === tab.key
            return (
              <button
                key={tab.key || 'all'}
                onClick={() => setStatusFilter(tab.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="relative max-w-xs flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
          <Input
            placeholder="Search subject or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        {list.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-xs text-[var(--text-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-xs text-[var(--text-muted)]">
            <Inbox className="h-5 w-5" />
            No tickets match the filter.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-default)]">
            {items.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function TicketRow({ ticket }: { ticket: SupportTicket }) {
  const [expanded, setExpanded] = React.useState(false)
  const statusMeta = STATUS_META[ticket.status]
  const StatusIcon = statusMeta.icon
  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--bg-base)]"
      >
        <span
          className={`mt-0.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${statusMeta.tint}`}
        >
          <StatusIcon className="h-3 w-3" />
          {statusMeta.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-[var(--text-primary)]">{ticket.subject}</p>
            <span className="rounded-md border border-[var(--border-default)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {ticket.user_role}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            <Mail className="mr-1 inline h-3 w-3 -translate-y-px" />
            {ticket.email}
            {ticket.employerName && ` · ${ticket.employerName}`}
            {ticket.employeeName && ` · ${ticket.employeeName}`}
            {' · '}
            {formatTime(ticket.created_at)}
          </p>
        </div>
        <ChevronDown
          className={`mt-1 h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expanded && <TicketDetail ticket={ticket} />}
    </li>
  )
}

function TicketDetail({ ticket }: { ticket: SupportTicket }) {
  const queryClient = useQueryClient()
  const authedFetch = usePrivyAuthedFetch()
  const { user } = usePrivy()
  const [resolutionDraft, setResolutionDraft] = React.useState(ticket.resolution_note ?? '')

  const update = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const response = await authedFetch(`/api/admin/support-tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? 'Update failed')
      }
      return response.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-support-tickets'] })
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Update failed'),
  })

  function setStatus(status: TicketStatus) {
    update.mutate({ status })
  }
  function claim() {
    if (!user?.id) return
    update.mutate({ assigned_to: user.id, status: 'in_progress' })
  }
  function saveResolution() {
    update.mutate({ resolution_note: resolutionDraft, status: 'resolved' })
  }

  const isMine = ticket.assigned_to && user?.id === ticket.assigned_to
  const claimed = Boolean(ticket.assigned_to)

  return (
    <div className="border-t border-[var(--border-default)] bg-[var(--bg-base)] px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Body</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
              {ticket.body}
            </p>
          </div>
          {ticket.employer_id && (
            <p className="text-xs">
              <Link
                href={`/admin/employers/${ticket.employer_id}`}
                className="text-[var(--accent)] hover:underline"
              >
                Open employer detail →
              </Link>
            </p>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Resolution note
            </p>
            <textarea
              rows={3}
              value={resolutionDraft}
              onChange={(e) => setResolutionDraft(e.target.value)}
              placeholder="What did you find? What did you ship?"
              className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              maxLength={5000}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                onClick={saveResolution}
                disabled={update.isPending || resolutionDraft.trim().length === 0}
              >
                {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save &amp; mark resolved
              </Button>
            </div>
          </div>
        </div>

        <aside className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Assigned to
            </p>
            <p className="mt-1 break-words text-xs text-[var(--text-secondary)]">
              {claimed ? (
                <span className="font-mono">{ticket.assigned_to}</span>
              ) : (
                <span className="text-[var(--text-muted)]">Unclaimed</span>
              )}
            </p>
            {!isMine && (
              <Button
                size="sm"
                variant="outline"
                onClick={claim}
                disabled={update.isPending}
                className="mt-2 w-full gap-2"
              >
                <UserCheck className="h-3.5 w-3.5" />
                {claimed ? 'Take over' : 'Claim'}
              </Button>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Move</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['open', 'in_progress', 'resolved', 'closed'] as TicketStatus[]).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={ticket.status === s ? 'default' : 'outline'}
                  onClick={() => setStatus(s)}
                  disabled={update.isPending || ticket.status === s}
                  className="gap-1 text-[11px]"
                >
                  {STATUS_META[s].label}
                </Button>
              ))}
            </div>
          </div>

          <div className="text-[10px] text-[var(--text-muted)]">
            <ShieldCheck className="mr-1 inline h-3 w-3" />
            Every action on this ticket is recorded in the admin audit log.
          </div>
        </aside>
      </div>
    </div>
  )
}
