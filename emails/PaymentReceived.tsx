import * as React from 'react'
import { EmailLayout, H1, P, PrimaryButton, Card, KeyValue, BRAND } from './_layout'

/**
 * PaymentReceived — fires per-employee on every settled payroll payment.
 *
 * Why per-payment vs per-run: employees engage with payroll once a month,
 * and the receipt is the one piece of mail that converts them from "your
 * employer uses this thing" to "I got paid through this thing." Per-run
 * batch summaries are operator-facing; per-payment receipts are the
 * employee-facing equivalent of a paystub stub-line.
 */
interface PaymentReceivedEmailProps {
  /** Employee's first name. Falls back to "you" in greeting if null. */
  firstName?: string | null
  /** Display name of the employer that paid. */
  companyName: string
  /** Net amount received in USD, decimal (e.g. 4250.00). */
  amountUsd: number
  /** ISO 8601 settlement timestamp, displayed in the recipient's locale. */
  settledAt: string
  /** 'tempo' or 'solana' — drives chain label + explorer link. */
  chain: 'tempo' | 'solana'
  /** Public block explorer URL for the settlement tx. */
  explorerUrl: string
  /** Short tx hash for inline display. */
  txHash: string
  /** URL to the employee's payslip page in the dashboard / portal. */
  payslipUrl: string
  /** Optional pay period label (e.g. "Apr 1–30, 2026"). */
  payPeriod?: string | null
  /** Optional cost-center label. */
  costCenter?: string | null
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function shortHash(hash: string): string {
  if (hash.length <= 18) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

function formatSettledAt(iso: string): string {
  try {
    const date = new Date(iso)
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  } catch {
    return iso
  }
}

export default function PaymentReceivedEmail({
  firstName,
  companyName,
  amountUsd,
  settledAt,
  chain,
  explorerUrl,
  txHash,
  payslipUrl,
  payPeriod,
  costCenter,
}: PaymentReceivedEmailProps) {
  const chainLabel = chain === 'solana' ? 'Solana' : 'Tempo'
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,'
  const amountFormatted = formatCurrency(amountUsd)

  return (
    <EmailLayout
      preview={`${amountFormatted} from ${companyName} just settled on ${chainLabel}.`}
    >
      <H1>You just got paid.</H1>
      <P>
        {greeting} {companyName} sent you {amountFormatted} via Remlo. It
        settled on {chainLabel} {chain === 'solana' ? 'devnet' : 'Moderato'} and is
        already in your wallet.
      </P>
      <Card>
        <KeyValue label="Amount" value={amountFormatted} />
        <KeyValue label="From" value={companyName} />
        <KeyValue label="Chain" value={chainLabel} />
        <KeyValue label="Settled" value={formatSettledAt(settledAt)} />
        <KeyValue label="Transaction" value={shortHash(txHash)} mono />
        {payPeriod ? <KeyValue label="Pay period" value={payPeriod} /> : null}
        {costCenter ? <KeyValue label="Cost center" value={costCenter} /> : null}
      </Card>
      <PrimaryButton href={payslipUrl}>View itemized payslip</PrimaryButton>
      <P small muted>
        Verify on-chain:{' '}
        <a href={explorerUrl} style={{ color: BRAND.accent, textDecoration: 'none' }}>
          {explorerUrl.replace(/^https?:\/\//, '').slice(0, 60)}
        </a>
      </P>
      <P small muted>
        Need to off-ramp to a local bank account? Sign in to your Remlo portal
        and use the &ldquo;Off-ramp&rdquo; button on this payment to convert
        to USD, EUR, MXN, or BRL.
      </P>
    </EmailLayout>
  )
}

PaymentReceivedEmail.PreviewProps = {
  firstName: 'Tomi',
  companyName: 'Acme Co.',
  amountUsd: 4250,
  settledAt: '2026-05-04T09:00:00.000Z',
  chain: 'tempo',
  explorerUrl: 'https://explore.moderato.tempo.xyz/tx/0xabcdef0123456789abcdef0123456789abcdef01',
  txHash: '0xabcdef0123456789abcdef0123456789abcdef01',
  payslipUrl: 'https://remlo.xyz/portal/payslips/run-uuid/employee-uuid',
  payPeriod: 'Apr 1–30, 2026',
  costCenter: 'Engineering',
} satisfies PaymentReceivedEmailProps
