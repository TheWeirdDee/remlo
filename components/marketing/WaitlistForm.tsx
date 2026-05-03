'use client'

import * as React from 'react'

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'check_inbox' }
  | { kind: 'already_confirmed' }
  | { kind: 'error'; message: string }

interface WaitlistFormProps {
  /** Where on the site this submission came from. Stored on the row for analytics. */
  source: string
  /**
   * Visual variant. `inline` is a single-line layout for hero/footer rows;
   * `card` adds a heading + description for full-width sections.
   */
  variant?: 'inline' | 'card'
  /** Optional copy override. Sensible defaults provided per variant. */
  heading?: string
  description?: string
  /** Submit button label. Defaults to "Join the waitlist". */
  ctaLabel?: string
  /** Tailwind class extension for the outer container. */
  className?: string
}

/**
 * Polished email capture form with inline status, accessibility hooks, and
 * a consistent success/error UX across landing surfaces.
 *
 * - Submitting and post-success states disable the input rather than hiding it,
 *   so the user can retry without scroll-jumping.
 * - We never reveal whether the email was already on the list — the API
 *   collapses created/pending into one response — but if the user re-submits a
 *   confirmed address we tell them so they don't re-confirm needlessly.
 */
export function WaitlistForm({
  source,
  variant = 'card',
  heading,
  description,
  ctaLabel = 'Join the waitlist',
  className,
}: WaitlistFormProps) {
  const [email, setEmail] = React.useState('')
  const [status, setStatus] = React.useState<Status>({ kind: 'idle' })

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status.kind === 'submitting') return
    if (!email.trim()) return
    setStatus({ kind: 'submitting' })
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        status?: 'check_inbox' | 'already_confirmed'
        error?: string
      }
      if (!res.ok) {
        setStatus({ kind: 'error', message: data.error ?? 'Something went wrong.' })
        return
      }
      setStatus({
        kind: data.status === 'already_confirmed' ? 'already_confirmed' : 'check_inbox',
      })
    } catch {
      setStatus({ kind: 'error', message: 'Network error. Please try again.' })
    }
  }

  const disabled = status.kind === 'submitting' || status.kind === 'check_inbox' || status.kind === 'already_confirmed'

  if (variant === 'inline') {
    return (
      <form
        onSubmit={handleSubmit}
        className={`flex w-full max-w-xl flex-col gap-2 sm:flex-row ${className ?? ''}`}
        aria-label="Join Remlo waitlist"
      >
        <label className="sr-only" htmlFor={`waitlist-email-${source}`}>
          Email address
        </label>
        <input
          id={`waitlist-email-${source}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          disabled={disabled}
          aria-invalid={status.kind === 'error' || undefined}
          className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !email.trim()}
          className="h-11 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status.kind === 'submitting' ? 'Sending…' : ctaLabel}
        </button>
        <StatusLine status={status} />
      </form>
    )
  }

  return (
    <div
      className={`rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 sm:p-8 ${className ?? ''}`}
    >
      {heading && (
        <h3 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
          {heading}
        </h3>
      )}
      {description && (
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">{description}</p>
      )}
      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-2 sm:flex-row" aria-label="Join Remlo waitlist">
        <label className="sr-only" htmlFor={`waitlist-email-${source}`}>
          Email address
        </label>
        <input
          id={`waitlist-email-${source}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          disabled={disabled}
          aria-invalid={status.kind === 'error' || undefined}
          className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !email.trim()}
          className="h-11 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status.kind === 'submitting' ? 'Sending…' : ctaLabel}
        </button>
      </form>
      <StatusLine status={status} className="mt-3" />
      <p className="mt-3 text-[11px] leading-snug text-[var(--text-muted)]">
        We&apos;ll send a confirmation link. No spam, no list-sharing, you can unsubscribe with one click.
      </p>
    </div>
  )
}

function StatusLine({ status, className }: { status: Status; className?: string }) {
  if (status.kind === 'idle' || status.kind === 'submitting') return null
  if (status.kind === 'check_inbox') {
    return (
      <p
        role="status"
        className={`text-xs text-[var(--accent)] ${className ?? ''}`}
      >
        Check your inbox — we just sent a confirmation link.
      </p>
    )
  }
  if (status.kind === 'already_confirmed') {
    return (
      <p role="status" className={`text-xs text-[var(--text-secondary)] ${className ?? ''}`}>
        You&apos;re already on the list. We&apos;ll be in touch.
      </p>
    )
  }
  return (
    <p role="alert" className={`text-xs text-red-400 ${className ?? ''}`}>
      {status.message}
    </p>
  )
}
