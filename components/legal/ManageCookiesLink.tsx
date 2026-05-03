'use client'

import * as React from 'react'
import { useCookieConsent } from './CookieConsentProvider'

interface ManageCookiesLinkProps {
  className?: string
  children?: React.ReactNode
}

/**
 * Tiny client component that opens the cookie settings modal. Lives in the
 * legal/* tree because it's logically part of the consent surface, not
 * navigation. Designed to drop into server-rendered footers without forcing
 * the whole footer to become a client component.
 */
export function ManageCookiesLink({ className, children }: ManageCookiesLinkProps) {
  const { openSettings } = useCookieConsent()
  return (
    <button
      type="button"
      onClick={openSettings}
      className={className ?? 'text-sm text-white/40 transition-colors hover:text-white'}
    >
      {children ?? 'Manage cookies'}
    </button>
  )
}
