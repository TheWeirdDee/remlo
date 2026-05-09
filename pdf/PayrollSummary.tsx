import * as React from 'react'
import { Text, View } from '@react-pdf/renderer'
import {
  PdfDocument,
  PdfFooter,
  PdfHeader,
  PdfKeyValue,
  PdfLink,
  PdfPage,
  pdfStyles,
} from './_layout'

export interface PayrollSummaryRecipient {
  fullName: string
  email: string | null
  walletAddress: string | null
  amountUsd: number
  status: 'confirmed' | 'pending' | 'failed' | string
  txHash: string | null
}

export interface PayrollSummaryProps {
  /** The employer running this payroll. */
  companyName: string
  /** UUID of the run, displayed truncated in the doc header. */
  runId: string
  /** Status of the payroll run as a whole (not per-recipient). */
  runStatus: 'pending' | 'processing' | 'confirmed' | 'failed' | string
  /** ISO date the run was initiated. */
  createdAtIso: string
  /** Network the payroll executed on. */
  chain: 'tempo' | 'solana' | string
  /** Run-level tx hash (one per run, employees each get the same one for batch payrolls). */
  txHash: string | null
  /** Explorer URL for the run-level tx, if available. */
  explorerUrl: string | null
  /** Settlement time in ms (only present once the run is confirmed). */
  settlementMs: number | null
  /** Total disbursed USD across all recipients. */
  totalAmountUsd: number
  /** Optional Remlo fee amount, if you display it on the doc. */
  feeUsd?: number | null
  recipients: ReadonlyArray<PayrollSummaryRecipient>
}

const STATUS_TINTS: Record<string, { fg: string; bg: string }> = {
  confirmed: { fg: '#059669', bg: '#D1FAE5' },
  pending: { fg: '#D97706', bg: '#FEF3C7' },
  failed: { fg: '#DC2626', bg: '#FEE2E2' },
}

function statusPillStyle(status: string) {
  const tint = STATUS_TINTS[status] ?? STATUS_TINTS.pending
  return [
    pdfStyles.statusPill,
    { backgroundColor: tint.bg, color: tint.fg },
  ]
}

function shortHash(hash: string | null): string {
  if (!hash) return '—'
  if (hash.length <= 18) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

function shortWallet(addr: string | null): string {
  if (!addr) return '—'
  if (addr.length <= 16) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`
}

export function PayrollSummary(props: PayrollSummaryProps): React.ReactElement {
  const fmtUsd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const createdAt = new Date(props.createdAtIso)
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(createdAt)

  const chainLabel =
    props.chain === 'tempo' ? 'Tempo' : props.chain === 'solana' ? 'Solana' : props.chain

  const confirmedCount = props.recipients.filter((r) => r.status === 'confirmed').length
  const pendingCount = props.recipients.filter((r) => r.status === 'pending').length
  const failedCount = props.recipients.filter((r) => r.status === 'failed').length

  return (
    <PdfDocument
      title={`Payroll run · ${props.companyName} · ${dateLabel}`}
    >
      <PdfPage>
        <PdfHeader
          kind="Payroll run"
          title={props.companyName}
          subtitle={`Run #${props.runId.slice(0, 8)} · ${dateLabel} · ${chainLabel}`}
        />

        {/* Summary tile row — 3 columns: total, recipients, settlement */}
        <View style={[pdfStyles.twoColumns, { marginVertical: 14 }]}>
          <View style={[pdfStyles.column, summaryTile]}>
            <Text style={pdfStyles.netLabel}>TOTAL</Text>
            <Text style={[pdfStyles.netAmount, { fontSize: 22 }]}>
              {fmtUsd.format(props.totalAmountUsd)}
            </Text>
            {typeof props.feeUsd === 'number' && (
              <Text style={pdfStyles.netSub}>Fee {fmtUsd.format(props.feeUsd)}</Text>
            )}
          </View>
          <View style={[pdfStyles.column, summaryTile]}>
            <Text style={pdfStyles.netLabel}>RECIPIENTS</Text>
            <Text style={[pdfStyles.netAmount, { fontSize: 22 }]}>{props.recipients.length}</Text>
            <Text style={pdfStyles.netSub}>
              {confirmedCount} confirmed · {pendingCount} pending · {failedCount} failed
            </Text>
          </View>
          <View style={[pdfStyles.column, summaryTile]}>
            <Text style={pdfStyles.netLabel}>STATUS</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Text style={statusPillStyle(props.runStatus)}>{props.runStatus.toUpperCase()}</Text>
            </View>
            {props.settlementMs && (
              <Text style={pdfStyles.netSub}>
                Settled in {(props.settlementMs / 1000).toFixed(2)}s
              </Text>
            )}
          </View>
        </View>

        {/* On-chain proof */}
        {(props.txHash || props.explorerUrl) && (
          <View style={{ marginVertical: 4 }}>
            <Text style={pdfStyles.sectionLabel}>ON-CHAIN PROOF</Text>
            {props.txHash && <PdfKeyValue label="Run tx" value={props.txHash} mono />}
            {props.explorerUrl && (
              <View style={{ marginTop: 4 }}>
                <PdfLink url={props.explorerUrl} />
              </View>
            )}
          </View>
        )}

        <View style={pdfStyles.rule} />

        {/* Recipient table */}
        <Text style={pdfStyles.sectionLabel}>RECIPIENTS</Text>
        <View style={pdfStyles.table}>
          <View style={pdfStyles.tHeadRow}>
            <Text style={[pdfStyles.tHeadCell, { flex: 3 }]}>Recipient</Text>
            <Text style={[pdfStyles.tHeadCell, { flex: 2 }]}>Wallet</Text>
            <Text style={[pdfStyles.tHeadCell, { flex: 1.4, textAlign: 'right' }]}>
              Amount
            </Text>
            <Text style={[pdfStyles.tHeadCell, { flex: 1.2 }]}>Status</Text>
            <Text style={[pdfStyles.tHeadCell, { flex: 1.6 }]}>Tx</Text>
          </View>
          {props.recipients.map((r, idx) => {
            const isLast = idx === props.recipients.length - 1
            return (
              <View key={idx} style={isLast ? pdfStyles.tBodyRowLast : pdfStyles.tBodyRow} wrap={false}>
                <View style={[pdfStyles.tBodyCell, { flex: 3 }]}>
                  <Text style={{ fontFamily: 'Helvetica-Bold' }}>{r.fullName}</Text>
                  {r.email && (
                    <Text style={{ fontSize: 8, color: '#94A3B8', marginTop: 1 }}>{r.email}</Text>
                  )}
                </View>
                <Text style={[pdfStyles.tBodyCell, { flex: 2, fontFamily: 'Courier', fontSize: 8 }]}>
                  {shortWallet(r.walletAddress)}
                </Text>
                <Text
                  style={[
                    pdfStyles.tBodyCell,
                    { flex: 1.4, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
                  ]}
                >
                  {fmtUsd.format(r.amountUsd)}
                </Text>
                <View style={[pdfStyles.tBodyCell, { flex: 1.2 }]}>
                  <Text style={statusPillStyle(r.status)}>{r.status.toUpperCase()}</Text>
                </View>
                <Text
                  style={[pdfStyles.tBodyCell, { flex: 1.6, fontFamily: 'Courier', fontSize: 8 }]}
                >
                  {shortHash(r.txHash)}
                </Text>
              </View>
            )
          })}
        </View>

        <PdfFooter
          verifyHint={
            props.explorerUrl
              ? 'Run is verifiable on-chain at the explorer URL above.'
              : 'On-chain proof becomes available once the run is broadcast.'
          }
        />
      </PdfPage>
    </PdfDocument>
  )
}

const summaryTile = {
  backgroundColor: '#F8FAFC',
  borderWidth: 1,
  borderColor: '#E2E8F0',
  borderRadius: 6,
  padding: 12,
}
