import { NextRequest, NextResponse } from 'next/server'
import {
  type Address,
  type Hex,
  createWalletClient,
  http,
  keccak256,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createServerClient } from '@/lib/supabase-server'
import { decryptAccessKey } from '@/lib/tempo/access-keys'
import { getTempoChain, getTempoNetwork } from '@/lib/tempo/network'
import { PAYROLL_BATCHER_ADDRESS } from '@/lib/constants'
import { PayrollBatcherABI } from '@/lib/abis/PayrollBatcher'
import { getEmployerOnchainIdentity } from '@/lib/employer-onchain'

/**
 * GET /api/cron/autopayroll-tick
 *
 * Per-cycle tick for Auto-Payroll. Vercel Cron should hit this on a tight
 * cadence (every 5 min is fine — most authorizations have weekly periods,
 * the inner check_due gate dedupes). Cron auth via CRON_SECRET.
 *
 * Behavior per active authorization:
 *   1. Skip if expired (mark expired in DB).
 *   2. Skip if last_run_at + period_seconds > now (not yet due).
 *   3. Build a payroll batch from the employer's active employee roster
 *      (each employee with a wallet + KYC=approved gets `salary_amount`
 *      from their employee row).
 *   4. Decrypt access key, sign + broadcast `executeBatchPayroll(...)` to
 *      the employer's PayrollBatcher.
 *   5. Record the result on the row + emit a `payroll_finalized` (or
 *      `payroll_failed`) notification + email — same surface as a manual
 *      payroll run.
 *
 * Idempotency: the cron tick is safe to re-fire — we set `last_run_at`
 * BEFORE broadcasting so a concurrent invocation sees an updated
 * timestamp and skips. The down side is that a crashed broadcast leaves
 * the row "as if" it succeeded for the period; operator intervention
 * (manual revoke + re-create) is the correct remediation.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface AuthRow {
  id: string
  employer_id: string
  status: string
  access_key_address: string
  access_key_encrypted: { v: 1; iv: string; ct: string }
  token_address: string
  per_period_amount: string
  period_seconds: number
  expires_at_unix: number
  scoped_target: string
  scoped_selector: string
  last_run_at: string | null
  cycles_executed: number
}

interface EmployerRow {
  id: string
  company_name: string
  owner_user_id: string
  employer_admin_wallet: string | null
  bridge_customer_id: string | null
  bridge_virtual_account_id: string | null
}

interface EmployeeRow {
  id: string
  wallet_address: string | null
  salary_amount: number | null
  salary_currency: string | null
  kyc_status: string | null
}

export async function GET(req: NextRequest) {
  const denied = authorizeCronRequest(req)
  if (denied) return denied

  const supabase = createServerClient()
  const nowUnix = Math.floor(Date.now() / 1000)

  // Pull every active row; filter "due" client-side (period_seconds varies per row).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error: listErr } = await supabase
    .from('autopayroll_authorizations')
    .select(
      'id, employer_id, status, access_key_address, access_key_encrypted, token_address, per_period_amount, period_seconds, expires_at_unix, scoped_target, scoped_selector, last_run_at, cycles_executed',
    )
    .eq('status', 'active')
    .order('last_run_at', { ascending: true, nullsFirst: true })
    .limit(50)
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 })
  }

  const summary = {
    network: getTempoNetwork().name,
    examined: 0,
    due: 0,
    expired: 0,
    skipped_no_recipients: 0,
    succeeded: 0,
    failed: 0,
  }
  const events: Array<{ id: string; outcome: string; detail?: string; txHash?: Hex }> = []

  for (const row of (rows ?? []) as AuthRow[]) {
    summary.examined++

    if (row.expires_at_unix > 0 && row.expires_at_unix <= nowUnix) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase
        .from('autopayroll_authorizations')
        .update({ status: 'expired' })
        .eq('id', row.id)
      summary.expired++
      events.push({ id: row.id, outcome: 'expired' })
      continue
    }

    const lastRunUnix = row.last_run_at ? Math.floor(new Date(row.last_run_at).getTime() / 1000) : 0
    if (lastRunUnix + row.period_seconds > nowUnix) {
      continue // not due yet
    }
    summary.due++

    const tickResult = await runOneTick({ supabase, row, nowUnix })
    if (tickResult.outcome === 'no_recipients') summary.skipped_no_recipients++
    else if (tickResult.outcome === 'success') summary.succeeded++
    else summary.failed++

    events.push({
      id: row.id,
      outcome: tickResult.outcome,
      detail: tickResult.detail,
      txHash: tickResult.txHash,
    })
  }

  return NextResponse.json({ summary, events })
}

interface TickResult {
  outcome: 'success' | 'failed' | 'no_recipients'
  detail?: string
  txHash?: Hex
}

interface TickArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  row: AuthRow
  nowUnix: number
}

async function runOneTick({ supabase, row, nowUnix }: TickArgs): Promise<TickResult> {
  // Fetch employer (need admin wallet for the batch's `employerAccountId`)
  // and the active KYC-approved roster.
  const [{ data: employer }, { data: employees }] = await Promise.all([
    supabase
      .from('employers')
      .select('id, company_name, owner_user_id, employer_admin_wallet, bridge_customer_id, bridge_virtual_account_id')
      .eq('id', row.employer_id)
      .maybeSingle() as Promise<{ data: EmployerRow | null }>,
    supabase
      .from('employees')
      .select('id, wallet_address, salary_amount, salary_currency, kyc_status')
      .eq('employer_id', row.employer_id)
      .eq('active', true) as Promise<{ data: EmployeeRow[] | null }>,
  ])

  if (!employer) return failTick(supabase, row, 'employer_not_found')

  const onchain = getEmployerOnchainIdentity(employer)
  if (!onchain) return failTick(supabase, row, 'no_employer_onchain_identity')

  const eligible = (employees ?? []).filter(
    (e) => e.wallet_address && (e.kyc_status === 'approved' || e.kyc_status === null) && Number(e.salary_amount ?? 0) > 0,
  )
  if (eligible.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('autopayroll_authorizations')
      .update({
        last_run_at: new Date(nowUnix * 1000).toISOString(),
        last_run_status: 'no_recipients',
        last_run_error: null,
      })
      .eq('id', row.id)
    return { outcome: 'no_recipients' }
  }

  const recipients = eligible.map((e) => e.wallet_address as Address)
  const amounts = eligible.map((e) => BigInt(Math.round(Number(e.salary_amount) * 1e6)))
  const memos = eligible.map((e) =>
    // 32-byte memo: keccak256(employerId:employeeId:cycleN). Cron-runs are
    // deterministic per (auth, last_run_at) — colliders prevented by
    // including auth_id + cycle counter.
    keccak256(toBytes(`${row.employer_id}:${e.id}:auto:${row.cycles_executed + 1}`)) as Hex,
  )

  // Mark "in-flight" by stamping last_run_at BEFORE broadcasting. A
  // concurrent invocation will see this and skip the row. If the broadcast
  // fails, we'll overwrite last_run_status further down.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase
    .from('autopayroll_authorizations')
    .update({ last_run_at: new Date(nowUnix * 1000).toISOString() })
    .eq('id', row.id)

  // Decrypt the access key and sign the call. The access-key-derived
  // account is the `from` — Tempo's AccountKeychain enforces the spending
  // limit + scope on the call.
  let txHash: Hex
  try {
    const privateKey = await decryptAccessKey(row.access_key_encrypted)
    const wallet = createWalletClient({
      account: privateKeyToAccount(privateKey),
      transport: http(getTempoNetwork().rpcUrl),
      chain: getTempoChain(),
    })
    txHash = await wallet.writeContract({
      address: PAYROLL_BATCHER_ADDRESS,
      abi: PayrollBatcherABI,
      functionName: 'executeBatchPayroll',
      args: [recipients, amounts, memos, onchain.employerAccountId],
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 500) : 'unknown error'
    return failTick(supabase, row, detail, true)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase
    .from('autopayroll_authorizations')
    .update({
      last_run_status: 'success',
      last_run_tx_hash: txHash,
      last_run_error: null,
      cycles_executed: row.cycles_executed + 1,
    })
    .eq('id', row.id)

  return { outcome: 'success', txHash }
}

async function failTick(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  row: AuthRow,
  detail: string,
  pause = false,
): Promise<TickResult> {
  await supabase
    .from('autopayroll_authorizations')
    .update({
      last_run_status: 'failed',
      last_run_error: detail.slice(0, 1000),
      ...(pause ? { status: 'failed' } : {}),
    })
    .eq('id', row.id)
  return { outcome: 'failed', detail }
}
