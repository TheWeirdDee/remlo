import { parseUnits, keccak256, toBytes, isAddress } from 'viem'
import { multiRailRoute } from '@/lib/mpp-route'
import { payrollBatcher, treasury, getServerWalletClient } from '@/lib/contracts'
import { getEmployerOnchainIdentity, getEmployerOnchainIdentityError } from '@/lib/employer-onchain'
import { spentInLastDay, recordPayCall } from '@/lib/queries/agent-authorizations'
import { encodeMemo } from '@/lib/memo'
import { requireEmployerCaller } from '@/lib/mpp-auth'

const AGENT_KEY = process.env.REMLO_AGENT_PRIVATE_KEY as `0x${string}` | undefined

interface PayBody {
  employer_id?: string
  recipient_wallet?: string
  amount?: string
  reference?: string
}

/**
 * POST /api/mpp/agent/pay
 * MPP-13 — $0.05 x402 charge.
 *
 * Agent-to-agent direct payment. An external agent (via AgentCash or another
 * x402 client) pays $0.05 USDC to Remlo, then Remlo broadcasts a single-
 * recipient USDC transfer from the specified employer's PayrollTreasury.
 *
 * Authorization: caller must be the employer (Privy) or an employer-authorized
 * agent (X-Agent-Identifier + HMAC). Caps (per-tx, per-day) enforce only on
 * the agent path — Privy callers can spend up to the on-chain treasury balance.
 */
export const POST = multiRailRoute({
  amount: '0.05',
  description: 'Agent-to-agent payment',
  handler: async ({ req }) => {
    if (!AGENT_KEY) {
    return Response.json(
      { error: 'REMLO_AGENT_PRIVATE_KEY not configured on server' },
      { status: 503 },
    )
  }

  const rawBody = await req.text()
  let body: PayBody
  try {
    body = JSON.parse(rawBody) as PayBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { employer_id: employerId, recipient_wallet: recipient, amount, reference } = body

  if (!employerId || !recipient || !amount) {
    return Response.json(
      { error: 'employer_id, recipient_wallet, and amount are required' },
      { status: 400 },
    )
  }
  if (!isAddress(recipient)) {
    return Response.json({ error: 'recipient_wallet is not a valid address' }, { status: 400 })
  }
  const amountNumber = parseFloat(amount)
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return Response.json({ error: 'amount must be a positive decimal' }, { status: 400 })
  }

  const auth = await requireEmployerCaller(req, { employerId, rawBody })
  if (!auth.ok) return auth.response

  // Caps + audit trail apply to the agent path only. Human owners use the
  // dashboard for cap-bound spending.
  if (auth.caller.kind === 'employer-agent') {
    const authorization = auth.caller.authorization
    if (amountNumber > Number(authorization.per_tx_cap_usd)) {
      return Response.json(
        {
          error: 'Amount exceeds per-transaction cap',
          requested: amountNumber,
          per_tx_cap_usd: Number(authorization.per_tx_cap_usd),
          code: 'PER_TX_CAP_EXCEEDED',
        },
        { status: 403 },
      )
    }
    const spentToday = await spentInLastDay(authorization.id)
    if (spentToday + amountNumber > Number(authorization.per_day_cap_usd)) {
      return Response.json(
        {
          error: 'Daily spend cap would be exceeded by this payment',
          spent_in_last_24h: spentToday,
          requested: amountNumber,
          per_day_cap_usd: Number(authorization.per_day_cap_usd),
          code: 'PER_DAY_CAP_EXCEEDED',
        },
        { status: 403 },
      )
    }
  }

  const onchain = getEmployerOnchainIdentity(auth.caller.employer)
  if (!onchain) {
    return Response.json(getEmployerOnchainIdentityError(auth.caller.employer), { status: 409 })
  }

  const amountUnits = parseUnits(amount, 6)
  const available = (await treasury.read.getAvailableBalance([
    onchain.employerAccountId,
  ])) as bigint
  if (available < amountUnits) {
    return Response.json(
      {
        error: 'Insufficient treasury balance',
        available: (Number(available) / 1e6).toFixed(6),
        required: amount,
      },
      { status: 422 },
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const recordHash = keccak256(
    toBytes(`agent-pay:${employerId}:${recipient}:${amount}:${Date.now()}`),
  ).slice(2, 10)

  const memo = encodeMemo({
    employerId,
    employeeId: '00000000-0000-0000-0000-000000000000',
    payPeriod: today,
    costCenter: 1000,
    recordHash,
  })

  const walletClient = getServerWalletClient(AGENT_KEY)
  const txHash = await walletClient.writeContract({
    address: payrollBatcher.address,
    abi: payrollBatcher.abi,
    functionName: 'executeBatchPayroll',
    args: [
      [recipient as `0x${string}`],
      [amountUnits],
      [memo],
      onchain.employerAccountId,
    ],
  })

  if (auth.caller.kind === 'employer-agent') {
    await recordPayCall({
      authorization_id: auth.caller.authorization.id,
      employer_id: employerId,
      recipient_wallet: recipient,
      usd_amount: amountNumber,
      tx_hash: txHash,
      reference: reference ?? null,
    })
  }

  return Response.json({
    success: true,
    tx_hash: txHash,
    recipient,
    amount,
    employer_id: employerId,
    employer_account_id: onchain.employerAccountId,
    caller: auth.caller.kind,
    authorization:
      auth.caller.kind === 'employer-agent'
        ? {
            id: auth.caller.authorization.id,
            label: auth.caller.authorization.label,
            per_tx_cap_usd: Number(auth.caller.authorization.per_tx_cap_usd),
            per_day_cap_usd: Number(auth.caller.authorization.per_day_cap_usd),
          }
        : null,
    reference: reference ?? null,
    explorer_url: `https://explore.moderato.tempo.xyz/tx/${txHash}`,
    memo,
    timestamp: new Date().toISOString(),
  })
  },
})
