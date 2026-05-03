import { createServerClient } from '@/lib/supabase-server'
import { getPrivyServerClient } from '@/lib/privy-server'

export interface EmployerRecipient {
  employerId: string
  companyName: string
  email: string
  ownerUserId: string
}

export async function getEmployerRecipient(employerId: string): Promise<EmployerRecipient | null> {
  const supabase = createServerClient()
  const { data: employer } = await supabase
    .from('employers')
    .select('id, company_name, owner_user_id')
    .eq('id', employerId)
    .maybeSingle()

  if (!employer) return null

  const email = await getPrivyUserEmail(employer.owner_user_id)
  if (!email) return null

  return {
    employerId: employer.id,
    companyName: employer.company_name,
    email,
    ownerUserId: employer.owner_user_id,
  }
}

export async function getPrivyUserEmail(userId: string): Promise<string | null> {
  try {
    const client = getPrivyServerClient()
    const user = await client.getUserById(userId)
    return user.email?.address ?? null
  } catch (err) {
    console.warn('[email] privy user lookup failed', { userId, error: err instanceof Error ? err.message : err })
    return null
  }
}
