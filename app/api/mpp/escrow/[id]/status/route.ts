import { multiRailRoute } from '@/lib/mpp-route'
import { createServerClient } from '@/lib/supabase-server'
import { publicEscrowView } from '@/lib/escrow'

/**
 * GET /api/mpp/escrow/[id]/status
 * Multi-rail $0.01 — accepts Tempo (mpp) or Base / Solana (x402).
 *
 * Public-read endpoint: any paying caller can observe the lifecycle of an
 * escrow by its UUID. Returns sanitized public fields only.
 */
export const GET = multiRailRoute<{ id: string }>({
  amount: '0.01',
  description: 'Read escrow status',
  handler: async ({ params }) => {
    const { id } = params

    const supabase = createServerClient()
    const { data: row } = await supabase
      .from('escrows')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (!row) return Response.json({ error: 'Escrow not found' }, { status: 404 })
    return Response.json(publicEscrowView(row))
  },
})
