import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getAuthorizedEmployer } from '@/lib/auth'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const [{ data: items, error: itemsError }, { count: unreadCount, error: countError }] =
    await Promise.all([
      supabase
        .from('notifications')
        .select('id, kind, title, body, severity, link, metadata, read_at, created_at')
        .eq('employer_id', employerId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('employer_id', employerId)
        .is('read_at', null),
    ])

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 })
  }

  return NextResponse.json({
    items: items ?? [],
    unread_count: unreadCount ?? 0,
  })
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: employerId } = await ctx.params
  const employer = await getAuthorizedEmployer(req, employerId)
  if (!employer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string }
  if (body.action !== 'mark_all_read') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('employer_id', employerId)
    .is('read_at', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export const dynamic = 'force-dynamic'
