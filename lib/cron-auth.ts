/**
 * Shared cron-secret auth for /api/cron/* endpoints. Timing-safe compare +
 * fail-closed on missing env var.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

/**
 * Returns null if authorized, else an early NextResponse to return from the
 * handler. Accepts Vercel's `Authorization: Bearer <CRON_SECRET>` header OR
 * a custom `X-Cron-Secret: <CRON_SECRET>` header.
 */
export function authorizeCronRequest(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured — endpoint disabled' },
      { status: 501 },
    )
  }

  const xCronHeader = req.headers.get('x-cron-secret') ?? ''
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = `Bearer ${cronSecret}`

  const vercelAuthValid = safeEqual(authHeader, bearer)
  const xCronValid = safeEqual(xCronHeader, cronSecret)

  if (!vercelAuthValid && !xCronValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
