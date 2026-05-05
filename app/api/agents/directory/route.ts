import { NextResponse } from 'next/server'
import { listAgentProfiles, attachReputation } from '@/lib/queries/agent-profiles'

/**
 * GET /api/agents/directory
 *
 * Public, free, paginated. Lists every agent that has registered a profile
 * with Remlo via /api/mpp/agents/register, ordered by most-recently
 * refreshed. Used by /agents and by employer-side authorize flows that let
 * the employer browse and pick.
 *
 * Query params:
 *   ?capability=payroll     filter to agents declaring this capability
 *   ?cursor=<iso>           pagination cursor (last_refreshed_at)
 *   ?limit=25               page size, max 100
 */
export const revalidate = 60

export async function GET(req: Request) {
  const url = new URL(req.url)
  const capability = url.searchParams.get('capability') ?? undefined
  const cursor = url.searchParams.get('cursor') ?? undefined
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 25

  const { items, nextCursor } = await listAgentProfiles({
    capability,
    cursor,
    limit: Number.isFinite(limit) ? limit : 25,
  })
  const enriched = await attachReputation(items)

  return NextResponse.json({
    agents: enriched.map((p) => ({
      agent_identifier: p.agent_identifier,
      agent_id: p.erc8004_agent_id,
      chain: p.erc8004_chain,
      owner_address: p.owner_address,
      display_name: p.display_name,
      description: p.description,
      endpoint: p.endpoint,
      capabilities: p.capabilities,
      contact_url: p.contact_url,
      registered_at: p.registered_at,
      last_refreshed_at: p.last_refreshed_at,
      reputation: p.reputation,
    })),
    next_cursor: nextCursor,
    listed_at: new Date().toISOString(),
  })
}
