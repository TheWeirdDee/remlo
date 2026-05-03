import { multiRailCharge } from '@/lib/x402-multi-rail'
import { decodeMemo } from '@/lib/memo'

/**
 * POST /api/mpp/memo/decode
 * Multi-rail $0.01 — accepts Tempo (mpp) or Base / Solana (x402).
 * Decodes a 32-byte ISO 20022 TIP-20 memo hex string.
 *
 * Body: { memo: string } — 0x-prefixed 32-byte hex
 */
export const POST = multiRailCharge({
  amount: '0.01',
  description: 'Decode payroll memo',
})(async (req: Request) => {
  const { memo } = await req.json() as { memo: string }

  if (!memo || !memo.startsWith('0x') || memo.length !== 66) {
    return Response.json({ error: 'Invalid memo: must be 0x-prefixed 32-byte hex (66 chars)' }, { status: 400 })
  }

  const fields = decodeMemo(memo as `0x${string}`)
  if (!fields) {
    return Response.json({ error: 'Failed to decode memo: unrecognized format' }, { status: 422 })
  }

  return Response.json({ memo, fields })
})
