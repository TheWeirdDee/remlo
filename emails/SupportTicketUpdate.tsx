import * as React from 'react'
import { EmailLayout, H1, P, PrimaryButton } from './_layout'

interface SupportTicketUpdateEmailProps {
  refCode: string
  subject: string
  statusLabel: string
  resolutionNote: string | null
  statusUrl: string
  appUrl: string
}

/**
 * Outbound notification when an admin updates a ticket — status change or
 * a new resolution note. Subject is `Re: <subject> [Ticket #<code>]`
 * (built in lib/email/client.ts SUBJECTS map) so it threads with the
 * original confirmation email in the recipient's mail client.
 *
 * The resolution_note is the only admin-typed text that ever lands in a
 * customer's inbox. Admins know that going in.
 */
export default function SupportTicketUpdateEmail({
  refCode,
  subject,
  statusLabel,
  resolutionNote,
  statusUrl,
  appUrl,
}: SupportTicketUpdateEmailProps) {
  void subject // referenced via the email subject line; preview here
  return (
    <EmailLayout preview={`Update on ticket #${refCode}`}>
      <H1>Update on your ticket.</H1>
      <P>
        Status: <strong>{statusLabel}</strong>. Your reference is still{' '}
        <strong>#{refCode}</strong>.
      </P>
      {resolutionNote && (
        <>
          <P small muted>
            <strong>From the Remlo team:</strong>
          </P>
          <P>{resolutionNote}</P>
        </>
      )}
      <PrimaryButton href={statusUrl}>View ticket status</PrimaryButton>
      <P small muted>
        Reply to this email if anything is still unclear — we&rsquo;ll see
        it on the same thread.
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

SupportTicketUpdateEmail.PreviewProps = {
  refCode: 'd979c78a',
  subject: 'My payroll didn\'t go through',
  statusLabel: 'Resolved',
  resolutionNote:
    'We re-broadcast your payroll run on Tempo testnet — the original tx had insufficient priority fee. All 12 payments confirmed in block 5,238,002.',
  statusUrl: 'https://www.remlo.xyz/support/status?code=d979c78a',
  appUrl: 'https://www.remlo.xyz',
} satisfies SupportTicketUpdateEmailProps
