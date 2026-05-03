/**
 * Cookie consent state lives in a first-party cookie so the server can read it
 * during SSR (e.g., to decide whether to inject analytics tags) and the client
 * can read it without a network round trip.
 *
 * The cookie itself is essential. Storing the consent record does not require
 * consent (it is the mechanism by which consent is recorded). All other
 * categories require explicit opt-in.
 *
 * Versioning: bump POLICY_VERSION whenever the categories or what each
 * category covers materially changes. Existing consent records with an older
 * version are treated as absent and the user is re-prompted.
 */

export const CONSENT_COOKIE_NAME = 'remlo_consent'
export const POLICY_VERSION = 1
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 // 1 year

export type ConsentCategory = 'essential' | 'preferences' | 'analytics' | 'marketing'

export interface ConsentRecord {
  /** Policy version at the time consent was given. */
  v: number
  /** Unix epoch ms when the consent was recorded. */
  ts: number
  /** Per-category opt-in. `essential` is always true. */
  categories: Record<ConsentCategory, boolean>
}

export const DEFAULT_DRAFT: Record<ConsentCategory, boolean> = {
  essential: true,
  preferences: false,
  analytics: false,
  marketing: false,
}

/** Read consent from `document.cookie`. Returns null if missing or stale-version. */
export function readConsentClient(): ConsentRecord | null {
  if (typeof document === 'undefined') return null
  const raw = readCookieValue(document.cookie, CONSENT_COOKIE_NAME)
  if (!raw) return null
  return parseConsent(raw)
}

/** Read consent from a server-side cookie header (e.g., `req.headers.cookie`). */
export function readConsentServer(cookieHeader: string | null | undefined): ConsentRecord | null {
  if (!cookieHeader) return null
  const raw = readCookieValue(cookieHeader, CONSENT_COOKIE_NAME)
  if (!raw) return null
  return parseConsent(raw)
}

/** Write consent. Caller should pass categories without `essential` (it is forced true). */
export function writeConsentClient(categories: Record<ConsentCategory, boolean>): ConsentRecord {
  const record: ConsentRecord = {
    v: POLICY_VERSION,
    ts: Date.now(),
    categories: { ...categories, essential: true },
  }
  if (typeof document !== 'undefined') {
    const value = encodeURIComponent(JSON.stringify(record))
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${CONSENT_COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
  }
  return record
}

/** Convenience: returns true iff the record exists and the category is opted in. Essential is always true. */
export function hasCategory(record: ConsentRecord | null, category: ConsentCategory): boolean {
  if (category === 'essential') return true
  if (!record) return false
  return record.categories[category] === true
}

// ── internals ───────────────────────────────────────────────────────────────

function readCookieValue(cookieHeader: string, name: string): string | null {
  // Manual parse so we don't pull in a cookie library for one read.
  const target = `${name}=`
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(target)) {
      return trimmed.slice(target.length)
    }
  }
  return null
}

function parseConsent(raw: string): ConsentRecord | null {
  try {
    const decoded = decodeURIComponent(raw)
    const parsed = JSON.parse(decoded) as Partial<ConsentRecord>
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.v !== POLICY_VERSION) return null
    if (typeof parsed.ts !== 'number') return null
    if (!parsed.categories || typeof parsed.categories !== 'object') return null
    // Force essential=true on read so a tampered cookie can't disable it.
    return {
      v: POLICY_VERSION,
      ts: parsed.ts,
      categories: {
        essential: true,
        preferences: parsed.categories.preferences === true,
        analytics: parsed.categories.analytics === true,
        marketing: parsed.categories.marketing === true,
      },
    }
  } catch {
    return null
  }
}
