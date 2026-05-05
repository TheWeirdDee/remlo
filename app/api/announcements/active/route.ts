import { NextRequest, NextResponse } from 'next/server'
import { getPrivyClaims } from '@/lib/auth'
import { isPlatformAdminUserId } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase-server'
import { listActiveAnnouncementsForUser } from '@/lib/queries/announcements'

/**
 * GET /api/announcements/active
 *
 * Returns up to 5 currently-visible (published, not expired, not dismissed)
 * announcements for the authenticated user, scoped by their role. Used by
 * the dashboard SystemAnnouncementBanner.
 *
 * Why we resolve the role inline instead of taking it as a query param:
 * the client mustn't be able to pick its own audience and read employer-
 * targeted messages while logged in as an employee. The role is whatever
 * we observe in our own database, period.
 */
export async function GET(req: NextRequest) {
  const claims = await getPrivyClaims(req)
  if (!claims) return NextResponse.json({ items: [] })

  const role = await resolveRole(claims.sub)
  if (!role) return NextResponse.json({ items: [] })

  const items = await listActiveAnnouncementsForUser(claims.sub, role)
  return NextResponse.json({ items })
}

async function resolveRole(
  userId: string,
): Promise<'employer' | 'employee' | 'platform_admin' | null> {
  if (isPlatformAdminUserId(userId)) return 'platform_admin'
  const supabase = createServerClient()
  const [{ data: employer }, { data: employee }] = await Promise.all([
    supabase
      .from('employers')
      .select('id')
      .eq('owner_user_id', userId)
      .eq('active', true)
      .maybeSingle(),
    supabase
      .from('employees')
      .select('id')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle(),
  ])
  if (employer) return 'employer'
  if (employee) return 'employee'
  return null
}
