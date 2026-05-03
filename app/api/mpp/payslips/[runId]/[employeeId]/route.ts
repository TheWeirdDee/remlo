import { multiRailRoute } from '@/lib/mpp-route'
import { getPayslip } from '@/lib/queries/payroll'
import { byteaMemoToHex, decodeMemo } from '@/lib/memo'
import { createServerClient } from '@/lib/supabase-server'
import { requireEmployerCaller, requireEmployeeCaller } from '@/lib/mpp-auth'

/**
 * GET /api/mpp/payslips/[runId]/[employeeId]
 * MPP-6 — $0.02 single charge.
 *
 * Returns a single payslip for an employee within a payroll run, including
 * decoded ISO 20022 memo fields. Discloses PII.
 *
 * Authorization (any one of):
 *   1. Employer (Privy) or employer-authorized agent (HMAC) of the employer
 *      that owns the payroll run.
 *   2. Employee (Privy) whose `user_id` matches the requested employeeId.
 */
export const GET = multiRailRoute<{ runId: string; employeeId: string }>({
  amount: '0.02',
  description: 'Fetch payslip',
  handler: async ({ req, params }) => {
    const { runId, employeeId } = params

    const result = await getPayslip(runId, employeeId)
    if (!result) {
      return Response.json({ error: 'Payslip not found' }, { status: 404 })
    }
    const { run, item } = result

    const supabase = createServerClient()
    const { data: runOwner } = await supabase
      .from('payroll_runs')
      .select('employer_id')
      .eq('id', run.id)
      .maybeSingle()
    if (!runOwner) {
      return Response.json({ error: 'Run not found' }, { status: 404 })
    }

    const employerAuth = await requireEmployerCaller(req, {
      employerId: runOwner.employer_id,
      rawBody: '',
    })

    if (!employerAuth.ok) {
      const employeeAuth = await requireEmployeeCaller(req, { employeeId })
      if (!employeeAuth.ok) return employerAuth.response
    }

    const memoHex = byteaMemoToHex(item.memo_bytes)
    const memoFields = item.memo_decoded ?? (memoHex ? decodeMemo(memoHex) : null)

    return Response.json({
      payslip: {
        run_id: run.id,
        employee_id: employeeId,
        amount_usd: item.amount,
        status: item.status,
        tx_hash: item.tx_hash,
        memo: memoFields,
        finalized_at: run.finalized_at,
        block_number: run.block_number,
        created_at: item.created_at,
      },
    })
  },
})
