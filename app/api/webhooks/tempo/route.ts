import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import crypto from 'crypto'
import { recordWebhookEvent, deriveExternalId } from '@/lib/webhook-idempotency'

/**
 * POST /api/webhooks/tempo
 * Receives Tempo block confirmation events (finalized payroll tx, stream events).
 * Updates payroll_runs and payment_items with confirmed tx hashes and block numbers.
 *
 * Fail-closed: missing secret → 500, missing/invalid signature → 401.
 * Idempotent: duplicate (source, external_id) pairs are 200 { replayed: true }.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const secret = process.env.TEMPO_WEBHOOK_SECRET
  if (!secret) {
    console.error('[tempo webhook] TEMPO_WEBHOOK_SECRET is not configured — refusing request')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const signature = req.headers.get('x-tempo-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(rawBody)
  const expected = `sha256=${hmac.digest('hex')}`
  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: TempoWebhookEvent
  try {
    event = JSON.parse(rawBody) as TempoWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const externalId = await deriveExternalId(rawBody, [
    (event as { id?: string }).id,
    event.tx_hash ? `${event.type}:${event.tx_hash}:${event.block_number}` : undefined,
  ])
  const { fresh } = await recordWebhookEvent('tempo', externalId, event.type)
  if (!fresh) {
    return NextResponse.json({ received: true, replayed: true })
  }

  await handleTempoEvent(event)
  return NextResponse.json({ received: true })
}

interface TempoWebhookEvent {
  type: string
  tx_hash: string
  block_number: number
  timestamp: number
  data?: Record<string, unknown>
}

async function handleTempoEvent(event: TempoWebhookEvent): Promise<void> {
  const supabase = createServerClient()

  switch (event.type) {
    case 'transaction.confirmed': {
      const settledAt = new Date(event.timestamp * 1000).toISOString()
      const confirmTime = Date.now() - event.timestamp * 1000

      // Update payroll_run with tx_hash + block_number + finalized_at
      const { data: run } = await supabase
        .from('payroll_runs')
        .update({
          status: 'completed',
          tx_hash: event.tx_hash,
          block_number: event.block_number,
          finalized_at: settledAt,
          settlement_time_ms: Math.max(0, Math.round(confirmTime)),
        })
        .eq('tx_hash', event.tx_hash)
        .select('id')
        .single()

      if (run) {
        // Mark all payment items in this run as confirmed
        await supabase
          .from('payment_items')
          .update({ status: 'confirmed', tx_hash: event.tx_hash })
          .eq('payroll_run_id', run.id)
      }
      break
    }

    case 'transaction.failed': {
      await supabase
        .from('payroll_runs')
        .update({ status: 'failed', tx_hash: event.tx_hash })
        .eq('tx_hash', event.tx_hash)

      await supabase
        .from('payment_items')
        .update({ status: 'failed' })
        .eq('tx_hash', event.tx_hash)
      break
    }

    default:
      break
  }
}
