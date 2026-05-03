/**
 * lib/auth.ts — server-side auth helpers for API route handlers.
 *
 * Verifies Privy JWT Bearer tokens via Web Crypto (see lib/jwt.ts) and resolves
 * the caller's employer / employee / admin record.
 *
 * SECURITY: all helpers here fail closed. If PRIVY_VERIFICATION_KEY is missing
 * or the signature does not verify, every helper returns null and the caller
 * MUST return 401.
 */
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { verifyPrivyToken, extractBearerToken, type PrivyClaims } from '@/lib/jwt'
import type { Database } from '@/lib/database.types'

export type Employer = Database['public']['Tables']['employers']['Row']
export type Employee = Database['public']['Tables']['employees']['Row']

export type { PrivyClaims }

function getAdminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function isPlatformAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false
  return getAdminUserIds().includes(userId)
}

/**
 * Verify and return the Privy claims for the incoming request. Returns null on
 * any failure (no header, bad token, expired, invalid signature).
 *
 * Breaking change vs pre-audit implementation: this is now ASYNC and the old
 * unverified decode is gone. Every call site must `await`.
 */
export async function getPrivyClaims(req: NextRequest): Promise<PrivyClaims | null> {
  const token = extractBearerToken(req.headers.get('authorization'))
  if (!token) return null
  return verifyPrivyToken(token)
}

export async function getCallerAdmin(req: NextRequest): Promise<PrivyClaims | null> {
  const claims = await getPrivyClaims(req)
  if (!claims) return null
  if (!isPlatformAdminUserId(claims.sub)) return null
  return claims
}

/** Resolve the employer record for the authenticated caller. */
export async function getCallerEmployer(req: NextRequest): Promise<Employer | null> {
  const claims = await getPrivyClaims(req)
  if (!claims) return null

  const supabase = createServerClient()
  const { data } = await supabase
    .from('employers')
    .select('*')
    .eq('owner_user_id', claims.sub)
    .eq('active', true)
    .maybeSingle()

  return data ?? null
}

/** Resolve the employee record for the authenticated caller. */
export async function getCallerEmployee(req: NextRequest): Promise<Employee | null> {
  const claims = await getPrivyClaims(req)
  if (!claims) return null

  const supabase = createServerClient()
  const { data } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', claims.sub)
    .eq('active', true)
    .maybeSingle()

  return data ?? null
}

/** Resolve the employer by ID, verifying the caller is the owner. */
export async function getAuthorizedEmployer(
  req: NextRequest,
  employerId: string,
): Promise<Employer | null> {
  const claims = await getPrivyClaims(req)
  if (!claims) return null

  const supabase = createServerClient()
  const { data } = await supabase
    .from('employers')
    .select('*')
    .eq('id', employerId)
    .eq('owner_user_id', claims.sub)
    .eq('active', true)
    .maybeSingle()

  return data ?? null
}

/** Resolve the employee by ID, verifying the caller owns that employee record. */
export async function getAuthorizedEmployee(
  req: NextRequest,
  employeeId: string,
): Promise<Employee | null> {
  const claims = await getPrivyClaims(req)
  if (!claims) return null

  const supabase = createServerClient()
  const { data } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .eq('user_id', claims.sub)
    .eq('active', true)
    .maybeSingle()

  return data ?? null
}
