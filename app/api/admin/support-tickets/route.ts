import { NextRequest, NextResponse } from 'next/server'
import { getCallerAdmin } from '@/lib/auth'
import { recordAdminAction, inspectRequest } from '@/lib/admin-audit'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/admin/support-tickets
 *
 * Admin inbox of support tickets, newest first. Filters:
 *   ?status=open|in_progress|resolved|closed
 *   ?search=<text>     prefix match against subject + email
 *   ?employer=<id>     restrict to one employer
 *   ?limit=<n>         page size (default 100, max 500)
 *
 * Joined with employer + employee names so the inbox is readable without
 * a second round trip per row.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const claims = await getCallerAdmin(req)
  if (!claims) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = req.nextUrl
  const status = url.searchParams.get('status')
  const search = url.searchParams.get('search')?.trim() ?? ''
  const employerScope = url.searchParams.get('employer')
  const limitRaw = url.searchParams.get('limit')
  const limit = Math.min(
    Math.max(limitRaw ? Number.parseInt(limitRaw, 10) : 100, 1),
    500,
  )

  const supabase = createServerClient()

  // Strip the leading `#` we display in the submitter-facing reference
  // code (`#d979c78a`), so pasting it back into the search field works.
  const searchTerm = search.replace(/^#/, '').trim()

  // Search strategy: when the operator is searching, fetch a broad slice
  // (status filter bypassed so a Resolved ticket found from the Open tab
  // still surfaces), then filter client-side. PostgREST's `or()` doesn't
  // accept the `::text` cast that ILIKE on a uuid column would require,
  // and admin ticket volume is bounded — client-side filtering of
  // `limit` rows is fine.
  const fetchLimit = searchTerm ? Math.max(limit, 500) : limit
  let baseQuery = supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(fetchLimit)

  if (status && !searchTerm) baseQuery = baseQuery.eq('status', status)
  if (employerScope) baseQuery = baseQuery.eq('employer_id', employerScope)

  const { data: rawTickets, error } = await baseQuery
  if (error) {
    console.error('[support-tickets] list failed', error.message)
    return NextResponse.json({ items: [] })
  }

  let tickets = rawTickets ?? []
  if (searchTerm) {
    const needle = searchTerm.toLowerCase()
    tickets = tickets.filter(
      (t) =>
        t.subject.toLowerCase().includes(needle) ||
        t.email.toLowerCase().includes(needle) ||
        t.id.toLowerCase().startsWith(needle),
    )
    tickets = tickets.slice(0, limit)
  }

  // Resolve employer + employee names in one round trip each.
  const employerIds = Array.from(
    new Set(((tickets ?? []) as Array<{ employer_id: string | null }>)
      .map((t) => t.employer_id)
      .filter(Boolean)),
  ) as string[]
  const employeeIds = Array.from(
    new Set(((tickets ?? []) as Array<{ employee_id: string | null }>)
      .map((t) => t.employee_id)
      .filter(Boolean)),
  ) as string[]

  const [{ data: employers }, { data: employees }] = await Promise.all([
    employerIds.length > 0
      ? supabase.from('employers').select('id, company_name').in('id', employerIds)
      : Promise.resolve({ data: [] }),
    employeeIds.length > 0
      ? supabase
          .from('employees')
          .select('id, first_name, last_name, email')
          .in('id', employeeIds)
      : Promise.resolve({ data: [] }),
  ])

  const employerMap = new Map((employers ?? []).map((e) => [e.id, e.company_name]))
  const employeeMap = new Map(
    (employees ?? []).map((e) => [
      e.id,
      [e.first_name, e.last_name].filter(Boolean).join(' ') || e.email,
    ]),
  )

  const items = (tickets ?? []).map(
    (t: {
      employer_id: string | null
      employee_id: string | null
      [key: string]: unknown
    }) => ({
      ...t,
      employerName: t.employer_id ? employerMap.get(t.employer_id) ?? null : null,
      employeeName: t.employee_id ? employeeMap.get(t.employee_id) ?? null : null,
    }),
  )

  const meta = inspectRequest(req)
  void recordAdminAction({
    actorUserId: claims.sub,
    action: 'support_tickets.list',
    result: 'success',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { count: items.length, status, search, employerScope },
  })

  return NextResponse.json({ items })
}
