import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/support/status?code=<refCode>&email=<email>
 *
 * Public lookup endpoint for ticket status. The submitter pastes the
 * reference code we showed them post-create (and put in their
 * confirmation email subject), plus the email they used. Both must match
 * — code alone would let anyone enumerate tickets, email alone would let
 * anyone see every ticket from a known address.
 *
 * Returns a deliberately narrow projection: nothing about the admin who
 * worked it, no internal IDs, no metadata. Just status, public-facing
 * resolution note, and timestamps.
 *
 * Rate-limited only at the edge (Vercel/Cloudflare). At the application
 * level we treat this as a low-blast-radius public read — wrong
 * email/code returns 404 like any not-found row.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const rawCode = (url.searchParams.get('code') ?? '').trim().replace(/^#/, '')
  const rawEmail = (url.searchParams.get('email') ?? '').trim().toLowerCase()

  // The reference code is the first 8 chars of the ticket UUID — hex
  // only. Reject anything else before we hit the DB.
  if (!/^[0-9a-f]{4,12}$/i.test(rawCode)) {
    return NextResponse.json(
      { error: 'Invalid reference code.' },
      { status: 400 },
    )
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return NextResponse.json({ error: 'Invalid email.' }, { status: 400 })
  }

  // Fetch tickets for this email and filter the id-prefix client-side.
  // PostgREST's ilike on a uuid column requires a `::text` cast that the
  // JS client doesn't expose cleanly; we'd rather do an extra round of
  // in-memory filtering than build a brittle filter expression.
  const supabase = createServerClient()
  const { data: rows, error } = await supabase
    .from('support_tickets')
    .select(
      'id, subject, status, resolution_note, created_at, updated_at, resolved_at, email',
    )
    .eq('email', rawEmail)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[support-status] lookup failed', error.message)
    return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 })
  }

  const codeLower = rawCode.toLowerCase()
  const ticket = (rows ?? []).find((t) => t.id.toLowerCase().startsWith(codeLower))

  if (!ticket) {
    return NextResponse.json(
      {
        error:
          "We couldn't find a ticket matching that reference and email. Double-check both — the code is the 8-character string in your confirmation email subject.",
      },
      { status: 404 },
    )
  }

  return NextResponse.json({
    refCode: ticket.id.slice(0, 8),
    subject: ticket.subject,
    status: ticket.status,
    resolutionNote: ticket.resolution_note ?? null,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at,
  })
}
