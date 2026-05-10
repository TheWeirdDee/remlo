import { NextRequest, NextResponse } from 'next/server'
import { confirmWaitlist } from '@/lib/waitlist'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz'

/**
 * GET /api/waitlist/confirm?token=...
 *
 * Confirmation link from the double-opt-in email. Always 302s back to the
 * waitlist page with a `?waitlist_confirmed=ok|already|invalid` query param
 * so the post-confirmation experience stays inside the waitlist flow.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() ?? ''
  const result = await confirmWaitlist(token)

  let status: 'ok' | 'already' | 'invalid'
  switch (result.kind) {
    case 'confirmed':
      status = 'ok'
      break
    case 'already_confirmed':
      status = 'already'
      break
    case 'invalid_token':
      status = 'invalid'
      break
  }

  const dest = new URL('/waitlist', APP_URL)
  dest.searchParams.set('waitlist_confirmed', status)
  return NextResponse.redirect(dest, { status: 303 })
}
