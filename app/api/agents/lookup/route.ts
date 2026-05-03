import { NextResponse } from 'next/server'
import { fetchAgentOwner, fetchAgentURI } from '@/lib/reputation/erc8004'

/**
 * GET /api/agents/lookup?agent_id=<bigint>
 *
 * Public read-only resolver. Given an ERC-8004 agentId on Tempo, returns the
 * EOA that owns the token and the registered agentURI. Used by the public
 * /agents/register flow to confirm a registration completed and by employers
 * authorizing a Tier 2 agent to confirm the operator's identity before
 * adding a row to employer_agent_authorizations.
 */
export const revalidate = 60

export async function GET(req: Request) {
  const url = new URL(req.url)
  const agentId = url.searchParams.get('agent_id')?.trim()
  if (!agentId || !/^\d+$/.test(agentId)) {
    return NextResponse.json(
      { error: 'agent_id query param required (uint256 as decimal string)' },
      { status: 400 },
    )
  }

  const [owner, agentUri] = await Promise.all([
    fetchAgentOwner(agentId),
    fetchAgentURI(agentId),
  ])

  if (!owner) {
    return NextResponse.json({ error: 'Agent not found on registry' }, { status: 404 })
  }

  return NextResponse.json({
    agent_id: agentId,
    owner_address: owner.toLowerCase(),
    agent_uri: agentUri,
    chain: 'tempo',
    chain_id: 42431,
    identity_registry: process.env.NEXT_PUBLIC_ERC8004_IDENTITY_REGISTRY ?? null,
    resolved_at: new Date().toISOString(),
  })
}
