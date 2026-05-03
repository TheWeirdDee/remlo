/**
 * Waitlist orchestration.
 *
 * Owns the full lifecycle so the API routes stay thin: subscribe creates
 * a row + sends a double-opt-in email, confirm marks the row + syncs to
 * Resend Audiences, unsubscribe clears the audience.
 */
import { randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/email/client'
import { addToWaitlistAudience, unsubscribeFromWaitlistAudience } from '@/lib/email/audiences'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz'

export type SubscribeResult =
  | { kind: 'created' }
  | { kind: 'pending'; reason: 'already_subscribed_unconfirmed' }
  | { kind: 'already_confirmed' }
  | { kind: 'invalid_email' }
  | { kind: 'error'; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

export interface SubscribeInput {
  email: string
  source?: string
  referrer?: string | null
  ip?: string | null
}

/**
 * Insert (or upsert) a waitlist row and send the confirmation email. Returns
 * a discriminated result so the API can return the right status code without
 * leaking whether an email is already on the list (we treat re-subscribe of
 * an unconfirmed row as a re-send opportunity).
 */
export async function subscribeToWaitlist(input: SubscribeInput): Promise<SubscribeResult> {
  const email = normalizeEmail(input.email)
  if (!EMAIL_RE.test(email)) return { kind: 'invalid_email' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('waitlist_subscribers')
    .select('email, confirmed_at, confirm_token')
    .eq('email', email)
    .maybeSingle()

  if (existing?.confirmed_at) return { kind: 'already_confirmed' }

  let token = existing?.confirm_token ?? randomBytes(24).toString('base64url')

  if (!existing) {
    const { error } = await supabase.from('waitlist_subscribers').insert({
      email,
      confirm_token: token,
      source: input.source ?? 'unknown',
      referrer: input.referrer ?? null,
      ip_inet: input.ip ?? null,
    })
    if (error) {
      // race: another request created the row between our select and insert.
      // re-fetch the token rather than failing — the user shouldn't see a
      // visible difference.
      const { data: raced } = await supabase
        .from('waitlist_subscribers')
        .select('confirm_token, confirmed_at')
        .eq('email', email)
        .maybeSingle()
      if (raced?.confirmed_at) return { kind: 'already_confirmed' }
      if (raced?.confirm_token) {
        token = raced.confirm_token
      } else {
        return { kind: 'error', message: error.message }
      }
    }
  }

  const confirmUrl = `${APP_URL}/api/waitlist/confirm?token=${encodeURIComponent(token)}`
  const send = await sendEmail({
    to: email,
    template: 'waitlist_confirm',
    props: { confirmUrl, appUrl: APP_URL },
    idempotencyKey: `waitlist_confirm:${token}`,
    tags: [
      { name: 'flow', value: 'waitlist' },
      { name: 'source', value: input.source ?? 'unknown' },
    ],
  })
  if (!send.ok && !send.skipped) {
    return { kind: 'error', message: send.error ?? 'send failed' }
  }

  return existing ? { kind: 'pending', reason: 'already_subscribed_unconfirmed' } : { kind: 'created' }
}

export type ConfirmResult =
  | { kind: 'confirmed'; email: string }
  | { kind: 'already_confirmed'; email: string }
  | { kind: 'invalid_token' }

export async function confirmWaitlist(token: string): Promise<ConfirmResult> {
  if (!token || token.length < 10) return { kind: 'invalid_token' }
  const supabase = createServerClient()
  const { data: row } = await supabase
    .from('waitlist_subscribers')
    .select('email, confirmed_at, resend_contact_id')
    .eq('confirm_token', token)
    .maybeSingle()

  if (!row) return { kind: 'invalid_token' }
  if (row.confirmed_at) return { kind: 'already_confirmed', email: row.email }

  const audienceResult = await addToWaitlistAudience({ email: row.email })

  await supabase
    .from('waitlist_subscribers')
    .update({
      confirmed_at: new Date().toISOString(),
      resend_contact_id: audienceResult.ok ? audienceResult.contactId ?? null : null,
    })
    .eq('email', row.email)

  return { kind: 'confirmed', email: row.email }
}

export async function unsubscribeWaitlist(token: string): Promise<{ ok: boolean }> {
  if (!token) return { ok: false }
  const supabase = createServerClient()
  const { data: row } = await supabase
    .from('waitlist_subscribers')
    .select('email, resend_contact_id, unsubscribed_at')
    .eq('confirm_token', token)
    .maybeSingle()
  if (!row) return { ok: false }
  if (row.unsubscribed_at) return { ok: true }

  if (row.resend_contact_id) {
    await unsubscribeFromWaitlistAudience(row.resend_contact_id)
  }

  await supabase
    .from('waitlist_subscribers')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('email', row.email)
  return { ok: true }
}
