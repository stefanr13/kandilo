import { useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, ReceiptText, Send } from 'lucide-react';
import type { ChurchStripeConnectSetupStatus, Language } from '../../types';
import type { TaxReceiptIssuanceState } from '../../domain/church';
import type { FirestoreGivingRecord, FirestoreTaxReceiptSummaryRecord } from '../../lib/db/giving';
import { getReceiptYear, getRecentClosedReceiptYears, isClosedReceiptYear } from '../../lib/giving/receipt-year';
import { receiptDeliveryErrorMessage, type ReceiptDeliveryErrorMessages } from '../../lib/giving/receipt-errors';
import { givingHasCorrectablePartialRefundMetadata } from '../../lib/giving/refund-metadata';
import { formatTaxReceiptAmount, normalizedTaxReceiptCurrency } from '../../lib/giving/receipt-currency';
import { getExtraCopy } from '../../localization/extra';
import {
  annualReceiptActionAvailability,
  givingHasExistingSendableReceipt,
  givingNeedsTaxReceiptCorrection,
  givingReceiptActionAvailability,
} from './receipt-actions';

const DONOR_PROFILE_INCOMPLETE_ERROR = 'tax_receipt_donor_profile_incomplete';
const MISSING_EMAIL_OR_AMOUNT_ERROR = 'tax_receipt_missing_email_or_amount';
const RESERVED_ANONYMOUS_DONOR_LABEL = 'Anonymous donor';

interface AnnualReceiptCandidate {
  userId: string;
  year: number;
  donorLabel: string;
  donorEmail: string;
  donorAnonymous: boolean;
  hasMixedCurrency: boolean;
  amountCents: number;
  eligibleAmountCents: number;
  refundedAmountCents: number;
  currency: string;
  count: number;
  hasCompletedGiving: boolean;
  needsReview: boolean;
  profileIncomplete: boolean;
  hasCorrectablePartialRefund: boolean;
  includesPreviouslyReceipted: boolean;
}

interface ManagementReceiptsTabProps {
  records: FirestoreGivingRecord[];
  annualSummaries: FirestoreTaxReceiptSummaryRecord[];
  loading: boolean;
  error: string;
  notice: string;
  sendingReceiptId: string | null;
  sendingAnnualReceiptKey: string | null;
  sendingBulkAnnualReceiptYear: number | null;
  sendingBulkCorrectedAnnualReceiptYear: number | null;
  stripeOnboardingLoading: boolean;
  stripeConnectSetupStatus: ChurchStripeConnectSetupStatus | null;
  stripeConnectSetupStatusLoading: boolean;
  canManageReceipts: boolean;
  taxReceiptIssuanceState: TaxReceiptIssuanceState;
  taxReceiptIssuanceReady: boolean;
  onOpenStripeConnectOnboarding: () => void;
  onSendReceipt: (givingId: string) => void;
  onSendCorrectedReceipt: (givingId: string) => void;
  onSendAnnualReceipt: (userId: string, year: number, acknowledgePreviouslyReceipted?: boolean) => void;
  onSendCorrectedAnnualReceipt: (userId: string, year: number, acknowledgePreviouslyReceipted?: boolean) => void;
  onSendChurchAnnualReceipts: (year: number, acknowledgePreviouslyReceipted?: boolean) => void;
  onSendChurchCorrectedAnnualReceipts: (year: number, acknowledgePreviouslyReceipted?: boolean) => void;
  language: Language;
  churchTimezone: string;
}

function formatCurrency(amountCents: number, currency: string): string {
  return formatTaxReceiptAmount(amountCents, currency);
}

function normalizedReceiptCurrency(currency: string): string {
  return normalizedTaxReceiptCurrency(currency);
}

function receiptManagerPublicLabelSafe(value: string): boolean {
  const label = value.trim();
  return Boolean(label)
    && label !== RESERVED_ANONYMOUS_DONOR_LABEL
    && !/[^\s@]+@[^\s@]+\.[^\s@]{2,}/i.test(label);
}

function clampRefundedAmount(amountCents: number, refundedAmountCents: number): number {
  return Math.min(Math.max(refundedAmountCents, 0), amountCents);
}

function eligibleAmountAfterRefund(amountCents: number, refundedAmountCents: number): number {
  return Math.max(amountCents - clampRefundedAmount(amountCents, refundedAmountCents), 0);
}

function givingRefundedAmount(record: FirestoreGivingRecord): number {
  return clampRefundedAmount(record.amountCents, record.stripeAmountRefundedCents);
}

function formatDate(record: FirestoreGivingRecord): string {
  const date = record.completedAt ?? record.createdAt;
  return date
    ? date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '-';
}

export default function ManagementReceiptsTab({
  records,
  annualSummaries,
  loading,
  error,
  notice,
  sendingReceiptId,
  sendingAnnualReceiptKey,
  sendingBulkAnnualReceiptYear,
  sendingBulkCorrectedAnnualReceiptYear,
  stripeOnboardingLoading,
  stripeConnectSetupStatus,
  stripeConnectSetupStatusLoading,
  canManageReceipts,
  taxReceiptIssuanceState,
  taxReceiptIssuanceReady,
  onOpenStripeConnectOnboarding,
  onSendReceipt,
  onSendCorrectedReceipt,
  onSendAnnualReceipt,
  onSendCorrectedAnnualReceipt,
  onSendChurchAnnualReceipts,
  onSendChurchCorrectedAnnualReceipts,
  language,
  churchTimezone,
}: ManagementReceiptsTabProps) {
  const t = getExtraCopy(language).management.receipts;
  const receiptDeliveryErrorMessages: ReceiptDeliveryErrorMessages = {
    fallback: t.sendError,
    emailNotConfigured: t.emailNotConfigured,
    emailInvalidConfiguration: t.emailInvalidConfiguration,
    missingEmailOrAmount: t.missingEmailOrAmount,
    missingDonorProfile: t.missingDonorProfile,
    pdfFailed: t.pdfFailed,
    providerRejected: t.providerRejected,
    genericIssue: t.genericIssue,
    setupRequired: t.setupRequired,
    unsupportedJurisdiction: t.unsupportedJurisdiction,
    previouslyReceiptedAckRequired: t.previouslyReceiptedAckRequired,
    partialRefundReview: t.partialRefundReview,
    singleIncludedInAnnual: t.singleIncludedInAnnual,
    singleGivingChanged: t.singleGivingChanged,
    annualGivingChanged: t.annualGivingChanged,
    annualMixedCurrency: t.annualMixedCurrency,
  };
  const [pendingBulkSend, setPendingBulkSend] = useState<{
    kind: 'annual' | 'correctedAnnual';
    year: number;
  } | null>(null);
  const [pendingAnnualSend, setPendingAnnualSend] = useState<{
    kind: 'annual' | 'correctedAnnual';
    key: string;
  } | null>(null);
  const stripeConnectAccountConfigured = stripeConnectSetupStatus?.stripeConnectAccountConfigured;
  const stripeConnectRoutingEnabled = stripeConnectSetupStatus?.stripeConnectRoutingEnabled === true;
  const stripeOnboardingDisabled =
    stripeOnboardingLoading || stripeConnectSetupStatusLoading || stripeConnectAccountConfigured !== true;
  const stripeSetupStatusLabel = stripeConnectSetupStatusLoading
    ? t.stripeSetupChecking
    : stripeConnectAccountConfigured === false
      ? t.stripeSetupMissing
      : stripeConnectAccountConfigured === true
        ? stripeConnectRoutingEnabled
          ? t.stripeRoutingEnabled
          : t.stripeRoutingPending
        : t.stripeSetupUnknown;
  const setupRequiredMessage = taxReceiptIssuanceState === 'unsupported_jurisdiction'
    ? t.unsupportedJurisdictionSetupRequired
    : t.setupRequired;
  const notConfiguredLabel = taxReceiptIssuanceState === 'unsupported_jurisdiction'
    ? t.unsupportedJurisdiction
    : t.notConfigured;
  const churchVisibleRecords = records.filter((record) => (
    record.anonymous === false
    && record.churchReceiptVisible === true
    && record.donorEmail === ''
    && record.donorNamePublicSafe === true
    && record.receiptManagerGivingSafeVersion === 1
    && receiptManagerPublicLabelSafe(record.donorName)
    && (record.status === 'completed' || record.status === 'refunded')
  ));
  const churchVisibleAnnualSummaries = annualSummaries.filter((summary) => (
    summary.donorAnonymous === false
    && summary.churchReceiptVisible === true
    && summary.donorLabelPublicSafe === true
    && receiptManagerPublicLabelSafe(summary.donorLabel)
    && summary.receiptManagerSummarySafe === true
    && summary.receiptManagerSummarySafeVersion === 2
  ));
  const completedRecords = churchVisibleRecords.filter((record) => record.status === 'completed');
  const receiptRecords = churchVisibleRecords.filter(
    (record) => record.status === 'completed' || record.taxReceiptStatus === 'voided'
  );
  const annualSummaryByDonorYear = new Map<string, FirestoreTaxReceiptSummaryRecord>();
  for (const summary of churchVisibleAnnualSummaries) {
    if (summary.kind !== 'annual' || summary.receiptYear === null || !summary.userId) {
      continue;
    }
    const key = `${summary.userId}:${summary.receiptYear}`;
    if (!annualSummaryByDonorYear.has(key)) {
      annualSummaryByDonorYear.set(key, summary);
    }
  }
  const annualCandidateByDonorYear = completedRecords.reduce((map, record) => {
    const date = record.completedAt ?? record.createdAt;
    if (!record.userId || !date) {
      return map;
    }
    const year = getReceiptYear(date, churchTimezone);
    if (!isClosedReceiptYear(year, churchTimezone)) {
      return map;
    }
    const key = `${record.userId}:${year}`;
    const initialCurrency = normalizedReceiptCurrency(record.currency);
    const current = map.get(key) ?? {
      userId: record.userId,
      year,
      donorLabel: record.anonymous
        ? t.anonymousDonor
        : record.donorName || t.unknownDonor,
      donorEmail: record.anonymous ? t.anonymousProtected : t.donorEmailProtected,
      donorAnonymous: record.anonymous,
      hasMixedCurrency: !initialCurrency,
      amountCents: 0,
      eligibleAmountCents: 0,
      refundedAmountCents: 0,
      currency: initialCurrency,
      count: 0,
      hasCompletedGiving: false,
      needsReview: false,
      profileIncomplete: false,
      hasCorrectablePartialRefund: false,
      includesPreviouslyReceipted: false,
    };
    if (record.anonymous) {
      current.donorLabel = t.anonymousDonor;
      current.donorEmail = t.anonymousProtected;
      current.donorAnonymous = true;
    }
    const recordCurrency = normalizedReceiptCurrency(record.currency);
    if (!recordCurrency) {
      current.hasMixedCurrency = true;
    } else if (!current.currency) {
      current.currency = recordCurrency;
    } else if (current.currency !== recordCurrency) {
      current.hasMixedCurrency = true;
    }
    const refundedAmountCents = givingRefundedAmount(record);
    current.amountCents += record.amountCents;
    current.refundedAmountCents += refundedAmountCents;
    current.eligibleAmountCents += eligibleAmountAfterRefund(record.amountCents, refundedAmountCents);
    current.count += 1;
    current.hasCompletedGiving = true;
    current.needsReview = current.needsReview || givingNeedsTaxReceiptCorrection(record);
    current.hasCorrectablePartialRefund =
      current.hasCorrectablePartialRefund || givingHasCorrectablePartialRefundMetadata(record);
    current.profileIncomplete = current.profileIncomplete
      || record.taxReceiptError === DONOR_PROFILE_INCOMPLETE_ERROR
      || record.taxReceiptEmailError === DONOR_PROFILE_INCOMPLETE_ERROR;
    current.includesPreviouslyReceipted =
      current.includesPreviouslyReceipted
      || givingHasExistingSendableReceipt(record);
    map.set(key, current);
    return map;
  }, new Map<string, AnnualReceiptCandidate>());
  for (const summary of churchVisibleAnnualSummaries) {
    if (summary.kind !== 'annual' || summary.receiptYear === null || !summary.userId) {
      continue;
    }
    const key = `${summary.userId}:${summary.receiptYear}`;
    if (annualCandidateByDonorYear.has(key)) {
      continue;
    }
    const summaryCurrency = normalizedReceiptCurrency(summary.currency);
    annualCandidateByDonorYear.set(key, {
      userId: summary.userId,
      year: summary.receiptYear,
      donorLabel: summary.donorAnonymous
        ? t.anonymousDonor
        : summary.donorLabel || t.unknownDonor,
      donorEmail: summary.donorAnonymous ? t.anonymousProtected : t.donorEmailProtected,
      donorAnonymous: summary.donorAnonymous,
      hasMixedCurrency: !summaryCurrency,
      amountCents: summary.amountCents,
      eligibleAmountCents: summary.eligibleAmountCents,
      refundedAmountCents: Math.max(summary.amountCents - summary.eligibleAmountCents, 0),
      currency: summaryCurrency,
      count: summary.donationCount ?? 0,
      hasCompletedGiving: false,
      needsReview: summary.correctionRequired || Boolean(summary.correctionReason) || !summaryCurrency,
      profileIncomplete: summary.emailError === DONOR_PROFILE_INCOMPLETE_ERROR,
      hasCorrectablePartialRefund: false,
      includesPreviouslyReceipted: summary.includesPreviouslyReceipted,
    });
  }
  const annualCandidates = Array.from(annualCandidateByDonorYear.values())
    .sort((a, b) => b.year - a.year || a.donorLabel.localeCompare(b.donorLabel));
  const annualYears = Array.from(new Set([
    ...getRecentClosedReceiptYears(churchTimezone),
    ...annualCandidates.map((candidate) => candidate.year),
    ...churchVisibleAnnualSummaries
      .map((summary) => summary.receiptYear)
      .filter((year): year is number => year !== null),
  ]))
    .filter((year) => isClosedReceiptYear(year, churchTimezone))
    .sort((a, b) => b - a);
  const confirmBulkAnnualSend = (year: number) => {
    if (pendingBulkSend?.kind === 'annual' && pendingBulkSend.year === year) {
      setPendingBulkSend(null);
      onSendChurchAnnualReceipts(year, true);
      return;
    }
    setPendingBulkSend({ kind: 'annual', year });
  };
  const confirmBulkCorrectedAnnualSend = (year: number) => {
    if (pendingBulkSend?.kind === 'correctedAnnual' && pendingBulkSend.year === year) {
      setPendingBulkSend(null);
      onSendChurchCorrectedAnnualReceipts(year, true);
      return;
    }
    setPendingBulkSend({ kind: 'correctedAnnual', year });
  };
  const confirmAnnualSend = (
    kind: 'annual' | 'correctedAnnual',
    annualKey: string,
    userId: string,
    year: number,
    needsPreviouslyReceiptedAcknowledgement: boolean
  ) => {
    if (
      needsPreviouslyReceiptedAcknowledgement
      && (pendingAnnualSend?.kind !== kind || pendingAnnualSend.key !== annualKey)
    ) {
      setPendingAnnualSend({ kind, key: annualKey });
      return;
    }

    setPendingAnnualSend(null);
    if (kind === 'correctedAnnual') {
      onSendCorrectedAnnualReceipt(userId, year, needsPreviouslyReceiptedAcknowledgement);
      return;
    }
    onSendAnnualReceipt(userId, year, needsPreviouslyReceiptedAcknowledgement);
  };

  if (!canManageReceipts) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50/30 p-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
            <AlertCircle size={24} />
          </div>
          <h2 className="text-xl font-black text-gray-900">{t.restrictedTitle}</h2>
          <p className="mt-2 text-sm font-medium leading-relaxed text-gray-400">{t.restrictedSub}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 xl:p-8 border-b border-gray-100 bg-white">
        <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
          {t.eyebrow}
        </span>
        <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{t.title}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 xl:p-8 scrollbar-hide bg-gray-50/30">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6 rounded-[32px] border border-gray-100 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#800000]/10 text-[#800000]">
                  <ReceiptText size={24} />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">{t.cardTitle}</h3>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-gray-500">{t.cardSub}</p>
                  <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold leading-relaxed text-amber-800">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <p>{t.staffPrivacyNote}</p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenStripeConnectOnboarding}
                disabled={stripeOnboardingDisabled}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-[#800000] disabled:opacity-60"
              >
                {stripeOnboardingLoading || stripeConnectSetupStatusLoading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ExternalLink size={14} />}
                {stripeOnboardingLoading ? t.openingStripeOnboarding : t.stripeOnboarding}
              </button>
            </div>
            <p className="mt-4 rounded-2xl bg-gray-50 px-4 py-3 text-xs font-bold leading-relaxed text-gray-500">
              {stripeSetupStatusLabel}
            </p>
          </div>

          {notice && (
            <p className="mb-4 rounded-2xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
              {notice}
            </p>
          )}
          {error && (
            <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
              {error}
            </p>
          )}
          {!taxReceiptIssuanceReady && (
            <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold leading-relaxed text-amber-700">
              {setupRequiredMessage}
            </p>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm font-bold text-gray-400">
              <Loader2 size={16} className="animate-spin" />
              {t.loading}
            </div>
          ) : receiptRecords.length === 0 ? (
            <div className="rounded-[32px] border border-dashed border-gray-200 bg-white p-10 text-center">
              <h3 className="text-lg font-black text-gray-900">{t.emptyTitle}</h3>
              <p className="mt-2 text-sm font-medium text-gray-400">{t.emptySub}</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[32px] border border-gray-100 bg-white shadow-sm">
              <div className="hidden grid-cols-[1.2fr_1fr_1fr_1fr_auto] gap-4 border-b border-gray-100 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 lg:grid">
                <span>{t.donor}</span>
                <span>{t.amount}</span>
                <span>{t.received}</span>
                <span>{t.status}</span>
                <span className="text-right">{t.action}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {receiptRecords.map((record) => {
                  const sending = sendingReceiptId === record.id;
                  const recordNeedsCorrection = givingNeedsTaxReceiptCorrection(record);
                  const refundedAmountCents = givingRefundedAmount(record);
                  const netEligibleAmountCents = eligibleAmountAfterRefund(record.amountCents, refundedAmountCents);
                  const receiptDeliveryHelp = receiptDeliveryErrorMessage(
                    record.taxReceiptEmailError || record.taxReceiptError,
                    receiptDeliveryErrorMessages
                  );
                  // Summary mirrors intentionally omit covered giving IDs; the callable performs the exact duplicate guard.
                  const {
                    hasExistingSendableReceipt,
                    invalidCurrency: recordInvalidCurrency,
                    unsupportedJurisdiction: recordUnsupportedJurisdiction,
                    coveredByAnnualReceipt: coveredByAnnualReceiptOnly,
                    canSendReceipt,
                    canSendCorrectedReceipt,
                  } = givingReceiptActionAvailability(
                    record,
                    taxReceiptIssuanceReady,
                    false,
                    taxReceiptIssuanceState === 'unsupported_jurisdiction'
                  );
                  const singleReceiptAlreadySent = record.taxReceiptStatus === 'sent';
                  const donorProfileIncomplete = !hasExistingSendableReceipt && (
                    record.taxReceiptError === DONOR_PROFILE_INCOMPLETE_ERROR
                    || record.taxReceiptEmailError === DONOR_PROFILE_INCOMPLETE_ERROR
                  );
                  const donorLabel = record.anonymous
                    ? t.anonymousDonor
                    : record.donorName || t.unknownDonor;
                  const statusLabel =
                    coveredByAnnualReceiptOnly
                      ? t.includedInAnnual
                    : record.taxReceiptStatus === 'voided'
                      ? t.voided
                    : recordUnsupportedJurisdiction
                      ? t.unsupportedJurisdiction
                    : recordInvalidCurrency
                      ? t.error
                    : record.taxReceiptStatus === 'sent'
                      ? t.sent
                      : record.taxReceiptStatus === 'issued'
                        ? t.issued
                      : donorProfileIncomplete
                        ? t.donorProfileNeeded
                        : record.taxReceiptStatus === 'ready'
                          ? t.ready
                          : record.taxReceiptStatus === 'error' || recordNeedsCorrection || recordInvalidCurrency
                            ? t.error
                            : !taxReceiptIssuanceReady
                              ? notConfiguredLabel
                              : t.ready;

                  return (
                    <div
                      key={record.id}
                      className="grid grid-cols-1 gap-3 px-5 py-5 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] lg:items-center lg:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-gray-900">{donorLabel}</p>
                        <p className="mt-1 truncate text-xs font-bold text-gray-400">
                          {record.anonymous ? t.anonymousProtected : t.donorEmailProtected}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-black text-gray-900">
                          {formatCurrency(
                            refundedAmountCents > 0 ? netEligibleAmountCents : record.amountCents,
                            record.currency
                          )}
                        </p>
                        {refundedAmountCents > 0 && (
                          <div className="mt-1 space-y-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            <p>{t.originalAmount}: {formatCurrency(record.amountCents, record.currency)}</p>
                            <p>{t.refundedAmount}: {formatCurrency(refundedAmountCents, record.currency)}</p>
                            <p>{t.netEligibleAmount}: {formatCurrency(netEligibleAmountCents, record.currency)}</p>
                          </div>
                        )}
                      </div>
                      <p className="text-sm font-bold text-gray-500">{formatDate(record)}</p>
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest text-[#937022]">
                          {statusLabel}
                          {record.taxReceiptNumber ? ` - ${record.taxReceiptNumber}` : ''}
                        </p>
                        {receiptDeliveryHelp && (
                          <p className="mt-2 text-xs font-bold leading-relaxed text-amber-700">
                            {receiptDeliveryHelp}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (canSendCorrectedReceipt) {
                            onSendCorrectedReceipt(record.id);
                          } else {
                            onSendReceipt(record.id);
                          }
                        }}
                        disabled={sending || (!canSendReceipt && !canSendCorrectedReceipt)}
                        className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#800000] px-4 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-[#8D1212] disabled:opacity-60 lg:w-auto"
                      >
                        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        {canSendCorrectedReceipt
                          ? t.sendCorrected
                          : recordUnsupportedJurisdiction
                            ? t.unsupportedJurisdiction
                          : coveredByAnnualReceiptOnly
                            ? t.includedInAnnual
                          : record.taxReceiptStatus === 'voided' || recordNeedsCorrection || recordInvalidCurrency
                            ? record.taxReceiptStatus === 'voided'
                              ? t.voided
                              : t.error
                          : !taxReceiptIssuanceReady && !hasExistingSendableReceipt
                            ? notConfiguredLabel
                          : sending
                            ? t.sending
                            : singleReceiptAlreadySent
                              ? t.resend
                            : donorProfileIncomplete
                              ? t.retrySend
                            : t.send}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && annualYears.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-[32px] border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h3 className="text-base font-black text-gray-900">{t.annualSummaries}</h3>
                <p className="mt-1 text-xs font-bold leading-relaxed text-gray-400">{t.annualSummarySub}</p>
                <p className="mt-2 text-xs font-bold leading-relaxed text-amber-700">{t.annualBatchPrivacyNote}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {annualYears.map((year) => {
                    const sending = sendingBulkAnnualReceiptYear === year;
                    const sendingCorrected = sendingBulkCorrectedAnnualReceiptYear === year;
                    const confirmingAnnual =
                      pendingBulkSend?.kind === 'annual' && pendingBulkSend.year === year;
                    const confirmingCorrectedAnnual =
                      pendingBulkSend?.kind === 'correctedAnnual' && pendingBulkSend.year === year;
                    return (
                      <div key={year} className="flex flex-wrap gap-2">
                        <button
                          onClick={() => confirmBulkAnnualSend(year)}
                          disabled={sending || sendingCorrected || !taxReceiptIssuanceReady}
                          aria-pressed={confirmingAnnual}
                          className={`flex min-h-9 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-all disabled:opacity-60 ${
                            confirmingAnnual
                              ? 'bg-amber-700 hover:bg-amber-800'
                              : 'bg-[#800000] hover:bg-[#8D1212]'
                          }`}
                        >
                          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                          {!taxReceiptIssuanceReady
                            ? notConfiguredLabel
                            : sending
                              ? t.bulkSending
                              : confirmingAnnual
                                ? `${t.confirmSendAllAnnual} ${year}`
                              : `${t.sendAllAnnual} ${year}`}
                        </button>
                        {/* The corrected annual batch is year-wide and privacy-preserving; button presence must not depend on staff-visible donor rows. */}
                        <button
                          onClick={() => confirmBulkCorrectedAnnualSend(year)}
                          disabled={sending || sendingCorrected || !taxReceiptIssuanceReady}
                          aria-pressed={confirmingCorrectedAnnual}
                          className={`flex min-h-9 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-all disabled:opacity-60 ${
                            confirmingCorrectedAnnual
                              ? 'bg-amber-700 hover:bg-amber-800'
                              : 'bg-gray-900 hover:bg-[#800000]'
                          }`}
                        >
                          {sendingCorrected ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                          {!taxReceiptIssuanceReady
                            ? notConfiguredLabel
                            : sendingCorrected
                              ? t.bulkCorrectedSending
                              : confirmingCorrectedAnnual
                                ? `${t.confirmSendAllCorrectedAnnual} ${year}`
                              : `${t.sendAllCorrectedAnnual} ${year}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {pendingBulkSend && (
                  <p className="mt-3 text-xs font-bold leading-relaxed text-amber-700">
                    {t.previouslyReceiptedAckRequired}
                  </p>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {annualCandidates.map((candidate) => {
                  const annualKey = `${candidate.userId}:${candidate.year}`;
                  const sending = sendingAnnualReceiptKey === annualKey;
                  const summary = annualSummaryByDonorYear.get(annualKey);
                  const {
                    summaryVoided,
                    summaryDeliveryFailureRetryable,
                    summaryReissueAvailable,
                    summarySettled,
                    summaryUnsupportedJurisdiction,
                    summaryInvalidCurrency,
                    summaryNeedsReview,
                    canSendCorrectedAnnualReceipt,
                    canSendAnnualReceipt,
                  } = annualReceiptActionAvailability(
                    summary,
                    candidate.needsReview,
                    candidate.hasMixedCurrency,
                    candidate.hasCorrectablePartialRefund,
                    candidate.hasCompletedGiving,
                    taxReceiptIssuanceReady,
                    {
                      candidateAmountCents: candidate.amountCents,
                      candidateEligibleAmountCents: candidate.eligibleAmountCents,
                      taxReceiptIssuanceUnsupported: taxReceiptIssuanceState === 'unsupported_jurisdiction',
                    }
                  );
                  const annualProfileIncomplete =
                    candidate.profileIncomplete || summary?.emailError === DONOR_PROFILE_INCOMPLETE_ERROR;
                  const annualMissingVerifiedEmail = summary?.emailError === MISSING_EMAIL_OR_AMOUNT_ERROR;
                  const summaryStatus =
                    annualProfileIncomplete
                      ? t.donorProfileNeeded
                    : summaryUnsupportedJurisdiction
                      ? t.unsupportedJurisdiction
                    : summaryInvalidCurrency
                      ? t.error
                    : annualMissingVerifiedEmail
                      ? t.ready
                    : summaryReissueAvailable
                      ? t.ready
                    : summaryNeedsReview
                      ? t.error
                      : summaryVoided
                        ? t.voided
                      : summary?.status === 'sent'
                      ? t.sent
                      : summary?.status === 'issued'
                        ? t.issued
                        : summary?.status === 'error'
                          ? t.error
                          : !taxReceiptIssuanceReady
                            ? notConfiguredLabel
                            : t.ready;
                  const receiptDeliveryHelp = receiptDeliveryErrorMessage(
                    summary?.emailError || (candidate.profileIncomplete ? DONOR_PROFILE_INCOMPLETE_ERROR : ''),
                    receiptDeliveryErrorMessages
                  );
                  const annualReceiptAlreadySent = summary?.status === 'sent'
                    && !summaryReissueAvailable
                    && !canSendCorrectedAnnualReceipt;
                  const correctedAnnualReceiptAlreadySent = annualReceiptAlreadySent
                    && summary?.correctedReceipt === true;
                  const needsPreviouslyReceiptedAcknowledgement =
                    candidate.includesPreviouslyReceipted || summary?.includesPreviouslyReceipted === true;
                  const confirmingAnnual =
                    pendingAnnualSend?.kind === 'annual' && pendingAnnualSend.key === annualKey;
                  const confirmingCorrectedAnnual =
                    pendingAnnualSend?.kind === 'correctedAnnual' && pendingAnnualSend.key === annualKey;
                  const confirmingCurrentAction = canSendCorrectedAnnualReceipt
                    ? confirmingCorrectedAnnual
                    : confirmingAnnual;
                  return (
                    <div
                      key={annualKey}
                      className="grid grid-cols-1 gap-3 px-5 py-5 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-center lg:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-gray-900">{candidate.donorLabel}</p>
                        <p className="mt-1 truncate text-xs font-bold text-gray-400">{candidate.donorEmail}</p>
                      </div>
                      <div>
                        <p className="text-sm font-black text-gray-900">
                          {candidate.year} {t.annualSummary}
                        </p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-[#937022]">
                          {summaryStatus}
                          {summary?.receiptNumber && !summaryReissueAvailable ? ` - ${summary.receiptNumber}` : ''}
                        </p>
                        {needsPreviouslyReceiptedAcknowledgement && (
                          <p className="mt-2 text-[10px] font-bold leading-relaxed text-amber-700">
                            {t.includesPreviouslyReceipted}
                          </p>
                        )}
                        {candidate.hasMixedCurrency && (
                          <p className="mt-2 text-[10px] font-bold leading-relaxed text-amber-700">
                            {t.mixedCurrencyAnnualBlocked}
                          </p>
                        )}
                        {receiptDeliveryHelp && (
                          <p className="mt-2 text-xs font-bold leading-relaxed text-amber-700">
                            {receiptDeliveryHelp}
                          </p>
                        )}
                      </div>
                      <div className="text-xs font-black uppercase tracking-widest text-[#937022]">
                        <p>
                          {candidate.hasMixedCurrency
                            ? t.mixedCurrency
                            : formatCurrency(
                              candidate.refundedAmountCents > 0
                                ? candidate.eligibleAmountCents
                                : candidate.amountCents,
                              candidate.currency
                            )}
                          {' / '}
                          {candidate.count}
                        </p>
                        {candidate.refundedAmountCents > 0 && !candidate.hasMixedCurrency && (
                          <div className="mt-1 space-y-0.5 text-[10px] font-bold text-gray-400">
                            <p>{t.originalAmount}: {formatCurrency(candidate.amountCents, candidate.currency)}</p>
                            <p>{t.refundedAmount}: {formatCurrency(candidate.refundedAmountCents, candidate.currency)}</p>
                            <p>{t.netEligibleAmount}: {formatCurrency(candidate.eligibleAmountCents, candidate.currency)}</p>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (canSendCorrectedAnnualReceipt) {
                            confirmAnnualSend(
                              'correctedAnnual',
                              annualKey,
                              candidate.userId,
                              candidate.year,
                              needsPreviouslyReceiptedAcknowledgement
                            );
                          } else {
                            confirmAnnualSend(
                              'annual',
                              annualKey,
                              candidate.userId,
                              candidate.year,
                              needsPreviouslyReceiptedAcknowledgement
                            );
                          }
                        }}
                        aria-pressed={confirmingCurrentAction}
                        disabled={sending || (!canSendAnnualReceipt && !canSendCorrectedAnnualReceipt)}
                        className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl px-4 text-[10px] font-black uppercase tracking-widest text-white transition-all disabled:opacity-60 lg:w-auto ${
                          confirmingCurrentAction
                            ? 'bg-amber-700 hover:bg-amber-800'
                            : 'bg-gray-900 hover:bg-[#800000]'
                        }`}
                      >
                        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        {canSendCorrectedAnnualReceipt
                          ? confirmingCorrectedAnnual
                            ? t.confirmCorrectedAnnualSend
                            : t.sendCorrected
                          : summaryUnsupportedJurisdiction
                            ? t.unsupportedJurisdiction
                          : summaryReissueAvailable
                            ? confirmingAnnual
                              ? t.confirmAnnualSend
                              : t.sendAnnual
                          : summaryVoided || summaryNeedsReview
                          ? summaryVoided
                            ? t.voided
                            : t.error
                          : !taxReceiptIssuanceReady && !summarySettled
                            ? notConfiguredLabel
                            : sending
                            ? t.sending
                            : annualProfileIncomplete || annualMissingVerifiedEmail
                              ? t.retrySend
                            : summaryDeliveryFailureRetryable
                              ? t.retrySend
                            : confirmingAnnual
                              ? t.confirmAnnualSend
                              : annualReceiptAlreadySent
                                ? correctedAnnualReceiptAlreadySent
                                  ? t.resendCorrectedAnnual
                                  : t.resendAnnual
                              : t.sendAnnual}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
