import { mppRoute } from '@/lib/mpp-route'
import { payrollBatcher, getServerWalletClient } from '@/lib/contracts'
import { sendEmailBatch } from '@/lib/email/client'
import { decodeMemo } from '@/lib/memo'
import { TEMPO_EXPLORER_URL } from '@/lib/constants'
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
export const POST = mppRoute({
  amount: '1.00',
  handler: async ({ req }) => {
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
    .select('id, wallet_address, email, first_name')
    .in('id', employeeIds)

  const walletMap = new Map<string, string>(
    (employees ?? [])
      .filter((e) => e.wallet_address)
      .map((e) => [e.id, e.wallet_address as string]),
  )
  const employeeProfileMap = new Map<
    string,
    { email: string; firstName: string | null }
  >(
    (employees ?? [])
      .filter((e) => e.email)
      .map((e) => [
        e.id,
        { email: e.email as string, firstName: (e.first_name as string | null) ?? null },
      ]),
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

  // Per-employee receipts. Fire-and-forget so MPP handler latency isn't tail-
  // extended by Resend round-trips. Idempotency keys scope to (run, employee)
  // so a retry doesn't double-send.
  void (async () => {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://remlo.xyz').replace(/\/$/, '')
    const explorerUrl = `${TEMPO_EXPLORER_URL}/tx/${txHash}`
    const settledAt = new Date().toISOString()
    const companyName = employer.company_name
    const receipts = items
      .map((item) => {
        const profile = employeeProfileMap.get(item.employee_id)
        if (!profile) return null
        const memoHex = byteaMemoToHex(item.memo_bytes)
        const memoFields = memoHex ? decodeMemo(memoHex) : null
        const payPeriod =
          memoFields && typeof memoFields === 'object' && 'payPeriod' in memoFields
            ? String((memoFields as { payPeriod: unknown }).payPeriod ?? '')
            : null
        return {
          to: profile.email,
          template: 'payment_received' as const,
          idempotencyKey: `payment-received:${payrollRunId}:${item.employee_id}`,
          tags: [
            { name: 'flow', value: 'payment_received' },
            { name: 'run_id', value: payrollRunId },
            { name: 'caller', value: auth.caller.kind },
          ],
          employerId: run.employer_id,
          props: {
            firstName: profile.firstName,
            companyName,
            amountUsd: Number(item.amount),
            settledAt,
            chain: 'tempo' as const,
            explorerUrl,
            txHash,
            payslipUrl: `${appUrl}/portal/payments?run=${encodeURIComponent(payrollRunId)}`,
            payPeriod: payPeriod || null,
            costCenter: null,
          },
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (receipts.length > 0) {
      const result = await sendEmailBatch(receipts)
      console.info('[mpp-payroll-execute] employee receipts sent', {
        runId: payrollRunId,
        attempted: result.attempted,
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
      })
    }
  })()

  return Response.json({
    success: true,
    tx_hash: txHash,
    payroll_run_id: payrollRunId,
    recipient_count: recipients.length,
    employer_admin_wallet: onchainIdentity.adminWallet,
    employer_account_id: onchainIdentity.employerAccountId,
    caller: auth.caller.kind,
  })
  },
})
