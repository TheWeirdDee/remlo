import { NextRequest, NextResponse } from 'next/server'
import { unsubscribeWaitlist } from '@/lib/waitlist'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz'

/**
 * GET /api/waitlist/unsubscribe?token=...
 *
 * Honors a one-click unsubscribe (the standard CAN-SPAM requirement).
 * Always redirects to the marketing site rather than rendering a page so we
 * can iterate the copy without redeploying.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() ?? ''
  await unsubscribeWaitlist(token)
  const dest = new URL('/', APP_URL)
  dest.searchParams.set('waitlist_unsubscribed', '1')
  return NextResponse.redirect(dest, { status: 303 })
}
