import * as React from 'react'
import { EmailLayout, H1, P, PrimaryButton, Card, KeyValue } from './_layout'

interface EmployerWelcomeEmailProps {
  firstName?: string | null
  companyName: string
  appUrl: string
}

export default function EmployerWelcomeEmail({
  firstName,
  companyName,
  appUrl,
}: EmployerWelcomeEmailProps) {
  const greeting = firstName ? `Welcome, ${firstName}.` : 'Welcome to Remlo.'
  const dashboardUrl = `${appUrl.replace(/\/$/, '')}/dashboard`
  const teamUrl = `${dashboardUrl}/team`

  return (
    <EmailLayout preview={`Welcome to Remlo, ${companyName}`}>
      <H1>{greeting}</H1>
      <P>
        {companyName} is now set up on Remlo. You can run your first payroll in under five
        minutes. Here&rsquo;s the path.
      </P>
      <Card>
        <KeyValue label="1." value="Add your first employee" />
        <KeyValue label="2." value="Fund your treasury (Tempo or Solana)" />
        <KeyValue label="3." value="Run payroll. Settles in 0.4 seconds." />
      </Card>
      <PrimaryButton href={teamUrl}>Add your first employee</PrimaryButton>
      <P small muted>
        Need a hand? Reply to this email. A real person will respond.
      </P>
    </EmailLayout>
  )
}

EmployerWelcomeEmail.PreviewProps = {
  firstName: 'Tomi',
  companyName: 'Acme Co.',
  appUrl: 'https://remlo.xyz',
} satisfies EmployerWelcomeEmailProps
