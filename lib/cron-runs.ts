/**
 * Cron-run audit logger.
 *
 * Wraps a cron handler so every fire writes a `cron_runs` row at start and
 * finalizes it on exit. Survives all exit paths — including thrown errors,
 * since the surrounding try/catch records the failure before re-raising.
 *
 * Design notes:
 *   - The 'running' row is written synchronously at the start so that even
 *     if the function crashes hard (OOM, timeout) we have a record of the
 *     attempt. Stuck-in-'running' rows are how we detect crashes from the
 *     monitoring UI.
 *   - Insert + update both use the service-role client; we never want a
 *     missing audit row to stop a cron from doing its real work, so all
 *     audit writes are wrapped in try/catch and degrade silently on
 *     persistence failure.
 *   - `withCronRun` is the recommended entry point — it threads the runId
 *     through the inner handler so cron-specific code can attach metadata
 *     ({ records, fromBlock, ... }) before finalize.
 */
import { createServerClient } from '@/lib/supabase-server'

export type CronRunStatus = 'success' | 'failed' | 'no_op' | 'partial'

export interface CronRunOutcome {
  status: CronRunStatus
  records_processed?: number
  error_message?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Wraps a cron handler. Records start, runs the handler, finalizes the
 * row with the handler's reported outcome. If the handler throws, the row
 * is finalized as 'failed' with the error message and the throw is
 * re-raised so the caller's normal error path still runs.
 */
export async function withCronRun<T>(
  cronName: string,
  handler: (runId: string) => Promise<{ outcome: CronRunOutcome; result: T }>,
): Promise<T> {
  const startedAt = Date.now()
  const runId = await recordStart(cronName)
  try {
    const { outcome, result } = await handler(runId)
    await recordFinish(runId, startedAt, outcome)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordFinish(runId, startedAt, {
      status: 'failed',
      error_message: message.slice(0, 4000),
    })
    throw err
  }
}

async function recordStart(cronName: string): Promise<string> {
  const supabase = createServerClient()
  try {
    const { data, error } = await supabase
      .from('cron_runs')
      .insert({ cron_name: cronName, status: 'running' })
      .select('id')
      .single()
    if (error || !data) {
      console.warn(`[cron-runs] failed to write start row for ${cronName}:`, error?.message)
      return ''
    }
    return data.id
  } catch (err) {
    console.warn(`[cron-runs] start-row insert threw for ${cronName}:`, err)
    return ''
  }
}

async function recordFinish(
  runId: string,
  startedAtMs: number,
  outcome: CronRunOutcome,
): Promise<void> {
  if (!runId) return
  const durationMs = Date.now() - startedAtMs
  const supabase = createServerClient()
  try {
    await supabase
      .from('cron_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: outcome.status,
        records_processed: outcome.records_processed ?? 0,
        error_message: outcome.error_message ?? null,
        duration_ms: durationMs,
        metadata: (outcome.metadata ?? null) as never,
      })
      .eq('id', runId)
  } catch (err) {
    console.warn(`[cron-runs] finalize update threw for ${runId}:`, err)
  }
}

/**
 * Best-effort prune of cron_runs older than `cutoffDays`. Called from the
 * daily process-expired-escrows tick so we don't add yet another cron just
 * to do retention. Returns the count deleted (0 on error).
 */
export async function pruneOldCronRuns(cutoffDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000).toISOString()
  const supabase = createServerClient()
  try {
    const { data, error } = await supabase
      .from('cron_runs')
      .delete()
      .lt('started_at', cutoff)
      .select('id')
    if (error) {
      console.warn('[cron-runs] prune failed:', error.message)
      return 0
    }
    return data?.length ?? 0
  } catch (err) {
    console.warn('[cron-runs] prune threw:', err)
    return 0
  }
}
