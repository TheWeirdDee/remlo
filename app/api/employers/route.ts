import { NextRequest, NextResponse } from 'next/server'
import { getAddress, isAddress } from 'viem'
import { createServerClient } from '@/lib/supabase-server'
import { PAYROLL_TREASURY_ADDRESS } from '@/lib/constants'
import { getPrivyClaims } from '@/lib/auth'
import { sendEmail } from '@/lib/email/client'
import { getPrivyUserEmail } from '@/lib/email/recipients'

export async function GET(req: NextRequest) {
  const decoded = await getPrivyClaims(req)
  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('employers')
    .select('*')
    .eq('owner_user_id', decoded.sub)
    .eq('active', true)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ employer: data ?? null })
}

export async function POST(req: NextRequest) {
  const decoded = await getPrivyClaims(req)
  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as {
    companyName?: string
    companySize?: string
    employerAdminWallet?: string
  }
  const companyName = body.companyName?.trim()
  const employerAdminWallet = body.employerAdminWallet?.trim()
  const normalizedEmployerAdminWallet = employerAdminWallet
    ? isAddress(employerAdminWallet)
      ? getAddress(employerAdminWallet)
      : null
    : null

  if (employerAdminWallet && !normalizedEmployerAdminWallet) {
    return NextResponse.json({ error: 'employerAdminWallet must be a valid EVM address' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Check if this user already has an employer record
  const { data: existing } = await supabase
    .from('employers')
    .select('id')
    .eq('owner_user_id', decoded.sub)
    .single()

  if (existing) {
    if (normalizedEmployerAdminWallet) {
      await supabase
        .from('employers')
        .update({
          employer_admin_wallet: normalizedEmployerAdminWallet,
          treasury_contract: PAYROLL_TREASURY_ADDRESS,
        })
        .eq('id', existing.id)
    }
    return NextResponse.json({ employerId: existing.id })
  }

  if (!companyName) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('employers')
    .insert({
      owner_user_id: decoded.sub,
      company_name: companyName,
      company_size: body.companySize ?? null,
      employer_admin_wallet: normalizedEmployerAdminWallet,
      treasury_contract: PAYROLL_TREASURY_ADDRESS,
      subscription_tier: 'starter',
      active: true,
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create employer' }, { status: 500 })
  }

  // Ship 6: seed the platform default Claude validator config so every
  // employer's first escrow has a working single-validator fast path without
  // a manual setup step. Non-blocking — failure just means the escrow flow
  // falls back to getDefaultValidator() at runtime.
  const privyWalletId = process.env.PRIVY_SOLANA_AGENT_WALLET_ID
  const privyWalletAddress = process.env.PRIVY_SOLANA_AGENT_WALLET_ADDRESS
  if (privyWalletId && privyWalletAddress) {
    const { error: validatorErr } = await supabase
      .from('escrow_validator_configs')
      .insert({
        employer_id: data.id,
        validator_id: privyWalletId,
        validator_address: privyWalletAddress,
        validator_type: 'llm_claude',
        weight: 1,
        active: true,
      })
    if (validatorErr && validatorErr.code !== '23505') {
      // log but don't block employer creation
      console.warn(
        `[employers] default validator config seed failed (non-fatal): ${validatorErr.message}`,
      )
    }
  }

  void (async () => {
    const email = await getPrivyUserEmail(decoded.sub)
    if (!email) return
    const appUrl = (req.nextUrl.origin || process.env.NEXT_PUBLIC_APP_URL || 'https://remlo.xyz').replace(/\/$/, '')
    await sendEmail({
      to: email,
      template: 'employer_welcome',
      idempotencyKey: `employer-welcome-${data.id}`,
      props: {
        firstName: null,
        companyName,
        appUrl,
      },
    })
  })()

  return NextResponse.json({ employerId: data.id }, { status: 201 })
}
