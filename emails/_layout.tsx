import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

// `Text` import retained because some templates use it directly. The
// `<table>` block in the header is intentional — Outlook/Gmail desktop
// strip flex/grid; tables are the only reliable cross-client layout
// primitive for inline image + label.

export const BRAND = {
  ink: '#0B1220',
  inkSoft: '#1E293B',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  bgBase: '#FFFFFF',
  bgSurface: '#F8FAFC',
  bgSubtle: '#F1F5F9',
  border: '#E2E8F0',
  accent: '#059669',
  accentSubtle: '#D1FAE5',
  success: '#059669',
  warning: '#D97706',
  error: '#DC2626',
}

interface EmailLayoutProps {
  preview: string
  children: React.ReactNode
}

const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Geist", Inter, Roboto, "Helvetica Neue", Arial, sans-serif'

export function EmailLayout({ preview, children }: EmailLayoutProps) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://remlo.xyz'

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: BRAND.bgSurface,
          fontFamily: fontStack,
          color: BRAND.text,
        }}
      >
        <Container
          style={{
            maxWidth: '560px',
            margin: '32px auto',
            backgroundColor: BRAND.bgBase,
            borderRadius: '16px',
            border: `1px solid ${BRAND.border}`,
            padding: '0',
            overflow: 'hidden',
          }}
        >
          <Section
            style={{
              padding: '24px 32px 0',
            }}
          >
            <table cellPadding={0} cellSpacing={0} role="presentation" style={{ borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ verticalAlign: 'middle' }}>
                    <Img
                      src={`${appUrl}/remlo-logo.png`}
                      alt="Remlo"
                      width="32"
                      height="32"
                      style={{ display: 'block', borderRadius: '8px' }}
                    />
                  </td>
                  <td style={{ paddingLeft: '10px', verticalAlign: 'middle' }}>
                    <Text
                      style={{
                        margin: 0,
                        fontSize: '18px',
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        color: BRAND.ink,
                      }}
                    >
                      Remlo
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>
          <Section style={{ padding: '24px 32px 32px' }}>{children}</Section>
          <Hr style={{ borderColor: BRAND.border, margin: '0 32px' }} />
          <Section style={{ padding: '20px 32px 28px' }}>
            <Text
              style={{
                margin: 0,
                fontSize: '12px',
                lineHeight: '18px',
                color: BRAND.textMuted,
              }}
            >
              Remlo · Multi-chain payroll on Tempo and Solana.
              <br />
              <Link href={appUrl} style={{ color: BRAND.accent, textDecoration: 'none' }}>
                {appUrl.replace(/^https?:\/\//, '')}
              </Link>
              {' · '}
              <Link
                href={`${appUrl}/legal/privacy`}
                style={{ color: BRAND.textMuted, textDecoration: 'underline' }}
              >
                Privacy
              </Link>
              {' · '}
              <Link
                href={`${appUrl}/legal/terms`}
                style={{ color: BRAND.textMuted, textDecoration: 'underline' }}
              >
                Terms
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export function H1({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        margin: '0 0 8px',
        fontSize: '22px',
        lineHeight: '30px',
        fontWeight: 700,
        color: BRAND.text,
        letterSpacing: '-0.01em',
      }}
    >
      {children}
    </Text>
  )
}

export function P({
  children,
  muted,
  small,
}: {
  children: React.ReactNode
  muted?: boolean
  small?: boolean
}) {
  return (
    <Text
      style={{
        margin: '0 0 12px',
        fontSize: small ? '13px' : '15px',
        lineHeight: small ? '20px' : '24px',
        color: muted ? BRAND.textMuted : BRAND.textSecondary,
      }}
    >
      {children}
    </Text>
  )
}

export function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Section style={{ margin: '20px 0 8px' }}>
      <Link
        href={href}
        style={{
          display: 'inline-block',
          backgroundColor: BRAND.accent,
          color: '#FFFFFF',
          padding: '12px 24px',
          borderRadius: '8px',
          textDecoration: 'none',
          fontSize: '14px',
          fontWeight: 600,
        }}
      >
        {children}
      </Link>
    </Section>
  )
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <Section
      style={{
        margin: '16px 0',
        padding: '16px 18px',
        backgroundColor: BRAND.bgSubtle,
        border: `1px solid ${BRAND.border}`,
        borderRadius: '12px',
      }}
    >
      {children}
    </Section>
  )
}

export function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Text
      style={{
        margin: '0 0 6px',
        fontSize: '13px',
        lineHeight: '20px',
        color: BRAND.textSecondary,
      }}
    >
      <span style={{ color: BRAND.textMuted, marginRight: '6px' }}>{label}</span>
      <span
        style={{
          color: BRAND.text,
          fontFamily: mono ? 'ui-monospace, "IBM Plex Mono", monospace' : undefined,
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </Text>
  )
}
