import { NextRequest, NextResponse } from 'next/server'
import { type Address, getAddress, toFunctionSelector } from 'viem'
import { getAuthorizedEmployer } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase-server'
import type { Json } from '@/lib/database.types'
import { TEMPO_TOKENS } from '@/lib/tempo/system-contracts'
import { PAYROLL_BATCHER_ADDRESS } from '@/lib/constants'
import {
  buildAuthorizeKeyCalldata,
  buildRevokeKeyCalldata,
  encryptAccessKey,
  generateAccessKey,
  ACCOUNT_KEYCHAIN_ADDRESS,
  NON_EXPIRING_KEY,
  PERIOD_WEEK,
} from '@/lib/tempo/access-keys'
import { tempoExplorerUrl } from '@/lib/tempo/network'
import { PayrollBatcherABI } from '@/lib/abis/PayrollBatcher'

/**
 * GET  /api/employers/[id]/autopayroll
 *   List the employer's authorizations (newest first).
 *
 * POST /api/employers/[id]/autopayroll
 *   Body: {
 *     perPeriodAmount: string  // base units (pathUSD = 6 decimals)
 *     periodSeconds?: number   // default 604800 (1 week)
 *     expiresAtUnix?: number   // 0 / undefined = non-expiring
 *     token?: Address          // default pathUSD
 *     notes?: string
 *   }
 *
 *   Returns the access-key address + the calldata the employer's wallet
 *   should sign + submit to the AccountKeychain precompile to grant
 *   spending authority. Row is created in `draft` and flips to `active`
 *   once the client posts the `authorizeTxHash` back to PATCH.
 *
 * Auth: Privy bearer of the employer owner.
 */
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const PAYROLL_SELECTOR = toFunctionSelector('executeBatchPayroll(address[],uint256[],bytes32[],bytes32)')

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase
    .from('autopayroll_authorizations')
    .select(
      'id, status, access_key_address, token_address, per_period_amount, period_seconds, expires_at_unix, scoped_target, scoped_selector, authorize_tx_hash, revoke_tx_hash, last_run_at, last_run_status, last_run_tx_hash, cycles_executed, notes, created_at, updated_at',
    )
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ items: data ?? [] })
}

interface CreateBody {
  perPeriodAmount?: unknown
  periodSeconds?: unknown
  expiresAtUnix?: unknown
  token?: unknown
  notes?: unknown
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const perPeriodRaw = typeof body.perPeriodAmount === 'string' ? body.perPeriodAmount : ''
  if (!/^[0-9]+$/.test(perPeriodRaw) || perPeriodRaw === '0') {
    return NextResponse.json(
      { error: 'perPeriodAmount must be a positive base-units integer string.' },
      { status: 400 },
    )
  }
  const perPeriodAmount = BigInt(perPeriodRaw)

  const periodSeconds =
    typeof body.periodSeconds === 'number' && body.periodSeconds >= 3600
      ? BigInt(Math.floor(body.periodSeconds))
      : PERIOD_WEEK
  if (periodSeconds < 3600n) {
    return NextResponse.json({ error: 'periodSeconds must be ≥ 3600.' }, { status: 400 })
  }

  const expiresAtUnix =
    typeof body.expiresAtUnix === 'number' && body.expiresAtUnix > 0
      ? BigInt(Math.floor(body.expiresAtUnix))
      : NON_EXPIRING_KEY

  let tokenAddress: Address
  try {
    tokenAddress =
      typeof body.token === 'string' ? getAddress(body.token) : (TEMPO_TOKENS.pathUsd as Address)
  } catch {
    return NextResponse.json({ error: 'token must be a valid 0x address.' }, { status: 400 })
  }

  const notes =
    typeof body.notes === 'string' && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 1000)
      : null

  // 1. Generate the fresh access key.
  const accessKey = generateAccessKey()

  // 2. Encrypt the private key for storage.
  let encrypted
  try {
    encrypted = await encryptAccessKey(accessKey.privateKey)
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Encryption key not configured on the server.',
      },
      { status: 503 },
    )
  }

  // 3. Build the calldata the employer signs onchain.
  const calldata = buildAuthorizeKeyCalldata({
    accessKeyAddress: accessKey.address,
    signatureType: 0, // secp256k1
    restrictions: {
      expiry: expiresAtUnix,
      enforceLimits: true,
      limits: [
        {
          token: tokenAddress,
          amount: perPeriodAmount,
          period: periodSeconds,
        },
      ],
      allowAnyCalls: false,
      allowedCalls: [
        {
          target: PAYROLL_BATCHER_ADDRESS,
          selectorRules: [
            {
              // Empty recipients array = any recipient passes (we still
              // gate per-employee at the token's TIP-403 policy level).
              selector: PAYROLL_SELECTOR,
              recipients: [],
            },
          ],
        },
      ],
    },
  })

  // 4. Persist as draft. Client comes back with authorizeTxHash to flip
  //    status → active.
  const supabase = createServerClient()
  const { data: row, error } = await supabase
    .from('autopayroll_authorizations')
    .insert({
      employer_id: employerId,
      status: 'draft',
      access_key_address: accessKey.address,
      access_key_encrypted: encrypted as unknown as Json,
      token_address: tokenAddress,
      per_period_amount: perPeriodAmount.toString(),
      period_seconds: Number(periodSeconds),
      expires_at_unix: Number(expiresAtUnix),
      scoped_target: PAYROLL_BATCHER_ADDRESS,
      scoped_selector: PAYROLL_SELECTOR,
      notes,
    })
    .select('id')
    .single()

  if (error || !row) {
    return NextResponse.json(
      { error: error?.message ?? 'Could not persist authorization.' },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      id: row.id,
      accessKeyAddress: accessKey.address,
      authorizationCalldata: calldata,
      authorizationTarget: ACCOUNT_KEYCHAIN_ADDRESS,
      perPeriodAmount: perPeriodAmount.toString(),
      periodSeconds: Number(periodSeconds),
      expiresAtUnix: Number(expiresAtUnix),
      tokenAddress,
      // Helpful for debugging / explorer linking.
      payrollBatcher: PAYROLL_BATCHER_ADDRESS,
      payrollSelector: PAYROLL_SELECTOR,
      explorerHint: tempoExplorerUrl('address', ACCOUNT_KEYCHAIN_ADDRESS),
    },
    { status: 201 },
  )
}

// Reference the ABI symbol so it isn't tree-shaken as unused — we intend the
// access key to call PayrollBatcher.executeBatchPayroll, the ABI lives in
// the cron's signing path.
void PayrollBatcherABI
