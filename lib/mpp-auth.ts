/**
 * Helpers for authenticating MPP handlers. MPP endpoints are wrapped by
 * `mppx.charge()` which gives them a raw `Request` (not NextRequest), so the
 * standard `getCaller*` helpers from `lib/auth.ts` don't apply directly.
 *
 * SECURITY: x402/MPP payment proves *a payment was made*, not *who paid*.
 * Every MPP endpoint that mutates state or discloses scoped data MUST also
 * verify caller identity via Privy or a signed agent proof.
 */
import { verifyPrivyToken, extractBearerToken, type PrivyClaims } from '@/lib/jwt'
import { createServerClient } from '@/lib/supabase-server'
import type { Database } from '@/lib/database.types'

type Employer = Database['public']['Tables']['employers']['Row']
type Employee = Database['public']['Tables']['employees']['Row']

export async function verifyMppCallerClaims(req: Request): Promise<PrivyClaims | null> {
  const token = extractBearerToken(req.headers.get('authorization'))
  if (!token) return null
  return verifyPrivyToken(token)
}

/**
 * Resolve the employer record for the MPP caller. Returns null if the caller
 * does not have a valid Privy JWT OR is not the owner of any employer.
 */
export async function getMppCallerEmployer(req: Request): Promise<Employer | null> {
  const claims = await verifyMppCallerClaims(req)
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

/**
 * Resolve the employee record for the MPP caller. Used for employee-scoped
 * MPP reads (balance, history) that currently leak across employees.
 */
export async function getMppCallerEmployee(req: Request): Promise<Employee | null> {
  const claims = await verifyMppCallerClaims(req)
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
