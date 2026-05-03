import { NextRequest } from 'next/server'
import { mppx } from '@/lib/mpp'
import { getPayslip } from '@/lib/queries/payroll'
import { byteaMemoToHex, decodeMemo } from '@/lib/memo'
import { createServerClient } from '@/lib/supabase-server'
import { requireEmployerCaller, requireEmployeeCaller } from '@/lib/mpp-auth'

/**
 * GET /api/mpp/payslips/[runId]/[employeeId]
 * MPP-6 — $0.02 single charge.
 *
 * Returns a single payslip for an employee within a payroll run, including
 * decoded ISO 20022 memo fields. This endpoint discloses PII so it MUST be
 * authorized.
 *
 * Authorization (any one of):
 *   1. Employer (Privy) or employer-authorized agent (HMAC) of the employer
 *      that owns the payroll run.
 *   2. Employee (Privy) whose user_id matches the requested employeeId — an
 *      employee can always read their own payslip.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; employeeId: string }> },
) {
  const { runId, employeeId } = await params

  return mppx.charge({ amount: '0.02' })(async (innerReq: Request) => {
    const result = await getPayslip(runId, employeeId)
    if (!result) {
      return Response.json({ error: 'Payslip not found' }, { status: 404 })
    }
    const { run, item } = result

    // Resolve the employer that owns this run so the helper can scope.
    const supabase = createServerClient()
    const { data: runOwner } = await supabase
      .from('payroll_runs')
      .select('employer_id')
      .eq('id', run.id)
      .maybeSingle()
    if (!runOwner) {
      return Response.json({ error: 'Run not found' }, { status: 404 })
    }

    // Try employer-side auth first.
    const employerAuth = await requireEmployerCaller(innerReq, {
      employerId: runOwner.employer_id,
      rawBody: '', // GET — no body to sign over
    })

    if (!employerAuth.ok) {
      // Fall back to employee-side auth (employee reading their own payslip).
      const employeeAuth = await requireEmployeeCaller(innerReq, { employeeId })
      if (!employeeAuth.ok) return employerAuth.response // surface the employer-side error
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
  })(req)
}
