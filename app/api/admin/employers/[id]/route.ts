import { NextRequest, NextResponse } from 'next/server'
import { getCallerAdmin } from '@/lib/auth'
import { recordAdminAction, inspectRequest } from '@/lib/admin-audit'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/admin/employers/[id]
 *
 * Drill-in view for a single employer. Returns the employer row, recent
 * payroll runs, recent MPP sessions, the team roster (KYC + wallet status),
 * and rolled-up payroll/MPP totals.
 *
 * Admin only.
 */
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  const claims = await getCallerAdmin(req)
  if (!claims) {
    const meta = inspectRequest(req)
    void recordAdminAction({
      actorUserId: 'unknown',
      action: 'employer.view',
      resource: `employer:${(await ctx.params).id}`,
      result: 'forbidden',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: employerId } = await ctx.params
  const supabase = createServerClient()
  const meta = inspectRequest(req)
  const reason = req.headers.get('x-admin-reason')?.slice(0, 500) ?? null

  // Read-side audit: this is sensitive PII (full team roster, KYC, wallets,
  // payment history). Every successful view is logged with the reason the
  // admin gave at the gate.
  void recordAdminAction({
    actorUserId: claims.sub,
    action: 'employer.view',
    resource: `employer:${employerId}`,
    result: 'success',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: reason ? { reason } : null,
  })

  const [
    { data: employer },
    { data: team },
    { data: payrollRuns },
    { data: mppSessions },
    { data: complianceEvents },
    { data: notifications },
    supportTicketsResp,
  ] = await Promise.all([
    supabase
      .from('employers')
      .select(
        'id, company_name, owner_user_id, employer_admin_wallet, subscription_tier, bridge_customer_id, bridge_virtual_account_id, treasury_contract, active, created_at, updated_at',
      )
      .eq('id', employerId)
      .maybeSingle(),
    supabase
      .from('employees')
      .select(
        'id, email, first_name, last_name, kyc_status, wallet_address, bridge_card_id, bridge_bank_account_id, active, created_at',
      )
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false }),
    supabase
      .from('payroll_runs')
      .select('id, status, total_amount, employee_count, tx_hash, created_at')
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('mpp_sessions')
      .select('id, agent_wallet, total_spent, status, opened_at, last_action')
      .eq('employer_id', employerId)
      .order('opened_at', { ascending: false })
      .limit(20),
    supabase
      .from('compliance_events')
      .select('id, employee_id, event_type, result, description, created_at')
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('notifications')
      .select('id, kind, title, severity, created_at, read_at')
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false })
      .limit(20),
    // Support tickets table isn't in generated types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase
      .from('support_tickets')
      .select('id, subject, status, email, user_role, created_at, resolved_at')
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (!employer) {
    return NextResponse.json({ error: 'Employer not found' }, { status: 404 })
  }

  const teamSafe = team ?? []
  const teamSize = teamSafe.length
  const activeTeam = teamSafe.filter((e) => e.active).length
  const kycApproved = teamSafe.filter((e) => e.kyc_status === 'approved').length
  const kycPending = teamSafe.filter((e) => e.kyc_status === 'pending' || !e.kyc_status).length
  const kycRejected = teamSafe.filter((e) => e.kyc_status === 'rejected').length
  const cardLinked = teamSafe.filter((e) => Boolean(e.bridge_card_id)).length
  const bankLinked = teamSafe.filter((e) => Boolean(e.bridge_bank_account_id)).length

  const payroll = payrollRuns ?? []
  const totalPayrollVolume = payroll.reduce((sum, run) => sum + Number(run.total_amount ?? 0), 0)
  const failedRuns = payroll.filter((r) => r.status === 'failed').length

  const mpp = mppSessions ?? []
  const totalMppSpend = mpp.reduce((sum, s) => sum + Number(s.total_spent ?? 0), 0)

  const employeeNameMap = new Map(
    teamSafe.map((e) => [
      e.id,
      [e.first_name, e.last_name].filter(Boolean).join(' ') || e.email,
    ]),
  )

  return NextResponse.json({
    employer,
    summary: {
      teamSize,
      activeTeam,
      kycApproved,
      kycPending,
      kycRejected,
      cardLinked,
      bankLinked,
      totalPayrollVolume,
      failedRuns,
      totalMppSpend,
    },
    team: teamSafe.map((e) => ({
      id: e.id,
      name: [e.first_name, e.last_name].filter(Boolean).join(' ') || e.email,
      email: e.email,
      kyc_status: e.kyc_status,
      wallet_linked: Boolean(e.wallet_address),
      card_linked: Boolean(e.bridge_card_id),
      bank_linked: Boolean(e.bridge_bank_account_id),
      active: e.active,
      created_at: e.created_at,
    })),
    payrollRuns: payroll,
    mppSessions: mpp,
    complianceEvents: (complianceEvents ?? []).map((event) => ({
      ...event,
      employeeName: event.employee_id
        ? employeeNameMap.get(event.employee_id) ?? 'Unknown'
        : 'System',
    })),
    notifications: notifications ?? [],
    supportTickets: (supportTicketsResp?.data ?? []) as Array<{
      id: string
      subject: string
      status: string
      email: string
      user_role: string
      created_at: string
      resolved_at: string | null
    }>,
  })
}
