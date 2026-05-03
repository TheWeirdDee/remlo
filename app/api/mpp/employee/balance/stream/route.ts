import { NextRequest } from 'next/server'
import { mppx } from '@/lib/mpp'
import { streamVesting } from '@/lib/contracts'
import { createServerClient } from '@/lib/supabase-server'
import { getMppCallerEmployee, getMppCallerEmployer } from '@/lib/mpp-auth'

// ~$100k/yr in pathUSD (6 decimals): 100_000 * 1e6 / (365.25 * 24 * 3600) ≈ 3_170_979
const SALARY_PER_SECOND = BigInt(3_170_979)

// Per-process concurrency cap. Resets per cold-start in serverless, but
// prevents a single caller from opening hundreds of streams at once and
// DoS-ing the server + burning MPP balance. Keyed on employeeId because a
// single authenticated caller (an employer) is allowed to legitimately
// open streams for multiple employees, but not many for the same one.
const MAX_STREAMS_PER_EMPLOYEE = 2
const openStreamsByEmployee = new Map<string, number>()

/**
 * GET /api/mpp/employee/balance/stream
 * MPP-5 — $0.001 per tick (SSE session, manual mode)
 *
 * SECURITY: caller must be the employee themselves or their employer (audit
 * C-11, H-5). A per-process concurrency cap prevents economic DoS via
 * unbounded parallel sessions.
 *
 * Query params: ?employeeId=emp_123
 * Legacy compatibility: ?address=0x... — now rejected because it has no
 * authorization anchor.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const employeeId = url.searchParams.get('employeeId')
  if (!employeeId) {
    return Response.json({ error: 'employeeId is required' }, { status: 400 })
  }

  return mppx.session({ amount: '0.001', unitType: 'second' })(async () => {
    const [callerEmployee, callerEmployer] = await Promise.all([
      getMppCallerEmployee(req),
      getMppCallerEmployer(req),
    ])
    if (!callerEmployee && !callerEmployer) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServerClient()
    const { data: employee } = await supabase
      .from('employees')
      .select('id, employer_id, wallet_address')
      .eq('id', employeeId)
      .maybeSingle()
    if (!employee) {
      return Response.json({ error: 'Employee not found' }, { status: 404 })
    }

    let authorized = false
    if (callerEmployee && callerEmployee.id === employee.id) authorized = true
    if (!authorized && callerEmployer && callerEmployer.id === employee.employer_id) authorized = true
    if (!authorized) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const current = openStreamsByEmployee.get(employeeId) ?? 0
    if (current >= MAX_STREAMS_PER_EMPLOYEE) {
      return Response.json(
        { error: 'Too many concurrent streams for this employee' },
        { status: 429 },
      )
    }
    openStreamsByEmployee.set(employeeId, current + 1)
    const releaseSlot = () => {
      const n = openStreamsByEmployee.get(employeeId) ?? 1
      if (n <= 1) openStreamsByEmployee.delete(employeeId)
      else openStreamsByEmployee.set(employeeId, n - 1)
    }

    const address = (employee.wallet_address as `0x${string}` | null) ?? null
    let baseBalance = BigInt(0)
    if (address?.startsWith('0x')) {
      baseBalance = await streamVesting.read.getAccruedBalance([address]) as bigint
    }

    const startTime = Date.now()
    let tick = 0

    const stream = new ReadableStream({
      start(controller) {
        const interval = setInterval(() => {
          tick++
          const elapsed = BigInt(Math.floor((Date.now() - startTime) / 1000))
          const accrued = baseBalance + elapsed * SALARY_PER_SECOND
          const accruedUsd = (Number(accrued) / 1e6).toFixed(6)

          const data = JSON.stringify({
            tick,
            employeeId,
            address,
            balance: accrued.toString(),
            balanceUsd: accruedUsd,
            accrued_raw: accrued.toString(),
            accrued_usd: accruedUsd,
            salary_per_second_usd: (Number(SALARY_PER_SECOND) / 1e6).toFixed(6),
            timestamp: Date.now(),
          })

          controller.enqueue(`data: ${data}\n\n`)

          if (tick >= 60) {
            clearInterval(interval)
            releaseSlot()
            controller.close()
          }
        }, 1000)

        req.signal?.addEventListener('abort', () => {
          clearInterval(interval)
          releaseSlot()
          controller.close()
        })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })(req)
}
