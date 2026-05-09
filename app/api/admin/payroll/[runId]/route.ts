import { NextRequest, NextResponse } from 'next/server'
import { getCallerAdmin } from '@/lib/auth'
import { recordAdminAction, inspectRequest } from '@/lib/admin-audit'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/admin/payroll/[runId]
 *
 * Drill-in view for a single payroll run. Returns the run row, the parent
 * employer, and the per-recipient payment_items joined to employee profiles
 * so an admin can see exactly which employees were paid, pending, or failed.
 *
 * Admin only.
 */
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ runId: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  const claims = await getCallerAdmin(req)
  if (!claims) {
    const meta = inspectRequest(req)
    void recordAdminAction({
      actorUserId: 'unknown',
      action: 'payroll_run.view',
      resource: `payroll_run:${(await ctx.params).runId}`,
      result: 'forbidden',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { runId } = await ctx.params
  const supabase = createServerClient()
  const meta = inspectRequest(req)
  const reason = req.headers.get('x-admin-reason')?.slice(0, 500) ?? null

  void recordAdminAction({
    actorUserId: claims.sub,
    action: 'payroll_run.view',
    resource: `payroll_run:${runId}`,
    result: 'success',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: reason ? { reason } : null,
  })

  const { data: run } = await supabase
    .from('payroll_runs')
    .select(
      'id, employer_id, status, total_amount, employee_count, tx_hash, finalized_at, settlement_time_ms, chain, created_at',
    )
    .eq('id', runId)
    .maybeSingle()

  if (!run) {
    return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
  }

  const [{ data: employer }, { data: items }] = await Promise.all([
    supabase
      .from('employers')
      .select('id, company_name, owner_user_id')
      .eq('id', run.employer_id)
      .maybeSingle(),
    supabase
      .from('payment_items')
      .select('id, employee_id, amount, status, tx_hash, created_at')
      .eq('payroll_run_id', runId)
      .order('created_at', { ascending: true }),
  ])

  const employeeIds = Array.from(new Set((items ?? []).map((i) => i.employee_id).filter(Boolean))) as string[]
  const { data: employees } =
    employeeIds.length > 0
      ? await supabase
          .from('employees')
          .select('id, email, first_name, last_name, wallet_address, kyc_status')
          .in('id', employeeIds)
      : { data: [] }

  const employeeMap = new Map((employees ?? []).map((e) => [e.id, e]))

  const recipients = (items ?? []).map((item) => {
    const employee = item.employee_id ? employeeMap.get(item.employee_id) : null
    return {
      id: item.id,
      employee_id: item.employee_id,
      name: employee
        ? [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.email
        : 'Unknown employee',
      email: employee?.email ?? null,
      wallet_address: employee?.wallet_address ?? null,
      kyc_status: employee?.kyc_status ?? null,
      amount: Number(item.amount ?? 0),
      status: item.status,
      tx_hash: item.tx_hash,
      created_at: item.created_at,
    }
  })

  // Status breakdown for the summary tiles
  const breakdown = {
    confirmed: recipients.filter((r) => r.status === 'confirmed').length,
    pending: recipients.filter((r) => r.status === 'pending').length,
    failed: recipients.filter((r) => r.status === 'failed').length,
    total: recipients.length,
  }
  const totalAmount = recipients.reduce((s, r) => s + r.amount, 0)

  return NextResponse.json({
    run,
    employer,
    breakdown: { ...breakdown, totalAmount },
    recipients,
  })
}
