import { NextRequest, NextResponse } from 'next/server'
import { getCallerAdmin } from '@/lib/auth'
import { recordAdminAction, inspectRequest } from '@/lib/admin-audit'
import { createServerClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/email/client'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz'

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

/**
 * PATCH /api/admin/support-tickets/[id]
 *
 * Admin updates a ticket: change status, claim it (assigned_to=me), record
 * a resolution note. Every change is audit-logged with the field deltas.
 *
 * Body:
 *   { status?, assigned_to?, resolution_note? }
 */
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const

interface PatchBody {
  status?: unknown
  assigned_to?: unknown
  resolution_note?: unknown
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const claims = await getCallerAdmin(req)
  if (!claims) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, string | null> = {}
  if (typeof body.status === 'string') {
    if (!(VALID_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }
    patch.status = body.status
  }
  if (typeof body.assigned_to === 'string') {
    patch.assigned_to = body.assigned_to.trim() || null
  } else if (body.assigned_to === null) {
    patch.assigned_to = null
  }
  if (typeof body.resolution_note === 'string') {
    const trimmed = body.resolution_note.trim()
    if (trimmed.length > 5000) {
      return NextResponse.json(
        { error: 'resolution_note must be 5000 chars or fewer.' },
        { status: 400 },
      )
    }
    patch.resolution_note = trimmed.length > 0 ? trimmed : null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No changes provided.' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Read the prior state so we can decide whether to fire the customer
  // notification email — we only email on status change or new resolution
  // note, not on a quiet `assigned_to` claim.
  const { data: prior } = await supabase
    .from('support_tickets')
    .select('status, resolution_note')
    .eq('id', id)
    .maybeSingle()

  const { data, error } = await supabase
    .from('support_tickets')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  const meta = inspectRequest(req)
  if (error || !data) {
    void recordAdminAction({
      actorUserId: claims.sub,
      action: 'support_ticket.update',
      resource: `support_ticket:${id}`,
      result: 'error',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { error: error?.message ?? 'not_found', patch },
    })
    return NextResponse.json(
      { error: error?.message ?? 'Ticket not found' },
      { status: error ? 500 : 404 },
    )
  }

  void recordAdminAction({
    actorUserId: claims.sub,
    action: 'support_ticket.update',
    resource: `support_ticket:${id}`,
    result: 'success',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: patch,
  })

  // Notify the customer when the admin moved status forward or wrote a new
  // resolution note. Skip silent claims (assigned_to-only) and no-op
  // patches that don't change visible state.
  const statusChanged =
    typeof patch.status === 'string' && patch.status !== prior?.status
  const noteChanged =
    'resolution_note' in patch &&
    (patch.resolution_note ?? null) !== (prior?.resolution_note ?? null) &&
    (patch.resolution_note ?? null) !== null
  if (statusChanged || noteChanged) {
    const refCode = data.id.slice(0, 8)
    void sendEmail({
      to: data.email,
      template: 'support_ticket_update',
      props: {
        refCode,
        subject: data.subject,
        statusLabel: STATUS_LABEL[data.status] ?? data.status,
        resolutionNote: data.resolution_note ?? null,
        statusUrl: `${APP_URL}/support/status?code=${refCode}`,
        appUrl: APP_URL,
      },
      idempotencyKey: `support_update:${data.id}:${data.updated_at}`,
      tags: [
        { name: 'flow', value: 'support' },
        { name: 'event', value: 'update' },
        { name: 'status', value: data.status },
      ],
    })
  }

  return NextResponse.json({ ticket: data })
}
