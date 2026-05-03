import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getAuthorizedEmployer } from '@/lib/auth'

type RouteContext = { params: Promise<{ id: string; runId: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id: employerId, runId } = await ctx.params

  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const { data: run, error: runError } = await supabase
    .from('payroll_runs')
    .select(
      'id, status, total_amount, employee_count, fee_amount, token_address, tx_hash, mpp_receipt_hash, block_number, finalized_at, settlement_time_ms, chain, solana_signatures, council_approved_at, created_at'
    )
    .eq('id', runId)
    .eq('employer_id', employerId)
    .maybeSingle()

  if (runError) {
    return NextResponse.json({ error: runError.message }, { status: 500 })
  }
  if (!run) {
    return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
  }

  const { data: items, error: itemsError } = await supabase
    .from('payment_items')
    .select(
      'id, employee_id, amount, status, tx_hash, chain, solana_signature, policy_rejection_reason, created_at'
    )
    .eq('payroll_run_id', runId)
    .order('created_at', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  const employeeIds = Array.from(new Set((items ?? []).map((it) => it.employee_id)))
  let employees: Array<{
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    wallet_address: string | null
  }> = []

  if (employeeIds.length > 0) {
    const { data: employeesData, error: employeesError } = await supabase
      .from('employees')
      .select('id, email, first_name, last_name, wallet_address')
      .in('id', employeeIds)

    if (employeesError) {
      return NextResponse.json({ error: employeesError.message }, { status: 500 })
    }
    employees = employeesData ?? []
  }

  const employeeById = new Map(employees.map((e) => [e.id, e]))

  const itemsWithEmployee = (items ?? []).map((item) => {
    const employee = employeeById.get(item.employee_id)
    const fullName = [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim()
    return {
      id: item.id,
      employee_id: item.employee_id,
      employee_name: fullName || null,
      employee_email: employee?.email ?? null,
      wallet_address: employee?.wallet_address ?? null,
      amount: item.amount,
      status: item.status,
      tx_hash: item.tx_hash,
      chain: item.chain,
      solana_signature: item.solana_signature,
      policy_rejection_reason: item.policy_rejection_reason,
      created_at: item.created_at,
    }
  })

  return NextResponse.json({ run, items: itemsWithEmployee })
}

export const dynamic = 'force-dynamic'
