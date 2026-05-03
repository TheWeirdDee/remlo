import { NextRequest, NextResponse } from 'next/server'
import { getCallerEmployer } from '@/lib/auth'
import { generateComplianceReport } from '@/lib/agent/tools/compliance-report'
import { x402SolanaCharge } from '@/lib/x402-solana'

/**
 * GET /api/x402/compliance/report?employer_id=...
 *
 * Generates a compliance report for the calling employer.
 *
 * Auth: dual gate.
 *   1. x402 Solana payment ($0.05 USDC on Solana, via X-PAYMENT header).
 *      Verified through the CDP facilitator.
 *   2. Privy JWT identifying the calling employer. Reports are scoped to the
 *      caller's own employer_id; cross-employer reads return 403.
 *
 * The wrapper handles step 1; step 2 runs inside the handler.
 */
async function handler(req: Request): Promise<Response> {
  const nextReq = req as NextRequest

  const employer = await getCallerEmployer(nextReq)
  if (!employer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const employerId = nextReq.nextUrl.searchParams.get('employer_id') ?? employer.id
  if (employerId !== employer.id) {
    return NextResponse.json({ error: 'Employer ID mismatch' }, { status: 403 })
  }

  const report = await generateComplianceReport(employerId)
  return NextResponse.json(report)
}

export const GET = x402SolanaCharge({
  amount: '0.05',
  description: 'Compliance report (Remlo)',
})(handler)
