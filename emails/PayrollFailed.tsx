import * as React from 'react'
import { Text } from '@react-email/components'
import { EmailLayout, P, PrimaryButton, Card, KeyValue, BRAND } from './_layout'

interface PayrollFailedEmailProps {
  companyName: string
  reason: string
  runUrl: string
  recipientCount?: number
}

export default function PayrollFailedEmail({
  companyName,
  reason,
  runUrl,
  recipientCount,
}: PayrollFailedEmailProps) {
  return (
    <EmailLayout preview={`Payroll failed for ${companyName}. Action required.`}>
      <Text
        style={{
          margin: '0 0 8px',
          fontSize: '22px',
          lineHeight: '30px',
          fontWeight: 700,
          color: BRAND.error,
          letterSpacing: '-0.01em',
        }}
      >
        Payroll didn&rsquo;t go through
      </Text>
      <P>
        {companyName}&rsquo;s most recent payroll run failed before broadcasting. No funds left
        the treasury. You can fix the issue and retry.
      </P>
      <Card>
        <KeyValue label="What happened" value={reason} />
        {typeof recipientCount === 'number' && (
          <KeyValue
            label="Affected"
            value={`${recipientCount} employee${recipientCount === 1 ? '' : 's'} not paid yet`}
          />
        )}
      </Card>
      <PrimaryButton href={runUrl}>Review run</PrimaryButton>
      <P small muted>
        Common causes: insufficient treasury balance, missing wallet for an employee, or expired
        KYC. The run status page shows the specific failure per employee.
      </P>
    </EmailLayout>
  )
}

PayrollFailedEmail.PreviewProps = {
  companyName: 'Acme Co.',
  reason: 'Treasury balance below total payroll amount.',
  runUrl: 'https://remlo.xyz/dashboard/payroll/run-id',
  recipientCount: 12,
} satisfies PayrollFailedEmailProps
