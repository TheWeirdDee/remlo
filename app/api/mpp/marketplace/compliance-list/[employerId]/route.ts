import { NextRequest } from 'next/server'
import { mppx } from '@/lib/mpp'
import { getComplianceEventsByEmployerId } from '@/lib/queries/compliance'
import { getMppCallerEmployer } from '@/lib/mpp-auth'

/**
 * GET /api/mpp/marketplace/compliance-list/[employerId]
 * MPP-11 — $0.50 single charge
 * Returns the compliance-cleared wallet list for the caller's OWN employer.
 *
 * SECURITY: previously returned arbitrary employers' employee wallet lists to
 * any MPP client. Now scoped to the authenticated caller (audit C-11).
 *
 * Query params: ?limit=100
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ employerId: string }> }
) {
  const { employerId } = await params
  const url = new URL(req.url)
  const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '100', 10))

  return mppx.charge({ amount: '0.50' })(async () => {
    const caller = await getMppCallerEmployer(req)
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (caller.id !== employerId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const events = await getComplianceEventsByEmployerId(employerId, limit)
    const latestClearByWallet = new Map<string, (typeof events)[number]>()

    for (const event of events) {
      if (event.result !== 'CLEAR' || !event.wallet_address) continue
      if (!latestClearByWallet.has(event.wallet_address)) {
        latestClearByWallet.set(event.wallet_address, event)
      }
    }

    const list = Array.from(latestClearByWallet.values()).map((event) => ({
      walletAddress: event.wallet_address,
      checkedAt: event.created_at,
      employeeId: event.employee_id,
      eventType: event.event_type,
    }))

    return Response.json({
      providerId: employerId,
      clearedWallets: list.length,
      list,
      lastUpdated: list[0]?.checkedAt ?? null,
    })
  })(req)
}
