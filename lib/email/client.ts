import * as React from 'react'
import { Resend } from 'resend'
import { render } from '@react-email/render'
import { createServerClient } from '@/lib/supabase-server'
import EmployeeInviteEmail from '@/emails/EmployeeInvite'
import EmployerWelcomeEmail from '@/emails/EmployerWelcome'
import PayrollFinalizedEmail from '@/emails/PayrollFinalized'
import PayrollFailedEmail from '@/emails/PayrollFailed'
import KycReminderEmail from '@/emails/KycReminder'
import WaitlistConfirmEmail from '@/emails/WaitlistConfirm'

const FROM_DEFAULT = 'Remlo <hello@remlo.xyz>'
const REPLY_TO_DEFAULT = 'hello@remlo.xyz'

type TemplateMap = {
  employee_invite: React.ComponentProps<typeof EmployeeInviteEmail>
  employer_welcome: React.ComponentProps<typeof EmployerWelcomeEmail>
  payroll_finalized: React.ComponentProps<typeof PayrollFinalizedEmail>
  payroll_failed: React.ComponentProps<typeof PayrollFailedEmail>
  kyc_reminder: React.ComponentProps<typeof KycReminderEmail>
  waitlist_confirm: React.ComponentProps<typeof WaitlistConfirmEmail>
}

export type EmailTemplate = keyof TemplateMap

const TEMPLATE_COMPONENTS: {
  [K in EmailTemplate]: (props: TemplateMap[K]) => React.JSX.Element
} = {
  employee_invite: EmployeeInviteEmail,
  employer_welcome: EmployerWelcomeEmail,
  payroll_finalized: PayrollFinalizedEmail,
  payroll_failed: PayrollFailedEmail,
  kyc_reminder: KycReminderEmail,
  waitlist_confirm: WaitlistConfirmEmail,
}

const SUBJECTS: { [K in EmailTemplate]: (props: TemplateMap[K]) => string } = {
  employee_invite: ({ companyName }) => `${companyName} invited you to Remlo`,
  employer_welcome: ({ companyName }) => `Welcome to Remlo, ${companyName}`,
  payroll_finalized: ({ companyName, recipientCount }) =>
    `Payroll broadcast — ${recipientCount} ${recipientCount === 1 ? 'employee' : 'employees'} paid (${companyName})`,
  payroll_failed: ({ companyName }) => `Payroll failed for ${companyName} — action required`,
  kyc_reminder: ({ companyName }) => `${companyName} is waiting on your identity check`,
  waitlist_confirm: () => 'Confirm your spot on the Remlo waitlist',
}

export interface SendEmailInput<K extends EmailTemplate = EmailTemplate> {
  to: string
  template: K
  props: TemplateMap[K]
  replyTo?: string
  from?: string
  idempotencyKey?: string
  /** Schedule the send for a future ISO timestamp (Resend supports up to 30d ahead). */
  scheduledAt?: string
  /** Resend tags for filterable analytics. `template` and `employer_id` (if any) are added automatically. */
  tags?: Array<{ name: string; value: string }>
  /** Employer associated with this send. Tagged on the message and stored on email_events for later analytics. */
  employerId?: string
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  error?: string
  skipped?: 'suppressed' | 'no_api_key'
}

let resendInstance: Resend | null = null

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!resendInstance) {
    resendInstance = new Resend(key)
  }
  return resendInstance
}

function normalizeEmail(addr: string): string {
  return addr.trim().toLowerCase()
}

async function isSuppressed(email: string): Promise<boolean> {
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('email_suppressions')
      .select('email')
      .eq('email', normalizeEmail(email))
      .maybeSingle()
    return Boolean(data)
  } catch {
    return false
  }
}

function buildTags(
  template: EmailTemplate,
  employerId: string | undefined,
  extras: Array<{ name: string; value: string }> | undefined,
): Array<{ name: string; value: string }> {
  const tags: Array<{ name: string; value: string }> = [{ name: 'template', value: template }]
  if (employerId) tags.push({ name: 'employer_id', value: employerId })
  if (extras) tags.push(...extras)
  return tags
}

async function renderTemplate<K extends EmailTemplate>(
  template: K,
  props: TemplateMap[K],
): Promise<{ html: string; text: string; subject: string } | { error: string }> {
  const Component = TEMPLATE_COMPONENTS[template] as (
    props: TemplateMap[K],
  ) => React.JSX.Element
  try {
    const element = Component(props)
    const html = await render(element)
    const text = await render(element, { plainText: true })
    const subject = SUBJECTS[template](props)
    return { html, text, subject }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'render failed'
    console.error('[email] render failed', { template, error: message })
    return { error: `render failed: ${message}` }
  }
}

export async function sendEmail<K extends EmailTemplate>(
  input: SendEmailInput<K>,
): Promise<SendEmailResult> {
  const resend = getResend()
  if (!resend) {
    console.warn('[email] RESEND_API_KEY missing — skipping send', { template: input.template })
    return { ok: false, skipped: 'no_api_key', error: 'RESEND_API_KEY missing' }
  }

  if (await isSuppressed(input.to)) {
    console.warn('[email] recipient suppressed — skipping', {
      template: input.template,
      to: input.to,
    })
    return { ok: false, skipped: 'suppressed', error: 'Recipient is on suppression list' }
  }

  const rendered = await renderTemplate(input.template, input.props)
  if ('error' in rendered) {
    return { ok: false, error: rendered.error }
  }

  const tags = buildTags(input.template, input.employerId, input.tags)

  try {
    const { data, error } = await resend.emails.send(
      {
        from: input.from ?? FROM_DEFAULT,
        to: input.to,
        replyTo: input.replyTo ?? REPLY_TO_DEFAULT,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        scheduledAt: input.scheduledAt,
        tags,
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    )

    if (error) {
      console.error('[email] send failed', {
        template: input.template,
        to: input.to,
        error: error.message,
      })
      return { ok: false, error: error.message }
    }

    return { ok: true, id: data?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'send failed'
    console.error('[email] send threw', { template: input.template, error: message })
    return { ok: false, error: message }
  }
}

/**
 * Send up to 100 emails in a single Resend API call.
 * Resend enforces the 100-per-call limit on its end; we slice automatically.
 * Suppressed recipients are filtered out before the API call.
 */
export interface SendEmailBatchItem<K extends EmailTemplate = EmailTemplate> {
  to: string
  template: K
  props: TemplateMap[K]
  idempotencyKey?: string
  scheduledAt?: string
  tags?: Array<{ name: string; value: string }>
  employerId?: string
}

export interface SendEmailBatchResult {
  attempted: number
  sent: number
  skipped: number
  failed: number
  errors: Array<{ to: string; error: string }>
}

export async function sendEmailBatch(
  items: ReadonlyArray<SendEmailBatchItem>,
): Promise<SendEmailBatchResult> {
  const result: SendEmailBatchResult = {
    attempted: items.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  const resend = getResend()
  if (!resend) {
    result.skipped = items.length
    return result
  }

  if (items.length === 0) return result

  const supabase = createServerClient()
  const recipients = Array.from(new Set(items.map((i) => normalizeEmail(i.to))))
  const { data: suppressed } = await supabase
    .from('email_suppressions')
    .select('email')
    .in('email', recipients)
  const suppressedSet = new Set((suppressed ?? []).map((r) => r.email))

  const cleanItems = items.filter((i) => !suppressedSet.has(normalizeEmail(i.to)))
  result.skipped = items.length - cleanItems.length

  const rendered = await Promise.all(
    cleanItems.map(async (item) => {
      const r = await renderTemplate(item.template, item.props)
      if ('error' in r) {
        result.failed += 1
        result.errors.push({ to: item.to, error: r.error })
        return null
      }
      return {
        from: FROM_DEFAULT,
        to: item.to,
        replyTo: REPLY_TO_DEFAULT,
        subject: r.subject,
        html: r.html,
        text: r.text,
        scheduledAt: item.scheduledAt,
        tags: buildTags(item.template, item.employerId, item.tags),
      }
    }),
  )

  const valid = rendered.filter((r): r is NonNullable<typeof r> => r !== null)

  // Resend batch endpoint accepts up to 100 per call.
  for (let offset = 0; offset < valid.length; offset += 100) {
    const slice = valid.slice(offset, offset + 100)
    try {
      const { data, error } = await resend.batch.send(slice)
      if (error) {
        result.failed += slice.length
        result.errors.push({ to: `batch[${offset}..]`, error: error.message })
        continue
      }
      result.sent += data?.data?.length ?? slice.length
    } catch (err) {
      const message = err instanceof Error ? err.message : 'batch send failed'
      result.failed += slice.length
      result.errors.push({ to: `batch[${offset}..]`, error: message })
    }
  }

  return result
}

/** Cancel a previously scheduled email by its Resend message ID. No-op if API key missing. */
export async function cancelScheduledEmail(emailId: string): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend()
  if (!resend) return { ok: false, error: 'RESEND_API_KEY missing' }
  try {
    const { error } = await resend.emails.cancel(emailId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'cancel failed' }
  }
}
