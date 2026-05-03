import { createServerClient } from '@/lib/supabase-server'

export interface PayrollPlanItem {
  employee_id: string
  amount: number
  chain: 'tempo' | 'solana'
}

export type AnomalyCategory =
  | 'duplicate_in_run'
  | 'amount_above_historical'
  | 'recently_onboarded'
  | 'wallet_changed'
  | 'kyc_not_verified'
  | 'kyc_expired'

export interface AnomalyItem {
  employee_id: string
  amount: number
  category: AnomalyCategory
  reason: string
  severity: 'warning' | 'critical'
}

export interface AnomalyReport {
  flagged_items: AnomalyItem[]
  clean_items: PayrollPlanItem[]
  severity: 'none' | 'warning' | 'critical'
}

export async function detectAnomalies(
  employerId: string,
  planItems: PayrollPlanItem[],
): Promise<AnomalyReport> {
  const client = createServerClient()

  const employeeIds = planItems.map((i) => i.employee_id)

  const [{ data: employees }, { data: recentPayments }] = await Promise.all([
    client
      .from('employees')
      .select('id, salary_amount, kyc_status, onboarded_at, wallet_address')
      .in('id', employeeIds),
    client
      .from('payment_items')
      .select('employee_id, amount, created_at')
      .in('employee_id', employeeIds)
      .order('created_at', { ascending: false })
      .limit(employeeIds.length * 6),
  ])

  const { data: recentEmployeePayments } = await client
    .from('payment_items')
    .select('employee_id, memo_decoded')
    .in('employee_id', employeeIds)
    .order('created_at', { ascending: false })
    .limit(employeeIds.length)

  const lastWalletByEmployee = new Map<string, string>()
  for (const p of recentEmployeePayments ?? []) {
    if (lastWalletByEmployee.has(p.employee_id)) continue
    const memo = p.memo_decoded as { wallet_address?: string } | null
    if (memo?.wallet_address) {
      lastWalletByEmployee.set(p.employee_id, memo.wallet_address.toLowerCase())
    }
  }

  const empMap = new Map(
    (employees ?? []).map((e) => [e.id, e]),
  )

  const avgMap = new Map<string, number>()
  const countMap = new Map<string, number>()
  for (const p of recentPayments ?? []) {
    const prev = avgMap.get(p.employee_id) ?? 0
    const c = countMap.get(p.employee_id) ?? 0
    avgMap.set(p.employee_id, prev + p.amount)
    countMap.set(p.employee_id, c + 1)
  }
  for (const [id, total] of avgMap) {
    avgMap.set(id, total / (countMap.get(id) ?? 1))
  }

  // Check for duplicates in the current plan
  const seen = new Set<string>()
  const duplicateIds = new Set<string>()
  for (const item of planItems) {
    if (seen.has(item.employee_id)) duplicateIds.add(item.employee_id)
    seen.add(item.employee_id)
  }

  const flagged: AnomalyItem[] = []
  const clean: PayrollPlanItem[] = []

  for (const item of planItems) {
    const emp = empMap.get(item.employee_id)
    const flags: AnomalyItem[] = []

    if (duplicateIds.has(item.employee_id)) {
      flags.push({
        employee_id: item.employee_id,
        amount: item.amount,
        category: 'duplicate_in_run',
        reason: 'Duplicate payment in same payroll run',
        severity: 'critical',
      })
    }

    const avg = avgMap.get(item.employee_id)
    if (avg && item.amount > avg * 2) {
      const ratio = (item.amount / avg).toFixed(1)
      flags.push({
        employee_id: item.employee_id,
        amount: item.amount,
        category: 'amount_above_historical',
        reason: `Amount $${item.amount} is ${ratio}x historical average ($${avg.toFixed(2)})`,
        severity: 'warning',
      })
    }

    if (emp?.onboarded_at) {
      const ageMs = Date.now() - new Date(emp.onboarded_at).getTime()
      const ageDays = ageMs / (1000 * 60 * 60 * 24)
      if (ageDays >= 0 && ageDays <= 7) {
        flags.push({
          employee_id: item.employee_id,
          amount: item.amount,
          category: 'recently_onboarded',
          reason: `New employee — onboarded ${Math.max(1, Math.round(ageDays))} day(s) ago`,
          severity: 'warning',
        })
      }
    }

    const lastWallet = lastWalletByEmployee.get(item.employee_id)
    if (lastWallet && emp?.wallet_address && emp.wallet_address.toLowerCase() !== lastWallet) {
      flags.push({
        employee_id: item.employee_id,
        amount: item.amount,
        category: 'wallet_changed',
        reason: 'Wallet address changed since last payment',
        severity: 'critical',
      })
    }

    if (emp && emp.kyc_status === 'expired') {
      flags.push({
        employee_id: item.employee_id,
        amount: item.amount,
        category: 'kyc_expired',
        reason: 'KYC verification expired — re-verification required',
        severity: 'critical',
      })
    } else if (emp && emp.kyc_status !== 'verified') {
      flags.push({
        employee_id: item.employee_id,
        amount: item.amount,
        category: 'kyc_not_verified',
        reason: `KYC status is "${emp.kyc_status}" — verification incomplete`,
        severity: 'warning',
      })
    }

    if (flags.length > 0) {
      flagged.push(...flags)
    } else {
      clean.push(item)
    }
  }

  const hasCritical = flagged.some((f) => f.severity === 'critical')
  const severity = flagged.length === 0 ? 'none' : hasCritical ? 'critical' : 'warning'

  return { flagged_items: flagged, clean_items: clean, severity }
}
