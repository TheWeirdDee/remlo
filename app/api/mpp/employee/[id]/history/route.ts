import { NextRequest } from 'next/server'
import { mppx } from '@/lib/mpp'
import { getPaymentItemsByEmployeeId } from '@/lib/queries/payroll'
import { byteaMemoToHex, decodeMemo } from '@/lib/memo'
import { getMppCallerEmployee, getMppCallerEmployer } from '@/lib/mpp-auth'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/mpp/employee/[id]/history
 * MPP-8 — $0.05 single charge
 *
 * SECURITY: payment history is scoped to the subject OR their employer.
 * Previously any MPP client could enumerate salary history for any employee
 * UUID (audit C-11).
 *
 * Query params: ?limit=50
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = new URL(req.url)
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '50', 10))

  return mppx.charge({ amount: '0.05' })(async () => {
    // Either the employee themselves or their employer may read this history.
    const [callerEmployee, callerEmployer] = await Promise.all([
      getMppCallerEmployee(req),
      getMppCallerEmployer(req),
    ])
    if (!callerEmployee && !callerEmployer) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let authorized = false
    if (callerEmployee && callerEmployee.id === id) authorized = true
    if (!authorized && callerEmployer) {
      const supabase = createServerClient()
      const { data: target } = await supabase
        .from('employees')
        .select('employer_id')
        .eq('id', id)
        .maybeSingle()
      if (target && target.employer_id === callerEmployer.id) authorized = true
    }
    if (!authorized) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const items = await getPaymentItemsByEmployeeId(id, limit)

    const payments = items.map((item) => {
      const memoHex = byteaMemoToHex(item.memo_bytes)

      return {
        id: item.id,
        amount_usd: item.amount,
        status: item.status,
        tx_hash: item.tx_hash,
        memo: item.memo_decoded ?? (memoHex ? decodeMemo(memoHex) : null),
        created_at: item.created_at,
      }
    })

    return Response.json({
      employee_id: id,
      payments,
      count: payments.length,
    })
  })(req)
}
