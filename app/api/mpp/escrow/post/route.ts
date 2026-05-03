import { multiRailCharge } from '@/lib/x402-multi-rail'
import { postEscrow, publicEscrowView } from '@/lib/escrow'
import { findActiveAuthorization } from '@/lib/queries/agent-authorizations'
import { verifyAgentProof } from '@/lib/agent-proof'

interface PostEscrowBody {
  employer_id?: string
  worker_wallet_address?: string
  worker_agent_identifier?: string
  amount_usdc?: string
  rubric_prompt?: string
  expiry_hours?: number
}

/**
 * POST /api/mpp/escrow/post
 * Multi-rail $0.10 — accepts Tempo (mpp) or Base / Solana (x402).
 *
 * Posts an escrow that will be auto-validated by Claude.
 *
 * Authorization: caller must be an agent registered for the employer
 * (X-Agent-Identifier + HMAC over `${X-Agent-Timestamp}.${rawBody}`).
 * Identifier without HMAC is rejected — leaked identifiers can no longer be
 * replayed by an attacker who paid $0.10.
 */
export const POST = multiRailCharge({
  amount: '0.10',
  description: 'Post escrow with auto-validation',
})(async (req: Request) => {
  const agentIdentifier = req.headers.get('x-agent-identifier')?.trim()
  if (!agentIdentifier) {
    return Response.json(
      {
        error: 'Missing X-Agent-Identifier header. Register at /dashboard/settings/agents.',
        code: 'AGENT_NOT_AUTHORIZED',
      },
      { status: 401 },
    )
  }

  const rawBody = await req.text()
  let body: PostEscrowBody
  try {
    body = JSON.parse(rawBody) as PostEscrowBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const required: (keyof PostEscrowBody)[] = [
    'employer_id',
    'worker_wallet_address',
    'worker_agent_identifier',
    'amount_usdc',
    'rubric_prompt',
  ]
  for (const key of required) {
    if (!body[key]) return Response.json({ error: `${key} is required` }, { status: 400 })
  }

  // Resolve the authorization at the route layer so we can verify the HMAC
  // before incurring the more expensive postEscrow path. postEscrow re-checks
  // authorization itself (per-tx cap, etc) so this is defense in depth.
  const authorization = await findActiveAuthorization(body.employer_id!, agentIdentifier)
  if (!authorization) {
    return Response.json(
      {
        error:
          'Agent is not authorized for this employer. Have the employer authorize this identifier at /dashboard/settings/agents.',
        code: 'AGENT_NOT_AUTHORIZED',
      },
      { status: 403 },
    )
  }
  const proof = verifyAgentProof({
    rawBody,
    timestampHeader: req.headers.get('x-agent-timestamp'),
    signatureHeader: req.headers.get('x-agent-signature'),
    signingSecret: authorization.signing_secret,
  })
  if (!proof.ok) {
    return Response.json({ error: proof.error, code: proof.code }, { status: proof.status })
  }

  try {
    const row = await postEscrow({
      employerId: body.employer_id!,
      requesterAgentIdentifier: agentIdentifier,
      workerAgentIdentifier: body.worker_agent_identifier!,
      workerWalletAddress: body.worker_wallet_address!,
      amountUsdc: body.amount_usdc!,
      rubricPrompt: body.rubric_prompt!,
      expiryHours: body.expiry_hours,
    })
    return Response.json({
      ...publicEscrowView(row),
      initialize_signature: row.initialize_signature,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    const status = msg.toLowerCase().includes('authoriz')
      ? 403
      : msg.toLowerCase().includes('not configured')
        ? 503
        : 400
    return Response.json({ error: msg }, { status })
  }
})
