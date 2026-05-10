'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, ChevronRight, Loader2 } from 'lucide-react'
import { usePrivyAuthedFetch, usePrivyAuthedJson } from '@/lib/hooks/usePrivyAuthedFetch'

interface ActivityItem {
  id: string
  title?: string
  body?: string | null
  link?: string | null
  created_at: string
}

interface ActivityResponse {
  items: ActivityItem[]
  unread_count: number
  last_seen_at: string | null
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * EmployeeNotificationsBell — header bell for the employee portal.
 *
 * The feed is derived from employee-facing domain records, while read state
 * is persisted server-side as a per-employee high-water mark.
 */
export function EmployeeNotificationsBell() {
  const router = useRouter()
  const fetchJson = usePrivyAuthedJson()
  const authedFetch = usePrivyAuthedFetch()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const query = useQuery<ActivityResponse>({
    queryKey: ['portal-activity-unread'],
    queryFn: () => fetchJson('/api/portal/activity'),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  })

  const items = query.data?.items ?? []
  const unreadCount = Math.min(query.data?.unread_count ?? 0, 99)
  const lastSeenAt = query.data?.last_seen_at ?? null

  const markAllRead = React.useCallback(async () => {
    await authedFetch('/api/portal/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_all_read' }),
    })
    void queryClient.invalidateQueries({ queryKey: ['portal-activity-unread'] })
    void queryClient.invalidateQueries({ queryKey: ['portal-activity'] })
  }, [authedFetch, queryClient])

  async function handleMarkAllRead() {
    if (unreadCount === 0) return
    try {
      await markAllRead()
    } catch (err) {
      console.error('[employee-activity] mark all read failed', err)
    }
  }

  async function handleItemClick(item: ActivityItem) {
    setOpen(false)
    try {
      await markAllRead()
    } catch (err) {
      console.error('[employee-activity] mark read failed', err)
    }
    const href = item.link || '/portal/activity'
    if (href.startsWith('/')) {
      router.push(href)
    } else {
      window.location.assign(href)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)]"
        aria-label="Activity notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 min-w-[8px] h-2 rounded-full bg-[var(--status-error)]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1.5 flex max-h-[28rem] w-80 flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Activity</p>
              {unreadCount > 0 && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">{unreadCount} unread</p>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => void handleMarkAllRead()}
                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              >
                <Check className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {query.isLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-[var(--text-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                You&apos;re all caught up. New activity will show up here.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-default)]">
                {items.slice(0, 8).map((item) => {
                  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : NaN
                  const unread = !Number.isFinite(lastSeenMs) || new Date(item.created_at).getTime() > lastSeenMs
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => void handleItemClick(item)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-subtle)] ${
                          unread ? 'bg-[var(--accent)]/5' : ''
                        }`}
                      >
                        <span
                          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)] ${
                            unread ? 'opacity-100' : 'opacity-0'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${unread ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                            {item.title ?? 'Activity update'}
                          </p>
                          {item.body && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{item.body}</p>
                          )}
                          <p className="mt-1 text-[10px] text-[var(--text-muted)]">{timeAgo(item.created_at)}</p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <Link
            href="/portal/activity"
            onClick={() => {
              setOpen(false)
              void markAllRead().catch((err) => {
                console.error('[employee-activity] mark all read failed', err)
              })
            }}
            className="flex items-center justify-between border-t border-[var(--border-default)] px-4 py-3 text-xs font-medium text-[var(--accent)] hover:bg-[var(--bg-subtle)]"
          >
            View all activity
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  )
}
