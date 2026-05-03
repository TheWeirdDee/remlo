import * as React from 'react'
import { EmailLayout, H1, P, PrimaryButton } from './_layout'

interface WaitlistConfirmEmailProps {
  confirmUrl: string
  appUrl: string
}

export default function WaitlistConfirmEmail({
  confirmUrl,
  appUrl,
}: WaitlistConfirmEmailProps) {
  return (
    <EmailLayout preview="Confirm your spot on the Remlo waitlist">
      <H1>One click and you&rsquo;re in.</H1>
      <P>
        We got your request to join the Remlo waitlist. Confirm your email so
        we know it&rsquo;s really you, and we&rsquo;ll email you the moment
        you can start running payroll.
      </P>
      <PrimaryButton href={confirmUrl}>Confirm my email</PrimaryButton>
      <P small muted>
        If you didn&rsquo;t request this, ignore this email. Nothing is added
        to our list until you click the button.
      </P>
      <P small muted>
        Link not clickable? Paste this into your browser:
        <br />
        <span style={{ wordBreak: 'break-all' }}>{confirmUrl}</span>
      </P>
      <P small muted>
        Curious what we ship?{' '}
        <a href={`${appUrl}/agents`} style={{ color: '#059669' }}>
          Read about the agent rails
        </a>
        .
      </P>
    </EmailLayout>
  )
}

WaitlistConfirmEmail.PreviewProps = {
  confirmUrl: 'https://remlo.xyz/api/waitlist/confirm?token=abc123',
  appUrl: 'https://remlo.xyz',
} satisfies WaitlistConfirmEmailProps
