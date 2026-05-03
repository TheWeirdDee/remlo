'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import {
  LayoutDashboard,
  Users,
  Banknote,
  Wallet,
  Gavel,
  Coins,
  Bot,
  Scale,
  Award,
  Sparkles,
  ShieldCheck,
  CreditCard,
  Terminal,
  Settings,
  Receipt,
  User,
  Search,
} from 'lucide-react'
import { useEmployer } from '@/lib/hooks/useEmployer'
import { useTeam, usePayrollRuns } from '@/lib/hooks/useDashboard'

interface NavItem {
  href: string
  label: string
  group: string
  keywords?: string[]
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', group: 'Pages', icon: <LayoutDashboard className="h-4 w-4" /> },
  { href: '/dashboard/team', label: 'Employees', group: 'Pages', keywords: ['team'], icon: <Users className="h-4 w-4" /> },
  { href: '/dashboard/payroll', label: 'Payroll', group: 'Pages', keywords: ['runs'], icon: <Banknote className="h-4 w-4" /> },
  { href: '/dashboard/payroll/new', label: 'Run Payroll', group: 'Actions', keywords: ['execute', 'send', 'pay'], icon: <Banknote className="h-4 w-4" /> },
  { href: '/dashboard/treasury', label: 'Payments', group: 'Pages', keywords: ['treasury'], icon: <Wallet className="h-4 w-4" /> },
  { href: '/dashboard/treasury/council', label: 'Council', group: 'Pages', keywords: ['multisig', 'approve'], icon: <Gavel className="h-4 w-4" /> },
  { href: '/dashboard/solana', label: 'Solana', group: 'Pages', icon: <Coins className="h-4 w-4" /> },
  { href: '/dashboard/agent', label: 'AI Agent', group: 'Pages', keywords: ['ai', 'claude'], icon: <Bot className="h-4 w-4" /> },
  { href: '/dashboard/escrows', label: 'Escrows', group: 'Pages', icon: <Scale className="h-4 w-4" /> },
  { href: '/dashboard/reputation', label: 'Reputation', group: 'Pages', keywords: ['erc-8004'], icon: <Award className="h-4 w-4" /> },
  { href: '/dashboard/superteam', label: 'Superteam', group: 'Pages', icon: <Sparkles className="h-4 w-4" /> },
  { href: '/dashboard/compliance', label: 'Compliance', group: 'Pages', keywords: ['kyc', 'tip-403'], icon: <ShieldCheck className="h-4 w-4" /> },
  { href: '/dashboard/cards', label: 'Cards', group: 'Pages', icon: <CreditCard className="h-4 w-4" /> },
  { href: '/dashboard/api-access', label: 'API & Demo', group: 'Pages', keywords: ['developer', 'mpp', 'x402'], icon: <Terminal className="h-4 w-4" /> },
  { href: '/dashboard/settings', label: 'Settings', group: 'Pages', icon: <Settings className="h-4 w-4" /> },
  { href: '/dashboard/team/add', label: 'Invite Employee', group: 'Actions', keywords: ['add', 'new'], icon: <Users className="h-4 w-4" /> },
]

interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const router = useRouter()
  const { data: employer } = useEmployer()
  const { data: teamData } = useTeam(employer?.id)
  const { data: payrollRunsData } = usePayrollRuns(employer?.id, 1, 20)

  const employees = teamData?.employees ?? []
  const runs = payrollRunsData?.runs ?? []

  const handleSelect = React.useCallback(
    (href: string) => {
      onOpenChange(false)
      router.push(href)
    },
    [router, onOpenChange],
  )

  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <Command
        label="Global search"
        loop
        className="w-full max-w-xl rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 border-b border-[var(--border-default)]">
          <Search className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
          <Command.Input
            autoFocus
            placeholder="Search pages, employees, payroll runs…"
            className="flex-1 bg-transparent py-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-[var(--border-default)] text-[10px] font-mono text-[var(--text-muted)]">
            ESC
          </kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto py-2">
          <Command.Empty className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
            No results found.
          </Command.Empty>

          <Command.Group heading="Pages" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)]">
            {NAV_ITEMS.filter((it) => it.group === 'Pages').map((item) => (
              <CommandItem
                key={item.href}
                value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
                onSelect={() => handleSelect(item.href)}
                icon={item.icon}
                label={item.label}
              />
            ))}
          </Command.Group>

          <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)]">
            {NAV_ITEMS.filter((it) => it.group === 'Actions').map((item) => (
              <CommandItem
                key={item.href}
                value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
                onSelect={() => handleSelect(item.href)}
                icon={item.icon}
                label={item.label}
              />
            ))}
          </Command.Group>

          {employees.length > 0 && (
            <Command.Group heading="Employees" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)]">
              {employees.map((emp) => {
                const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim()
                const display = fullName || emp.email
                return (
                  <CommandItem
                    key={emp.id}
                    value={`${fullName} ${emp.email} ${emp.job_title ?? ''}`}
                    onSelect={() => handleSelect(`/dashboard/team/${emp.id}`)}
                    icon={<User className="h-4 w-4" />}
                    label={display}
                    sublabel={fullName ? emp.email : emp.job_title ?? undefined}
                  />
                )
              })}
            </Command.Group>
          )}

          {runs.length > 0 && (
            <Command.Group heading="Payroll runs" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)]">
              {runs.map((run) => (
                <CommandItem
                  key={run.id}
                  value={`payroll run ${formatDate(run.created_at)} ${run.status} ${run.total_amount}`}
                  onSelect={() => handleSelect(`/dashboard/payroll/${run.id}`)}
                  icon={<Receipt className="h-4 w-4" />}
                  label={`${formatDate(run.created_at)} · ${formatCurrency(run.total_amount)}`}
                  sublabel={`${run.status} · ${run.employee_count} employees`}
                />
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  )
}

interface CommandItemProps {
  value: string
  onSelect: () => void
  icon: React.ReactNode
  label: string
  sublabel?: string
}

function CommandItem({ value, onSelect, icon, label, sublabel }: CommandItemProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="mx-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] cursor-pointer aria-selected:bg-[var(--bg-subtle)] aria-selected:text-[var(--text-primary)]"
    >
      <span className="text-[var(--text-muted)] shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate">{label}</p>
        {sublabel && <p className="truncate text-xs text-[var(--text-muted)]">{sublabel}</p>}
      </div>
    </Command.Item>
  )
}
