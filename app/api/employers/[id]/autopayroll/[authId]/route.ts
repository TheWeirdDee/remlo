import { NextRequest, NextResponse } from 'next/server'
import { type Hex } from 'viem'
import { getAuthorizedEmployer } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase-server'
import { buildRevokeKeyCalldata, ACCOUNT_KEYCHAIN_ADDRESS } from '@/lib/tempo/access-keys'

/**
 * PATCH  /api/employers/[id]/autopayroll/[authId]
 *   Body:
 *     { action: 'confirm', authorizeTxHash }   — flip draft → active
 *     { action: 'pause' }                       — flip active → paused
 *     { action: 'resume' }                      — flip paused → active
 *
 * DELETE /api/employers/[id]/autopayroll/[authId]
 *   Returns the calldata the employer signs to revoke onchain. Server
 *   does NOT broadcast — the chain authority sits with the employer.
 *   Once the employer posts the revokeTxHash back via PATCH action='revoke',
 *   we flip the row to `revoked`.
 */
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; authId: string }> }

interface PatchBody {
  action?: unknown
  authorizeTxHash?: unknown
  revokeTxHash?: unknown
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id: employerId, authId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const supabase = createServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await supabase
    .from('autopayroll_authorizations')
    .select('id, status, expires_at_unix')
    .eq('id', authId)
    .eq('employer_id', employerId)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'Authorization not found.' }, { status: 404 })
  }

  if (action === 'confirm') {
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: `Cannot confirm an authorization in status="${existing.status}".` },
        { status: 409 },
      )
    }
    const txHash = typeof body.authorizeTxHash === 'string' ? body.authorizeTxHash : ''
    if (!TX_HASH.test(txHash)) {
      return NextResponse.json({ error: 'authorizeTxHash must be a 0x… 32-byte hex.' }, { status: 400 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('autopayroll_authorizations')
      .update({
        status: 'active',
        authorize_tx_hash: txHash,
      })
      .eq('id', authId)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ status: 'active', authorizeTxHash: txHash })
  }

  if (action === 'pause') {
    if (existing.status !== 'active') {
      return NextResponse.json({ error: 'Only active authorizations can be paused.' }, { status: 409 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('autopayroll_authorizations')
      .update({ status: 'paused' })
      .eq('id', authId)
    return NextResponse.json({ status: 'paused' })
  }

  if (action === 'resume') {
    if (existing.status !== 'paused') {
      return NextResponse.json({ error: 'Only paused authorizations can be resumed.' }, { status: 409 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('autopayroll_authorizations')
      .update({ status: 'active' })
      .eq('id', authId)
    return NextResponse.json({ status: 'active' })
  }

  if (action === 'revoke') {
    const txHash = typeof body.revokeTxHash === 'string' ? body.revokeTxHash : ''
    if (!TX_HASH.test(txHash)) {
      return NextResponse.json({ error: 'revokeTxHash must be a 0x… 32-byte hex.' }, { status: 400 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('autopayroll_authorizations')
      .update({ status: 'revoked', revoke_tx_hash: txHash })
      .eq('id', authId)
    return NextResponse.json({ status: 'revoked', revokeTxHash: txHash })
  }

  return NextResponse.json(
    { error: 'action must be one of: confirm | pause | resume | revoke' },
    { status: 400 },
  )
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  // DELETE returns the calldata the employer signs to revoke onchain. The
  // row stays in active until the client PATCHes back with the
  // revokeTxHash. We don't broadcast on the server because the employer
  // holds the chain-side admin rights — the access key would have no
  // authority to revoke itself.
  const { id: employerId, authId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase
    .from('autopayroll_authorizations')
    .select('access_key_address, status')
    .eq('id', authId)
    .eq('employer_id', employerId)
    .maybeSingle()

  if (!data) return NextResponse.json({ error: 'Authorization not found.' }, { status: 404 })
  if (data.status === 'revoked') {
    return NextResponse.json({ error: 'Already revoked.' }, { status: 409 })
  }

  const calldata: Hex = buildRevokeKeyCalldata(data.access_key_address as `0x${string}`)
  return NextResponse.json({
    revokeCalldata: calldata,
    revokeTarget: ACCOUNT_KEYCHAIN_ADDRESS,
    accessKeyAddress: data.access_key_address,
  })
}
