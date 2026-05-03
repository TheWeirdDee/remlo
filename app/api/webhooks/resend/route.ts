import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { createServerClient } from '@/lib/supabase-server'
import { createNotification } from '@/lib/notifications'

/**
 * POST /api/webhooks/resend
 *
 * Receives Resend delivery events and stores them on `email_events`.
 * Hard bounces and spam complaints insert into `email_suppressions` so
 * future sends to that recipient are skipped.
 *
 * Configure in Resend dashboard → Webhooks → Add endpoint:
 *   URL: https://www.remlo.xyz/api/webhooks/resend
 *   Events: email.sent, email.delivered, email.delivery_delayed,
 *           email.bounced, email.complained, email.opened, email.clicked
 * Set RESEND_WEBHOOK_SECRET to the signing secret Resend gives you.
 */

interface ResendEventData {
  email_id?: string
  to?: string[]
  from?: string
  subject?: string
  tags?: Array<{ name: string; value: string }> | Record<string, string>
  bounce?: { type?: string; subType?: string; message?: string }
  click?: { link?: string }
}

interface ResendEventPayload {
  type?: string
  created_at?: string
  data?: ResendEventData
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const rawBody = await req.text()

  let payload: ResendEventPayload
  if (secret) {
    const headers: Record<string, string> = {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }
    try {
      const wh = new Webhook(secret)
      payload = wh.verify(rawBody, headers) as ResendEventPayload
    } catch (err) {
      console.warn('[resend-webhook] signature verify failed', err)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    console.warn('[resend-webhook] RESEND_WEBHOOK_SECRET missing — skipping signature check')
    try {
      payload = JSON.parse(rawBody) as ResendEventPayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  }

  const eventType = payload.type
  const data = payload.data
  if (!eventType || !data) {
    return NextResponse.json({ error: 'Missing type or data' }, { status: 400 })
  }

  const recipient = Array.isArray(data.to) ? data.to[0] : null
  if (!recipient) {
    return NextResponse.json({ ok: true, skipped: 'no_recipient' })
  }

  const tagsArray = Array.isArray(data.tags)
    ? data.tags
    : data.tags
      ? Object.entries(data.tags).map(([name, value]) => ({ name, value: String(value) }))
      : []
  const tagMap = new Map(tagsArray.map((t) => [t.name, t.value]))
  const template = tagMap.get('template') ?? null
  const employerId = tagMap.get('employer_id') ?? null

  const supabase = createServerClient()

  const { data: insertedEvent, error: insertError } = await supabase
    .from('email_events')
    .insert({
      provider_event_id: data.email_id ? `${data.email_id}-${eventType}` : null,
      provider_message_id: data.email_id ?? null,
      event_type: eventType,
      recipient: recipient.toLowerCase(),
      template,
      employer_id: employerId,
      tags: (tagsArray as never) ?? null,
      raw: payload as never,
    })
    .select('id')
    .single()

  if (insertError && insertError.code !== '23505') {
    console.error('[resend-webhook] insert email_events failed', insertError.message)
  }

  const eventId = insertedEvent?.id ?? null

  if (eventType === 'email.bounced') {
    const bounceType = data.bounce?.type ?? null
    const isHardBounce = bounceType === 'Permanent' || bounceType === 'hard'
    if (isHardBounce) {
      await supabase
        .from('email_suppressions')
        .upsert({
          email: recipient.toLowerCase(),
          reason: 'hard_bounce',
          source_event_id: eventId,
        })
    }
  } else if (eventType === 'email.complained') {
    await supabase
      .from('email_suppressions')
      .upsert({
        email: recipient.toLowerCase(),
        reason: 'complaint',
        source_event_id: eventId,
      })
  }

  // Operator-facing alert when a payroll email bounces — the recipient
  // never saw the receipt and the company should know.
  if (
    eventType === 'email.bounced' &&
    employerId &&
    (template === 'payroll_finalized' || template === 'payroll_failed')
  ) {
    void createNotification({
      employerId,
      kind: 'payroll_failed',
      severity: 'warning',
      title: 'Payroll receipt email bounced',
      body: `Receipt to ${recipient} could not be delivered (${data.bounce?.message ?? 'unknown reason'}). Update the email on file.`,
    })
  }

  return NextResponse.json({ ok: true })
}

export const dynamic = 'force-dynamic'
