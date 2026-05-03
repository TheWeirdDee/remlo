'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { useCookieConsent } from './CookieConsentProvider'
import { DEFAULT_DRAFT, type ConsentCategory } from '@/lib/cookie-consent'

interface CookieSettingsProps {
  onClose: () => void
}

interface CategoryDef {
  key: ConsentCategory
  label: string
  description: string
  required?: boolean
}

const CATEGORIES: ReadonlyArray<CategoryDef> = [
  {
    key: 'essential',
    label: 'Essential',
    description:
      'Required for the site to function. Sign-in sessions, security tokens, and the consent record itself. Always on.',
    required: true,
  },
  {
    key: 'preferences',
    label: 'Preferences',
    description:
      'Remember choices you make: theme, language, dashboard layout. Off by default.',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    description:
      'Help us understand how visitors use the product so we can improve it. We do not sell this data. Anonymized in aggregate.',
  },
  {
    key: 'marketing',
    label: 'Marketing',
    description:
      'Third-party pixels for retargeting and ad attribution on platforms we run campaigns on. Off by default.',
  },
]

/**
 * Granular consent modal. Reachable from the first-visit banner ("Customize")
 * or from the persistent "Manage cookies" link in the footer. Modeled as a
 * focus-trapped dialog with Escape and click-outside dismissal.
 */
export function CookieSettings({ onClose }: CookieSettingsProps) {
  const { record, saveCategories, rejectAll } = useCookieConsent()
  const initial = record?.categories ?? DEFAULT_DRAFT
  const [draft, setDraft] = React.useState<Record<ConsentCategory, boolean>>(initial)
  const dialogRef = React.useRef<HTMLDivElement>(null)

  // Escape closes. We do NOT treat dismissal as opt-out — the user must press
  // Save or Reject. Escape just closes; the previous record (if any) stands.
  React.useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Lock body scroll while the modal is open.
  React.useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // Move initial focus to the dialog so screen readers announce it.
  React.useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 px-4 py-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-settings-title"
        aria-describedby="cookie-settings-body"
        className="w-full max-w-lg rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-6 shadow-2xl shadow-black/50 outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="cookie-settings-title" className="text-lg font-semibold text-[var(--text-primary)]">
            Cookie preferences
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
            aria-label="Close cookie preferences"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p id="cookie-settings-body" className="mb-6 text-sm text-[var(--text-secondary)]">
          Choose which cookies Remlo can set on your device. Essential cookies are required for the site to function and can&apos;t be disabled.
        </p>

        <div className="mb-6 space-y-3">
          {CATEGORIES.map((category) => (
            <CategoryRow
              key={category.key}
              label={category.label}
              description={category.description}
              required={category.required}
              checked={draft[category.key]}
              onChange={(value) => setDraft((prev) => ({ ...prev, [category.key]: value }))}
            />
          ))}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <button
            type="button"
            onClick={rejectAll}
            className="text-left text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:text-center"
          >
            Reject all except essential
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveCategories(draft)}
              className="h-10 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
            >
              Save preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface CategoryRowProps {
  label: string
  description: string
  required?: boolean
  checked: boolean
  onChange: (value: boolean) => void
}

function CategoryRow({ label, description, required, checked, onChange }: CategoryRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{label}</span>
          {required && (
            <span className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              Required
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{description}</p>
      </div>
      <Toggle
        checked={checked}
        disabled={required}
        onChange={onChange}
        ariaLabel={`Toggle ${label} cookies`}
      />
    </div>
  )
}

interface ToggleProps {
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
  ariaLabel: string
}

function Toggle({ checked, disabled, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-[var(--accent)]/40'
          : checked
            ? 'bg-[var(--accent)]'
            : 'border border-[var(--border-default)] bg-[var(--bg-subtle)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}
