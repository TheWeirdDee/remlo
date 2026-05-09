import * as React from 'react'
import { NextRequest } from 'next/server'
import { renderToStream } from '@react-pdf/renderer'
import { getAuthorizedEmployer } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase-server'
import { PayrollSummary, type PayrollSummaryRecipient } from '@/pdf/PayrollSummary'
import { TEMPO_EXPLORER_URL } from '@/lib/constants'
import { SOLANA_CLUSTER } from '@/lib/solana-constants'

/**
 * GET /api/employers/[id]/payroll/[runId]/export?format=pdf|csv
 *
 * Employer-facing export of a single payroll run. Auth: the caller must own
 * the employer (Privy bearer + getAuthorizedEmployer). Default format is
 * pdf; pass ?format=csv for the spreadsheet-friendly version that finance
 * teams plug straight into their accounting tool.
 *
 * The PDF is generated on the server with @react-pdf/renderer (same vendor
 * stack as our React Email templates). The CSV is built by hand to keep the
 * column ordering predictable for downstream importers.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; runId: string }> }

interface RecipientRow {
  fullName: string
  email: string | null
  walletAddress: string | null
  amountUsd: number
  status: string
  txHash: string | null
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id: employerId, runId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const format = (req.nextUrl.searchParams.get('format') ?? 'pdf').toLowerCase()
  if (format !== 'pdf' && format !== 'csv') {
    return new Response(JSON.stringify({ error: 'format must be pdf or csv' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const supabase = createServerClient()

  const { data: run } = await supabase
    .from('payroll_runs')
    .select(
      'id, employer_id, status, total_amount, employee_count, fee_amount, tx_hash, finalized_at, settlement_time_ms, chain, created_at',
    )
    .eq('id', runId)
    .eq('employer_id', employerId)
    .maybeSingle()

  if (!run) {
    return new Response(JSON.stringify({ error: 'Payroll run not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }

  const { data: items } = await supabase
    .from('payment_items')
    .select('id, employee_id, amount, status, tx_hash, solana_signature, created_at')
    .eq('payroll_run_id', runId)
    .order('created_at', { ascending: true })

  const employeeIds = Array.from(
    new Set((items ?? []).map((i) => i.employee_id).filter(Boolean)),
  ) as string[]
  const { data: employees } = employeeIds.length
    ? await supabase
        .from('employees')
        .select('id, email, first_name, last_name, wallet_address, country_code')
        .in('id', employeeIds)
    : { data: [] }

  const employeeMap = new Map((employees ?? []).map((e) => [e.id, e]))

  const recipients: RecipientRow[] = (items ?? []).map((item) => {
    const employee = item.employee_id ? employeeMap.get(item.employee_id) : null
    const fullName = employee
      ? [employee.first_name, employee.last_name].filter(Boolean).join(' ') ||
        employee.email ||
        'Unknown'
      : 'Unknown'
    return {
      fullName,
      email: employee?.email ?? null,
      walletAddress: employee?.wallet_address ?? null,
      amountUsd: Number(item.amount ?? 0),
      status: item.status ?? 'pending',
      txHash:
        run.chain === 'solana'
          ? (item.solana_signature ?? null)
          : (item.tx_hash ?? run.tx_hash ?? null),
    }
  })

  const explorerUrl =
    run.chain === 'solana' && run.tx_hash
      ? `https://explorer.solana.com/tx/${run.tx_hash}?cluster=${SOLANA_CLUSTER}`
      : run.tx_hash
        ? `${TEMPO_EXPLORER_URL}/tx/${run.tx_hash}`
        : null

  const dateStamp = new Date(run.created_at).toISOString().slice(0, 10)
  const safeCompany = employer.company_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const baseName = `payroll-${safeCompany}-${dateStamp}`

  if (format === 'csv') {
    return new Response(buildCsv(recipients, run, employer.company_name), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${baseName}.csv"`,
        'cache-control': 'private, no-store',
      },
    })
  }

  const pdfElement = React.createElement(PayrollSummary, {
    companyName: employer.company_name,
    runId: run.id,
    runStatus: run.status ?? 'pending',
    createdAtIso: run.created_at,
    chain: run.chain ?? 'tempo',
    txHash: run.tx_hash ?? null,
    explorerUrl,
    settlementMs: run.settlement_time_ms ?? null,
    totalAmountUsd: Number(run.total_amount ?? 0),
    feeUsd: typeof run.fee_amount === 'number' ? run.fee_amount : null,
    recipients: recipients as PayrollSummaryRecipient[],
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await renderToStream(pdfElement as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Response(stream as any, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${baseName}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}

interface RunRow {
  id: string
  status: string | null
  chain: string | null
  tx_hash: string | null
  finalized_at: string | null
  created_at: string
  total_amount: number | null
  employee_count: number | null
  fee_amount: number | null
  settlement_time_ms: number | null
}

function buildCsv(
  recipients: RecipientRow[],
  run: RunRow,
  companyName: string,
): string {
  const escape = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  // Two-section CSV: a small "run" header block, then per-recipient rows.
  // This is friendlier to humans than a flattened wide table and still
  // imports cleanly into Sheets/Excel.
  const lines: string[] = []
  lines.push('# Run summary')
  lines.push(`# Company,${escape(companyName)}`)
  lines.push(`# Run ID,${escape(run.id)}`)
  lines.push(`# Status,${escape(run.status)}`)
  lines.push(`# Chain,${escape(run.chain)}`)
  lines.push(`# Run tx,${escape(run.tx_hash)}`)
  lines.push(`# Created at,${escape(run.created_at)}`)
  lines.push(`# Finalized at,${escape(run.finalized_at)}`)
  lines.push(`# Total amount USD,${escape(Number(run.total_amount ?? 0).toFixed(2))}`)
  lines.push(`# Recipients,${escape(recipients.length)}`)
  lines.push('')
  lines.push(['name', 'email', 'wallet_address', 'amount_usd', 'status', 'tx_hash'].join(','))
  for (const r of recipients) {
    lines.push(
      [
        escape(r.fullName),
        escape(r.email),
        escape(r.walletAddress),
        escape(r.amountUsd.toFixed(2)),
        escape(r.status),
        escape(r.txHash),
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}
