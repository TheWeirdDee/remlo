import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getPrivyClaims } from '@/lib/auth'
import { hashToken, hashIp } from '@/lib/invite-tokens'

type RouteContext = { params: Promise<{ token: string }> }

/**
 * POST /api/invite/[token]/claim
 *
 * SECURITY (audit C-10, H-4):
 *   - Token is a 32-byte random value stored as sha256. Lookup is by hash.
 *   - TTL enforced; claimed tokens are tombstoned with invite_claimed_at.
 *   - Rate-limited per IP.
 *   - Requires Privy Bearer token (verified via lib/auth.ts).
 *   - Employer DIDs blocked from claiming.
 *   - Single-use via unique filter on update; losing the race returns 409.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const claims = await getPrivyClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const tokenHash = hashToken(token)
  const ipHash = hashIp(
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
  )

  const sinceIso = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await supabase
    .from('invite_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('attempted_at', sinceIso)
  if ((count ?? 0) >= 24) {
    return NextResponse.json({ error: 'Too many claim attempts' }, { status: 429 })
  }

  const { data: existingEmployer } = await supabase
    .from('employers')
    .select('id')
    .eq('owner_user_id', claims.sub)
    .eq('active', true)
    .maybeSingle()
  if (existingEmployer) {
    return NextResponse.json(
      { error: 'This Privy account is already registered as an employer. Use a separate account to accept employee invites.' },
      { status: 403 },
    )
  }

  const { data: employee } = await supabase
    .from('employees')
    .select('id, user_id, invite_token_expires_at, invite_claimed_at, active')
    .eq('invite_token_hash', tokenHash)
    .maybeSingle()

  await supabase.from('invite_attempts').insert({
    ip_hash: ipHash,
    token_hash: tokenHash,
    success: !!employee,
  })

  if (!employee || !employee.active) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }
  if (employee.invite_claimed_at || employee.user_id) {
    return NextResponse.json({ error: 'Invite already claimed' }, { status: 409 })
  }
  if (
    employee.invite_token_expires_at &&
    new Date(employee.invite_token_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
  }

  const body = (await req.json().catch(() => ({}))) as { walletAddress?: string }

  // Single-use: update only where invite is still unclaimed. If another
  // request raced us, the `.is('user_id', null)` guard + unique token hash
  // cause this to match zero rows and we return 409 via the subsequent check.
  const { data: updated, error: updateError } = await supabase
    .from('employees')
    .update({
      user_id: claims.sub,
      wallet_address: body.walletAddress ?? null,
      onboarded_at: new Date().toISOString(),
      invite_claimed_at: new Date().toISOString(),
      invite_token_hash: null, // burn the token
    })
    .eq('id', employee.id)
    .is('user_id', null)
    .select('id')

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Invite already claimed' }, { status: 409 })
  }

  return NextResponse.json({ success: true })
}
