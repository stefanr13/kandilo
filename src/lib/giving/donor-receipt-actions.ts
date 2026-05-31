import type {
  FirestoreGivingRecord,
  FirestoreTaxReceiptRecord,
  FirestoreTaxReceiptSummaryRecord,
} from '../db/giving';
import {
  givingHasCorrectablePartialRefundMetadata,
  givingHasPartialRefundSignal,
} from './refund-metadata';
import { normalizedTaxReceiptCurrency } from './receipt-currency';
import { assignedTaxReceiptNumber, hasAssignedTaxReceiptNumber } from './receipt-number';
import { getReceiptYear, isClosedReceiptYear } from './receipt-year';

const PARTIAL_REFUND_REVIEW_REASON = 'stripe_partial_refund_review_required';
const FULL_REFUND_VOID_REASON = 'stripe_full_refund';
const DONOR_PROFILE_INCOMPLETE_ERROR = 'tax_receipt_donor_profile_incomplete';
const MISSING_EMAIL_OR_AMOUNT_ERROR = 'tax_receipt_missing_email_or_amount';
const UNSUPPORTED_JURISDICTION_ERROR = 'tax_receipt_unsupported_jurisdiction';
const RETRYABLE_ANNUAL_ISSUANCE_GAP_ERRORS = new Set([
  DONOR_PROFILE_INCOMPLETE_ERROR,
  MISSING_EMAIL_OR_AMOUNT_ERROR,
]);
const RETRYABLE_ANNUAL_DELIVERY_ERRORS = new Set([
  'resend_api_key_missing',
  'resend_api_key_invalid_format',
  'tax_receipt_pdf_failed',
  'tax_receipt_pdf_retention_failed',
  'tax_receipt_provider_rejected',
  'tax_receipt_preparation_failed',
  'tax_receipt_send_failed',
  'receipt_send_failed',
]);

interface DonorReceiptActionContext {
  activeChurchId: string | null;
  activeChurchTaxReceiptReady: boolean;
  activeChurchTaxReceiptUnsupported?: boolean;
}

export interface DonorGivingReceiptActionAvailability {
  receiptId: string;
  receiptNumber: string;
  hasExistingSendableReceipt: boolean;
  missingAssignedReceiptNumber: boolean;
  invalidCurrency: boolean;
  unsupportedJurisdiction: boolean;
  needsCorrection: boolean;
  coveredByAnnualReceipt: boolean;
  canSendReceipt: boolean;
  canSendCorrectedReceipt: boolean;
}

export interface DonorTaxReceiptActionAvailability {
  unsupportedJurisdiction: boolean;
  missingAssignedReceiptNumber: boolean;
  invalidCurrency: boolean;
  needsReview: boolean;
  actionBlocked: boolean;
  canSendReceipt: boolean;
  canSendCorrectedReceipt: boolean;
}

export interface DonorAnnualReceiptActionAvailability {
  receiptVoided: boolean;
  receiptUnsupportedJurisdiction: boolean;
  receiptMissingAssignedReceiptNumber: boolean;
  receiptInvalidCurrency: boolean;
  receiptDeliveryFailureRetryable: boolean;
  receiptReissueAvailable: boolean;
  receiptSettled: boolean;
  receiptNeedsReview: boolean;
  canSendAnnualReceipt: boolean;
  canSendCorrectedAnnualReceipt: boolean;
}

export interface DonorAnnualReceiptRow {
  key: string;
  churchId: string;
  churchName: string;
  year: number;
  receipt?: FirestoreTaxReceiptRecord;
  summary?: FirestoreTaxReceiptSummaryRecord;
  candidateNeedsReview: boolean;
  candidateHasMixedCurrency: boolean;
  candidateCurrency: string;
  candidateAmountCents: number;
  candidateEligibleAmountCents: number;
  candidateHasPartialRefund: boolean;
  candidateHasEligibleGiving: boolean;
  candidateIncludesPreviouslyReceipted: boolean;
}

type AnnualReceiptRecord = Pick<
  FirestoreTaxReceiptRecord | FirestoreTaxReceiptSummaryRecord,
  'status' | 'amountCents' | 'eligibleAmountCents' | 'correctionRequired' | 'correctionReason' | 'voidReason' | 'emailError'
> & {
  id?: string;
  receiptId?: string;
  receiptNumber?: string;
  jurisdiction?: string;
  currency?: string;
  givingIds?: string[];
};

interface DonorAnnualReceiptCandidateAmounts {
  candidateAmountCents?: number;
  candidateEligibleAmountCents?: number;
  taxReceiptIssuanceUnsupported?: boolean;
}

function receiptIssuanceReadyForChurch(
  churchId: string,
  context: DonorReceiptActionContext
): boolean {
  return Boolean(
    context.activeChurchTaxReceiptReady
    && context.activeChurchId
    && churchId === context.activeChurchId
  );
}

function receiptIssuanceUnsupportedForChurch(
  churchId: string,
  context: DonorReceiptActionContext
): boolean {
  return Boolean(
    context.activeChurchTaxReceiptUnsupported
    && context.activeChurchId
    && churchId === context.activeChurchId
  );
}

export function donorGivingNeedsTaxReceiptCorrection(record: FirestoreGivingRecord): boolean {
  return record.taxReceiptCorrectionRequired
    || Boolean(record.taxReceiptCorrectionReason)
    || givingHasPartialRefundSignal(record);
}

export function donorTaxReceiptNeedsReview(
  receipt: Pick<FirestoreTaxReceiptRecord, 'correctionRequired' | 'correctionReason'>
): boolean {
  return receipt.correctionRequired || Boolean(receipt.correctionReason);
}

function receiptUnsupportedJurisdiction(
  receipt: Pick<FirestoreTaxReceiptRecord, 'jurisdiction' | 'emailError'> | AnnualReceiptRecord | undefined
): boolean {
  if (!receipt) {
    return false;
  }
  const jurisdiction = typeof receipt.jurisdiction === 'string' ? receipt.jurisdiction.trim().toUpperCase() : '';
  return Boolean(
    (jurisdiction && jurisdiction !== 'US')
    || receipt.emailError === UNSUPPORTED_JURISDICTION_ERROR
  );
}

function givingReceiptUnsupportedJurisdiction(
  record: FirestoreGivingRecord,
  matchedReceipt: FirestoreTaxReceiptRecord | undefined,
  context: DonorReceiptActionContext
): boolean {
  return Boolean(
    receiptIssuanceUnsupportedForChurch(record.churchId, context)
    ||
    record.taxReceiptError === UNSUPPORTED_JURISDICTION_ERROR
    || record.taxReceiptEmailError === UNSUPPORTED_JURISDICTION_ERROR
    || receiptUnsupportedJurisdiction(matchedReceipt)
  );
}

function hasPartialRefundCorrectionReason(reason: string): boolean {
  return reason === PARTIAL_REFUND_REVIEW_REASON;
}

function originalAmountCents(record: FirestoreGivingRecord): number {
  return Number.isInteger(record.amountCents) && record.amountCents > 0 ? record.amountCents : 0;
}

function eligibleAmountCentsAfterRefund(record: FirestoreGivingRecord): number {
  const amountCents = originalAmountCents(record);
  if (!givingHasCorrectablePartialRefundMetadata(record)) {
    return amountCents;
  }
  return Math.max(amountCents - record.stripeAmountRefundedCents, 0);
}

function receiptMatchesCurrentPartialRefundCorrection(
  receiptRecord: AnnualReceiptRecord | undefined,
  candidateHasPartialRefund: boolean,
  amounts: DonorAnnualReceiptCandidateAmounts
): boolean {
  if (!candidateHasPartialRefund || receiptRecord === undefined) {
    return false;
  }

  const candidateAmountCents = amounts.candidateAmountCents ?? 0;
  const candidateEligibleAmountCents = amounts.candidateEligibleAmountCents ?? 0;
  return (
    (receiptRecord.status === 'issued' || receiptRecord.status === 'sent')
    && receiptRecord.correctionRequired !== true
    && !receiptRecord.correctionReason
    && hasAssignedTaxReceiptNumber(receiptRecord.receiptNumber)
    && candidateAmountCents > candidateEligibleAmountCents
    && candidateEligibleAmountCents > 0
    && receiptRecord.amountCents === candidateEligibleAmountCents
    && receiptRecord.eligibleAmountCents === candidateEligibleAmountCents
  );
}

function storedAnnualReceiptId(record: AnnualReceiptRecord | undefined): string {
  if (!record) {
    return '';
  }
  if (Array.isArray(record.givingIds)) {
    return record.id ?? '';
  }
  return record.receiptId ?? '';
}

function annualDeliveryFailureRetryable(record: AnnualReceiptRecord | undefined): boolean {
  return Boolean(
    record
    && record.status === 'error'
    && storedAnnualReceiptId(record)
    && hasAssignedTaxReceiptNumber(record.receiptNumber)
    && RETRYABLE_ANNUAL_DELIVERY_ERRORS.has(record.emailError)
  );
}

function annualIssuanceGapRetryable(record: AnnualReceiptRecord | undefined): boolean {
  return Boolean(
    record
    && record.status === 'error'
    && !storedAnnualReceiptId(record)
    && !hasAssignedTaxReceiptNumber(record.receiptNumber)
    && RETRYABLE_ANNUAL_ISSUANCE_GAP_ERRORS.has(record.emailError)
  );
}

export function donorAnnualReceiptRowKey(churchId: string, year: number): string {
  return `${churchId}:${year}`;
}

export function donorGivingReceiptActionAvailability(
  record: FirestoreGivingRecord,
  matchedReceipt: FirestoreTaxReceiptRecord | undefined,
  context: DonorReceiptActionContext,
  coveredByAnnualReceipt = false
): DonorGivingReceiptActionAvailability {
  const receiptId = record.taxReceiptId || matchedReceipt?.id || '';
  const receiptNumber =
    assignedTaxReceiptNumber(record.taxReceiptNumber)
    || assignedTaxReceiptNumber(matchedReceipt?.receiptNumber);
  const needsCorrection = donorGivingNeedsTaxReceiptCorrection(record);
  const unsupportedJurisdiction = givingReceiptUnsupportedJurisdiction(record, matchedReceipt, context);
  const invalidCurrency =
    !normalizedTaxReceiptCurrency(record.currency)
    || (matchedReceipt !== undefined && !normalizedTaxReceiptCurrency(matchedReceipt.currency));
  const hasExistingReceiptState = Boolean(
    receiptId
    || record.taxReceiptStatus === 'issued'
    || record.taxReceiptStatus === 'sent'
    || matchedReceipt?.status === 'issued'
    || matchedReceipt?.status === 'sent'
  );
  const hasExistingSendableReceipt = Boolean(
    receiptNumber
  );
  const missingAssignedReceiptNumber = hasExistingReceiptState && !hasExistingSendableReceipt;
  const canIssueNewReceipt = receiptIssuanceReadyForChurch(record.churchId, context);
  const canSendBase =
    record.status === 'completed'
    && record.taxReceiptStatus !== 'voided';
  const coveredByAnnualReceiptOnly = coveredByAnnualReceipt && !hasExistingSendableReceipt;

  return {
    receiptId,
    receiptNumber,
    hasExistingSendableReceipt,
    missingAssignedReceiptNumber,
    invalidCurrency,
    unsupportedJurisdiction,
    needsCorrection,
    coveredByAnnualReceipt: coveredByAnnualReceiptOnly,
    canSendReceipt:
      canSendBase
      && !unsupportedJurisdiction
      && !invalidCurrency
      && !missingAssignedReceiptNumber
      && !needsCorrection
      && !coveredByAnnualReceiptOnly
      && (hasExistingSendableReceipt || canIssueNewReceipt),
    canSendCorrectedReceipt:
      canSendBase
      && !unsupportedJurisdiction
      && !invalidCurrency
      && needsCorrection
      && givingHasCorrectablePartialRefundMetadata(record)
      && receiptIssuanceReadyForChurch(record.churchId, context),
  };
}

export function donorTaxReceiptActionAvailability(
  receipt: FirestoreTaxReceiptRecord,
  context: DonorReceiptActionContext
): DonorTaxReceiptActionAvailability {
  const needsReview = donorTaxReceiptNeedsReview(receipt);
  const unsupportedJurisdiction =
    receiptIssuanceUnsupportedForChurch(receipt.churchId, context)
    || receiptUnsupportedJurisdiction(receipt);
  const invalidCurrency = !normalizedTaxReceiptCurrency(receipt.currency);
  const missingAssignedReceiptNumber = !hasAssignedTaxReceiptNumber(receipt.receiptNumber);
  const actionBlocked =
    unsupportedJurisdiction
    || invalidCurrency
    || missingAssignedReceiptNumber
    || receipt.status === 'voided'
    || needsReview;

  return {
    unsupportedJurisdiction,
    missingAssignedReceiptNumber,
    invalidCurrency,
    needsReview,
    actionBlocked,
    canSendReceipt:
      Boolean(receipt.givingId)
      && receipt.status !== 'voided'
      && !unsupportedJurisdiction
      && !invalidCurrency
      && !missingAssignedReceiptNumber
      && !needsReview,
    canSendCorrectedReceipt:
      Boolean(receipt.givingId)
      && receipt.status !== 'voided'
      && !unsupportedJurisdiction
      && !invalidCurrency
      && !missingAssignedReceiptNumber
      && needsReview
      && hasPartialRefundCorrectionReason(receipt.correctionReason)
      && receiptIssuanceReadyForChurch(receipt.churchId, context),
  };
}

export function donorAnnualReceiptRows(input: {
  givingRecords: FirestoreGivingRecord[];
  taxReceiptRecords: FirestoreTaxReceiptRecord[];
  annualSummaries: FirestoreTaxReceiptSummaryRecord[];
  churchTimezoneForChurch: (churchId: string) => string;
}): DonorAnnualReceiptRow[] {
  const rows = new Map<string, DonorAnnualReceiptRow>();
  const ensureRow = (churchId: string, year: number, churchName = ''): DonorAnnualReceiptRow => {
    const key = donorAnnualReceiptRowKey(churchId, year);
    const existing = rows.get(key);
    if (existing) {
      if (!existing.churchName && churchName) {
        existing.churchName = churchName;
      }
      return existing;
    }
    const row: DonorAnnualReceiptRow = {
      key,
      churchId,
      churchName,
      year,
      candidateNeedsReview: false,
      candidateHasMixedCurrency: false,
      candidateCurrency: '',
      candidateAmountCents: 0,
      candidateEligibleAmountCents: 0,
      candidateHasPartialRefund: false,
      candidateHasEligibleGiving: false,
      candidateIncludesPreviouslyReceipted: false,
    };
    rows.set(key, row);
    return row;
  };

  for (const record of input.givingRecords) {
    const date = record.completedAt ?? record.createdAt;
    if (
      record.status !== 'completed'
      || !record.churchId
      || !date
    ) {
      continue;
    }

    const churchTimezone = input.churchTimezoneForChurch(record.churchId);
    const year = getReceiptYear(date, churchTimezone);
    if (!isClosedReceiptYear(year, churchTimezone)) {
      continue;
    }

    const row = ensureRow(record.churchId, year, record.churchName);
    const currency = normalizedTaxReceiptCurrency(record.currency);
    if (!currency) {
      row.candidateHasMixedCurrency = true;
    } else if (!row.candidateCurrency) {
      row.candidateCurrency = currency;
    } else if (row.candidateCurrency !== currency) {
      row.candidateHasMixedCurrency = true;
    }
    row.candidateHasEligibleGiving = true;
    row.candidateAmountCents += originalAmountCents(record);
    row.candidateEligibleAmountCents += eligibleAmountCentsAfterRefund(record);
    row.candidateNeedsReview = row.candidateNeedsReview || donorGivingNeedsTaxReceiptCorrection(record);
    row.candidateHasPartialRefund =
      row.candidateHasPartialRefund || givingHasCorrectablePartialRefundMetadata(record);
    row.candidateIncludesPreviouslyReceipted =
      row.candidateIncludesPreviouslyReceipted
      || hasAssignedTaxReceiptNumber(record.taxReceiptNumber);
  }

  for (const receipt of input.taxReceiptRecords) {
    if (
      receipt.kind !== 'annual'
      || receipt.receiptYear === null
      || !receipt.churchId
    ) {
      continue;
    }

    const row = ensureRow(receipt.churchId, receipt.receiptYear, receipt.churchName);
    row.receipt ??= receipt;
  }

  for (const summary of input.annualSummaries) {
    if (
      summary.kind !== 'annual'
      || summary.receiptYear === null
      || !summary.churchId
    ) {
      continue;
    }

    const row = ensureRow(summary.churchId, summary.receiptYear);
    row.summary ??= summary;
  }

  for (const receipt of input.taxReceiptRecords) {
    if (
      receipt.kind !== 'single'
      || receipt.receiptYear === null
      || !receipt.churchId
      || receipt.status === 'voided'
      || !hasAssignedTaxReceiptNumber(receipt.receiptNumber)
    ) {
      continue;
    }

    const row = rows.get(donorAnnualReceiptRowKey(receipt.churchId, receipt.receiptYear));
    if (row) {
      row.candidateIncludesPreviouslyReceipted = true;
    }
  }

  return Array.from(rows.values())
    .sort((a, b) => (
      b.year - a.year
      || a.churchName.localeCompare(b.churchName)
      || a.churchId.localeCompare(b.churchId)
    ));
}

export function donorAnnualReceiptActionAvailability(
  receiptRecord: AnnualReceiptRecord | undefined,
  candidateNeedsReview: boolean,
  candidateHasMixedCurrency: boolean,
  candidateHasPartialRefund: boolean,
  candidateHasEligibleGiving: boolean,
  activeChurchTaxReceiptReady: boolean,
  amounts: DonorAnnualReceiptCandidateAmounts = {}
): DonorAnnualReceiptActionAvailability {
  const receiptVoided = receiptRecord?.status === 'voided';
  const unsupportedJurisdiction = Boolean(
    amounts.taxReceiptIssuanceUnsupported
    || receiptUnsupportedJurisdiction(receiptRecord)
  );
  const invalidCurrency = Boolean(receiptRecord && !normalizedTaxReceiptCurrency(receiptRecord.currency));
  const receiptIssuanceGapRetryable = annualIssuanceGapRetryable(receiptRecord);
  const deliveryFailureRetryable = annualDeliveryFailureRetryable(receiptRecord);
  const receiptHasAssignedReceiptNumber = hasAssignedTaxReceiptNumber(receiptRecord?.receiptNumber);
  const receiptMissingAssignedReceiptNumber = Boolean(
    receiptRecord
    && !receiptHasAssignedReceiptNumber
    && !receiptIssuanceGapRetryable
    && (
      receiptRecord.status === 'issued'
      || receiptRecord.status === 'sent'
      || (receiptRecord.status === 'error' && storedAnnualReceiptId(receiptRecord))
    )
  );
  const partialRefundCorrectionSettled = receiptMatchesCurrentPartialRefundCorrection(
    receiptRecord,
    candidateHasPartialRefund,
    amounts
  );
  const receiptReissueAvailable = Boolean(
    !unsupportedJurisdiction
    && receiptVoided
    && receiptRecord?.voidReason === FULL_REFUND_VOID_REASON
    && candidateHasEligibleGiving
    && !candidateNeedsReview
    && !candidateHasMixedCurrency
    && !candidateHasPartialRefund
    && activeChurchTaxReceiptReady
  );
  const receiptSettled =
    receiptRecord !== undefined
    && (receiptRecord.status === 'issued' || receiptRecord.status === 'sent')
    && !unsupportedJurisdiction
    && !invalidCurrency
    && !receiptVoided
    && receiptHasAssignedReceiptNumber
    && receiptRecord.correctionRequired !== true
    && !receiptRecord.correctionReason;
  const receiptNeedsReview =
    unsupportedJurisdiction
    || invalidCurrency
    || receiptMissingAssignedReceiptNumber
    || (
      !receiptIssuanceGapRetryable
      && !deliveryFailureRetryable
      && (
        receiptRecord?.status === 'error'
        || receiptRecord?.correctionRequired === true
        || Boolean(receiptRecord?.correctionReason)
        || candidateHasMixedCurrency
        || (candidateNeedsReview && !receiptReissueAvailable && !partialRefundCorrectionSettled)
      )
    );
  const canIssuePartialRefundCorrection =
    !unsupportedJurisdiction
    && !invalidCurrency
    && !candidateHasMixedCurrency
    && (
      candidateHasPartialRefund
      || (
        !candidateHasEligibleGiving
        && hasPartialRefundCorrectionReason(receiptRecord?.correctionReason ?? '')
      )
    );

  return {
    receiptVoided,
    receiptUnsupportedJurisdiction: unsupportedJurisdiction,
    receiptMissingAssignedReceiptNumber,
    receiptInvalidCurrency: invalidCurrency,
    receiptDeliveryFailureRetryable: deliveryFailureRetryable,
    receiptReissueAvailable,
    receiptSettled,
    receiptNeedsReview,
    canSendCorrectedAnnualReceipt:
      (receiptNeedsReview || receiptIssuanceGapRetryable)
      && !receiptVoided
      && activeChurchTaxReceiptReady
      && canIssuePartialRefundCorrection,
    canSendAnnualReceipt:
      !unsupportedJurisdiction
      && !invalidCurrency
      && !candidateHasMixedCurrency
      && (!candidateHasPartialRefund || partialRefundCorrectionSettled)
      && (
        receiptReissueAvailable
        || (
          !receiptNeedsReview
          && !receiptVoided
          && (activeChurchTaxReceiptReady || receiptSettled || deliveryFailureRetryable)
        )
      ),
  };
}
