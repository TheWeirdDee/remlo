'use client'

import * as React from 'react'
import { useSolanaWallets } from '@privy-io/react-auth'
import { encodeFunctionData } from 'viem'
import { IdentityRegistryAbi } from '@/lib/reputation/erc8004-client'

interface LookupResponse {
  agent_id: string
  owner_address: string
  agent_uri: string | null
  identity_registry: string | null
  resolved_at: string
}

interface RegisterFlowProps {
  identityRegistry: string | null
  tempoChainId: number
  tempoRpcUrl: string
  explorerBase: string
}

/**
 * Tier 2 registration helper. Three steps:
 *   1. Build the agentURI document (what an indexer fetches when it resolves
 *      the token).
 *   2. Get the calldata + registry address — operator submits via their own
 *      wallet (we don't bundle a wallet picker just for this page).
 *   3. After registration, resolve the new agentId on-chain to confirm and
 *      copy the X-Agent-Identifier value to use in MPP requests.
 */
export function RegisterFlow({
  identityRegistry,
  tempoChainId,
  tempoRpcUrl,
  explorerBase,
}: RegisterFlowProps) {
  const { ready: solanaReady, wallets: solanaWallets } = useSolanaWallets()
  const solanaWallet = solanaWallets[0] ?? null
  const [agentName, setAgentName] = React.useState('')
  const [agentDescription, setAgentDescription] = React.useState('')
  const [agentEndpoint, setAgentEndpoint] = React.useState('')
  const [agentUri, setAgentUri] = React.useState('')
  const [solanaSigning, setSolanaSigning] = React.useState(false)
  const [solanaSignedBody, setSolanaSignedBody] = React.useState('')
  const [solanaSignError, setSolanaSignError] = React.useState<string | null>(null)

  const [lookupAgentId, setLookupAgentId] = React.useState('')
  const [lookupState, setLookupState] = React.useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ok'; data: LookupResponse }
    | { status: 'error'; message: string }
  >({ status: 'idle' })

  const [copied, setCopied] = React.useState<string | null>(null)

  const builtAgentUri = React.useMemo(() => {
    if (agentUri.trim()) return agentUri.trim()
    if (!agentName.trim()) return ''
    const card = {
      name: agentName.trim(),
      description: agentDescription.trim() || null,
      endpoint: agentEndpoint.trim() || null,
      protocols: ['x402', 'mpp'],
      registered_via: 'remlo.xyz/agents/register',
    }
    return `data:application/json;base64,${typeof window !== 'undefined' ? btoa(JSON.stringify(card)) : ''}`
  }, [agentName, agentDescription, agentEndpoint, agentUri])

  const calldata = React.useMemo(() => {
    if (!builtAgentUri) return ''
    try {
      return encodeFunctionData({
        abi: IdentityRegistryAbi,
        functionName: 'register',
        args: [builtAgentUri],
      })
    } catch {
      return ''
    }
  }, [builtAgentUri])

  async function handleLookup() {
    const id = lookupAgentId.trim()
    if (!/^\d+$/.test(id)) {
      setLookupState({ status: 'error', message: 'Agent ID must be a positive integer.' })
      return
    }
    setLookupState({ status: 'loading' })
    try {
      const res = await fetch(`/api/agents/lookup?agent_id=${id}`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Lookup failed (${res.status})`)
      }
      const data = (await res.json()) as LookupResponse
      setLookupState({ status: 'ok', data })
    } catch (err) {
      setLookupState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Lookup failed',
      })
    }
  }

  async function copy(label: string, value: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* noop */
    }
  }

  async function buildSolanaRegistrationBody() {
    setSolanaSignError(null)
    setSolanaSignedBody('')

    if (!solanaWallet) {
      setSolanaSignError('No Privy Solana wallet is loaded in this browser session.')
      return
    }

    setSolanaSigning(true)
    try {
      const timestampMs = Date.now().toString()
      const message = [
        'Remlo Agent Registration v1',
        `Solana Pubkey: ${solanaWallet.address}`,
        `Timestamp: ${timestampMs}`,
      ].join('\n')
      const signature = await solanaWallet.signMessage(new TextEncoder().encode(message))
      const body = {
        solana_pubkey: solanaWallet.address,
        timestamp_ms: timestampMs,
        signature: toHex(signature),
        display_name: agentName.trim() || 'Winszn Payroll Agent',
        description:
          agentDescription.trim() ||
          'Employee-owned Solana agent identity for Remlo payroll and compliance demos.',
        endpoint: agentEndpoint.trim() || 'https://www.remlo.xyz/api/mcp',
        capabilities: ['payroll', 'compliance', 'agent-pay', 'solana'],
        contact_url: 'https://t.me/remlo_xyz',
      }
      setSolanaSignedBody(JSON.stringify(body, null, 2))
    } catch (err) {
      setSolanaSignError(err instanceof Error ? err.message : 'Unable to sign Solana registration message.')
    } finally {
      setSolanaSigning(false)
    }
  }

  return (
    <div className="space-y-10">
      <Step number={0} title="Solana fast path for AgentCash">
        <p className="text-sm text-[var(--text-secondary)]">
          If your agent identity is a Solana wallet, you do not need an
          ERC-8004 mint. Sign the Remlo registration message with the loaded
          Privy Solana wallet, then submit the generated body through
          AgentCash. AgentCash pays the HTTP 402 fee; this wallet signature
          proves the agent identity.
        </p>
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Loaded Solana wallet
              </p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--mono)]">
                {solanaWallet?.address ?? (solanaReady ? 'No Solana wallet loaded' : 'Loading Privy wallets...')}
              </p>
            </div>
            <button
              type="button"
              onClick={buildSolanaRegistrationBody}
              disabled={!solanaReady || !solanaWallet || solanaSigning}
              className="h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {solanaSigning ? 'Signing...' : 'Sign Solana body'}
            </button>
          </div>
          {solanaSignError ? (
            <p className="text-xs text-red-400">{solanaSignError}</p>
          ) : null}
          {solanaSignedBody ? (
            <div className="space-y-3">
              <CopyRow
                label="Signed AgentCash body"
                value={solanaSignedBody}
                onCopy={copy}
                copied={copied}
                mono
                truncate
              />
              <pre className="rounded-md bg-[var(--bg-subtle)] p-3 text-xs overflow-x-auto">
                {`npx -y agentcash@latest fetch https://www.remlo.xyz/api/mpp/agents/register \\
  -m POST \\
  -H "Content-Type: application/json" \\
  -d '${solanaSignedBody.replaceAll("'", "'\\''")}'`}
              </pre>
              <p className="text-xs text-[var(--text-muted)]">
                The response returns{' '}
                <code className="font-mono">X-Agent-Identifier: solana:{solanaWallet?.address}</code>.
                Authorize that identifier in the employer dashboard with the
                per-transaction and per-day caps you want to demo.
              </p>
            </div>
          ) : null}
        </div>
      </Step>

      <Step number={1} title="Describe your agent">
        <p className="text-sm text-[var(--text-secondary)]">
          The agentURI is whatever URL or data URI you want indexers to fetch
          when they resolve your agent token. The simplest path is to fill in
          the fields below — we&apos;ll bake them into a self-contained{' '}
          <code className="font-mono">data:application/json</code> URI you can
          ship as-is. If you already host an{' '}
          <code className="font-mono">/.well-known/agent-registration.json</code>,
          paste that URL into the override field.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Agent name"
            placeholder="My Payroll Concierge"
            value={agentName}
            onChange={setAgentName}
          />
          <Field
            label="Endpoint"
            placeholder="https://my-agent.example/api"
            value={agentEndpoint}
            onChange={setAgentEndpoint}
          />
          <div className="sm:col-span-2">
            <Field
              label="Description"
              placeholder="What your agent does, in one sentence."
              value={agentDescription}
              onChange={setAgentDescription}
            />
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Override agentURI (optional)"
              placeholder="https://yourdomain/.well-known/agent-registration.json"
              value={agentUri}
              onChange={setAgentUri}
            />
          </div>
        </div>
      </Step>

      <Step number={2} title="Submit the register transaction">
        <p className="text-sm text-[var(--text-secondary)]">
          Send a transaction to the IdentityRegistry on Tempo Moderato (chain
          id {tempoChainId}) calling{' '}
          <code className="font-mono">register(agentURI)</code>. We don&apos;t
          embed a wallet picker on this page — use whatever signer your agent
          already controls (CDP, Privy server wallets, viem, foundry,
          MetaMask, the explorer&apos;s &ldquo;write&rdquo; tab).
        </p>
        <CopyRow
          label="Identity Registry"
          value={identityRegistry ?? 'NEXT_PUBLIC_ERC8004_IDENTITY_REGISTRY not set'}
          onCopy={copy}
          copied={copied}
        />
        <CopyRow
          label="Tempo RPC URL"
          value={tempoRpcUrl}
          onCopy={copy}
          copied={copied}
        />
        <CopyRow
          label="agentURI you'll register"
          value={builtAgentUri || '(fill the form above first)'}
          onCopy={copy}
          copied={copied}
          mono
        />
        <CopyRow
          label="Encoded calldata"
          value={calldata || '(fill the form above first)'}
          onCopy={copy}
          copied={copied}
          mono
          truncate
        />
        <pre className="rounded-md bg-[var(--bg-subtle)] p-3 text-xs overflow-x-auto">
          {`# viem one-liner once you have the calldata above
import { createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const tempo = defineChain({
  id: ${tempoChainId},
  name: 'Tempo Moderato',
  nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 6 },
  rpcUrls: { default: { http: ['${tempoRpcUrl}'] } },
})
const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.AGENT_KEY as \`0x\${string}\`),
  chain: tempo,
  transport: http('${tempoRpcUrl}'),
})
const tx = await wallet.sendTransaction({
  to: '${identityRegistry ?? '0x...'}',
  data: '${calldata || '0x...'}',
})`}
        </pre>
        <p className="text-xs text-[var(--text-muted)]">
          The transaction emits an{' '}
          <code className="font-mono">AgentRegistered(agentId, owner)</code>{' '}
          event. Pull <code className="font-mono">agentId</code> from the
          receipt logs (or read it from the explorer below) — that&apos;s the
          uint256 you&apos;ll use as <code className="font-mono">X-Agent-Identifier</code>.
        </p>
      </Step>

      <Step number={3} title="Verify and copy your headers">
        <p className="text-sm text-[var(--text-secondary)]">
          Paste the agentId from the receipt — we&apos;ll resolve the owner on
          Tempo and confirm everything looks right. After this, ask any
          Remlo employer to authorize{' '}
          <code className="font-mono">erc8004:tempo:&lt;your_agent_id&gt;</code>{' '}
          at <code className="font-mono">/dashboard/settings/agents</code>{' '}
          and you&apos;re live.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            inputMode="numeric"
            placeholder="42"
            value={lookupAgentId}
            onChange={(e) => setLookupAgentId(e.target.value)}
            className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleLookup}
            disabled={lookupState.status === 'loading'}
            className="h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {lookupState.status === 'loading' ? 'Resolving…' : 'Resolve agent'}
          </button>
        </div>
        {lookupState.status === 'error' && (
          <p className="text-xs text-red-400">{lookupState.message}</p>
        )}
        {lookupState.status === 'ok' && (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-2">
              <KV k="Agent ID" v={lookupState.data.agent_id} />
              <KV k="Owner address" v={lookupState.data.owner_address} mono />
            </div>
            <KV k="Registered URI" v={lookupState.data.agent_uri ?? '—'} mono truncate />
            <div className="pt-2 border-t border-[var(--border-default)] space-y-2">
              <p className="text-xs text-[var(--text-muted)]">
                Headers to attach on every Remlo MPP call:
              </p>
              <CopyRow
                label="X-Agent-Identifier"
                value={`erc8004:tempo:${lookupState.data.agent_id}`}
                onCopy={copy}
                copied={copied}
                mono
              />
              <p className="text-xs text-[var(--text-muted)]">
                Sign the canonical message at{' '}
                <code className="font-mono">buildTier2SignMessage</code> in{' '}
                <a
                  href="https://docs.remlo.xyz/docs/mpp-api/agent-registration"
                  className="text-[var(--accent)] hover:underline"
                >
                  the docs
                </a>{' '}
                with the owner key, attach as{' '}
                <code className="font-mono">X-Agent-Signature</code>, plus
                <code className="font-mono"> X-Agent-Timestamp</code>.
              </p>
            </div>
            <a
              href={`${explorerBase}/address/${lookupState.data.owner_address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-xs text-[var(--accent)] hover:underline"
            >
              View owner on Tempo Explorer →
            </a>
          </div>
        )}
      </Step>
    </div>
  )
}

function toHex(bytes: Uint8Array) {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function Step({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--accent)]/40 bg-[var(--accent-subtle)] text-xs font-bold text-[var(--accent)]">
          {number}
        </span>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      </div>
      <div className="space-y-3 pl-10">{children}</div>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
      />
    </label>
  )
}

function CopyRow({
  label,
  value,
  onCopy,
  copied,
  mono,
  truncate,
}: {
  label: string
  value: string
  onCopy: (label: string, value: string) => void
  copied: string | null
  mono?: boolean
  truncate?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
        <div
          className={`text-xs ${mono ? 'font-mono' : ''} ${
            truncate ? 'truncate' : ''
          } text-[var(--text-primary)]`}
        >
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onCopy(label, value)}
        className="shrink-0 rounded-md border border-[var(--border-default)] px-2 py-1 text-[10px] font-medium uppercase text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
      >
        {copied === label ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function KV({ k, v, mono, truncate }: { k: string; v: string; mono?: boolean; truncate?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{k}</div>
      <div
        className={`text-sm ${mono ? 'font-mono' : ''} ${
          truncate ? 'truncate' : ''
        } text-[var(--text-primary)]`}
      >
        {v}
      </div>
    </div>
  )
}
