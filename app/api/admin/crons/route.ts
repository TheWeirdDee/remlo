import { NextRequest, NextResponse } from 'next/server'
import { getCallerAdmin } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase-server'
import { inspectRequest, recordAdminAction } from '@/lib/admin-audit'

/**
 * GET /api/admin/crons
 *
 * Per-cron health rollup for the /admin/crons monitoring page. Reads from
 * the cron_runs audit table populated by withCronRun() in lib/cron-runs.ts.
 *
 * For each registered cron we return:
 *   - schedule (from vercel.json — kept in sync manually here; there's no
 *     runtime API to ask Vercel for the schedule)
 *   - last 20 runs with status, duration, records_processed, error
 *   - aggregate counts over the last 24h (success / no_op / failed / partial)
 *   - latest known status — green / yellow / red — based on:
 *       green  : last run was success/no_op AND fired within 1.5x its expected interval
 *       yellow : last run was success/no_op BUT past expected interval (stale)
 *       red    : last run was failed/partial OR the row is stuck in 'running'
 *                past 2x maxDuration (crashed)
 *   - next expected run computed from schedule + last started_at
 *
 * The page polls this every 15s like the other monitoring scopes.
 */
export const dynamic = 'force-dynamic'

interface CronDefinition {
  name: string
  path: string
  schedule: string
  cadenceSeconds: number
  maxDurationSeconds: number
  description: string
}

/**
 * Source of truth for cron metadata. Mirrors vercel.json — keep in sync.
 * The cadenceSeconds derives from the cron expression but we hardcode it
 * to avoid pulling in a cron-parser dependency for four schedules.
 */
const CRONS: CronDefinition[] = [
  {
    name: 'autopayroll-tick',
    path: '/api/cron/autopayroll-tick',
    schedule: '0 * * * *',
    cadenceSeconds: 3600,
    maxDurationSeconds: 120,
    description:
      'Per-cycle Auto-Payroll executor. Pulls active TIP-1011 authorizations, broadcasts executeBatchPayroll for each due window.',
  },
  {
    name: 'index-virtual-inflows',
    path: '/api/cron/index-virtual-inflows',
    schedule: '*/30 * * * *',
    cadenceSeconds: 1800,
    maxDurationSeconds: 60,
    description:
      'Indexes inbound TIP-20 transfers to virtual master addresses. Decodes userTag → employee, persists to virtual_address_inflows.',
  },
  {
    name: 'process-expired-escrows',
    path: '/api/cron/process-expired-escrows',
    schedule: '0 3 * * *',
    cadenceSeconds: 86400,
    maxDurationSeconds: 60,
    description:
      'Daily janitor: refunds expired escrows + prunes cron_runs older than 30 days.',
  },
  {
    name: 'process-reputation-writes',
    path: '/api/cron/process-reputation-writes',
    schedule: '15 3 * * *',
    cadenceSeconds: 86400,
    maxDurationSeconds: 60,
    description:
      'Drains the reputation_writes queue. Writes SAS attestations (Solana) and ERC-8004 feedback (Tempo).',
  },
]

interface CronRunRow {
  id: string
  cron_name: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'success' | 'failed' | 'no_op' | 'partial'
  records_processed: number
  error_message: string | null
  duration_ms: number | null
  metadata: unknown
}

type Health = 'green' | 'yellow' | 'red' | 'unknown'

interface CronHealth {
  name: string
  path: string
  schedule: string
  description: string
  cadenceSeconds: number
  maxDurationSeconds: number
  health: Health
  lastRun: CronRunRow | null
  nextExpectedAt: string | null
  staleSeconds: number | null
  last24h: {
    total: number
    success: number
    no_op: number
    failed: number
    partial: number
    crashed: number
  }
  recent: CronRunRow[]
}

export async function GET(req: NextRequest) {
  const admin = await getCallerAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const reqInspect = inspectRequest(req)
  await recordAdminAction({
    actorUserId: admin.sub,
    action: 'cron.view',
    resource: 'cron_runs',
    result: 'success',
    ipAddress: reqInspect.ipAddress,
    userAgent: reqInspect.userAgent,
  })

  const supabase = createServerClient()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // One round-trip pulls everything. ~74 rows/day across all crons; well
  // under any pagination concern. We slice per-cron client-side.
  const { data: rows, error } = await supabase
    .from('cron_runs')
    .select('id, cron_name, started_at, finished_at, status, records_processed, error_message, duration_ms, metadata')
    .gte('started_at', since24h)
    .order('started_at', { ascending: false })
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const runsByName = new Map<string, CronRunRow[]>()
  for (const r of (rows ?? []) as CronRunRow[]) {
    if (!runsByName.has(r.cron_name)) runsByName.set(r.cron_name, [])
    runsByName.get(r.cron_name)!.push(r)
  }

  // For each cron: also peek at the absolute most recent row even if it
  // landed before the 24h window. This prevents a quiet daily cron from
  // showing 'unknown' just because nothing happened in the last 24h.
  const latestQueries = await Promise.all(
    CRONS.map((cron) =>
      supabase
        .from('cron_runs')
        .select('id, cron_name, started_at, finished_at, status, records_processed, error_message, duration_ms, metadata')
        .eq('cron_name', cron.name)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  )

  const nowMs = Date.now()
  const result: CronHealth[] = CRONS.map((cron, i) => {
    const recent = (runsByName.get(cron.name) ?? []).slice(0, 20)
    const latestOverall = (latestQueries[i].data as CronRunRow | null) ?? null
    const lastRun = recent[0] ?? latestOverall

    const last24hRows = runsByName.get(cron.name) ?? []
    const last24h = {
      total: last24hRows.length,
      success: last24hRows.filter((r) => r.status === 'success').length,
      no_op: last24hRows.filter((r) => r.status === 'no_op').length,
      failed: last24hRows.filter((r) => r.status === 'failed').length,
      partial: last24hRows.filter((r) => r.status === 'partial').length,
      crashed: last24hRows.filter(
        (r) =>
          r.status === 'running' &&
          nowMs - new Date(r.started_at).getTime() > cron.maxDurationSeconds * 1000 * 2,
      ).length,
    }

    let health: Health = 'unknown'
    let nextExpectedAt: string | null = null
    let staleSeconds: number | null = null

    if (lastRun) {
      nextExpectedAt = new Date(
        new Date(lastRun.started_at).getTime() + cron.cadenceSeconds * 1000,
      ).toISOString()
      staleSeconds = Math.floor(
        (nowMs - new Date(lastRun.started_at).getTime()) / 1000 - cron.cadenceSeconds,
      )

      const isStuck =
        lastRun.status === 'running' &&
        nowMs - new Date(lastRun.started_at).getTime() > cron.maxDurationSeconds * 1000 * 2
      const isFailure = lastRun.status === 'failed' || lastRun.status === 'partial'

      if (isStuck || isFailure) {
        health = 'red'
      } else if (staleSeconds > cron.cadenceSeconds * 0.5) {
        // 1.5x cadence elapsed since last fire — Vercel cron may have skipped.
        health = 'yellow'
      } else {
        health = 'green'
      }
    }

    return {
      name: cron.name,
      path: cron.path,
      schedule: cron.schedule,
      description: cron.description,
      cadenceSeconds: cron.cadenceSeconds,
      maxDurationSeconds: cron.maxDurationSeconds,
      health,
      lastRun,
      nextExpectedAt,
      staleSeconds,
      last24h,
      recent,
    }
  })

  const overall: Health = result.some((c) => c.health === 'red')
    ? 'red'
    : result.some((c) => c.health === 'yellow')
      ? 'yellow'
      : result.every((c) => c.health === 'green')
        ? 'green'
        : 'unknown'

  return NextResponse.json({
    crons: result,
    overall,
    generatedAt: new Date().toISOString(),
  })
}
