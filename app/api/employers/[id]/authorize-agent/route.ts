import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedEmployer } from '@/lib/auth'
import {
  listAuthorizations,
  createAuthorization,
  revokeAuthorization,
  type CreateAuthorizationInput,
} from '@/lib/queries/agent-authorizations'
import { fetchAgentOwner } from '@/lib/reputation/erc8004'
import { PublicKey } from '@solana/web3.js'

type RouteContext = { params: Promise<{ id: string }> }

interface AuthorizeAgentBody {
  label?: string
  agent_identifier?: string
  per_tx_cap_usd?: number
  per_day_cap_usd?: number
  /** 'hmac' (default), 'erc8004_tempo', or 'sas_solana'. */
  identity_kind?: 'hmac' | 'erc8004_tempo' | 'sas_solana'
  /** Required when identity_kind === 'erc8004_tempo'. uint256 as decimal string. */
  erc8004_agent_id?: string
  /** Required when identity_kind === 'sas_solana'. Base58 32-byte pubkey. */
  solana_pubkey?: string
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const authorizations = await listAuthorizations(employerId)
  return NextResponse.json(authorizations)
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as AuthorizeAgentBody

  if (!body.label?.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }

  const perTx = Number(body.per_tx_cap_usd ?? 100)
  const perDay = Number(body.per_day_cap_usd ?? 500)
  if (!Number.isFinite(perTx) || perTx <= 0 || !Number.isFinite(perDay) || perDay <= 0) {
    return NextResponse.json({ error: 'Spend caps must be positive numbers' }, { status: 400 })
  }

  const identityKind = body.identity_kind ?? 'hmac'
  let insertInput: CreateAuthorizationInput

  if (identityKind === 'erc8004_tempo') {
    const agentId = body.erc8004_agent_id?.trim()
    if (!agentId || !/^\d+$/.test(agentId)) {
      return NextResponse.json(
        { error: 'erc8004_agent_id must be a positive integer when identity_kind is erc8004_tempo' },
        { status: 400 },
      )
    }
    const owner = await fetchAgentOwner(agentId)
    if (!owner) {
      return NextResponse.json(
        {
          error:
            'Agent not found on Tempo IdentityRegistry. Ensure the agent is registered before authorizing.',
        },
        { status: 404 },
      )
    }
    insertInput = {
      employer_id: employerId,
      label: body.label.trim(),
      agent_identifier: `erc8004:tempo:${agentId}`,
      per_tx_cap_usd: perTx,
      per_day_cap_usd: perDay,
      identity_kind: 'erc8004_tempo',
      erc8004_agent_id: agentId,
      erc8004_owner_address: owner.toLowerCase(),
    }
  } else if (identityKind === 'sas_solana') {
    const rawPubkey = body.solana_pubkey?.trim()
    if (!rawPubkey) {
      return NextResponse.json(
        { error: 'solana_pubkey is required when identity_kind is sas_solana' },
        { status: 400 },
      )
    }
    let normalizedPubkey: string
    try {
      normalizedPubkey = new PublicKey(rawPubkey).toBase58()
    } catch {
      return NextResponse.json(
        { error: 'solana_pubkey must be a valid base58-encoded 32-byte Solana public key.' },
        { status: 400 },
      )
    }
    insertInput = {
      employer_id: employerId,
      label: body.label.trim(),
      agent_identifier: `solana:${normalizedPubkey}`,
      per_tx_cap_usd: perTx,
      per_day_cap_usd: perDay,
      identity_kind: 'sas_solana',
      solana_pubkey: normalizedPubkey,
    }
  } else {
    if (!body.agent_identifier?.trim()) {
      return NextResponse.json(
        { error: 'agent_identifier is required for hmac identity_kind' },
        { status: 400 },
      )
    }
    insertInput = {
      employer_id: employerId,
      label: body.label.trim(),
      agent_identifier: body.agent_identifier.trim(),
      per_tx_cap_usd: perTx,
      per_day_cap_usd: perDay,
      identity_kind: 'hmac',
    }
  }

  const created = await createAuthorization(insertInput)

  if (!created) {
    return NextResponse.json(
      { error: 'Failed to create authorization (duplicate agent_identifier?)' },
      { status: 409 },
    )
  }

  return NextResponse.json(created, { status: 201 })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const authorizationId = req.nextUrl.searchParams.get('authorization_id')
  if (!authorizationId) {
    return NextResponse.json({ error: 'authorization_id query param required' }, { status: 400 })
  }

  const ok = await revokeAuthorization(authorizationId, employerId)
  return NextResponse.json({ revoked: ok })
}
