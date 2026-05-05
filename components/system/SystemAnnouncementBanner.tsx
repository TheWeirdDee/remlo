'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { usePrivyAuthedFetch, usePrivyAuthedJson } from '@/lib/hooks/usePrivyAuthedFetch'

type Severity = 'info' | 'success' | 'warning' | 'error'

interface ActiveAnnouncement {
  id: string
  title: string
  body: string
  link_url: string | null
  link_label: string | null
  severity: Severity
  audience: string
  published_at: string | null
  expires_at: string | null
  created_at: string
}

const SEVERITY_STYLE: Record<
  Severity,
  {
    container: string
    icon: React.ComponentType<{ className?: string }>
    iconClass: string
  }
> = {
  info: {
    container:
      'bg-[var(--bg-subtle)] border-[var(--border-default)] text-[var(--text-primary)]',
    icon: Info,
    iconClass: 'text-[var(--text-muted)]',
  },
  success: {
    container:
      'bg-[var(--status-success)]/10 border-[var(--status-success)]/30 text-[var(--text-primary)]',
    icon: CheckCircle2,
    iconClass: 'text-[var(--status-success)]',
  },
  warning: {
    container:
      'bg-[var(--status-pending)]/10 border-[var(--status-pending)]/30 text-[var(--text-primary)]',
    icon: AlertTriangle,
    iconClass: 'text-[var(--status-pending)]',
  },
  error: {
    container:
      'bg-[var(--status-error)]/10 border-[var(--status-error)]/30 text-[var(--text-primary)]',
    icon: AlertCircle,
    iconClass: 'text-[var(--status-error)]',
  },
}

/**
 * SystemAnnouncementBanner — top-of-page strip for the operator-controlled
 * channel. Mounts in the employer / employee / admin layouts. Only fetches
 * once on mount and on user-action invalidation; not realtime (no need —
 * announcements are humans on the operator side, not high-frequency events).
 *
 * Per-user dismissals persist server-side, so dismissing in one tab clears
 * the banner across devices on the next refresh.
 */
export function SystemAnnouncementBanner() {
  const fetchJson = usePrivyAuthedJson()
  const authedFetch = usePrivyAuthedFetch()
  const qc = useQueryClient()

  const query = useQuery<{ items: ActiveAnnouncement[] }>({
    queryKey: ['announcements-active'],
    queryFn: () => fetchJson('/api/announcements/active'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  const dismiss = useMutation({
    mutationFn: async (id: string) =>
      authedFetch(`/api/announcements/${id}/dismiss`, { method: 'POST' }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['announcements-active'] })
      const previous = qc.getQueryData<{ items: ActiveAnnouncement[] }>([
        'announcements-active',
      ])
      qc.setQueryData<{ items: ActiveAnnouncement[] }>(['announcements-active'], (old) => {
        if (!old) return { items: [] }
        return { items: old.items.filter((item) => item.id !== id) }
      })
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(['announcements-active'], context.previous)
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['announcements-active'] })
    },
  })

  const items = query.data?.items ?? []
  if (items.length === 0) return null

  return (
    <div className="space-y-2 px-4 lg:px-6 pt-4">
      {items.map((a) => {
        const style = SEVERITY_STYLE[a.severity]
        const Icon = style.icon
        return (
          <div
            key={a.id}
            role={a.severity === 'error' ? 'alert' : 'status'}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${style.container}`}
          >
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${style.iconClass}`} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold">{a.title}</p>
                {a.link_url && a.link_label && (
                  <LinkPill url={a.link_url} label={a.link_label} />
                )}
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{a.body}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss.mutate(a.id)}
              disabled={dismiss.isPending}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function LinkPill({ url, label }: { url: string; label: string }) {
  if (url.startsWith('/')) {
    return (
      <Link
        href={url}
        className="text-xs text-[var(--accent)] hover:underline"
      >
        {label} →
      </Link>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-[var(--accent)] hover:underline"
    >
      {label} ↗
    </a>
  )
}
