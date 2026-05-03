'use client'

import * as React from 'react'
import { CookieBanner } from './CookieBanner'
import { CookieSettings } from './CookieSettings'
import {
  readConsentClient,
  writeConsentClient,
  hasCategory as hasCategoryUtil,
  type ConsentCategory,
  type ConsentRecord,
} from '@/lib/cookie-consent'

interface CookieConsentContextValue {
  /** Current consent record, or null if the user hasn't decided yet. */
  record: ConsentRecord | null
  /** True after the provider has hydrated from the cookie (avoid SSR mismatch). */
  hydrated: boolean
  /** Convenience for downstream code: does the user permit `category`? */
  hasCategory: (category: ConsentCategory) => boolean
  /** Open the granular settings modal. Safe to call from anywhere. */
  openSettings: () => void
  /** Accept all four categories. */
  acceptAll: () => void
  /** Reject everything except essential. */
  rejectAll: () => void
  /** Save a custom set. Essential is always forced on. */
  saveCategories: (categories: Record<ConsentCategory, boolean>) => void
}

const Ctx = React.createContext<CookieConsentContextValue | null>(null)

export function useCookieConsent(): CookieConsentContextValue {
  const ctx = React.useContext(Ctx)
  if (!ctx) {
    throw new Error('useCookieConsent must be used inside <CookieConsentProvider>')
  }
  return ctx
}

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [record, setRecord] = React.useState<ConsentRecord | null>(null)
  const [hydrated, setHydrated] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  // Hydrate after mount so server and client render the same initial tree.
  React.useEffect(() => {
    setRecord(readConsentClient())
    setHydrated(true)
  }, [])

  const acceptAll = React.useCallback(() => {
    setRecord(
      writeConsentClient({
        essential: true,
        preferences: true,
        analytics: true,
        marketing: true,
      }),
    )
    setSettingsOpen(false)
  }, [])

  const rejectAll = React.useCallback(() => {
    setRecord(
      writeConsentClient({
        essential: true,
        preferences: false,
        analytics: false,
        marketing: false,
      }),
    )
    setSettingsOpen(false)
  }, [])

  const saveCategories = React.useCallback(
    (categories: Record<ConsentCategory, boolean>) => {
      setRecord(writeConsentClient(categories))
      setSettingsOpen(false)
    },
    [],
  )

  const hasCategory = React.useCallback(
    (category: ConsentCategory) => hasCategoryUtil(record, category),
    [record],
  )

  const value: CookieConsentContextValue = React.useMemo(
    () => ({
      record,
      hydrated,
      hasCategory,
      openSettings: () => setSettingsOpen(true),
      acceptAll,
      rejectAll,
      saveCategories,
    }),
    [record, hydrated, hasCategory, acceptAll, rejectAll, saveCategories],
  )

  // Banner only when hydrated AND no record AND modal isn't already showing
  // the granular settings (so the two never overlap).
  const showBanner = hydrated && !record && !settingsOpen

  return (
    <Ctx.Provider value={value}>
      {children}
      {showBanner && <CookieBanner onCustomize={() => setSettingsOpen(true)} />}
      {settingsOpen && <CookieSettings onClose={() => setSettingsOpen(false)} />}
    </Ctx.Provider>
  )
}
