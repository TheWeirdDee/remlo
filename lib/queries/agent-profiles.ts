import { createServerClient } from '@/lib/supabase-server'
import type { Database } from '@/lib/database.types'
import { aggregateTempoReputation } from '@/lib/reputation/erc8004'

export type AgentProfile = Database['public']['Tables']['remlo_agent_profiles']['Row']

/**
 * A profile enriched with the on-chain reputation summary aggregated from
 * `reputation_writes` (DB-backed, no live RPC hit per request). Suitable
 * for directory listings where we render N cards in parallel.
 */
export interface AgentProfileWithReputation extends AgentProfile {
  reputation: {
    total_feedback_count: number
    average_score: number | null
    feedback_by_tag: Record<string, number>
    latest_feedback_at: string | null
  } | null
}

export interface UpsertProfileInput {
  agent_identifier: string
  /** Optional — null for sas_solana profiles (no ERC-8004 token). */
  erc8004_agent_id: string | null
  erc8004_chain: 'tempo' | 'solana'
  /** EVM 0x-address for tempo flavor; base58 pubkey for solana flavor. */
  owner_address: string
  display_name: string
  description: string | null
  endpoint: string | null
  capabilities: string[]
  contact_url: string | null
  registered_via: 'tempo' | 'base' | 'solana'
  registration_tx_id?: string | null
}

/**
 * Upsert (insert-or-update) a profile keyed on agent_identifier. On
 * re-registration we advance `last_refreshed_at` so the directory can sort
 * fresh agents first. Other timestamps follow Postgres defaults / triggers.
 */
export async function upsertAgentProfile(input: UpsertProfileInput): Promise<AgentProfile | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('remlo_agent_profiles')
    .upsert(
      {
        ...input,
        active: true,
        last_refreshed_at: new Date().toISOString(),
      },
      { onConflict: 'agent_identifier' },
    )
    .select('*')
    .single()
  if (error) {
    console.error('[agent-profiles] upsert failed', { agent: input.agent_identifier, error: error.message })
    return null
  }
  return data ?? null
}

export async function getAgentProfile(agentIdentifier: string): Promise<AgentProfile | null> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('remlo_agent_profiles')
    .select('*')
    .eq('agent_identifier', agentIdentifier)
    .eq('active', true)
    .maybeSingle()
  return data ?? null
}

export interface ListProfilesOptions {
  capability?: string
  limit?: number
  cursor?: string
}

/**
 * Batch-attach reputation to an array of profiles. Currently only the
 * `erc8004_chain === 'tempo'` flavor has a working aggregator; Solana
 * profiles return `reputation: null` until SAS aggregation lands.
 *
 * Failures are tolerated per-agent — one missing reputation should not
 * fail the entire directory render.
 */
export async function attachReputation(
  profiles: AgentProfile[],
): Promise<AgentProfileWithReputation[]> {
  const results = await Promise.all(
    profiles.map(async (p): Promise<AgentProfileWithReputation> => {
      if (p.erc8004_chain !== 'tempo' || !p.erc8004_agent_id) {
        return { ...p, reputation: null }
      }
      try {
        const summary = await aggregateTempoReputation(p.erc8004_agent_id)
        return {
          ...p,
          reputation: {
            total_feedback_count: summary.totalFeedbackCount,
            average_score: summary.averageScore,
            feedback_by_tag: summary.feedbackByTag,
            latest_feedback_at: summary.latestFeedbackAt,
          },
        }
      } catch {
        return { ...p, reputation: null }
      }
    }),
  )
  return results
}

export async function listAgentProfiles(
  options: ListProfilesOptions = {},
): Promise<{ items: AgentProfile[]; nextCursor: string | null }> {
  const supabase = createServerClient()
  const limit = Math.max(1, Math.min(100, options.limit ?? 25))
  let query = supabase
    .from('remlo_agent_profiles')
    .select('*')
    .eq('active', true)
    .order('last_refreshed_at', { ascending: false })
    .limit(limit + 1) // +1 to detect more

  if (options.capability) {
    query = query.contains('capabilities', [options.capability.toLowerCase()])
  }
  if (options.cursor) {
    query = query.lt('last_refreshed_at', options.cursor)
  }

  const { data, error } = await query
  if (error) {
    console.error('[agent-profiles] list failed', error.message)
    return { items: [], nextCursor: null }
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? items[items.length - 1].last_refreshed_at : null
  return { items, nextCursor }
}
