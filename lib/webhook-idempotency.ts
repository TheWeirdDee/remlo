/**
 * Webhook idempotency guard. Call recordWebhookEvent with (source, externalId)
 * before running side effects. Returns false if the (source, externalId) pair
 * was already recorded — the handler must then short-circuit with 200.
 */
import { createServerClient } from '@/lib/supabase-server'

export type WebhookSource = 'bridge' | 'tempo'

export async function recordWebhookEvent(
  source: WebhookSource,
  externalId: string,
  eventType?: string,
): Promise<{ fresh: boolean }> {
  if (!externalId) return { fresh: true }
  const supabase = createServerClient()
  const { error } = await supabase
    .from('webhook_events')
    .insert({ source, external_id: externalId, event_type: eventType ?? null })
  if (error) {
    if (error.code === '23505') return { fresh: false }
    // Any other error: treat as fresh so we don't silently drop a real event,
    // but log so ops can catch persistent insert failures.
    console.error(`[webhook ${source}] idempotency insert failed:`, error.message)
    return { fresh: true }
  }
  return { fresh: true }
}

/**
 * Derive a stable external id from a webhook payload. Prefers explicit id
 * fields; falls back to a SHA-256 of the raw body to still enforce exact-body
 * dedup when providers omit an id.
 */
export async function deriveExternalId(
  rawBody: string,
  candidates: (string | undefined | null)[],
): Promise<string> {
  for (const c of candidates) {
    if (c && typeof c === 'string') return c
  }
  const buf = new TextEncoder().encode(rawBody)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
