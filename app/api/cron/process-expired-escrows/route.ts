import { NextRequest, NextResponse } from 'next/server'
import { processExpiredEscrows } from '@/lib/escrow'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { withCronRun, pruneOldCronRuns } from '@/lib/cron-runs'

/**
 * POST /api/cron/process-expired-escrows
 *
 * Cranks expired escrows into the `expired_refunded` state by broadcasting
 * the permissionless refund(Expired) instruction. Refund destinations are
 * fixed by the on-chain escrow account (requester ATA); the server just
 * submits the tx. Vercel Cron hits this once a day per vercel.json.
 *
 * Doubles as the daily janitor for cron_runs retention — pruneOldCronRuns
 * runs at the end of every successful tick to keep the audit table bounded.
 *
 * Auth: either X-Cron-Secret header matching CRON_SECRET env (ops invocation)
 * OR the Vercel-signed header `authorization: Bearer <CRON_SECRET>` (Vercel
 * Cron pattern). If CRON_SECRET is not configured, returns 501 rather than
 * leaving the endpoint open.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauthorized = authorizeCronRequest(req)
  if (unauthorized) return unauthorized

  return withCronRun('process-expired-escrows', async () => {
    const result = await processExpiredEscrows()
    const cronPruned = await pruneOldCronRuns(30)
    const status =
      result.failures.length > 0
        ? (result.processed > 0 ? 'partial' : 'failed')
        : (result.processed === 0 ? 'no_op' : 'success')
    return {
      outcome: {
        status,
        records_processed: result.processed,
        metadata: { ...result, cron_runs_pruned: cronPruned },
        error_message:
          result.failures.length > 0
            ? result.failures.map((f) => `${f.escrow_id}: ${f.error}`).slice(0, 5).join(' | ').slice(0, 4000)
            : null,
      },
      result: NextResponse.json({ ...result, cron_runs_pruned: cronPruned }),
    }
  })
}

// Vercel Cron uses GET by default. Accept both.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}
