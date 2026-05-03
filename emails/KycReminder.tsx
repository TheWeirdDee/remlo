import * as React from 'react'
import { EmailLayout, H1, P, PrimaryButton, Card, KeyValue } from './_layout'

interface KycReminderEmailProps {
  firstName?: string | null
  companyName: string
  kycUrl: string
}

export default function KycReminderEmail({
  firstName,
  companyName,
  kycUrl,
}: KycReminderEmailProps) {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,'

  return (
    <EmailLayout preview="One step left to receive payroll. Verify your identity.">
      <H1>One step left to receive your payroll</H1>
      <P>{greeting}</P>
      <P>
        {companyName} is ready to send your salary, but we need to verify your identity first.
        It takes about two minutes. Just a photo of an ID and a short selfie.
      </P>
      <PrimaryButton href={kycUrl}>Verify identity</PrimaryButton>
      <Card>
        <KeyValue label="Why" value="Required by financial regulators" />
        <KeyValue label="Time" value="About 2 minutes" />
        <KeyValue label="Provider" value="Bridge (audited KYC partner)" />
      </Card>
      <P small muted>
        We don&rsquo;t store your ID documents. Verification runs through our regulated partner.
        Once verified, future paychecks land automatically.
      </P>
    </EmailLayout>
  )
}

KycReminderEmail.PreviewProps = {
  firstName: 'Tomi',
  companyName: 'Acme Co.',
  kycUrl: 'https://remlo.xyz/kyc/preview-token',
} satisfies KycReminderEmailProps
