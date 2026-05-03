import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { hashToken, hashIp } from '@/lib/invite-tokens'

type RouteContext = { params: Promise<{ token: string }> }

/**
 * GET /api/invite/[token]
 * Public — no Privy auth. The opaque random token IS the auth.
 *
 * SECURITY (audit C-10, H-4):
 *   - Token is a 32-byte random value; lookup is by sha256(token).
 *     Legacy UUID lookup has been removed.
 *   - Response intentionally excludes salary_amount / salary_currency /
 *     pay_frequency to avoid leaking payroll intelligence to an attacker
 *     who steals a forwarded invite link.
 *   - TTL enforced via invite_token_expires_at.
 *   - Every request is rate-limited per IP (24 per hour).
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const supabase = createServerClient()
  const tokenHash = hashToken(token)
  const ipHash = hashIp(
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
  )

  // Rate limit — reject if > 24 attempts from this IP in the last hour.
  const sinceIso = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await supabase
    .from('invite_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('attempted_at', sinceIso)
  if ((count ?? 0) >= 24) {
    return NextResponse.json({ error: 'Too many invite requests' }, { status: 429 })
  }

  const { data } = await supabase
    .from('employees')
    .select('id, first_name, last_name, job_title, department, invite_token_expires_at, invite_claimed_at, active')
    .eq('invite_token_hash', tokenHash)
    .maybeSingle()

  await supabase.from('invite_attempts').insert({
    ip_hash: ipHash,
    token_hash: tokenHash,
    success: !!data,
  })

  if (!data || !data.active) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }
  if (data.invite_claimed_at) {
    return NextResponse.json({ error: 'Invite already claimed' }, { status: 409 })
  }
  if (
    data.invite_token_expires_at &&
    new Date(data.invite_token_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
  }

  // Non-sensitive display fields only.
  return NextResponse.json({
    firstName: data.first_name,
    lastName: data.last_name,
    jobTitle: data.job_title,
    department: data.department,
  })
}
