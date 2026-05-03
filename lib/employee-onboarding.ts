import { createServerClient } from '@/lib/supabase-server'
import { bridgeRequest } from '@/lib/bridge'
import type { Database } from '@/lib/database.types'
import { generateInviteToken, generateKycToken } from '@/lib/invite-tokens'
import { sendEmail } from '@/lib/email/client'

type EmployeeRow = Database['public']['Tables']['employees']['Row']

export interface CreateEmployeeInviteInput {
  employerId: string
  companyName: string
  email: string
  appUrl?: string
  firstName?: string
  lastName?: string
  jobTitle?: string
  department?: string
  countryCode?: string
  salaryAmount?: number
  salaryCurrency?: string
  payFrequency?: string
}

export interface CreateEmployeeInviteResult {
  employeeId: string
  inviteUrl: string
  kycUrl: string | null
  bridgeCustomerId: string | null
  emailSent: boolean
  existing: boolean
  inviteState: 'claimable' | 'claimed'
}

interface BridgeKycLinkResponse {
  id: string
  kyc_link: string
  tos_link: string
  kyc_status?: string
  tos_status?: string
  customer_id?: string | null
}

function getAppUrl(appUrlOverride?: string) {
  return (appUrlOverride ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://remlo.xyz').replace(/\/$/, '')
}

/**
 * Build an invite URL using the secure random token (NOT the employee UUID).
 * Callers must persist the hash to employees.invite_token_hash before sharing.
 */
export function buildInviteUrlFromToken(token: string, appUrlOverride?: string) {
  return `${getAppUrl(appUrlOverride)}/invite/${token}`
}

/**
 * Build a KYC URL using the secure random KYC token (NOT the employee UUID).
 */
export function buildKycUrlFromToken(token: string, appUrlOverride?: string) {
  return `${getAppUrl(appUrlOverride)}/kyc/${token}`
}

/**
 * Ensure a Bridge KYC link exists for an employee.
 *
 * Uses Bridge's standalone KYC Links flow (POST /v0/kyc_links). Bridge runs the
 * hosted form, derives the customer record from submitted data, and fires
 * `kyc_link.completed` to /api/webhooks/bridge with the new customer_id.
 *
 * We intentionally do NOT pre-create a Bridge customer via POST /v0/customers:
 * that endpoint requires fields we don't have at invite time (birth_date,
 * residential_address, identifying_information, signed_agreement_id).
 *
 * Returns null when BRIDGE_API_KEY is not set or full_name is unavailable.
 */
export async function ensureEmployeeKycLink(
  employee: Pick<
    EmployeeRow,
    'id' | 'email' | 'first_name' | 'last_name' | 'bridge_customer_id' | 'bridge_kyc_link_id'
  >,
  appUrlOverride?: string,
): Promise<{ kycUrl: string; customerId: string | null; kycLinkId: string } | null> {
  if (!process.env.BRIDGE_API_KEY) {
    return null
  }

  const fullName = [employee.first_name, employee.last_name].filter(Boolean).join(' ').trim()
  if (!fullName) {
    // Bridge requires `full_name` on POST /v0/kyc_links. Caller should fill in
    // the employee profile first or skip the KYC step until they do.
    console.warn('[bridge-kyc] missing full_name for employee', { id: employee.id })
    return null
  }

  const supabase = createServerClient()

  // SECURITY (audit H-7): mint a secure KYC token per request so the redirect
  // doesn't leak the employee UUID. The hash is stored; the raw token is only
  // round-tripped via Bridge's redirect_uri.
  const kycToken = generateKycToken()
  await supabase
    .from('employees')
    .update({ kyc_token_hash: kycToken.hash })
    .eq('id', employee.id)

  const redirectUri = `${getAppUrl(appUrlOverride)}/kyc/${kycToken.token}?status=complete`

  const link = await bridgeRequest<BridgeKycLinkResponse>('/kyc_links', {
    method: 'POST',
    body: JSON.stringify({
      type: 'individual',
      full_name: fullName,
      email: employee.email,
      redirect_uri: redirectUri,
    }),
    headers: { 'Idempotency-Key': `kyc-${employee.id}` },
  })

  await supabase
    .from('employees')
    .update({
      bridge_kyc_link_id: link.id,
      ...(link.customer_id ? { bridge_customer_id: link.customer_id } : {}),
    })
    .eq('id', employee.id)

  return {
    kycUrl: link.kyc_link,
    customerId: link.customer_id ?? employee.bridge_customer_id ?? null,
    kycLinkId: link.id,
  }
}

export async function sendEmployeeInviteEmail(opts: {
  to: string
  firstName?: string
  companyName: string
  inviteUrl: string
  appUrl?: string
}): Promise<boolean> {
  const result = await sendEmail({
    to: opts.to,
    template: 'employee_invite',
    props: {
      firstName: opts.firstName ?? null,
      companyName: opts.companyName,
      inviteUrl: opts.inviteUrl,
    },
  })
  return result.ok
}

export async function createEmployeeInvite(
  input: CreateEmployeeInviteInput
): Promise<CreateEmployeeInviteResult> {
  const supabase = createServerClient()
  const normalizedEmail = input.email.trim().toLowerCase()

  const { data: existing, error: existingError } = await supabase
    .from('employees')
    .select('id, email, first_name, last_name, bridge_customer_id, bridge_kyc_link_id, user_id')
    .eq('employer_id', input.employerId)
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (existingError) {
    throw new Error(existingError.message)
  }

  if (existing) {
    let kycUrl: string | null = null
    let bridgeCustomerId = existing.bridge_customer_id

    try {
      const kyc = await ensureEmployeeKycLink(existing, input.appUrl)
      kycUrl = kyc?.kycUrl ?? null
      bridgeCustomerId = kyc?.customerId ?? bridgeCustomerId
    } catch {
      kycUrl = null
    }

    // Re-mint the invite token on every resend so prior leaks are invalidated.
    const invite = generateInviteToken()
    await supabase
      .from('employees')
      .update({
        invite_token_hash: invite.hash,
        invite_token_expires_at: invite.expiresAt.toISOString(),
      })
      .eq('id', existing.id)

    return {
      employeeId: existing.id,
      inviteUrl: buildInviteUrlFromToken(invite.token, input.appUrl),
      kycUrl,
      bridgeCustomerId,
      emailSent: false,
      existing: true,
      inviteState: existing.user_id ? 'claimed' : 'claimable',
    }
  }

  const invite = generateInviteToken()

  const { data: created, error: createError } = await supabase
    .from('employees')
    .insert({
      employer_id: input.employerId,
      email: normalizedEmail,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      job_title: input.jobTitle ?? null,
      department: input.department ?? null,
      country_code: input.countryCode ?? null,
      salary_amount: input.salaryAmount ?? null,
      salary_currency: input.salaryCurrency ?? 'USD',
      pay_frequency: input.payFrequency ?? 'monthly',
      kyc_status: 'pending',
      active: true,
      invited_at: new Date().toISOString(),
      invite_token_hash: invite.hash,
      invite_token_expires_at: invite.expiresAt.toISOString(),
    })
    .select('id, email, first_name, last_name, bridge_customer_id, bridge_kyc_link_id')
    .single()

  if (createError || !created) {
    throw new Error(createError?.message ?? 'Failed to create employee')
  }

  let kycUrl: string | null = null
  let bridgeCustomerId = created.bridge_customer_id

  try {
    const kyc = await ensureEmployeeKycLink(created, input.appUrl)
    kycUrl = kyc?.kycUrl ?? null
    bridgeCustomerId = kyc?.customerId ?? bridgeCustomerId
  } catch {
    kycUrl = null
  }

  const inviteUrl = buildInviteUrlFromToken(invite.token, input.appUrl)

  const emailSent = await sendEmployeeInviteEmail({
    to: normalizedEmail,
    firstName: input.firstName,
    companyName: input.companyName,
    inviteUrl,
    appUrl: input.appUrl,
  })

  return {
    employeeId: created.id,
    inviteUrl,
    kycUrl,
    bridgeCustomerId,
    emailSent,
    existing: false,
    inviteState: 'claimable',
  }
}
