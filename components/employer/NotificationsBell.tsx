'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Check, Info, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useEmployer } from '@/lib/hooks/useEmployer'
import { useNotifications, type NotificationItem } from '@/lib/hooks/useDashboard'
import { usePrivyAuthedFetch } from '@/lib/hooks/usePrivyAuthedFetch'
import { cn } from '@/lib/utils'

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

const SEVERITY_ICON: Record<NotificationItem['severity'], React.ReactNode> = {
  info: <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" />,
  success: <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-success)]" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-[var(--status-pending)]" />,
  error: <AlertCircle className="h-3.5 w-3.5 text-[var(--status-error)]" />,
}

export function NotificationsBell() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const authedFetch = usePrivyAuthedFetch()
  const { data: employer } = useEmployer()
  const { data } = useNotifications(employer?.id)
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  const items = data?.items ?? []
  const unreadCount = data?.unread_count ?? 0

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

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['notifications', employer?.id] })
  }, [queryClient, employer?.id])

  async function handleItemClick(item: NotificationItem) {
    setOpen(false)
    if (!employer?.id) return
    if (!item.read_at) {
      try {
        await authedFetch(`/api/employers/${employer.id}/notifications/${item.id}`, { method: 'POST' })
        invalidate()
      } catch (err) {
        console.error('[notifications] mark read failed', err)
      }
    }
    if (item.link) {
      router.push(item.link)
    }
  }

  async function handleMarkAllRead() {
    if (!employer?.id || unreadCount === 0) return
    try {
      await authedFetch(`/api/employers/${employer.id}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      })
      invalidate()
    } catch (err) {
      console.error('[notifications] mark all read failed', err)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[8px] h-2 rounded-full bg-[var(--status-error)]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 sm:w-96 max-h-[28rem] flex flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg z-20">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Notifications</p>
              {unreadCount > 0 && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{unreadCount} unread</p>
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
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                You&apos;re all caught up. New activity will show up here.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-default)]">
                {items.map((item) => {
                  const unread = !item.read_at
                  const clickable = Boolean(item.link) || unread
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => void handleItemClick(item)}
                        disabled={!clickable}
                        className={cn(
                          'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors',
                          clickable && 'hover:bg-[var(--bg-subtle)] cursor-pointer',
                          unread && 'bg-[var(--accent)]/5',
                        )}
                      >
                        <span className="mt-0.5 shrink-0">{SEVERITY_ICON[item.severity]}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p
                              className={cn(
                                'text-sm truncate',
                                unread ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                              )}
                            >
                              {item.title}
                            </p>
                            {unread && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                            )}
                          </div>
                          {item.body && (
                            <p className="mt-0.5 text-xs text-[var(--text-muted)] line-clamp-2">{item.body}</p>
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
        </div>
      )}
    </div>
  )
}
