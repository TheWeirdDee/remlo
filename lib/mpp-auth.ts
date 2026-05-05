/**
 * Helpers for authenticating MPP handlers.
 *
 * SECURITY: x402/MPP payment proves *a payment was made*, not *who paid*.
 * Every MPP endpoint that mutates state or discloses scoped data MUST also
 * verify caller identity. This file centralizes that check so endpoints don't
 * each re-implement it (and miss cases).
 *
 * Two principal-bearer flavors are supported:
 *
 *   1. employer-human  — Privy JWT whose `sub` matches employers.owner_user_id
 *   2. employer-agent  — Tier 1 HMAC: X-Agent-Identifier + X-Agent-Timestamp
 *                        + X-Agent-Signature, where the signing_secret was
 *                        issued from /dashboard/settings/agents
 *
 * Tier 2 (external AgentCash agents authenticated via SIWX over an
 * ERC-8004-registered key) hooks into this same helper but is wired in a
 * later patch. The seam is `verifyAgentTier2Proof` below — currently a stub.
 */
import { verifyPrivyToken, extractBearerToken, type PrivyClaims } from '@/lib/jwt'
import { verifyAccessToken as verifyMcpAccessToken } from '@/lib/mcp/oauth/tokens'
import { createServerClient } from '@/lib/supabase-server'
import { findActiveAuthorization } from '@/lib/queries/agent-authorizations'
import {
  verifyAgentProof,
  verifyTier2AgentProof,
  verifyTier2SolanaProof,
} from '@/lib/agent-proof'
import type { Database } from '@/lib/database.types'

type Employer = Database['public']['Tables']['employers']['Row']
type Employee = Database['public']['Tables']['employees']['Row']
type AgentAuthorization = Database['public']['Tables']['employer_agent_authorizations']['Row']

export type EmployerCallerContext =
  | {
      kind: 'employer-human'
      employer: Employer
      claims: PrivyClaims
    }
  | {
      kind: 'employer-agent'
      employer: Employer
      authorization: AgentAuthorization
    }

export interface EmployeeCallerContext {
  kind: 'employee-human'
  employee: Employee
  claims: PrivyClaims
}

export type CallerContext = EmployerCallerContext | EmployeeCallerContext

export type EmployerAuthResult =
  | { ok: true; caller: EmployerCallerContext }
  | { ok: false; response: Response }

export type EmployeeAuthResult =
  | { ok: true; caller: EmployeeCallerContext }
  | { ok: false; response: Response }

export type AuthResult = EmployerAuthResult | EmployeeAuthResult

export interface RequireEmployerCallerOptions {
  /** UUID of the employer whose resources are being acted on. */
  employerId: string
  /** Raw request body bytes (required when allowAgent=true so HMAC is over the exact bytes). */
  rawBody?: string
  /** Accept Tier 1 agent HMAC. Default true. */
  allowAgent?: boolean
}

export interface RequireEmployeeCallerOptions {
  /** UUID of the employee being acted on. */
  employeeId: string
}

export async function verifyMppCallerClaims(req: Request): Promise<PrivyClaims | null> {
  const token = extractBearerToken(req.headers.get('authorization'))
  if (!token) return null

  // Accept either a Privy JWT (browser sessions, direct API callers) or a
  // Remlo-issued MCP access token (callers coming through the MCP front
  // door). Both carry the same subject (Privy user ID), so downstream
  // employer-ownership checks behave identically.
  const mcpClaims = await verifyMcpAccessToken(token)
  if (mcpClaims) {
    return { sub: mcpClaims.sub, exp: mcpClaims.exp }
  }
  return verifyPrivyToken(token)
}

/** Resolve the Privy-authenticated employer for the request, or null. */
export async function getMppCallerEmployer(req: Request): Promise<Employer | null> {
  const claims = await verifyMppCallerClaims(req)
  if (!claims) return null
  const supabase = createServerClient()
  const { data } = await supabase
    .from('employers')
    .select('*')
    .eq('owner_user_id', claims.sub)
    .eq('active', true)
    .maybeSingle()
  return data ?? null
}

/** Resolve the Privy-authenticated employee for the request, or null. */
export async function getMppCallerEmployee(req: Request): Promise<Employee | null> {
  const claims = await verifyMppCallerClaims(req)
  if (!claims) return null
  const supabase = createServerClient()
  const { data } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', claims.sub)
    .eq('active', true)
    .maybeSingle()
  return data ?? null
}

/**
 * Require a caller authorized to act on behalf of `employerId`.
 *
 * Resolution order:
 *   1. Privy bearer token whose `sub` owns the employer  → employer-human
 *   2. X-Agent-Identifier + X-Agent-Signature pair authorized for the employer → employer-agent
 *
 * Returns either `{ ok: true, caller }` or `{ ok: false, response }` with the
 * exact 401/403 Response the caller should return.
 */
export async function requireEmployerCaller(
  req: Request,
  options: RequireEmployerCallerOptions,
): Promise<EmployerAuthResult> {
  const supabase = createServerClient()
  const { data: employer } = await supabase
    .from('employers')
    .select('*')
    .eq('id', options.employerId)
    .eq('active', true)
    .maybeSingle()

  if (!employer) {
    return {
      ok: false,
      response: Response.json({ error: 'Employer not found' }, { status: 404 }),
    }
  }

  // Path 1: Privy human owner
  const claims = await verifyMppCallerClaims(req)
  if (claims && claims.sub === employer.owner_user_id) {
    return { ok: true, caller: { kind: 'employer-human', employer, claims } }
  }

  // Path 2: Tier 1 agent HMAC
  const allowAgent = options.allowAgent !== false
  if (!allowAgent) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Unauthorized', code: 'PRIVY_REQUIRED' },
        { status: 401 },
      ),
    }
  }

  const agentIdentifier = req.headers.get('x-agent-identifier')?.trim()
  if (!agentIdentifier) {
    return {
      ok: false,
      response: Response.json(
        {
          error:
            'Authentication required. Provide a Privy bearer token (employer owner) or X-Agent-Identifier (registered agent).',
          code: 'AUTH_REQUIRED',
        },
        { status: 401 },
      ),
    }
  }

  const authorization = await findActiveAuthorization(employer.id, agentIdentifier)
  if (!authorization) {
    return {
      ok: false,
      response: Response.json(
        {
          error:
            'Agent is not authorized for this employer. Have the employer authorize this identifier at /dashboard/settings/agents.',
          code: 'AGENT_NOT_AUTHORIZED',
        },
        { status: 403 },
      ),
    }
  }

  if (options.rawBody === undefined) {
    return {
      ok: false,
      response: Response.json(
        {
          error:
            'Internal: requireEmployerCaller needs rawBody when accepting agent auth. This is a server bug.',
          code: 'AUTH_BUG_NO_RAW_BODY',
        },
        { status: 500 },
      ),
    }
  }

  // Dispatch to the right proof flavor. identity_kind is set per row at
  // authorization time — each kind populates a different column set:
  //   - hmac           → signing_secret
  //   - erc8004_tempo  → erc8004_owner_address (cached from Tempo on insert)
  //   - sas_solana     → solana_pubkey (the pubkey IS the identity, no
  //                       on-chain ownerOf step needed)
  const identityKind = authorization.identity_kind ?? 'hmac'

  if (identityKind === 'erc8004_tempo') {
    const proof = await verifyTier2AgentProof({
      method: req.method,
      url: req.url,
      rawBody: options.rawBody,
      timestampHeader: req.headers.get('x-agent-timestamp'),
      signatureHeader: req.headers.get('x-agent-signature'),
      expectedOwner: authorization.erc8004_owner_address,
    })
    if (!proof.ok) {
      return {
        ok: false,
        response: Response.json({ error: proof.error, code: proof.code }, { status: proof.status }),
      }
    }
  } else if (identityKind === 'sas_solana') {
    const proof = await verifyTier2SolanaProof({
      method: req.method,
      url: req.url,
      rawBody: options.rawBody,
      timestampHeader: req.headers.get('x-agent-timestamp'),
      signatureHeader: req.headers.get('x-agent-signature'),
      expectedPubkey: authorization.solana_pubkey,
    })
    if (!proof.ok) {
      return {
        ok: false,
        response: Response.json({ error: proof.error, code: proof.code }, { status: proof.status }),
      }
    }
  } else {
    const proof = verifyAgentProof({
      rawBody: options.rawBody,
      timestampHeader: req.headers.get('x-agent-timestamp'),
      signatureHeader: req.headers.get('x-agent-signature'),
      signingSecret: authorization.signing_secret,
    })
    if (!proof.ok) {
      return {
        ok: false,
        response: Response.json({ error: proof.error, code: proof.code }, { status: proof.status }),
      }
    }
  }

  return { ok: true, caller: { kind: 'employer-agent', employer, authorization } }
}

/**
 * Require a Privy-authenticated employee whose `user_id` matches the bearer
 * token, AND whose `id` matches `employeeId`.
 *
 * Tier 1 agent auth on employee-scoped endpoints isn't supported yet —
 * employees don't issue signing_secrets. If/when we add that, extend here.
 */
export async function requireEmployeeCaller(
  req: Request,
  options: RequireEmployeeCallerOptions,
): Promise<EmployeeAuthResult> {
  const claims = await verifyMppCallerClaims(req)
  if (!claims) {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  const supabase = createServerClient()
  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', options.employeeId)
    .eq('active', true)
    .maybeSingle()
  if (!employee) {
    return {
      ok: false,
      response: Response.json({ error: 'Employee not found' }, { status: 404 }),
    }
  }
  if (employee.user_id !== claims.sub) {
    return {
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }
  return { ok: true, caller: { kind: 'employee-human', employee, claims } }
}
