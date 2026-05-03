import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import crypto from 'crypto'
import { recordWebhookEvent, deriveExternalId } from '@/lib/webhook-idempotency'
import { createNotification } from '@/lib/notifications'

/**
 * POST /api/webhooks/bridge
 *
 * Bridge webhook signature verification (per their docs):
 *   Header:   `X-Webhook-Signature: t=<ms_timestamp>,v0=<base64_signature>`
 *   Algorithm: RSA-SHA256 over `${t}.${rawBody}`
 *   Public key: PEM, provided per-endpoint when the webhook is created in
 *               the Bridge dashboard. Stored in BRIDGE_WEBHOOK_SECRET.
 *   Tolerance: reject events older than 10 minutes (600s).
 *
 * Fail-closed: missing key → 500, missing signature → 401, stale → 401, bad → 401.
 * Idempotent: duplicate (source, external_id) pairs return 200 { replayed: true }.
 *
 * Sandbox note: only `kyc_link.*` and `customer.*` events fire in sandbox per
 * Bridge docs. `transfer.*` and `card_transaction.*` are production-only.
 */

const TIMESTAMP_TOLERANCE_MS = 10 * 60 * 1000 // 10 minutes per Bridge docs

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const publicKeyPem = process.env.BRIDGE_WEBHOOK_SECRET
  if (!publicKeyPem) {
    console.error('[bridge-webhook] BRIDGE_WEBHOOK_SECRET (RSA public key) not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const signatureHeader = req.headers.get('x-webhook-signature')
  if (!signatureHeader) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  const parsed = parseSignatureHeader(signatureHeader)
  if (!parsed) {
    return NextResponse.json({ error: 'Malformed signature header' }, { status: 401 })
  }

  const { timestamp, signature } = parsed
  const now = Date.now()
  if (Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_MS) {
    console.warn('[bridge-webhook] stale event', { ageMs: now - timestamp })
    return NextResponse.json({ error: 'Stale event' }, { status: 401 })
  }

  let isValid: boolean
  try {
    isValid = verifyBridgeSignature({
      timestamp,
      rawBody,
      signature,
      publicKeyPem,
    })
  } catch (err) {
    console.error('[bridge-webhook] signature verify threw', err)
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 })
  }
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: BridgeWebhookEvent
  try {
    event = JSON.parse(rawBody) as BridgeWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = (event.event_object ?? event.data ?? {}) as Record<string, unknown>
  const externalId = await deriveExternalId(rawBody, [
    (event as { id?: string }).id,
    typeof payload.id === 'string' ? payload.id : undefined,
    typeof payload.event_id === 'string' ? payload.event_id : undefined,
  ])
  const eventType = event.event_type ?? event.type ?? ''

  const { fresh } = await recordWebhookEvent('bridge', externalId, eventType)
  if (!fresh) {
    return NextResponse.json({ received: true, replayed: true })
  }

  await handleBridgeEvent(eventType, payload)
  return NextResponse.json({ received: true })
}

interface ParsedSignature {
  timestamp: number
  signature: string
}

function parseSignatureHeader(header: string): ParsedSignature | null {
  // Format: `t=<ms_timestamp>,v0=<base64_signature>`
  const parts = header.split(',').map((p) => p.trim())
  let timestamp: number | null = null
  let signature: string | null = null
  for (const part of parts) {
    const [key, value] = part.split('=', 2)
    if (key === 't' && value) {
      const n = Number.parseInt(value, 10)
      if (Number.isFinite(n)) timestamp = n
    } else if (key === 'v0' && value) {
      signature = value
    }
  }
  if (timestamp === null || signature === null) return null
  return { timestamp, signature }
}

interface VerifyInput {
  timestamp: number
  rawBody: string
  signature: string
  publicKeyPem: string
}

function verifyBridgeSignature({ timestamp, rawBody, signature, publicKeyPem }: VerifyInput): boolean {
  const signedPayload = `${timestamp}.${rawBody}`
  const verify = crypto.createVerify('RSA-SHA256')
  verify.update(signedPayload)
  verify.end()
  return verify.verify(publicKeyPem, signature, 'base64')
}

interface BridgeWebhookEvent {
  type?: string
  event_type?: string
  data?: Record<string, unknown>
  event_object?: Record<string, unknown>
  created_at?: string
}

async function handleBridgeEvent(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = createServerClient()

  switch (eventType) {
    case 'kyc_link.completed':
    case 'kyc_link.updated': {
      // Bridge fires this when a customer finishes (or progresses through) the
      // hosted KYC form. Resolve the link back to our employee row via
      // bridge_kyc_link_id so we can attach the newly-minted customer_id.
      const link = payload as {
        id?: string
        customer_id?: string
        kyc_status?: string
        tos_status?: string
        rejection_reasons?: string[]
      }
      if (!link.id) break

      const { data: employee } = await supabase
        .from('employees')
        .select('id, employer_id, bridge_customer_id')
        .eq('bridge_kyc_link_id', link.id)
        .maybeSingle()

      if (!employee) {
        console.warn('[bridge-webhook] kyc_link event for unknown link', { id: link.id })
        break
      }

      const updates: Record<string, unknown> = {}
      if (link.customer_id && employee.bridge_customer_id !== link.customer_id) {
        updates.bridge_customer_id = link.customer_id
      }
      const newStatus = mapKycStatus(link.kyc_status)
      if (newStatus) {
        updates.kyc_status = newStatus
        if (newStatus === 'approved') {
          updates.kyc_verified_at = new Date().toISOString()
        }
      }
      if (Object.keys(updates).length === 0) break

      await supabase.from('employees').update(updates).eq('id', employee.id)

      await supabase.from('compliance_events').insert({
        employer_id: employee.employer_id,
        employee_id: employee.id,
        event_type: `bridge_${eventType.replace('.', '_')}`,
        result: newStatus === 'approved' ? 'CLEAR' : link.kyc_status === 'rejected' ? 'BLOCKED' : null,
        description: link.rejection_reasons?.join('; ') ?? null,
        metadata: {
          kyc_link_id: link.id,
          customer_id: link.customer_id,
          kyc_status: link.kyc_status,
          tos_status: link.tos_status,
        } as never,
      })

      if (newStatus === 'approved') {
        void createNotification({
          employerId: employee.employer_id,
          kind: 'kyc_update',
          severity: 'success',
          title: 'Employee verified',
          body: 'A team member just completed identity verification and is ready for payroll.',
          link: `/dashboard/team/${employee.id}`,
          metadata: { employee_id: employee.id },
        })
      } else if (link.kyc_status === 'rejected') {
        void createNotification({
          employerId: employee.employer_id,
          kind: 'kyc_update',
          severity: 'error',
          title: 'KYC rejected for an employee',
          body: link.rejection_reasons?.join('; ') ?? 'Bridge rejected the verification.',
          link: `/dashboard/team/${employee.id}`,
          metadata: { employee_id: employee.id },
        })
      }
      break
    }

    case 'customer.updated':
    case 'customer.created': {
      // Status changes after the KYC link has been consumed (e.g., manual
      // review flips `pending` → `approved` in production).
      const customer = payload as {
        id?: string
        kyc_status?: string
        rejection_reasons?: string[]
      }
      if (!customer.id) break

      const newStatus = mapKycStatus(customer.kyc_status)
      if (!newStatus) break

      const updates: Record<string, unknown> = { kyc_status: newStatus }
      if (newStatus === 'approved') {
        updates.kyc_verified_at = new Date().toISOString()
      }

      const { data: employee } = await supabase
        .from('employees')
        .update(updates)
        .eq('bridge_customer_id', customer.id)
        .select('id, employer_id')
        .maybeSingle()

      if (employee) {
        await supabase.from('compliance_events').insert({
          employer_id: employee.employer_id,
          employee_id: employee.id,
          event_type: `bridge_${eventType.replace('.', '_')}`,
          result: newStatus === 'approved' ? 'CLEAR' : 'BLOCKED',
          description: customer.rejection_reasons?.join('; ') ?? null,
          metadata: { customer_id: customer.id, kyc_status: customer.kyc_status } as never,
        })
      }
      break
    }

    case 'transfer.payment_processed':
    case 'transfer.state_changed': {
      const transfer = payload as { id: string; status: string }
      await supabase
        .from('payment_items')
        .update({ status: mapTransferStatus(transfer.status) })
        .eq('tx_hash', transfer.id)
      break
    }

    case 'card_transaction.created':
    case 'card_transaction.updated': {
      // Surfaced via Bridge API directly in employee portal; no persistence.
      break
    }

    default:
      // Future event types: accept silently to avoid rejecting unknown events.
      console.info('[bridge-webhook] unhandled event type', { eventType })
      break
  }
}

function mapTransferStatus(bridgeStatus: string): string {
  const map: Record<string, string> = {
    pending: 'pending',
    processing: 'pending',
    completed: 'confirmed',
    failed: 'failed',
    cancelled: 'failed',
  }
  return map[bridgeStatus] ?? 'pending'
}

function mapKycStatus(bridgeStatus: string | undefined): string | null {
  if (!bridgeStatus) return null
  const map: Record<string, string> = {
    not_started: 'pending',
    pending: 'pending',
    under_review: 'pending',
    incomplete: 'pending',
    approved: 'approved',
    active: 'approved',
    rejected: 'rejected',
    expired: 'expired',
  }
  return map[bridgeStatus] ?? null
}
