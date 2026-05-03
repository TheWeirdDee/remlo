import { mppx } from '@/lib/mpp'
import { createOffRampTransfer } from '@/lib/bridge'
import { createServerClient } from '@/lib/supabase-server'
import { requireEmployerCaller } from '@/lib/mpp-auth'
import { randomUUID } from 'crypto'

interface OffRampBody {
  employeeId?: string
  amount?: string
  destinationType?: 'ach' | 'sepa' | 'spei' | 'pix'
  bankAccountId?: string
}

/**
 * POST /api/mpp/bridge/offramp
 * MPP-9 — $0.25 single charge (Tempo rail only).
 *
 * Initiates a Bridge off-ramp transfer for an employee. Converts on-chain
 * balance to fiat via ACH / SEPA / SPEI / PIX.
 *
 * Authorization: caller must be the employer (Privy) or an employer-
 * authorized agent (X-Agent-Identifier + HMAC). The employee must belong to
 * that employer; offramp is rejected if the employee is from a different
 * employer.
 */
export const POST = mppx.charge({ amount: '0.25' })(async (req: Request) => {
  const rawBody = await req.text()
  let body: OffRampBody
  try {
    body = JSON.parse(rawBody) as OffRampBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { employeeId, amount, destinationType, bankAccountId } = body
  if (!employeeId || !amount || !destinationType || !bankAccountId) {
    return Response.json(
      { error: 'employeeId, amount, destinationType, bankAccountId required' },
      { status: 400 },
    )
  }

  const supabase = createServerClient()
  const { data: employee } = await supabase
    .from('employees')
    .select('id, employer_id, bridge_customer_id')
    .eq('id', employeeId)
    .maybeSingle()
  if (!employee) {
    return Response.json({ error: 'Employee not found' }, { status: 404 })
  }

  const auth = await requireEmployerCaller(req, {
    employerId: employee.employer_id,
    rawBody,
  })
  if (!auth.ok) return auth.response

  if (!employee.bridge_customer_id) {
    return Response.json(
      { error: 'Employee has no Bridge account. Complete KYC first.' },
      { status: 422 },
    )
  }

  const transfer = await createOffRampTransfer({
    customerId: employee.bridge_customer_id,
    amount,
    currency: 'usd',
    destinationType,
    bankAccountId,
    idempotencyKey: randomUUID(),
  })

  return Response.json({
    success: true,
    transfer_id: transfer.id,
    status: transfer.status,
    amount,
    destination_type: destinationType,
    created_at: transfer.created_at,
    caller: auth.caller.kind,
  })
})
