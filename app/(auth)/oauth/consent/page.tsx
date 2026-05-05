import Link from 'next/link'

import { decodeAuthRequest } from '@/lib/mcp/oauth/flow'
import { getClient } from '@/lib/mcp/oauth/store'

import { ConsentForm } from './ConsentForm'

/**
 * /oauth/consent — server-rendered OAuth consent screen.
 *
 * Receives a signed `req` token (produced by /api/oauth/authorize) that
 * carries the validated client_id, redirect_uri, scope, and PKCE
 * code_challenge. We re-verify the signature here so the user never sees
 * unverified client metadata.
 */

export const dynamic = 'force-dynamic'

interface ConsentPageProps {
  searchParams: Promise<{ req?: string }>
}

export default async function OauthConsentPage({ searchParams }: ConsentPageProps): Promise<React.JSX.Element> {
  const { req } = await searchParams
  if (!req) {
    return <ErrorView title="Authorization request missing" detail="No request token was provided." />
  }

  const decoded = await decodeAuthRequest(req)
  if (!decoded) {
    return <ErrorView title="Authorization request expired" detail="This consent link has expired or been tampered with. Start a new connection from your MCP client." />
  }

  const client = await getClient(decoded.client_id)
  if (!client) {
    return <ErrorView title="Unknown client" detail={`No registered MCP client with id ${decoded.client_id}.`} />
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-neutral-200 shadow-sm p-8">
        <div className="text-center mb-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Remlo MCP authorization
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            {client.client_name}
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            wants to connect as a Remlo MCP client
          </p>
        </div>

        <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4 mb-6 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-neutral-500">Client ID</span>
            <span className="font-mono text-neutral-700 truncate ml-4">{client.client_id}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-neutral-500">Scope</span>
            <span className="font-mono text-neutral-700">{decoded.scope}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-neutral-500">Redirect</span>
            <span className="font-mono text-neutral-700 truncate ml-4">{decoded.redirect_uri}</span>
          </div>
          {client.software_id ? (
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">Software</span>
              <span className="font-mono text-neutral-700">
                {client.software_id}
                {client.software_version ? `@${client.software_version}` : ''}
              </span>
            </div>
          ) : null}
        </div>

        <div className="text-sm text-neutral-700 mb-6">
          Approving this connection lets <strong>{client.client_name}</strong> call Remlo MCP
          tools on your behalf. Paid tools (`remlo_agent_pay`, `remlo_payroll_execute`, etc.)
          still require their own per-call x402/MPP payment and any required Tier 1/2 identity
          headers — this consent only grants transport-level access.
        </div>

        <ConsentForm requestToken={req} clientName={client.client_name} />

        <div className="mt-6 pt-4 border-t border-neutral-200 text-center text-xs text-neutral-500">
          <Link href="/dashboard/integrations/mcp" className="hover:text-neutral-700 underline">
            Manage connected MCP clients
          </Link>
        </div>
      </div>
    </div>
  )
}

function ErrorView({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-neutral-200 shadow-sm p-8 text-center">
        <h1 className="text-xl font-semibold text-neutral-900 mb-2">{title}</h1>
        <p className="text-sm text-neutral-600">{detail}</p>
        <Link
          href="/dashboard"
          className="inline-block mt-6 text-sm font-medium text-neutral-900 underline hover:no-underline"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  )
}
