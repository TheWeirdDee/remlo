/**
 * lib/env.ts — server-side env validation.
 *
 * Imported by every server module that needs a required env var. Validates
 * at module load: in production, throws if a required var is missing so the
 * server refuses to start with broken config. In dev, warns once and lets
 * the developer continue (so partial setups still boot).
 *
 * Why this exists: the waitlist confirmation email silently failed for a
 * day because RESEND_API_KEY was missing on Vercel. The send function
 * returned `{ skipped: 'no_api_key' }` and the caller treated that as
 * success. Boot-time validation catches the same class of bug at deploy
 * time instead of inside a user flow.
 *
 * Required vars are the ones any traffic flow depends on: database,
 * auth, payment broadcast, email. Feature-specific vars (Bridge, Solana
 * fee recipient, etc.) intentionally validate-on-use elsewhere — so a
 * partial deploy can still serve the rest of the API.
 */

const REQUIRED_PROD_ENV = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'NEXT_PUBLIC_PRIVY_APP_ID',
  'PRIVY_APP_SECRET',
  'PRIVY_VERIFICATION_KEY',
  'RESEND_API_KEY',
  'REMLO_AGENT_PRIVATE_KEY',
  'REMLO_TREASURY_ADDRESS',
  'MPP_SECRET_KEY',
  'CLAUDE_API_KEY',
] as const

type RequiredEnvKey = (typeof REQUIRED_PROD_ENV)[number]

let validated = false

function validateOnce(): void {
  if (validated) return
  validated = true

  // Skip in build phase — Next.js runs server modules during build before
  // env vars are necessarily injected. We only want runtime validation.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const missing = REQUIRED_PROD_ENV.filter((key) => {
    const v = process.env[key]
    return !v || v.trim() === ''
  })

  if (missing.length === 0) return

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[env] Missing required production env vars: ${missing.join(', ')}. ` +
        'The server refuses to start with broken config. Add them in Vercel → Settings → Environment Variables and redeploy.',
    )
  }

  console.warn(
    `[env] Missing env vars (dev OK, production will refuse to start): ${missing.join(', ')}`,
  )
}

validateOnce()

/**
 * Strict accessor: returns the env var or throws. Use this when calling
 * code is on a critical path where a missing/empty var is unrecoverable.
 *
 * In production this never throws because boot validation already crashed
 * the server if any required var was missing — so it's effectively a typed
 * `process.env.X!` for the validated set.
 */
export function requireEnv(key: RequiredEnvKey): string {
  const value = process.env[key]
  if (!value || value.trim() === '') {
    throw new Error(`[env] Required env var missing: ${key}`)
  }
  return value
}

/**
 * Soft accessor for feature-specific vars. Returns `undefined` if the var
 * is missing — caller decides what to do (skip the feature, log, etc.).
 * Don't use this for required vars; use `requireEnv` instead.
 */
export function optionalEnv(key: string): string | undefined {
  const value = process.env[key]
  if (!value || value.trim() === '') return undefined
  return value
}
