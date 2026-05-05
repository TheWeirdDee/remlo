import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { GET as agentsDirectoryGET } from '@/app/api/agents/directory/route'
import { GET as agentsProfileGET } from '@/app/api/agents/profile/[agentIdentifier]/route'
import { GET as openApiSpecGET } from '@/app/api/openapi.json/route'
import { GET as reputationGET } from '@/app/api/reputation/[address]/route'

import { invokeRoute, toToolResult } from './shim'

/**
 * lib/mcp/tools-free.ts — read-only tools that don't require payment.
 *
 * These are useful for orientation: an agent connecting to the Remlo MCP
 * server can browse the directory, look up an agent's profile, or read
 * the OpenAPI contract without spending anything. All four shim into
 * existing free routes.
 */

const REMLO_BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.remlo.xyz'

export function registerFreeTools(server: McpServer): void {
  server.registerTool(
    'remlo_agents_directory',
    {
      title: 'Browse Remlo agents directory',
      description:
        "List agents that have published a Remlo profile (ERC-8004 on Tempo or SAS on Solana). Free, no auth required.",
      inputSchema: {
        chain: z.enum(['tempo', 'solana']).optional().describe('Filter to a single chain'),
        limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50)'),
        cursor: z.string().optional().describe('Pagination cursor from a previous response'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const result = await invokeRoute({
        handler: agentsDirectoryGET,
        method: 'GET',
        url: `${REMLO_BASE}/api/agents/directory`,
        args,
        requestInfo: extra.requestInfo,
      })
      return toToolResult(result)
    },
  )

  server.registerTool(
    'remlo_agents_profile',
    {
      title: 'Resolve a single agent profile',
      description:
        'Look up a single agent by identifier (`erc8004:tempo:<id>` or `solana:<base58>`). Returns directory metadata, registered capabilities, and on-chain reputation summary.',
      inputSchema: {
        agent_identifier: z
          .string()
          .min(1)
          .describe('Agent identifier, e.g. `erc8004:tempo:42` or `solana:3N5z...`'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const result = await invokeRoute({
        handler: agentsProfileGET,
        method: 'GET',
        url: `${REMLO_BASE}/api/agents/profile/${encodeURIComponent(args.agent_identifier)}`,
        pathParams: { agentIdentifier: args.agent_identifier },
        requestInfo: extra.requestInfo,
      })
      return toToolResult(result)
    },
  )

  server.registerTool(
    'remlo_reputation_get',
    {
      title: 'Read on-chain reputation for any subject',
      description:
        'Return the aggregated reputation summary for a subject address. Reads ERC-8004 ReputationRegistry on Tempo and Solana Attestation Service. Subject can be an EVM 0x-address or a Solana base58 pubkey.',
      inputSchema: {
        address: z.string().min(1).describe('EVM 0x-address or Solana base58 pubkey'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const result = await invokeRoute({
        handler: reputationGET,
        method: 'GET',
        url: `${REMLO_BASE}/api/reputation/${encodeURIComponent(args.address)}`,
        pathParams: { address: args.address },
        requestInfo: extra.requestInfo,
      })
      return toToolResult(result)
    },
  )

  server.registerTool(
    'remlo_openapi_spec',
    {
      title: 'Read the Remlo OpenAPI contract',
      description:
        "Return the full OpenAPI 3.0.3 spec for every paid Remlo endpoint, including prices, supported chains, request/response schemas, and `x-payment-info` annotations. Useful for tools that want to discover endpoints programmatically.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (_args, extra) => {
      const result = await invokeRoute({
        handler: openApiSpecGET,
        method: 'GET',
        url: `${REMLO_BASE}/api/openapi.json`,
        requestInfo: extra.requestInfo,
      })
      return toToolResult(result)
    },
  )
}
