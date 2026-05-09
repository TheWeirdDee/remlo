import * as React from 'react'
import { EmailLayout, H1, P, PrimaryButton } from './_layout'

interface SupportTicketReceivedEmailProps {
  refCode: string
  subject: string
  statusUrl: string
  appUrl: string
}

/**
 * Confirmation email after a support ticket is filed. Industry-standard
 * pattern: the reference code appears in the subject line so the recipient
 * can search their inbox for it later, and any future Remlo replies use
 * the same `Re: <subject> [Ticket #<code>]` format so threading works in
 * Gmail/Outlook/Apple Mail without a custom Message-ID parser.
 */
export default function SupportTicketReceivedEmail({
  refCode,
  subject,
  statusUrl,
  appUrl,
}: SupportTicketReceivedEmailProps) {
  return (
    <EmailLayout preview={`We got your ticket — reference #${refCode}`}>
      <H1>We got your ticket.</H1>
      <P>
        Thanks for reaching out. Someone from the Remlo team will reply to
        this email thread directly. Your reference number is{' '}
        <strong>#{refCode}</strong> — keep this email and we&rsquo;ll all
        stay on the same page.
      </P>
      <P small muted>
        <strong>What you sent us:</strong> {subject}
      </P>
      <PrimaryButton href={statusUrl}>Check status anytime</PrimaryButton>
      <P small muted>
        Need to follow up? Just reply to this email — we&rsquo;ll see it.
        Or look up the status directly with your reference code at{' '}
        <a href={statusUrl} style={{ color: '#059669' }}>
          {statusUrl.replace(/^https?:\/\//, '')}
        </a>
        .
      </P>
      <P small muted>
        We typically reply within one business day. Urgent? Mention it in
        the reply and we&rsquo;ll prioritize.
      </P>
      <P small muted>
        — The Remlo team ·{' '}
        <a href={appUrl} style={{ color: '#059669' }}>
          {appUrl.replace(/^https?:\/\//, '')}
        </a>
      </P>
    </EmailLayout>
  )
}

SupportTicketReceivedEmail.PreviewProps = {
  refCode: 'd979c78a',
  subject: 'My payroll didn\'t go through',
  statusUrl: 'https://www.remlo.xyz/support/status?code=d979c78a',
  appUrl: 'https://www.remlo.xyz',
} satisfies SupportTicketReceivedEmailProps
