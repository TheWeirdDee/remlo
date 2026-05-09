import { NextRequest, NextResponse } from 'next/server'
import { getAddress } from 'viem'
import { getAuthorizedEmployer } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase-server'
import { getCompliancePreflight, getCompliancePreflightBatch } from '@/lib/tempo/compliance'
import { TEMPO_TOKENS } from '@/lib/tempo/system-contracts'
import { getTempoNetwork } from '@/lib/tempo/network'

/**
 * GET  /api/employers/[id]/compliance/preflight?address=0x…&token=0x…
 * POST /api/employers/[id]/compliance/preflight
 *   body: { addresses: Address[], token?: Address }   — batch
 *   body: { employeeIds: string[], token?: Address }  — resolve from team roster
 *
 * Pre-flights an address (or a batch) against the token's TIP-403 policy
 * so the dashboard can warn before payroll runs that an employee will
 * fail compliance. Default token is pathUSD (Remlo's canonical payroll
 * asset).
 *
 * Auth: Privy bearer of the employer owner.
 */
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

interface PostBody {
  addresses?: unknown
  employeeIds?: unknown
  token?: unknown
}

function parseAddress(raw: unknown): `0x${string}` | null {
  if (typeof raw !== 'string') return null
  try {
    return getAddress(raw)
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl
  const address = parseAddress(url.searchParams.get('address'))
  if (!address) {
    return NextResponse.json(
      { error: 'address query param is required and must be a valid 0x address.' },
      { status: 400 },
    )
  }

  const tokenParam = url.searchParams.get('token')
  const token = tokenParam ? parseAddress(tokenParam) : (TEMPO_TOKENS.pathUsd as `0x${string}`)
  if (!token) {
    return NextResponse.json({ error: 'token must be a valid 0x address.' }, { status: 400 })
  }

  try {
    const result = await getCompliancePreflight(address, { token })
    return NextResponse.json({ network: getTempoNetwork().name, result })
  } catch (err) {
    console.error('[compliance/preflight] read failed', err)
    return NextResponse.json(
      {
        error: 'Compliance pre-flight read failed. The token may not be a TIP-20 or RPC may be down.',
      },
      { status: 502 },
    )
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tokenParam = typeof body.token === 'string' ? parseAddress(body.token) : null
  const token = tokenParam ?? (TEMPO_TOKENS.pathUsd as `0x${string}`)

  // Two input modes — explicit addresses, or resolve from employee IDs in
  // the employer's roster. Roster resolution stays inside the request so
  // the client never sends raw employee wallet addresses if it doesn't
  // already know them.
  let addresses: `0x${string}`[] = []

  if (Array.isArray(body.addresses)) {
    for (const raw of body.addresses) {
      const a = parseAddress(raw)
      if (!a) {
        return NextResponse.json(
          { error: `Invalid address in body.addresses: ${String(raw)}` },
          { status: 400 },
        )
      }
      addresses.push(a)
    }
  } else if (Array.isArray(body.employeeIds)) {
    const ids = body.employeeIds.filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) {
      return NextResponse.json({ error: 'employeeIds must be a non-empty array of strings.' }, { status: 400 })
    }
    if (ids.length > 200) {
      return NextResponse.json({ error: 'employeeIds capped at 200 per request.' }, { status: 400 })
    }
    const supabase = createServerClient()
    const { data: rows } = await supabase
      .from('employees')
      .select('id, wallet_address, first_name, last_name, email')
      .eq('employer_id', employerId)
      .in('id', ids)

    addresses = (rows ?? [])
      .map((r) => (r.wallet_address ? parseAddress(r.wallet_address) : null))
      .filter((a): a is `0x${string}` => a !== null)
  } else {
    return NextResponse.json(
      { error: 'Provide either addresses[] or employeeIds[].' },
      { status: 400 },
    )
  }

  if (addresses.length === 0) {
    return NextResponse.json({
      network: getTempoNetwork().name,
      results: [],
      summary: { total: 0, ok: 0, blocked: 0 },
    })
  }
  if (addresses.length > 200) {
    return NextResponse.json({ error: 'addresses capped at 200 per request.' }, { status: 400 })
  }

  try {
    const results = await getCompliancePreflightBatch(addresses, { token })
    const ok = results.filter((r) => r.ok).length
    return NextResponse.json({
      network: getTempoNetwork().name,
      results,
      summary: {
        total: results.length,
        ok,
        blocked: results.length - ok,
      },
    })
  } catch (err) {
    console.error('[compliance/preflight] batch read failed', err)
    return NextResponse.json(
      { error: 'Compliance pre-flight read failed. RPC may be down.' },
      { status: 502 },
    )
  }
}
