import { createServerClient } from '@/lib/supabase-server'
import type { Database } from '@/lib/database.types'

export type EmailSuppression = Database['public']['Tables']['email_suppressions']['Row']
export type SuppressionReason = EmailSuppression['reason']

export interface ListSuppressionsOptions {
  search?: string
  reason?: SuppressionReason
  cursor?: string
  limit?: number
}

export async function listSuppressions(
  options: ListSuppressionsOptions = {},
): Promise<{ items: EmailSuppression[]; nextCursor: string | null }> {
  const supabase = createServerClient()
  const limit = Math.max(1, Math.min(200, options.limit ?? 50))
  let query = supabase
    .from('email_suppressions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  if (options.search) {
    // Prefix-match the email field (Postgres ILIKE), case-insensitive.
    query = query.ilike('email', `%${options.search.trim().toLowerCase()}%`)
  }
  if (options.reason) {
    query = query.eq('reason', options.reason)
  }
  if (options.cursor) {
    query = query.lt('created_at', options.cursor)
  }

  const { data, error } = await query
  if (error) {
    console.error('[suppressions] list failed', error.message)
    return { items: [], nextCursor: null }
  }
  const rows = data ?? []
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? items[items.length - 1].created_at : null
  return { items, nextCursor }
}

export async function addSuppression(input: {
  email: string
  reason: SuppressionReason
}): Promise<EmailSuppression | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('email_suppressions')
    .upsert(
      {
        email: input.email.trim().toLowerCase(),
        reason: input.reason,
      },
      { onConflict: 'email' },
    )
    .select('*')
    .single()
  if (error) {
    console.error('[suppressions] upsert failed', error.message)
    return null
  }
  return data
}

export async function removeSuppression(email: string): Promise<boolean> {
  const supabase = createServerClient()
  const { error } = await supabase
    .from('email_suppressions')
    .delete()
    .eq('email', email.trim().toLowerCase())
  if (error) {
    console.error('[suppressions] delete failed', error.message)
    return false
  }
  return true
}

export async function suppressionStats(): Promise<{
  total: number
  byReason: Record<SuppressionReason, number>
}> {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('email_suppressions').select('reason')
  if (error) {
    return {
      total: 0,
      byReason: { hard_bounce: 0, complaint: 0, unsubscribe: 0, manual: 0 },
    }
  }
  const byReason: Record<SuppressionReason, number> = {
    hard_bounce: 0,
    complaint: 0,
    unsubscribe: 0,
    manual: 0,
  }
  for (const row of data ?? []) {
    byReason[row.reason] = (byReason[row.reason] ?? 0) + 1
  }
  return { total: data?.length ?? 0, byReason }
}
