import { mppRoute } from '@/lib/mpp-route'
import { treasury, yieldRouter, employeeRegistry, getServerWalletClient } from '@/lib/contracts'
import { getEmployerById } from '@/lib/queries/employers'
import { getEmployerOnchainIdentity, getEmployerOnchainIdentityError } from '@/lib/employer-onchain'
import { requireEmployerCaller } from '@/lib/mpp-auth'

const DEPLOYER_KEY = process.env.REMLO_AGENT_PRIVATE_KEY as `0x${string}`

type Action = 'balance' | 'yield' | 'rebalance' | 'headcount'

interface SessionBody {
  action?: Action
  employerId?: string
  allocation?: number[]
  params?: {
    targetAllocation?: number[]
  }
}

/**
 * POST /api/mpp/agent/session/treasury
 * MPP-12 — $0.02 charge.
 *
 * AI agent treasury management endpoint. Supports four actions:
 *   - balance: read available + locked treasury balance
 *   - yield: read current APY + accrued yield
 *   - headcount: read employee count
 *   - rebalance: write — change yield allocation
 *
 * Authorization: every action requires either Privy (employer owner) or a
 * Tier 1 employer-authorized agent. Without auth, an attacker who paid $0.02
 * could rebalance any employer's yield strategy or read private treasury
 * positions.
 */
export const POST = mppRoute({
  amount: '0.02',
  handler: async ({ req }) => {
  const rawBody = await req.text()
  let body: SessionBody
  try {
    body = JSON.parse(rawBody) as SessionBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action, employerId } = body
  const allocation = body.allocation ?? body.params?.targetAllocation

  if (!action || !employerId) {
    return Response.json({ error: 'action and employerId required' }, { status: 400 })
  }

  const auth = await requireEmployerCaller(req, { employerId, rawBody })
  if (!auth.ok) return auth.response

  const employer = await getEmployerById(employerId)
  if (!employer) {
    return Response.json({ error: 'Employer not found' }, { status: 404 })
  }
  const onchainIdentity = getEmployerOnchainIdentity(employer)
  if (!onchainIdentity) {
    return Response.json(getEmployerOnchainIdentityError(employer), { status: 409 })
  }
  const timestamp = Date.now()

  switch (action) {
    case 'balance': {
      const [available, locked] = await Promise.all([
        treasury.read.getAvailableBalance([onchainIdentity.employerAccountId]) as Promise<bigint>,
        treasury.read.getLockedBalance([onchainIdentity.employerAccountId]) as Promise<bigint>,
      ])
      return Response.json({
        action,
        result: {
          employerId,
          employerAdminWallet: onchainIdentity.adminWallet,
          employerAccountId: onchainIdentity.employerAccountId,
          availableRaw: available.toString(),
          availableUsd: (Number(available) / 1e6).toFixed(6),
          lockedRaw: locked.toString(),
          lockedUsd: (Number(locked) / 1e6).toFixed(6),
          totalUsd: ((Number(available) + Number(locked)) / 1e6).toFixed(6),
        },
        timestamp,
        caller: auth.caller.kind,
      })
    }

    case 'yield': {
      const apy = (await yieldRouter.read.getCurrentAPY()) as bigint
      const accrued = (await yieldRouter.read.getAccruedYield([
        onchainIdentity.employerAccountId,
      ])) as bigint
      return Response.json({
        action,
        result: {
          employerId,
          employerAdminWallet: onchainIdentity.adminWallet,
          employerAccountId: onchainIdentity.employerAccountId,
          apyBps: Number(apy),
          apyPercent: Number(apy) / 100,
          accruedRaw: accrued.toString(),
          accruedUsd: (Number(accrued) / 1e6).toFixed(6),
        },
        timestamp,
        caller: auth.caller.kind,
      })
    }

    case 'rebalance': {
      if (!allocation || !Array.isArray(allocation)) {
        return Response.json({ error: 'allocation[] required for rebalance' }, { status: 400 })
      }
      const walletClient = getServerWalletClient(DEPLOYER_KEY)
      const txHash = await walletClient.writeContract({
        address: yieldRouter.address,
        abi: yieldRouter.abi,
        functionName: 'rebalance',
        args: [onchainIdentity.employerAccountId, allocation.map(BigInt)],
      })
      return Response.json({
        action,
        result: {
          employerId,
          employerAdminWallet: onchainIdentity.adminWallet,
          employerAccountId: onchainIdentity.employerAccountId,
          txHash,
          targetAllocation: allocation,
        },
        timestamp,
        caller: auth.caller.kind,
      })
    }

    case 'headcount': {
      const count = (await employeeRegistry.read.getEmployeeCount([
        onchainIdentity.employerAccountId,
      ])) as bigint
      return Response.json({
        action,
        result: {
          employerId,
          employerAdminWallet: onchainIdentity.adminWallet,
          employerAccountId: onchainIdentity.employerAccountId,
          headcount: Number(count),
        },
        timestamp,
        caller: auth.caller.kind,
      })
    }

    default:
      return Response.json({ error: `Unknown action: ${action as string}` }, { status: 400 })
  }
  },
})
