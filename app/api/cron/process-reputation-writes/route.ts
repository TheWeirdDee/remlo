import { NextRequest, NextResponse } from 'next/server'
import {
  fetchPendingReputationWrites,
  markReputationWriteWritten,
  markReputationWriteFailed,
  type ReputationWrite,
} from '@/lib/queries/reputation-writes'
import { processSasReputationWrite } from '@/lib/reputation/sas'
import { processErc8004ReputationWrite } from '@/lib/reputation/erc8004'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createNotification } from '@/lib/notifications'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Map a reputation_writes row to its owning employer (if discoverable) so we
 * can fire a `reputation_write_failed` bell notification on terminal failure.
 * Returns null if the source can't be resolved or didn't carry an employer id.
 */
async function resolveEmployerForReputationWrite(
  row: ReputationWrite,
): Promise<string | null> {
  if (!row.source_id) return null
  const sb = createServerClient()
  try {
    if (row.source_type === 'employer') {
      return row.source_id
    }
    if (row.source_type === 'escrow') {
      const { data } = await sb
        .from('escrows')
        .select('employer_id')
        .eq('id', row.source_id)
        .maybeSingle()
      return data?.employer_id ?? null
    }
    if (row.source_type === 'payment_item') {
      const { data: item } = await sb
        .from('payment_items')
        .select('payroll_run_id')
        .eq('id', row.source_id)
        .maybeSingle()
      if (!item?.payroll_run_id) return null
      const { data: run } = await sb
        .from('payroll_runs')
        .select('employer_id')
        .eq('id', item.payroll_run_id)
        .maybeSingle()
      return run?.employer_id ?? null
    }
    if (row.source_type === 'agent_pay_call') {
      const { data } = await sb
        .from('agent_pay_calls')
        .select('employer_id')
        .eq('id', row.source_id)
        .maybeSingle()
      return data?.employer_id ?? null
    }
  } catch (err) {
    console.warn('[reputation-cron] resolve employer failed', { source_type: row.source_type, source_id: row.source_id, err })
  }
  return null
}

/**
 * POST /api/cron/process-reputation-writes
 *
 * Drains the `reputation_writes` queue. For each pending or failed row
 * (attempts < 5), routes to the correct chain handler, broadcasts the
 * on-chain attestation / feedback, and marks the row as written.
 *
 * Non-blocking from the payment flow's perspective: failures here never roll
 * back the already-settled payment. Rows retry up to 5 times before being
 * marked 'giving_up'.
 *
 * Vercel Cron hits this every 10 minutes per vercel.json.
 *
 * Auth: same pattern as process-expired-escrows — X-Cron-Secret header or
 * Vercel's signed Authorization bearer.
 */
const MAX_PER_INVOCATION = 20

export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauthorized = authorizeCronRequest(req)
  if (unauthorized) return unauthorized

  const pending = await fetchPendingReputationWrites(MAX_PER_INVOCATION, 5)

  let processed = 0
  let written = 0
  let failed = 0
  let gaveUp = 0
  const errors: { id: string; error: string }[] = []

  const solanaWalletId = process.env.PRIVY_SOLANA_AGENT_WALLET_ID
  const solanaWalletAddress = process.env.PRIVY_SOLANA_AGENT_WALLET_ADDRESS

  for (const row of pending) {
    processed++
    try {
      if (row.chain === 'solana') {
        if (!solanaWalletId || !solanaWalletAddress) {
          throw new Error('Privy Solana wallet not configured')
        }
        const result = await processSasReputationWrite(
          row,
          solanaWalletId,
          solanaWalletAddress,
        )
        await markReputationWriteWritten(row.id, {
          attestation_pda: result.attestationPda,
          tx_signature: result.signature,
        })
        written++
      } else if (row.chain === 'tempo') {
        const result = await processErc8004ReputationWrite(row)
        await markReputationWriteWritten(row.id, {
          tx_signature: result.txHash,
          signer_path: result.signerPath,
        })
        written++
      } else {
        throw new Error(`Unknown chain: ${(row as ReputationWrite).chain}`)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'unknown error'
      const nextAttempts = row.attempts + 1
      await markReputationWriteFailed(row.id, nextAttempts, errorMessage, 5, row.chain)
      if (nextAttempts >= 5) {
        gaveUp++
        // Surface terminal failures to the employer dashboard. We only fire on
        // giving_up (5+ attempts) so retryable transient errors don't spam the
        // bell.
        const employerId = await resolveEmployerForReputationWrite(row)
        if (employerId) {
          void createNotification({
            employerId,
            kind: 'reputation_write_failed',
            severity: 'error',
            title: 'Reputation write gave up',
            body: `${row.chain === 'solana' ? 'SAS attestation' : 'ERC-8004 feedback'} for ${row.subject_address.slice(0, 10)}… failed after 5 attempts. Last error: ${errorMessage.slice(0, 200)}`,
            link: `/dashboard/reputation`,
            metadata: {
              reputation_write_id: row.id,
              chain: row.chain,
              source_type: row.source_type,
              source_id: row.source_id,
              error: errorMessage.slice(0, 500),
            },
          })
        }
      } else {
        failed++
      }
      errors.push({ id: row.id, error: errorMessage })
    }
  }

  return NextResponse.json({
    processed,
    written,
    failed,
    gave_up: gaveUp,
    errors,
  })
}

// Vercel Cron uses GET by default. Accept both.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}
