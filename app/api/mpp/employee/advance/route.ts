import { mppRoute } from '@/lib/mpp-route'
import { streamVesting, getServerWalletClient } from '@/lib/contracts'
import { createServerClient } from '@/lib/supabase-server'
import { requireEmployerCaller } from '@/lib/mpp-auth'

const DEPLOYER_KEY = process.env.REMLO_AGENT_PRIVATE_KEY as `0x${string}`

interface AdvanceBody {
  employeeId?: string
}

/**
 * POST /api/mpp/employee/advance
 * MPP-3 — $0.50 single charge.
 *
 * Claims all accrued vesting for an employee via StreamVesting.claimAccrued.
 * Funds settle to the employee's registered wallet, not the caller's.
 *
 * Authorization: caller must be the employer (Privy) or an employer-authorized
 * agent. Employee is resolved from the database — caller cannot specify an
 * arbitrary wallet, which prevents an agent of employer A from triggering a
 * claim on employer B's employee.
 *
 * Body: { employeeId: string }
 */
export const POST = mppRoute({
  amount: '0.50',
  handler: async ({ req }) => {
  const rawBody = await req.text()
  let body: AdvanceBody
  try {
    body = JSON.parse(rawBody) as AdvanceBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { employeeId } = body
  if (!employeeId) {
    return Response.json({ error: 'employeeId required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: employee } = await supabase
    .from('employees')
    .select('id, employer_id, wallet_address, active')
    .eq('id', employeeId)
    .maybeSingle()
  if (!employee || !employee.active) {
    return Response.json({ error: 'Employee not found' }, { status: 404 })
  }
  if (!employee.wallet_address) {
    return Response.json(
      { error: 'Employee has no Tempo wallet address on file' },
      { status: 422 },
    )
  }

  const auth = await requireEmployerCaller(req, {
    employerId: employee.employer_id,
    rawBody,
  })
  if (!auth.ok) return auth.response

  const walletClient = getServerWalletClient(DEPLOYER_KEY)
  const txHash = await walletClient.writeContract({
    address: streamVesting.address,
    abi: streamVesting.abi,
    functionName: 'claimAccrued',
    args: [employee.wallet_address as `0x${string}`],
  })

  return Response.json({
    success: true,
    employee_id: employee.id,
    employee_address: employee.wallet_address,
    tx_hash: txHash,
    claimed_at: new Date().toISOString(),
    caller: auth.caller.kind,
  })
  },
})
