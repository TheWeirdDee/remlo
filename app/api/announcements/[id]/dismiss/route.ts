import { NextRequest, NextResponse } from 'next/server'
import { getPrivyClaims } from '@/lib/auth'
import { dismissAnnouncementForUser } from '@/lib/queries/announcements'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/announcements/[id]/dismiss
 *
 * Idempotent — repeated calls are no-ops. The user's dismissal is recorded
 * even if the announcement is later edited; the banner stays gone for them
 * specifically. (To re-deliver an updated message, the operator should
 * publish a NEW announcement, not edit the dismissed one.)
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const claims = await getPrivyClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const ok = await dismissAnnouncementForUser(id, claims.sub)
  if (!ok) return NextResponse.json({ error: 'Dismiss failed' }, { status: 500 })
  return NextResponse.json({ dismissed: true })
}
