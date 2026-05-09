import * as React from 'react'
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  Link,
} from '@react-pdf/renderer'

/**
 * Shared visual vocabulary for all PDF documents (payslips, payroll
 * summaries, future statements). Mirrors the email layout palette so
 * mailed and printed artifacts feel like the same product.
 *
 * Print PDFs intentionally use a *light* canvas even though the app is
 * dark-themed — accountants print to paper and the contrast there must
 * be unambiguous.
 */

export const PDF_BRAND = {
  ink: '#0B1220',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  accent: '#059669',
  accentSubtle: '#D1FAE5',
  bgSurface: '#FFFFFF',
  bgSubtle: '#F8FAFC',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  success: '#059669',
  pending: '#D97706',
  error: '#DC2626',
}

export const pdfStyles = StyleSheet.create({
  page: {
    paddingHorizontal: 48,
    paddingVertical: 56,
    fontSize: 10,
    color: PDF_BRAND.text,
    fontFamily: 'Helvetica',
  },
  // ─── Header ────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: PDF_BRAND.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkLetter: {
    color: '#FFFFFF',
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
  },
  brandName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    color: PDF_BRAND.ink,
    letterSpacing: 0.2,
  },
  docKindLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    letterSpacing: 1.6,
    color: PDF_BRAND.textMuted,
  },
  docTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    color: PDF_BRAND.text,
    marginTop: 2,
  },
  docSubtitle: {
    fontSize: 10,
    color: PDF_BRAND.textSecondary,
    marginTop: 4,
  },
  // ─── Rule lines ────────────────────────────────────────────────────────────
  rule: {
    borderTopWidth: 1,
    borderTopColor: PDF_BRAND.border,
    marginVertical: 14,
  },
  // ─── Section headers ───────────────────────────────────────────────────────
  sectionLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    letterSpacing: 1.2,
    color: PDF_BRAND.textMuted,
    marginBottom: 6,
  },
  // ─── Key/value rows ────────────────────────────────────────────────────────
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  kvLabel: {
    color: PDF_BRAND.textSecondary,
    fontSize: 10,
  },
  kvValue: {
    color: PDF_BRAND.text,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
  },
  kvMono: {
    fontFamily: 'Courier',
    fontSize: 9,
    color: PDF_BRAND.text,
  },
  // ─── Two-column blocks (parties etc.) ──────────────────────────────────────
  twoColumns: {
    flexDirection: 'row',
    gap: 24,
  },
  column: { flex: 1 },
  // ─── Headline number (net pay etc.) ────────────────────────────────────────
  netCard: {
    backgroundColor: PDF_BRAND.bgSubtle,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: PDF_BRAND.border,
    marginVertical: 14,
  },
  netLabel: {
    fontSize: 9,
    color: PDF_BRAND.textMuted,
    letterSpacing: 1.2,
    fontFamily: 'Helvetica-Bold',
  },
  netAmount: {
    fontSize: 32,
    fontFamily: 'Helvetica-Bold',
    color: PDF_BRAND.text,
    marginTop: 4,
    letterSpacing: -0.5,
  },
  netSub: {
    fontSize: 10,
    color: PDF_BRAND.textSecondary,
    marginTop: 2,
  },
  // ─── Tables ────────────────────────────────────────────────────────────────
  table: {
    borderWidth: 1,
    borderColor: PDF_BRAND.border,
    borderRadius: 6,
    overflow: 'hidden',
    marginTop: 8,
  },
  tHeadRow: {
    flexDirection: 'row',
    backgroundColor: PDF_BRAND.bgSubtle,
    borderBottomWidth: 1,
    borderBottomColor: PDF_BRAND.border,
  },
  tBodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: PDF_BRAND.border,
  },
  tBodyRowLast: {
    flexDirection: 'row',
  },
  tHeadCell: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: PDF_BRAND.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tBodyCell: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    fontSize: 9,
    color: PDF_BRAND.text,
  },
  // ─── Footer ────────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: PDF_BRAND.textMuted,
    textAlign: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_BRAND.border,
  },
  // ─── Status badges ─────────────────────────────────────────────────────────
  statusPill: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
  },
  statusSuccess: {
    backgroundColor: PDF_BRAND.accentSubtle,
    color: PDF_BRAND.success,
  },
  statusPending: {
    backgroundColor: '#FEF3C7',
    color: PDF_BRAND.pending,
  },
  statusError: {
    backgroundColor: '#FEE2E2',
    color: PDF_BRAND.error,
  },
})

export interface PdfHeaderProps {
  /** Small label above the title — e.g. "PAYSLIP", "PAYROLL RUN". */
  kind: string
  title: string
  subtitle?: string
}

export function PdfHeader({ kind, title, subtitle }: PdfHeaderProps) {
  return (
    <View>
      <View style={pdfStyles.headerRow}>
        <View style={pdfStyles.brandRow}>
          <View style={pdfStyles.brandMark}>
            <Text style={pdfStyles.brandMarkLetter}>R</Text>
          </View>
          <Text style={pdfStyles.brandName}>Remlo</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={pdfStyles.docKindLabel}>{kind.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={pdfStyles.docTitle}>{title}</Text>
      {subtitle && <Text style={pdfStyles.docSubtitle}>{subtitle}</Text>}
      <View style={pdfStyles.rule} />
    </View>
  )
}

export interface PdfFooterProps {
  /** Verifiable URL — usually an explorer link or the verifier endpoint. */
  verifyHint?: string
  generatedAt?: Date
}

export function PdfFooter({ verifyHint, generatedAt = new Date() }: PdfFooterProps) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(generatedAt)
  return (
    <View style={pdfStyles.footer} fixed>
      <Text>
        Generated {formatted} by Remlo. {verifyHint ?? ''}
      </Text>
      {verifyHint && <Text style={{ marginTop: 2 }}>remlo.xyz</Text>}
    </View>
  )
}

export function PdfKeyValue({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <View style={pdfStyles.kvRow}>
      <Text style={pdfStyles.kvLabel}>{label}</Text>
      <Text style={mono ? pdfStyles.kvMono : pdfStyles.kvValue}>{value}</Text>
    </View>
  )
}

/** A clickable monospace explorer link, on its own line. */
export function PdfLink({ url, label }: { url: string; label?: string }) {
  return (
    <Link
      src={url}
      style={{
        color: PDF_BRAND.accent,
        fontSize: 9,
        fontFamily: 'Courier',
        textDecoration: 'underline',
      }}
    >
      {label ?? url}
    </Link>
  )
}

export function PdfPage({ children, size = 'LETTER' }: { children: React.ReactNode; size?: 'A4' | 'LETTER' }) {
  return (
    <Page size={size} style={pdfStyles.page}>
      {children}
    </Page>
  )
}

export function PdfDocument({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Document title={title} author="Remlo" producer="Remlo">
      {children}
    </Document>
  )
}
