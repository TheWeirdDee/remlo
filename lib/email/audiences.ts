/**
 * Resend Audiences sync.
 *
 * The waitlist API stores subscribers in our own Postgres table (so we have
 * control over double opt-in, source attribution, and unsubscribe state).
 * Once a subscriber confirms, we mirror them into a Resend Audience so the
 * operator can run Broadcasts straight from the Resend dashboard without
 * exporting CSVs.
 *
 * If RESEND_AUDIENCE_ID is unset, syncing is a noop — the local row is the
 * source of truth and broadcasts can still be sent later.
 */
import { Resend } from 'resend'

let resendInstance: Resend | null = null

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!resendInstance) resendInstance = new Resend(key)
  return resendInstance
}

function getAudienceId(): string | null {
  return process.env.RESEND_AUDIENCE_ID?.trim() || null
}

export interface SyncContactInput {
  email: string
  firstName?: string | null
  lastName?: string | null
}

export interface SyncContactResult {
  ok: boolean
  contactId?: string
  error?: string
}

export async function addToWaitlistAudience(
  input: SyncContactInput,
): Promise<SyncContactResult> {
  const resend = getResend()
  const audienceId = getAudienceId()
  if (!resend || !audienceId) {
    return { ok: false, error: 'Resend audience not configured' }
  }
  try {
    const { data, error } = await resend.contacts.create({
      audienceId,
      email: input.email,
      firstName: input.firstName ?? undefined,
      lastName: input.lastName ?? undefined,
      unsubscribed: false,
    })
    if (error) {
      console.warn('[email/audiences] add failed', { email: input.email, error: error.message })
      return { ok: false, error: error.message }
    }
    return { ok: true, contactId: data?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'add failed'
    console.warn('[email/audiences] add threw', { email: input.email, error: message })
    return { ok: false, error: message }
  }
}

export async function unsubscribeFromWaitlistAudience(
  contactId: string,
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend()
  const audienceId = getAudienceId()
  if (!resend || !audienceId) return { ok: false, error: 'Resend audience not configured' }
  try {
    const { error } = await resend.contacts.update({
      id: contactId,
      audienceId,
      unsubscribed: true,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unsubscribe failed' }
  }
}
