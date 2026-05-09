'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Clock, Loader2, MessageSquare, XCircle } from 'lucide-react'

/**
 * /support/status — public lookup for ticket status.
 *
 * Submitter pastes the reference code (the 8-character string we put in
 * the email subject and on the success screen) and the email they used.
 * Both must match — see /api/support/status for the lookup logic.
 *
 * This page exists so a user who closed the success screen, lost their
 * confirmation email, or just wants to check progress can do so without
 * logging in. Most enterprise support tools (Zendesk, Help Scout, Front)
 * have an equivalent status page; the bar for a fast pitch demo is to
 * have one too.
 *
 * Next.js 15 requires `useSearchParams` consumers to be wrapped in a
 * Suspense boundary so prerender doesn't bail. Outer page renders the
 * suspense + the static shell; inner client component reads the params.
 */

interface StatusResponse {
  refCode: string
  subject: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  resolutionNote: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

const STATUS_META: Record<
  StatusResponse['status'],
  { label: string; tone: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  open: { label: 'Open', tone: 'text-amber-400', Icon: Clock },
  in_progress: { label: 'In progress', tone: 'text-blue-400', Icon: MessageSquare },
  resolved: { label: 'Resolved', tone: 'text-emerald-400', Icon: CheckCircle2 },
  closed: { label: 'Closed', tone: 'text-[var(--text-muted)]', Icon: XCircle },
}

export default function SupportStatusPage() {
  return (
    <React.Suspense fallback={<StatusPageSkeleton />}>
      <SupportStatusForm />
    </React.Suspense>
  )
}

function StatusPageSkeleton() {
  return (
    <main className="min-h-screen bg-[var(--bg-base)] px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-subtle)]" />
        <div className="mt-8 h-8 w-2/3 animate-pulse rounded bg-[var(--bg-subtle)]" />
        <div className="mt-3 h-4 w-full animate-pulse rounded bg-[var(--bg-subtle)]" />
        <div className="mt-6 h-48 animate-pulse rounded-2xl bg-[var(--bg-subtle)]" />
      </div>
    </main>
  )
}

function SupportStatusForm() {
  const searchParams = useSearchParams()
  const initialCode = (searchParams.get('code') ?? '').replace(/^#/, '')
  const initialEmail = searchParams.get('email') ?? ''

  const [code, setCode] = React.useState(initialCode)
  const [email, setEmail] = React.useState(initialEmail)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ticket, setTicket] = React.useState<StatusResponse | null>(null)

  // Auto-lookup if both query params are present (deep-link from
  // confirmation email or success screen).
  const autoRanRef = React.useRef(false)
  React.useEffect(() => {
    if (autoRanRef.current) return
    if (initialCode && initialEmail) {
      autoRanRef.current = true
      void lookup(initialCode, initialEmail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function lookup(c: string, e: string) {
    setLoading(true)
    setError(null)
    setTicket(null)
    try {
      const res = await fetch(
        `/api/support/status?code=${encodeURIComponent(c)}&email=${encodeURIComponent(e)}`,
      )
      const json = (await res.json().catch(() => ({}))) as
        | StatusResponse
        | { error?: string }
      if (!res.ok) {
        setError('error' in json && json.error ? json.error : 'Lookup failed.')
        return
      }
      setTicket(json as StatusResponse)
    } catch {
      setError('Network error. Try again.')
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    if (loading) return
    void lookup(code.trim(), email.trim())
  }

  return (
    <main className="min-h-screen bg-[var(--bg-base)] px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-xl">
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to support
        </Link>

        <div className="mt-8">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Check ticket status
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Paste the reference code from your confirmation email and the email you used. We&rsquo;ll
            show the latest status without making you sign in.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-6 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 space-y-4"
        >
          <div>
            <label htmlFor="status-code" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Reference code
            </label>
            <input
              id="status-code"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="d979c78a"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              className="w-full font-mono rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              The 8-character string in your confirmation email subject — the part inside <code>[Ticket #...]</code>.
            </p>
          </div>
          <div>
            <label htmlFor="status-email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Email address
            </label>
            <input
              id="status-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !code.trim() || !email.trim()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[#0B1220] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Check status
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {ticket && <TicketCard ticket={ticket} />}

        <p className="mt-8 text-[11px] leading-snug text-[var(--text-muted)]">
          Lost the email? Open a fresh ticket at{' '}
          <Link href="/support" className="underline hover:text-[var(--text-primary)]">
            /support
          </Link>{' '}
          and reference the original issue in the body.
        </p>
      </div>
    </main>
  )
}

function TicketCard({ ticket }: { ticket: StatusResponse }) {
  const meta = STATUS_META[ticket.status]
  const Icon = meta.Icon
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-default)] px-5 py-4 flex items-center gap-3">
        <Icon className={`h-4 w-4 ${meta.tone}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">Status</p>
          <p className={`text-sm font-semibold ${meta.tone}`}>{meta.label}</p>
        </div>
        <p className="font-mono text-[10px] text-[var(--text-muted)]">#{ticket.refCode}</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] mb-1">Subject</p>
          <p className="text-sm text-[var(--text-primary)]">{ticket.subject}</p>
        </div>
        {ticket.resolutionNote && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] mb-1">
              Update from Remlo
            </p>
            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
              {ticket.resolutionNote}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 pt-2 text-xs text-[var(--text-muted)]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] mb-0.5">Filed</p>
            <p className="text-[var(--text-secondary)]">{new Date(ticket.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] mb-0.5">
              {ticket.resolvedAt ? 'Resolved' : 'Last update'}
            </p>
            <p className="text-[var(--text-secondary)]">
              {new Date(ticket.resolvedAt ?? ticket.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
