'use client'

import * as React from 'react'

/**
 * Reads the `?waitlist_confirmed` (and `?waitlist_unsubscribed`) query params
 * placed by /api/waitlist/confirm, shows a dismissible banner, and rewrites
 * the URL so a refresh doesn't re-show the banner.
 */
export function WaitlistConfirmedBanner() {
  const [state, setState] = React.useState<
    | null
    | { kind: 'confirmed' | 'already' | 'invalid' | 'unsubscribed' }
  >(null)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const confirmed = url.searchParams.get('waitlist_confirmed')
    const unsubscribed = url.searchParams.get('waitlist_unsubscribed')
    if (confirmed === 'ok' || confirmed === 'already' || confirmed === 'invalid') {
      setState({
        kind: confirmed === 'ok' ? 'confirmed' : confirmed === 'already' ? 'already' : 'invalid',
      })
    } else if (unsubscribed === '1') {
      setState({ kind: 'unsubscribed' })
    }
    if (confirmed || unsubscribed) {
      url.searchParams.delete('waitlist_confirmed')
      url.searchParams.delete('waitlist_unsubscribed')
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  if (!state) return null

  const isError = state.kind === 'invalid'
  const message =
    state.kind === 'confirmed'
      ? "You're confirmed. We'll be in touch the moment you can run your first payroll."
      : state.kind === 'already'
        ? "You're already on the list. Stay tuned."
        : state.kind === 'unsubscribed'
          ? "You've been removed from the waitlist."
          : 'That confirmation link is invalid or expired. Try subscribing again.'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      // Sits flush below the 64px PublicNavbar (top-16) so it reads as a
      // sub-header status strip instead of fighting the navbar for space.
      // z-index is higher than the navbar (z-50) so it stays above the
      // hero gradient but lower than mobile menus / dialogs (z-300).
      className={`fixed inset-x-0 top-16 z-[60] flex items-center justify-center gap-4 px-4 py-2.5 text-sm font-medium backdrop-blur ${
        isError
          ? 'bg-red-500/10 text-red-300 border-b border-red-500/20'
          : 'bg-[var(--accent)]/10 text-[var(--accent)] border-b border-[var(--accent)]/20'
      }`}
    >
      <span className="text-center">{message}</span>
      <button
        type="button"
        onClick={() => setState(null)}
        className="shrink-0 rounded-md border border-current/20 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  )
}
