import { NextResponse } from 'next/server'
import { getAgentProfile, attachReputation } from '@/lib/queries/agent-profiles'
import { fetchAgentOwner, aggregateTempoReputation } from '@/lib/reputation/erc8004'

type RouteContext = { params: Promise<{ agentIdentifier: string }> }

/**
 * GET /api/agents/profile/[agentIdentifier]
 *
 * Public read for a single agent's Remlo profile. Used by the employer
 * authorize flow to render a profile preview when the employer pastes an
 * agent identifier (`erc8004:tempo:42`) before clicking Authorize.
 *
 * If the agent has not registered a Remlo profile yet, we fall back to a
 * minimal "bare" response built from the on-chain ERC-8004 owner lookup so
 * the employer can still authorize a Tier 2 agent that hasn't yet adopted
 * the directory.
 */
export const revalidate = 60

export async function GET(_req: Request, ctx: RouteContext) {
  const { agentIdentifier } = await ctx.params

  // Tier 2 identifier shapes we currently support: ERC-8004 on Tempo, or
  // raw Solana pubkey. Both are normalized at the registration layer; here
  // we just need to know which kind of fallback to construct if the
  // profile isn't in our database yet.
  const tempoMatch = agentIdentifier.match(/^erc8004:tempo:(\d+)$/)
  const solanaMatch = agentIdentifier.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})$/)
  if (!tempoMatch && !solanaMatch) {
    return NextResponse.json(
      {
        error:
          'Unsupported agent identifier. Expected `erc8004:tempo:<agent_id>` or `solana:<base58 pubkey>`.',
      },
      { status: 400 },
    )
  }
  const agentId = tempoMatch ? tempoMatch[1] : null
  const solanaPubkey = solanaMatch ? solanaMatch[1] : null

  const profile = await getAgentProfile(agentIdentifier)
  if (profile) {
    const [enriched] = await attachReputation([profile])
    return NextResponse.json({
      kind: 'remlo_registered',
      profile: {
        agent_identifier: enriched.agent_identifier,
        agent_id: enriched.erc8004_agent_id,
        chain: enriched.erc8004_chain,
        owner_address: enriched.owner_address,
        display_name: enriched.display_name,
        description: enriched.description,
        endpoint: enriched.endpoint,
        capabilities: enriched.capabilities,
        contact_url: enriched.contact_url,
        registered_at: enriched.registered_at,
        last_refreshed_at: enriched.last_refreshed_at,
        reputation: enriched.reputation,
      },
      resolved_at: new Date().toISOString(),
    })
  }

  // Bare fallback. ERC-8004 path: confirm the token exists on-chain via
  // ownerOf. Solana path: pubkey is self-validating (no on-chain step).
  if (tempoMatch && agentId) {
    const owner = await fetchAgentOwner(agentId)
    if (!owner) {
      return NextResponse.json(
        { error: 'Agent ID not found on the IdentityRegistry.' },
        { status: 404 },
      )
    }
    // Even an unregistered agent may have accumulated reputation via prior
    // transact-time interactions, so include it as an "earned reputation" hint.
    const reputationHint = await aggregateTempoReputation(agentId).catch(() => null)
    return NextResponse.json({
      kind: 'unregistered',
      profile: {
        agent_identifier: agentIdentifier,
        agent_id: agentId,
        chain: 'tempo',
        owner_address: owner.toLowerCase(),
        display_name: null,
        description: null,
        endpoint: null,
        capabilities: [],
        contact_url: null,
        registered_at: null,
        last_refreshed_at: null,
        reputation: reputationHint
          ? {
              total_feedback_count: reputationHint.totalFeedbackCount,
              average_score: reputationHint.averageScore,
              feedback_by_tag: reputationHint.feedbackByTag,
              latest_feedback_at: reputationHint.latestFeedbackAt,
            }
          : null,
      },
      resolved_at: new Date().toISOString(),
    })
  }

  // Solana fallback: pubkey itself is the only verifiable identity. SAS-
  // attested reputation aggregation is future work; today we surface the
  // pubkey only.
  return NextResponse.json({
    kind: 'unregistered',
    profile: {
      agent_identifier: agentIdentifier,
      agent_id: null,
      chain: 'solana',
      owner_address: solanaPubkey,
      display_name: null,
      description: null,
      endpoint: null,
      capabilities: [],
      contact_url: null,
      registered_at: null,
      last_refreshed_at: null,
      reputation: null,
    },
    resolved_at: new Date().toISOString(),
  })
}
