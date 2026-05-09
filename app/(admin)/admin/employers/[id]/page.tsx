'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bell,
  Building2,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Inbox,
  ShieldAlert,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import { SectionHeader } from '@/components/ui/SectionHeader'
import {
  AdminReasonGuard,
  useReasonedAuthedJson,
} from '@/components/admin/AdminReasonGuard'

interface EmployerDetail {
  employer: {
    id: string
    company_name: string
    owner_user_id: string
    employer_admin_wallet: string | null
    subscription_tier: string
    bridge_customer_id: string | null
    bridge_virtual_account_id: string | null
    treasury_contract: string | null
    active: boolean
    created_at: string
    updated_at: string
  }
  summary: {
    teamSize: number
    activeTeam: number
    kycApproved: number
    kycPending: number
    kycRejected: number
    cardLinked: number
    bankLinked: number
    totalPayrollVolume: number
    failedRuns: number
    totalMppSpend: number
  }
  team: Array<{
    id: string
    name: string
    email: string
    kyc_status: string | null
    wallet_linked: boolean
    card_linked: boolean
    bank_linked: boolean
    active: boolean
    created_at: string
  }>
  payrollRuns: Array<{
    id: string
    status: string
    total_amount: number | null
    employee_count: number | null
    tx_hash: string | null
    created_at: string
  }>
  mppSessions: Array<{
    id: string
    agent_wallet: string
    total_spent: number
    status: string
    opened_at: string
    last_action: string | null
  }>
  complianceEvents: Array<{
    id: string
    employee_id: string | null
    employeeName: string
    event_type: string
    result: string | null
    description: string | null
    created_at: string
  }>
  notifications: Array<{
    id: string
    kind: string
    title: string
    severity: string
    created_at: string
    read_at: string | null
  }>
  supportTickets: Array<{
    id: string
    subject: string
    status: string
    email: string
    user_role: string
    created_at: string
    resolved_at: string | null
  }>
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

const KYC_BADGE: Record<string, string> = {
  approved: 'bg-[var(--status-success)]/10 text-[var(--status-success)] border-[var(--status-success)]/30',
  pending: 'bg-[var(--status-pending)]/10 text-[var(--status-pending)] border-[var(--status-pending)]/30',
  rejected: 'bg-[var(--status-error)]/10 text-[var(--status-error)] border-[var(--status-error)]/30',
}

const PAYROLL_STATUS_BADGE: Record<string, string> = {
  pending: 'text-[var(--text-muted)]',
  processing: 'text-[var(--status-pending)]',
  confirmed: 'text-[var(--status-success)]',
  failed: 'text-[var(--status-error)]',
}

export default function EmployerDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>()
  const employerId = params.id

  return (
    <AdminReasonGuard
      resourceKey={`employer:${employerId}`}
      purpose="View employer detail"
      cancelHref="/admin/employers"
      context={
        <>
          <strong>Scope of this view:</strong> employer profile, identity &amp; linkage details
          (Bridge IDs, treasury contract, on-chain admin wallet), full team roster with KYC and
          wallet status, recent payroll runs, MPP sessions, compliance events, and recent in-app
          notifications. Every field on this page will be recorded in the access audit.
        </>
      }
    >
      <EmployerDetailBody employerId={employerId} />
    </AdminReasonGuard>
  )
}

function EmployerDetailBody({ employerId }: { employerId: string }): React.ReactElement {
  const fetchJson = useReasonedAuthedJson()

  const detail = useQuery<EmployerDetail>({
    queryKey: ['admin-employer', employerId],
    queryFn: () => fetchJson(`/api/admin/employers/${employerId}`),
    enabled: Boolean(employerId),
  })

  if (detail.isLoading) {
    return <div className="h-96 animate-pulse rounded-2xl bg-[var(--bg-subtle)]" />
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/employers"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to employers
        </Link>
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          Could not load employer.
        </div>
      </div>
    )
  }

  const {
    employer,
    summary,
    team,
    payrollRuns,
    mppSessions,
    complianceEvents,
    notifications,
    supportTickets,
  } = detail.data

  return (
    <div className="space-y-6">
      <Link
        href="/admin/employers"
        className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to employers
      </Link>

      <SectionHeader
        title={employer.company_name}
        description={`Created ${formatDate(employer.created_at)} · Tier: ${employer.subscription_tier} · ${employer.active ? 'Active' : 'Inactive'}`}
      />

      {/* Summary tiles */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Team"
          value={summary.activeTeam}
          hint={`${summary.teamSize - summary.activeTeam} inactive`}
          icon={Users}
        />
        <SummaryTile
          label="KYC approved"
          value={summary.kycApproved}
          hint={`${summary.kycPending} pending · ${summary.kycRejected} rejected`}
          icon={CheckCircle2}
          tone={summary.kycRejected > 0 ? 'warning' : 'success'}
        />
        <SummaryTile
          label="Payroll volume"
          value={formatCurrency(summary.totalPayrollVolume)}
          hint={`${summary.failedRuns} failed`}
          icon={Wallet}
          tone={summary.failedRuns > 0 ? 'warning' : 'default'}
        />
        <SummaryTile
          label="MPP spend"
          value={formatCurrency(summary.totalMppSpend)}
          hint={`${summary.cardLinked} cards · ${summary.bankLinked} banks linked`}
          icon={CreditCard}
        />
      </div>

      {/* Identity / linkage block */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center gap-2 border-b border-[var(--border-default)] px-5 py-4">
          <Building2 className="h-4 w-4 text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Identity & linkage</h2>
        </header>
        <dl className="grid gap-px bg-[var(--border-default)] sm:grid-cols-2">
          <Field label="Employer ID" value={employer.id} mono />
          <Field label="Owner user ID" value={employer.owner_user_id} mono />
          <Field label="Bridge customer" value={employer.bridge_customer_id ?? '—'} mono />
          <Field label="Bridge virtual account" value={employer.bridge_virtual_account_id ?? '—'} mono />
          <Field label="Treasury contract" value={employer.treasury_contract ?? '—'} mono />
          <Field label="On-chain admin wallet" value={employer.employer_admin_wallet ?? '—'} mono />
        </dl>
      </section>

      {/* Team */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Team ({team.length})</h2>
          </div>
        </header>
        {team.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-[var(--text-muted)]">
            No employees added yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-base)]">
                <tr className="text-left">
                  {['Name', 'KYC', 'Wallet', 'Card', 'Bank', 'Active', 'Joined'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {team.map((employee) => (
                  <tr key={employee.id}>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{employee.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{employee.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-[10px] uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
                          KYC_BADGE[employee.kyc_status ?? 'pending'] ?? KYC_BADGE.pending
                        }`}
                      >
                        {employee.kyc_status ?? 'pending'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <DotIndicator on={employee.wallet_linked} />
                    </td>
                    <td className="px-5 py-3">
                      <DotIndicator on={employee.card_linked} />
                    </td>
                    <td className="px-5 py-3">
                      <DotIndicator on={employee.bank_linked} />
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">
                      {employee.active ? 'Yes' : 'No'}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {formatDate(employee.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Payroll runs */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Recent payroll runs ({payrollRuns.length})
            </h2>
          </div>
        </header>
        {payrollRuns.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-[var(--text-muted)]">No payroll runs yet.</div>
        ) : (
          <ul className="divide-y divide-[var(--border-default)]">
            {payrollRuns.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/admin/payroll/${run.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-[var(--bg-base)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--text-primary)]">
                      <span className={PAYROLL_STATUS_BADGE[run.status] ?? 'text-[var(--text-muted)]'}>
                        {run.status}
                      </span>
                      {run.tx_hash && (
                        <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">
                          {run.tx_hash.slice(0, 14)}…
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {run.employee_count ?? 0} recipients · {formatCurrency(Number(run.total_amount ?? 0))} ·{' '}
                      {formatDate(run.created_at)}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* MPP sessions + compliance + notifications */}
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
          <header className="flex items-center gap-2 border-b border-[var(--border-default)] px-5 py-4">
            <CreditCard className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">MPP sessions</h2>
          </header>
          {mppSessions.length === 0 ? (
            <div className="px-5 py-6 text-center text-xs text-[var(--text-muted)]">
              No MPP activity.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-default)]">
              {mppSessions.map((s) => (
                <li key={s.id} className="px-5 py-3">
                  <p className="font-mono text-xs text-[var(--text-secondary)]">{s.agent_wallet}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {s.status} · {formatCurrency(Number(s.total_spent))} · {formatDate(s.opened_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
          <header className="flex items-center gap-2 border-b border-[var(--border-default)] px-5 py-4">
            <ShieldAlert className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Compliance events</h2>
          </header>
          {complianceEvents.length === 0 ? (
            <div className="px-5 py-6 text-center text-xs text-[var(--text-muted)]">
              No compliance events for this employer.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-default)]">
              {complianceEvents.map((event) => (
                <li key={event.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-[var(--text-secondary)]">{event.event_type}</span>
                    {event.result === 'BLOCKED' ? (
                      <span className="text-[10px] uppercase tracking-wider rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 px-1.5 py-0.5 text-[var(--status-error)]">
                        BLOCKED
                      </span>
                    ) : event.result === 'CLEAR' ? (
                      <span className="text-[10px] uppercase tracking-wider rounded-md border border-[var(--status-success)]/30 bg-[var(--status-success)]/10 px-1.5 py-0.5 text-[var(--status-success)]">
                        CLEAR
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {event.employeeName} · {formatDate(event.created_at)}
                  </p>
                  {event.description && (
                    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{event.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Support tickets — surfaced inline so investigating an employer
           shows their open support history at a glance. */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Support tickets ({supportTickets.length})
            </h2>
          </div>
          <Link href="/admin/support" className="text-xs text-[var(--accent)] hover:underline">
            Open inbox →
          </Link>
        </header>
        {supportTickets.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-[var(--text-muted)]">
            No tickets filed by this employer or their team.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-default)]">
            {supportTickets.map((ticket) => (
              <li key={ticket.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-[var(--text-primary)]">{ticket.subject}</p>
                  <span
                    className={`text-[10px] uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
                      ticket.status === 'open'
                        ? 'border-[var(--status-pending)]/30 bg-[var(--status-pending)]/10 text-[var(--status-pending)]'
                        : ticket.status === 'in_progress'
                          ? 'border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]'
                          : ticket.status === 'resolved'
                            ? 'border-[var(--status-success)]/30 bg-[var(--status-success)]/10 text-[var(--status-success)]'
                            : 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-muted)]'
                    }`}
                  >
                    {ticket.status.replace('_', ' ')}
                  </span>
                  <span className="rounded-md border border-[var(--border-default)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {ticket.user_role}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {ticket.email} · {formatDate(ticket.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Notifications */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center gap-2 border-b border-[var(--border-default)] px-5 py-4">
          <Bell className="h-4 w-4 text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent in-app notifications</h2>
        </header>
        {notifications.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-[var(--text-muted)]">No notifications.</div>
        ) : (
          <ul className="divide-y divide-[var(--border-default)]">
            {notifications.map((n) => (
              <li key={n.id} className="px-5 py-3">
                <p className="text-sm text-[var(--text-primary)]">{n.title}</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {n.kind} · {n.severity} · {formatDate(n.created_at)} · {n.read_at ? 'read' : 'unread'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: number | string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'warning' | 'error' | 'success'
}) {
  const valueClass =
    tone === 'error'
      ? 'text-[var(--status-error)]'
      : tone === 'warning'
        ? 'text-[var(--status-pending)]'
        : tone === 'success'
          ? 'text-[var(--status-success)]'
          : 'text-[var(--text-primary)]'
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</p>
        <Icon className="h-4 w-4 text-[var(--text-muted)]" />
      </div>
      <p className={`mt-3 text-2xl font-semibold ${valueClass}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-[var(--bg-surface)] px-5 py-3">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</dt>
      <dd
        className={`mt-1 truncate text-sm text-[var(--text-primary)] ${mono ? 'font-mono text-xs' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function DotIndicator({ on }: { on: boolean }) {
  return on ? (
    <CheckCircle2 className="h-4 w-4 text-[var(--status-success)]" />
  ) : (
    <XCircle className="h-4 w-4 text-[var(--text-muted)]" />
  )
}
