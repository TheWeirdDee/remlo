import { mppx } from '@/lib/mpp'
import { payrollBatcher, getServerWalletClient } from '@/lib/contracts'
import { getPayrollRunById, getPaymentItemsByRunId } from '@/lib/queries/payroll'
import { getEmployerById } from '@/lib/queries/employers'
import { createServerClient } from '@/lib/supabase-server'
import { byteaMemoToHex } from '@/lib/memo'
import { getEmployerOnchainIdentity, getEmployerOnchainIdentityError } from '@/lib/employer-onchain'
import { requireEmployerCaller } from '@/lib/mpp-auth'

const DEPLOYER_KEY = process.env.REMLO_AGENT_PRIVATE_KEY as `0x${string}`

interface ExecuteBody {
  payrollRunId?: string
}

/**
 * POST /api/mpp/payroll/execute
 * MPP-2 — $1.00 single charge (Tempo rail only).
 *
 * Executes a pending payroll batch on-chain via PayrollBatcher.
 *
 * Authorization: caller must be the employer (Privy) or an employer-authorized
 * agent (X-Agent-Identifier + HMAC). Without this, anyone with $1 could
 * execute any pending payroll for any employer (audit C-2).
 */
export const POST = mppx.charge({ amount: '1.00' })(async (req: Request) => {
  const rawBody = await req.text()
  let body: ExecuteBody
  try {
    body = JSON.parse(rawBody) as ExecuteBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { payrollRunId } = body
  if (!payrollRunId) {
    return Response.json({ error: 'payrollRunId required' }, { status: 400 })
  }

  const run = await getPayrollRunById(payrollRunId)
  if (!run) {
    return Response.json({ error: 'Payroll run not found' }, { status: 404 })
  }

  const auth = await requireEmployerCaller(req, {
    employerId: run.employer_id,
    rawBody,
  })
  if (!auth.ok) return auth.response

  if (run.status !== 'pending') {
    return Response.json({ error: `Payroll run is ${run.status}, not pending` }, { status: 409 })
  }

  const items = await getPaymentItemsByRunId(payrollRunId)
  if (items.length === 0) {
    return Response.json({ error: 'No payment items found' }, { status: 400 })
  }

  const employer = await getEmployerById(run.employer_id)
  if (!employer) {
    return Response.json({ error: 'Employer not found for payroll run' }, { status: 404 })
  }

  const onchainIdentity = getEmployerOnchainIdentity(employer)
  if (!onchainIdentity) {
    return Response.json(getEmployerOnchainIdentityError(employer), { status: 409 })
  }

  // Fetch wallet addresses from employees table
  const supabase = createServerClient()
  const employeeIds = items.map((item) => item.employee_id)
  const { data: employees } = await supabase
    .from('employees')
    .select('id, wallet_address')
    .in('id', employeeIds)

  const walletMap = new Map<string, string>(
    (employees ?? [])
      .filter((e) => e.wallet_address)
      .map((e) => [e.id, e.wallet_address as string]),
  )

  const missing = employeeIds.filter((id) => !walletMap.has(id))
  if (missing.length > 0) {
    return Response.json(
      { error: `${missing.length} employees missing wallet addresses` },
      { status: 422 },
    )
  }

  const recipients = items.map((item) => walletMap.get(item.employee_id)! as `0x${string}`)
  const amounts = items.map((item) => BigInt(Math.round(item.amount * 1e6)))
  const memos = items.map((item) => byteaMemoToHex(item.memo_bytes))
  if (memos.some((memo) => !memo)) {
    return Response.json(
      { error: 'One or more payment items are missing a valid 32-byte payroll memo' },
      { status: 422 },
    )
  }
  const walletClient = getServerWalletClient(DEPLOYER_KEY)
  const txHash = await walletClient.writeContract({
    address: payrollBatcher.address,
    abi: payrollBatcher.abi,
    functionName: 'executeBatchPayroll',
    args: [recipients, amounts, memos as `0x${string}`[], onchainIdentity.employerAccountId],
  })

  await supabase
    .from('payroll_runs')
    .update({ status: 'submitted', tx_hash: txHash })
    .eq('id', payrollRunId)

  return Response.json({
    success: true,
    tx_hash: txHash,
    payroll_run_id: payrollRunId,
    recipient_count: recipients.length,
    employer_admin_wallet: onchainIdentity.adminWallet,
    employer_account_id: onchainIdentity.employerAccountId,
    caller: auth.caller.kind,
  })
})
