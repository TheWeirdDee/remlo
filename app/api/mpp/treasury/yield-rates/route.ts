import { multiRailCharge } from '@/lib/x402-multi-rail'
import { yieldRouter } from '@/lib/contracts'

/**
 * GET /api/mpp/treasury/yield-rates
 * Multi-rail $0.01 — accepts Tempo (mpp) or Base / Solana (x402).
 * Returns current APY, yield sources, and allocation from YieldRouter contract.
 */
export const GET = multiRailCharge({
  amount: '0.01',
  description: 'Treasury yield rates',
})(async () => {
  const [apy, sources, allocation] = await Promise.all([
    yieldRouter.read.getCurrentAPY() as Promise<bigint>,
    yieldRouter.read.getYieldSources() as Promise<string[]>,
    yieldRouter.read.getAllocation() as Promise<bigint[]>,
  ])

  return Response.json({
    apy_bps: Number(apy),
    apy_percent: Number(apy) / 100,
    sources,
    allocation: allocation.map(Number),
    timestamp: Date.now(),
  })
})
