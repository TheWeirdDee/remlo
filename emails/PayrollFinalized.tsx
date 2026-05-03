import * as React from 'react'
import { EmailLayout, H1, P, PrimaryButton, Card, KeyValue, BRAND } from './_layout'

interface PayrollFinalizedEmailProps {
  companyName: string
  recipientCount: number
  totalAmount: number
  txHash: string
  runUrl: string
  explorerUrl: string
  chain: 'tempo' | 'solana'
  settlementMs?: number | null
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

export default function PayrollFinalizedEmail({
  companyName,
  recipientCount,
  totalAmount,
  txHash,
  runUrl,
  explorerUrl,
  chain,
  settlementMs,
}: PayrollFinalizedEmailProps) {
  const chainLabel = chain === 'solana' ? 'Solana' : 'Tempo'
  const settlement =
    typeof settlementMs === 'number' ? `${(settlementMs / 1000).toFixed(2)}s` : 'In progress'

  return (
    <EmailLayout
      preview={`Payroll broadcast on ${chainLabel}. ${recipientCount} employees, ${formatCurrency(totalAmount)}.`}
    >
      <H1>Payroll broadcast on {chainLabel}</H1>
      <P>
        {companyName}&rsquo;s payroll batch is on-chain. Employees will see funds settle within
        seconds.
      </P>
      <Card>
        <KeyValue label="Recipients" value={`${recipientCount} employee${recipientCount === 1 ? '' : 's'}`} />
        <KeyValue label="Total" value={formatCurrency(totalAmount)} />
        <KeyValue label="Chain" value={chainLabel} />
        <KeyValue label="Settlement" value={settlement} />
        <KeyValue label="Tx" value={shortHash(txHash)} mono />
      </Card>
      <PrimaryButton href={runUrl}>View itemized payouts</PrimaryButton>
      <P small muted>
        Confirm on the explorer:{' '}
        <a href={explorerUrl} style={{ color: BRAND.accent, textDecoration: 'none' }}>
          {explorerUrl.replace(/^https?:\/\//, '').slice(0, 60)}
        </a>
      </P>
    </EmailLayout>
  )
}

PayrollFinalizedEmail.PreviewProps = {
  companyName: 'Acme Co.',
  recipientCount: 12,
  totalAmount: 24500,
  txHash: '0xabcdef0123456789abcdef0123456789abcdef01',
  runUrl: 'https://remlo.xyz/dashboard/payroll/run-id',
  explorerUrl: 'https://explore.moderato.tempo.xyz/tx/0xabcdef',
  chain: 'tempo',
  settlementMs: 420,
} satisfies PayrollFinalizedEmailProps
