'use client'

import * as React from 'react'
import Link from 'next/link'
import { Cookie } from 'lucide-react'
import { useCookieConsent } from './CookieConsentProvider'

interface CookieBannerProps {
  onCustomize: () => void
}

/**
 * First-visit consent prompt. Anchored to the bottom of the viewport on a
 * dedicated stacking context so it overlays every page. Three actions: accept
 * all, reject non-essential, or open the granular settings modal.
 *
 * Pressing Escape is intentionally NOT treated as "reject all" — the user
 * has to make an explicit choice via one of the three buttons. This avoids
 * the dark-pattern trap of dismissing the banner without recording consent.
 */
export function CookieBanner({ onCustomize }: CookieBannerProps) {
  const { acceptAll, rejectAll } = useCookieConsent()

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[200] p-3 sm:p-5"
      role="region"
      aria-label="Cookie consent"
    >
      <div
        className="mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-5 shadow-2xl shadow-black/40 sm:p-6"
        role="dialog"
        aria-modal="false"
        aria-labelledby="cookie-banner-title"
        aria-describedby="cookie-banner-body"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)]"
          >
            <Cookie className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h2 id="cookie-banner-title" className="text-base font-semibold text-[var(--text-primary)]">
              Cookies on Remlo
            </h2>
            <p id="cookie-banner-body" className="text-sm leading-relaxed text-[var(--text-secondary)]">
              We use cookies to keep you signed in, remember preferences, and understand how the product is used. You can accept all, reject non-essential cookies, or pick categories. See our{' '}
              <Link href="/legal/cookies" className="text-[var(--accent)] hover:underline">
                cookie policy
              </Link>{' '}
              for details.
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <button
            type="button"
            onClick={onCustomize}
            className="text-left text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:text-center"
          >
            Customize
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
            <button
              type="button"
              onClick={rejectAll}
              className="h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)]"
            >
              Reject non-essential
            </button>
            <button
              type="button"
              onClick={acceptAll}
              className="h-10 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
              autoFocus
            >
              Accept all
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
