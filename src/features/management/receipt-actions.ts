import type { FirestoreGivingRecord, FirestoreTaxReceiptSummaryRecord } from '../../lib/db/giving';
import {
  givingHasCorrectablePartialRefundMetadata,
  givingHasPartialRefundSignal,
} from '../../lib/giving/refund-metadata';
import { normalizedTaxReceiptCurrency } from '../../lib/giving/receipt-currency';
import { hasAssignedTaxReceiptNumber } from '../../lib/giving/receipt-number';

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

export interface GivingReceiptActionAvailability {
  hasExistingSendableReceipt: boolean;
  missingAssignedReceiptNumber: boolean;
  invalidCurrency: boolean;
  unsupportedJurisdiction: boolean;
  needsCorrection: boolean;
  coveredByAnnualReceipt: boolean;
  canSendReceipt: boolean;
  canSendCorrectedReceipt: boolean;
}

export interface AnnualReceiptActionAvailability {
  summaryVoided: boolean;
  summaryUnsupportedJurisdiction: boolean;
  summaryMissingAssignedReceiptNumber: boolean;
  summaryInvalidCurrency: boolean;
  summaryDeliveryFailureRetryable: boolean;
  summaryReissueAvailable: boolean;
  summarySettled: boolean;
  summaryNeedsReview: boolean;
  canSendAnnualReceipt: boolean;
  canSendCorrectedAnnualReceipt: boolean;
}

interface AnnualReceiptCandidateAmounts {
  candidateAmountCents?: number;
  candidateEligibleAmountCents?: number;
  taxReceiptIssuanceUnsupported?: boolean;
}

function hasPartialRefundCorrectionReason(reason: string): boolean {
  return reason === PARTIAL_REFUND_REVIEW_REASON;
}

function givingUnsupportedJurisdiction(record: FirestoreGivingRecord): boolean {
  return record.taxReceiptError === UNSUPPORTED_JURISDICTION_ERROR
    || record.taxReceiptEmailError === UNSUPPORTED_JURISDICTION_ERROR;
}

function summaryUnsupportedJurisdiction(summary: FirestoreTaxReceiptSummaryRecord | undefined): boolean {
  if (!summary) {
    return false;
  }
  const jurisdiction = summary.jurisdiction.trim().toUpperCase();
  return Boolean(
    (jurisdiction && jurisdiction !== 'US')
    || summary.emailError === UNSUPPORTED_JURISDICTION_ERROR
  );
}

function summaryInvalidCurrency(summary: FirestoreTaxReceiptSummaryRecord | undefined): boolean {
  return Boolean(summary && !normalizedTaxReceiptCurrency(summary.currency));
}

function summaryMatchesCurrentPartialRefundCorrection(
  summary: FirestoreTaxReceiptSummaryRecord | undefined,
  candidateHasPartialRefund: boolean,
  amounts: AnnualReceiptCandidateAmounts
): boolean {
  if (!candidateHasPartialRefund || summary === undefined) {
    return false;
  }

  const candidateAmountCents = amounts.candidateAmountCents ?? 0;
  const candidateEligibleAmountCents = amounts.candidateEligibleAmountCents ?? 0;
  return (
    (summary.status === 'issued' || summary.status === 'sent')
    && summary.correctionRequired !== true
    && !summary.correctionReason
    && hasAssignedTaxReceiptNumber(summary.receiptNumber)
    && candidateAmountCents > candidateEligibleAmountCents
    && candidateEligibleAmountCents > 0
    && summary.amountCents === candidateEligibleAmountCents
    && summary.eligibleAmountCents === candidateEligibleAmountCents
  );
}

function annualSummaryDeliveryFailureRetryable(summary: FirestoreTaxReceiptSummaryRecord | undefined): boolean {
  return Boolean(
    summary
    && summary.status === 'error'
    && summary.receiptId
    && hasAssignedTaxReceiptNumber(summary.receiptNumber)
    && RETRYABLE_ANNUAL_DELIVERY_ERRORS.has(summary.emailError)
  );
}

function annualSummaryIssuanceGapRetryable(summary: FirestoreTaxReceiptSummaryRecord | undefined): boolean {
  return Boolean(
    summary
    && summary.status === 'error'
    && !summary.receiptId
    && !hasAssignedTaxReceiptNumber(summary.receiptNumber)
    && RETRYABLE_ANNUAL_ISSUANCE_GAP_ERRORS.has(summary.emailError)
  );
}

export function givingNeedsTaxReceiptCorrection(record: FirestoreGivingRecord): boolean {
  return record.taxReceiptCorrectionRequired
    || Boolean(record.taxReceiptCorrectionReason)
    || givingHasPartialRefundSignal(record);
}

export function givingHasExistingSendableReceipt(record: FirestoreGivingRecord): boolean {
  return hasAssignedTaxReceiptNumber(record.taxReceiptNumber);
}

export function givingReceiptActionAvailability(
  record: FirestoreGivingRecord,
  taxReceiptIssuanceReady: boolean,
  coveredByAnnualReceipt = false,
  taxReceiptIssuanceUnsupported = false
): GivingReceiptActionAvailability {
  const needsCorrection = givingNeedsTaxReceiptCorrection(record);
  const unsupportedJurisdiction = taxReceiptIssuanceUnsupported || givingUnsupportedJurisdiction(record);
  const invalidCurrency = !normalizedTaxReceiptCurrency(record.currency);
  const hasExistingSendableReceipt = givingHasExistingSendableReceipt(record);
  const missingAssignedReceiptNumber = Boolean(
    !hasExistingSendableReceipt
    && (
      record.taxReceiptId
      || record.taxReceiptStatus === 'issued'
      || record.taxReceiptStatus === 'sent'
    )
  );
  const coveredByAnnualReceiptOnly = coveredByAnnualReceipt && !hasExistingSendableReceipt;

  return {
    hasExistingSendableReceipt,
    missingAssignedReceiptNumber,
    invalidCurrency,
    unsupportedJurisdiction,
    needsCorrection,
    coveredByAnnualReceipt: coveredByAnnualReceiptOnly,
    canSendReceipt:
      record.status === 'completed'
      && (taxReceiptIssuanceReady || hasExistingSendableReceipt)
      && record.taxReceiptStatus !== 'voided'
      && !unsupportedJurisdiction
      && !invalidCurrency
      && !missingAssignedReceiptNumber
      && !needsCorrection
      && !coveredByAnnualReceiptOnly,
    canSendCorrectedReceipt:
      record.status === 'completed'
      && taxReceiptIssuanceReady
      && record.taxReceiptStatus !== 'voided'
      && !unsupportedJurisdiction
      && !invalidCurrency
      && needsCorrection
      && givingHasCorrectablePartialRefundMetadata(record),
  };
}

export function annualReceiptActionAvailability(
  summary: FirestoreTaxReceiptSummaryRecord | undefined,
  candidateNeedsReview: boolean,
  candidateHasMixedCurrency: boolean,
  candidateHasPartialRefund: boolean,
  candidateHasEligibleGiving: boolean,
  taxReceiptIssuanceReady: boolean,
  amounts: AnnualReceiptCandidateAmounts = {}
): AnnualReceiptActionAvailability {
  const summaryVoided = summary?.status === 'voided';
  const unsupportedJurisdiction = Boolean(
    amounts.taxReceiptIssuanceUnsupported
    || summaryUnsupportedJurisdiction(summary)
  );
  const invalidCurrency = summaryInvalidCurrency(summary);
  const summaryIssuanceGapRetryable = annualSummaryIssuanceGapRetryable(summary);
  const deliveryFailureRetryable = annualSummaryDeliveryFailureRetryable(summary);
  const summaryHasAssignedReceiptNumber = hasAssignedTaxReceiptNumber(summary?.receiptNumber);
  const summaryMissingAssignedReceiptNumber = Boolean(
    summary
    && !summaryHasAssignedReceiptNumber
    && !summaryIssuanceGapRetryable
    && (
      summary.status === 'issued'
      || summary.status === 'sent'
      || (summary.status === 'error' && summary.receiptId)
    )
  );
  const partialRefundCorrectionSettled = summaryMatchesCurrentPartialRefundCorrection(
    summary,
    candidateHasPartialRefund,
    amounts
  );
  const summaryReissueAvailable = Boolean(
    !unsupportedJurisdiction
    && summaryVoided
    && summary?.voidReason === FULL_REFUND_VOID_REASON
    && candidateHasEligibleGiving
    && !candidateNeedsReview
    && !candidateHasMixedCurrency
    && !candidateHasPartialRefund
    && taxReceiptIssuanceReady
  );
  const summarySettled =
    summary !== undefined
    && (summary.status === 'issued' || summary.status === 'sent')
    && !unsupportedJurisdiction
    && !invalidCurrency
    && !summaryVoided
    && summaryHasAssignedReceiptNumber
    && summary.correctionRequired !== true
    && !summary.correctionReason;
  const summaryNeedsReview =
    unsupportedJurisdiction
    || invalidCurrency
    || summaryMissingAssignedReceiptNumber
    || (
      !summaryIssuanceGapRetryable
      && !deliveryFailureRetryable
      && (
        summary?.status === 'error'
        || summary?.correctionRequired === true
        || Boolean(summary?.correctionReason)
        || candidateHasMixedCurrency
        || (candidateNeedsReview && !summaryReissueAvailable && !partialRefundCorrectionSettled)
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
        && hasPartialRefundCorrectionReason(summary?.correctionReason ?? '')
      )
    );

  return {
    summaryVoided,
    summaryUnsupportedJurisdiction: unsupportedJurisdiction,
    summaryMissingAssignedReceiptNumber,
    summaryInvalidCurrency: invalidCurrency,
    summaryDeliveryFailureRetryable: deliveryFailureRetryable,
    summaryReissueAvailable,
    summarySettled,
    summaryNeedsReview,
    canSendCorrectedAnnualReceipt:
      (summaryNeedsReview || summaryIssuanceGapRetryable)
      && !summaryVoided
      && taxReceiptIssuanceReady
      && canIssuePartialRefundCorrection,
    canSendAnnualReceipt:
      !unsupportedJurisdiction
      && !invalidCurrency
      && !candidateHasMixedCurrency
      && (!candidateHasPartialRefund || partialRefundCorrectionSettled)
      && (
        summaryReissueAvailable
        || (
          !summaryNeedsReview
          && !summaryVoided
          && (taxReceiptIssuanceReady || summarySettled || deliveryFailureRetryable)
        )
      ),
  };
}
