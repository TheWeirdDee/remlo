import { NextRequest } from 'next/server'
import { getAuthorizedEmployer } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/employers/[id]/agent-payments?format=csv&since=<iso>
 *
 * CSV export of every MPP session opened against this employer's treasury,
 * with the running spend per session. Built for accountants — the columns
 * are stable, the date format is ISO-8601, and the order matches what most
 * bookkeepers expect (date first, then party, then amount).
 *
 * `?since=<iso>` optionally restricts to sessions opened on or after that
 * timestamp. No upper bound — accountants pull the whole horizon and slice
 * in their tool.
 *
 * JSON variant available with `?format=json` for in-app dashboards (the
 * employer admin UI uses this to show a session table).
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const url = req.nextUrl
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase()
  const since = url.searchParams.get('since')

  if (format !== 'json' && format !== 'csv') {
    return new Response(JSON.stringify({ error: 'format must be json or csv' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const supabase = createServerClient()
  let query = supabase
    .from('mpp_sessions')
    .select(
      'id, agent_wallet, channel_tx_hash, max_deposit, total_spent, status, opened_at, closed_at, last_action',
    )
    .eq('employer_id', employerId)
    .order('opened_at', { ascending: false })
    .limit(2000)

  if (since) {
    query = query.gte('opened_at', since)
  }

  const { data, error } = await query
  if (error) {
    console.error('[agent-payments] query failed', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const rows = data ?? []

  if (format === 'json') {
    const totalSpend = rows.reduce((s, r) => s + Number(r.total_spent ?? 0), 0)
    const activeCount = rows.filter((r) => r.status === 'open').length
    const distinctAgents = new Set(rows.map((r) => r.agent_wallet)).size
    return new Response(
      JSON.stringify({
        sessions: rows,
        summary: {
          totalSpend,
          activeCount,
          distinctAgents,
          sessionCount: rows.length,
        },
      }),
      {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'private, no-store',
        },
      },
    )
  }

  const dateStamp = new Date().toISOString().slice(0, 10)
  const safeCompany = employer.company_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const filename = `agent-spend-${safeCompany}-${dateStamp}.csv`

  return new Response(buildCsv(rows, employer.company_name), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  })
}

interface SessionRow {
  id: string
  agent_wallet: string
  channel_tx_hash: string | null
  max_deposit: number | null
  total_spent: number | null
  status: string | null
  opened_at: string | null
  closed_at: string | null
  last_action: string | null
}

function buildCsv(rows: SessionRow[], companyName: string): string {
  const escape = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const totalSpend = rows.reduce((s, r) => s + Number(r.total_spent ?? 0), 0)
  const distinctAgents = new Set(rows.map((r) => r.agent_wallet)).size

  const lines: string[] = []
  lines.push('# Agent payment activity (MPP sessions)')
  lines.push(`# Company,${escape(companyName)}`)
  lines.push(`# Sessions,${escape(rows.length)}`)
  lines.push(`# Distinct agents,${escape(distinctAgents)}`)
  lines.push(`# Total spend USD,${escape(totalSpend.toFixed(6))}`)
  lines.push(`# Generated,${escape(new Date().toISOString())}`)
  lines.push('')
  lines.push(
    [
      'opened_at',
      'closed_at',
      'agent_wallet',
      'session_id',
      'status',
      'max_deposit_usd',
      'total_spent_usd',
      'channel_tx_hash',
      'last_action_at',
    ].join(','),
  )
  for (const r of rows) {
    lines.push(
      [
        escape(r.opened_at),
        escape(r.closed_at),
        escape(r.agent_wallet),
        escape(r.id),
        escape(r.status),
        escape(r.max_deposit ? Number(r.max_deposit).toFixed(6) : ''),
        escape(Number(r.total_spent ?? 0).toFixed(6)),
        escape(r.channel_tx_hash),
        escape(r.last_action),
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}
