import { NextRequest, NextResponse } from 'next/server'
import { processExpiredEscrows } from '@/lib/escrow'
import { authorizeCronRequest } from '@/lib/cron-auth'

/**
 * POST /api/cron/process-expired-escrows
 *
 * Cranks expired escrows into the `expired_refunded` state by broadcasting
 * the permissionless refund(Expired) instruction. Refund destinations are
 * fixed by the on-chain escrow account (requester ATA); the server just
 * submits the tx. Vercel Cron hits this every 15 minutes per vercel.json.
 *
 * Auth: either X-Cron-Secret header matching CRON_SECRET env (ops invocation)
 * OR the Vercel-signed header `authorization: Bearer <CRON_SECRET>` (Vercel
 * Cron pattern). If CRON_SECRET is not configured, returns 501 rather than
 * leaving the endpoint open.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauthorized = authorizeCronRequest(req)
  if (unauthorized) return unauthorized

  const result = await processExpiredEscrows()
  return NextResponse.json(result)
}

// Vercel Cron uses GET by default. Accept both.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}
