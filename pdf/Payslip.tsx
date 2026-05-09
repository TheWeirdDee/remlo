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

export interface PayslipProps {
  /** Pay period label, e.g. "May 2026". Falls back to settlement month. */
  payPeriodLabel: string
  /** ISO date the payment settled (used as pay date). */
  settledAtIso: string
  /** Net amount after any deductions. Today there are no deductions, so net == gross. */
  amountUsd: number
  currency: 'USD' | string
  employer: {
    companyName: string
    ownerEmail?: string | null
  }
  employee: {
    fullName: string
    email: string
    employeeId: string
    countryCode?: string | null
  }
  /** "Salary" / cost-center / line item description if available. */
  description?: string | null
  /** On-chain proof. */
  payment: {
    chain: 'tempo' | 'solana' | string
    txHash: string | null
    explorerUrl: string | null
    settlementMs: number | null
    blockNumber?: number | null
  }
  /** Internal payroll run ID — useful if the employee asks support to cross-reference. */
  payrollRunId: string
  paymentItemId: string
}

export function Payslip(props: PayslipProps): React.ReactElement {
  const fmtUsd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: props.currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const settledAt = new Date(props.settledAtIso)
  const payDateFormatted = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(settledAt)

  const chainLabel =
    props.payment.chain === 'tempo'
      ? 'Tempo'
      : props.payment.chain === 'solana'
        ? 'Solana'
        : props.payment.chain

  return (
    <PdfDocument title={`Payslip · ${props.employee.fullName} · ${props.payPeriodLabel}`}>
      <PdfPage>
        <PdfHeader
          kind="Payslip"
          title={`${props.payPeriodLabel} earnings`}
          subtitle={`Pay date ${payDateFormatted}${props.payment.settlementMs ? ` · settled in ${(props.payment.settlementMs / 1000).toFixed(2)}s` : ''}`}
        />

        {/* Net pay block — the headline number an employee actually cares about */}
        <View style={pdfStyles.netCard}>
          <Text style={pdfStyles.netLabel}>NET PAY</Text>
          <Text style={pdfStyles.netAmount}>{fmtUsd.format(props.amountUsd)}</Text>
          <Text style={pdfStyles.netSub}>
            {props.description ?? 'Salary payment'} · paid in {chainLabel} stablecoin
          </Text>
        </View>

        {/* Parties block */}
        <View style={pdfStyles.twoColumns}>
          <View style={pdfStyles.column}>
            <Text style={pdfStyles.sectionLabel}>EMPLOYER</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 11 }}>
              {props.employer.companyName}
            </Text>
            {props.employer.ownerEmail && (
              <Text style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
                {props.employer.ownerEmail}
              </Text>
            )}
          </View>
          <View style={pdfStyles.column}>
            <Text style={pdfStyles.sectionLabel}>EMPLOYEE</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 11 }}>{props.employee.fullName}</Text>
            <Text style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>{props.employee.email}</Text>
            {props.employee.countryCode && (
              <Text style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
                Country · {props.employee.countryCode.toUpperCase()}
              </Text>
            )}
          </View>
        </View>

        <View style={pdfStyles.rule} />

        {/* Earnings line items. Today there's only a single line, but the table
            shape is here so future deductions / multi-line earnings drop in
            without redesigning the doc. */}
        <Text style={pdfStyles.sectionLabel}>EARNINGS</Text>
        <View style={pdfStyles.table}>
          <View style={pdfStyles.tHeadRow}>
            <Text style={[pdfStyles.tHeadCell, { flex: 3 }]}>Description</Text>
            <Text style={[pdfStyles.tHeadCell, { flex: 1, textAlign: 'right' }]}>Amount</Text>
          </View>
          <View style={pdfStyles.tBodyRow}>
            <Text style={[pdfStyles.tBodyCell, { flex: 3 }]}>
              {props.description ?? 'Salary payment'}
            </Text>
            <Text
              style={[
                pdfStyles.tBodyCell,
                { flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
              ]}
            >
              {fmtUsd.format(props.amountUsd)}
            </Text>
          </View>
          <View style={[pdfStyles.tBodyRowLast, { backgroundColor: '#F8FAFC' }]}>
            <Text style={[pdfStyles.tBodyCell, { flex: 3, fontFamily: 'Helvetica-Bold' }]}>
              Total
            </Text>
            <Text
              style={[
                pdfStyles.tBodyCell,
                { flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
              ]}
            >
              {fmtUsd.format(props.amountUsd)}
            </Text>
          </View>
        </View>

        <View style={pdfStyles.rule} />

        {/* On-chain proof — the differentiator. Anyone reading this PDF can
            verify it themselves on the explorer. */}
        <Text style={pdfStyles.sectionLabel}>PAYMENT PROOF</Text>
        <PdfKeyValue label="Network" value={chainLabel} />
        {props.payment.txHash && (
          <PdfKeyValue label="Transaction hash" value={props.payment.txHash} mono />
        )}
        {props.payment.blockNumber && (
          <PdfKeyValue label="Block" value={`#${props.payment.blockNumber}`} mono />
        )}
        {props.payment.settlementMs && (
          <PdfKeyValue
            label="Settlement time"
            value={`${(props.payment.settlementMs / 1000).toFixed(2)}s`}
          />
        )}
        <PdfKeyValue label="Pay run" value={props.payrollRunId.slice(0, 8) + '…'} mono />
        {props.payment.explorerUrl && (
          <View style={{ marginTop: 6 }}>
            <Text style={pdfStyles.kvLabel}>Verify on explorer</Text>
            <View style={{ marginTop: 2 }}>
              <PdfLink url={props.payment.explorerUrl} />
            </View>
          </View>
        )}

        <PdfFooter
          verifyHint={
            props.payment.explorerUrl
              ? 'Verify this payslip cryptographically at the explorer URL above.'
              : 'On-chain settlement pending — re-download once confirmed for the verification link.'
          }
        />
      </PdfPage>
    </PdfDocument>
  )
}
