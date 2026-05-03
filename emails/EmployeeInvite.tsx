import * as React from 'react'
import { EmailLayout, H1, P, PrimaryButton, Card, KeyValue, BRAND } from './_layout'

interface EmployeeInviteEmailProps {
  firstName?: string | null
  companyName: string
  inviteUrl: string
}

export default function EmployeeInviteEmail({
  firstName,
  companyName,
  inviteUrl,
}: EmployeeInviteEmailProps) {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,'

  return (
    <EmailLayout preview={`${companyName} added you to Remlo for payroll`}>
      <H1>{companyName} added you to Remlo for payroll</H1>
      <P>{greeting}</P>
      <P>
        {companyName} uses Remlo to pay its team. Accept your invite to set up your account, verify
        your ID, and get ready for your first paycheck. No app downloads, no banking forms.
      </P>
      <PrimaryButton href={inviteUrl}>Accept invite</PrimaryButton>
      <Card>
        <KeyValue label="Step 1" value="Create your account" />
        <KeyValue label="Step 2" value="Verify your ID (about 2 minutes)" />
        <KeyValue label="Step 3" value="Get paid automatically" />
      </Card>
      <P small muted>
        This invite is unique to you. Don&rsquo;t share the link. If you weren&rsquo;t expecting
        this email, you can safely ignore it.
      </P>
      <P small muted>
        Trouble with the button? Paste this URL into your browser:{' '}
        <span style={{ color: BRAND.text, wordBreak: 'break-all' }}>{inviteUrl}</span>
      </P>
    </EmailLayout>
  )
}

EmployeeInviteEmail.PreviewProps = {
  firstName: 'Tomi',
  companyName: 'Acme Co.',
  inviteUrl: 'https://remlo.xyz/invite/preview-token',
} satisfies EmployeeInviteEmailProps
