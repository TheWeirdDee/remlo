import { NextRequest, NextResponse } from 'next/server'
import { rateLimitCheck, principalKey } from '@/lib/rate-limit'
import { subscribeToWaitlist } from '@/lib/waitlist'

interface SubscribeBody {
  email?: string
  source?: string
  referrer?: string | null
}

/**
 * POST /api/waitlist
 *
 * Public, unauthenticated. Rate-limited per IP to keep abuse down. Returns
 * the same friendly status for "newly created" and "re-send confirmation"
 * so we don't disclose whether an email is already on the list.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rate = rateLimitCheck(principalKey('waitlist:subscribe', [ip]), {
    limit: 5,
    windowMs: 60_000,
  })
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Try again in a minute.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(rate.retryAfterMs / 1000).toString() } },
    )
  }

  let body: SubscribeBody
  try {
    body = (await req.json()) as SubscribeBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const result = await subscribeToWaitlist({
    email: body.email,
    source: body.source,
    referrer: body.referrer ?? req.headers.get('referer'),
    ip,
  })

  switch (result.kind) {
    case 'created':
    case 'pending':
      return NextResponse.json({
        ok: true,
        status: 'check_inbox',
        message: 'Check your inbox for a confirmation link.',
      })
    case 'already_confirmed':
      return NextResponse.json({
        ok: true,
        status: 'already_confirmed',
        message: "You're already on the list.",
      })
    case 'invalid_email':
      return NextResponse.json(
        { error: "That doesn't look like a valid email address." },
        { status: 400 },
      )
    case 'error':
      console.error('[waitlist/subscribe] error', result.message)
      return NextResponse.json(
        { error: 'Something went wrong on our side. Please try again.' },
        { status: 500 },
      )
  }
}
