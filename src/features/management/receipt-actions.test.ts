import { describe, expect, it } from 'vitest';
import type { FirestoreGivingRecord, FirestoreTaxReceiptSummaryRecord } from '../../lib/db/giving';
import {
  annualReceiptActionAvailability,
  givingReceiptActionAvailability,
} from './receipt-actions';

function givingRecord(overrides: Partial<FirestoreGivingRecord> = {}): FirestoreGivingRecord {
  return {
    id: 'giving-1',
    churchId: 'church-1',
    churchName: 'St. Nicholas',
    userId: 'member-1',
    donorName: 'Member One',
    donorEmail: '',
    donorNamePublicSafe: true,
    churchReceiptVisible: true,
    receiptManagerGivingSafeVersion: 1,
    amountCents: 5000,
    amount: 50,
    currency: 'USD',
    purpose: 'General Fund',
    anonymous: false,
    status: 'completed',
    stripeRefundStatus: '',
    stripeAmountRefundedCents: 0,
    createdAt: null,
    completedAt: null,
    taxReceiptId: '',
    taxReceiptNumber: '',
    taxReceiptStatus: 'ready',
    taxReceiptError: '',
    taxReceiptEmailError: '',
    taxReceiptCorrectionRequired: false,
    taxReceiptCorrectionReason: '',
    ...overrides,
  };
}

function annualSummary(
  overrides: Partial<FirestoreTaxReceiptSummaryRecord> = {}
): FirestoreTaxReceiptSummaryRecord {
  return {
    id: 'annual-1',
    receiptId: 'annual-1',
    churchId: 'church-1',
    userId: 'member-1',
    donorLabel: 'Member One',
    donorAnonymous: false,
    churchReceiptVisible: true,
    donorLabelPublicSafe: true,
    receiptManagerSummarySafe: true,
    receiptManagerSummarySafeVersion: 2,
    kind: 'annual',
    status: 'sent',
    jurisdiction: 'US',
    receiptYear: 2025,
    receiptNumber: 'STN-2025-000001',
    amountCents: 12000,
    eligibleAmountCents: 12000,
    currency: 'USD',
    donationCount: 3,
    includesPreviouslyReceipted: false,
    issuedAt: null,
    emailSentAt: null,
    emailFailedAt: null,
    emailError: '',
    correctedReceipt: false,
    correctionRequired: false,
    correctionReason: '',
    voidedAt: null,
    voidReason: '',
    ...overrides,
  };
}

describe('receipt action availability', () => {
  it('requires current receipt setup before sending a new single-donation receipt', () => {
    expect(givingReceiptActionAvailability(givingRecord(), false)).toMatchObject({
      hasExistingSendableReceipt: false,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });

    expect(givingReceiptActionAvailability(givingRecord(), true)).toMatchObject({
      hasExistingSendableReceipt: false,
      canSendReceipt: true,
      canSendCorrectedReceipt: false,
    });
  });

  it('allows re-sending existing single-donation receipts when new issuance setup is no longer ready', () => {
    expect(
      givingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'giving-1',
          taxReceiptNumber: 'STN-2026-000001',
          taxReceiptStatus: 'sent',
        }),
        false
      )
    ).toMatchObject({
      hasExistingSendableReceipt: true,
      canSendReceipt: true,
      canSendCorrectedReceipt: false,
    });
  });

  it('does not treat unassigned single receipt numbers as resendable receipt evidence', () => {
    expect(
      givingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'giving-1',
          taxReceiptNumber: 'unassigned',
          taxReceiptStatus: 'sent',
        }),
        true
      )
    ).toMatchObject({
      hasExistingSendableReceipt: false,
      missingAssignedReceiptNumber: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('blocks receipt-manager resends for unsupported-jurisdiction stored single receipts', () => {
    expect(
      givingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'giving-ca',
          taxReceiptNumber: 'CA-2026-000001',
          taxReceiptStatus: 'sent',
          taxReceiptError: 'tax_receipt_unsupported_jurisdiction',
        }),
        true
      )
    ).toMatchObject({
      hasExistingSendableReceipt: true,
      unsupportedJurisdiction: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('blocks receipt-manager legacy single resends when church receipt jurisdiction is unsupported', () => {
    expect(
      givingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'giving-ca',
          taxReceiptNumber: 'CA-2026-000002',
          taxReceiptStatus: 'sent',
        }),
        false,
        false,
        true
      )
    ).toMatchObject({
      hasExistingSendableReceipt: true,
      unsupportedJurisdiction: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('blocks new single-donation sends already covered by a settled annual receipt', () => {
    expect(givingReceiptActionAvailability(givingRecord(), true, true)).toMatchObject({
      hasExistingSendableReceipt: false,
      coveredByAnnualReceipt: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });

    expect(
      givingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'giving-1',
          taxReceiptNumber: 'STN-2025-000123',
          taxReceiptStatus: 'sent',
        }),
        false,
        true
      )
    ).toMatchObject({
      hasExistingSendableReceipt: true,
      coveredByAnnualReceipt: false,
      canSendReceipt: true,
    });
  });

  it('blocks stale single-donation resends after partial refunds until corrected issuance is available', () => {
    const record = givingRecord({
      taxReceiptId: 'giving-1',
      taxReceiptStatus: 'issued',
      taxReceiptCorrectionRequired: true,
      taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1000,
    });

    expect(givingReceiptActionAvailability(record, false)).toMatchObject({
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
    expect(givingReceiptActionAvailability(record, true)).toMatchObject({
      canSendReceipt: false,
      canSendCorrectedReceipt: true,
    });
  });

  it('treats Stripe partial-refund metadata as a correction signal before the review code is mirrored', () => {
    const record = givingRecord({
      taxReceiptStatus: 'ready',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1000,
    });

    expect(givingReceiptActionAvailability(record, false)).toMatchObject({
      needsCorrection: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
    expect(givingReceiptActionAvailability(record, true)).toMatchObject({
      needsCorrection: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: true,
    });
  });

  it('keeps non-correctable Stripe refund metadata on the review-only path', () => {
    for (const record of [
      givingRecord({
        taxReceiptStatus: 'ready',
        stripeRefundStatus: 'partially_refunded',
        stripeAmountRefundedCents: 0,
      }),
      givingRecord({
        taxReceiptStatus: 'ready',
        stripeRefundStatus: '',
        stripeAmountRefundedCents: 5000,
      }),
    ]) {
      expect(givingReceiptActionAvailability(record, true)).toMatchObject({
        needsCorrection: true,
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });
    }
  });

  it('blocks single-donation receipt actions when the giving currency is missing or unsupported', () => {
    for (const currency of ['', 'EUR']) {
      expect(givingReceiptActionAvailability(givingRecord({ currency }), true)).toMatchObject({
        invalidCurrency: true,
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });
    }
  });

  it('allows re-sending settled annual summaries when new issuance setup is no longer ready', () => {
    expect(annualReceiptActionAvailability(annualSummary({ status: 'sent' }), false, false, false, false, false))
      .toMatchObject({
        summarySettled: true,
        summaryNeedsReview: false,
        canSendAnnualReceipt: true,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('does not treat unassigned annual receipt numbers as settled or retryable', () => {
    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'sent',
          receiptNumber: 'unassigned',
        }),
        false,
        false,
        false,
        true,
        true
      )
    ).toMatchObject({
      summaryMissingAssignedReceiptNumber: true,
      summarySettled: false,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });

    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'error',
          receiptId: 'annual-1',
          receiptNumber: 'unassigned',
          emailError: 'tax_receipt_provider_rejected',
        }),
        false,
        false,
        false,
        true,
        true
      )
    ).toMatchObject({
      summaryMissingAssignedReceiptNumber: true,
      summaryDeliveryFailureRetryable: false,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
    });

    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'error',
          receiptId: 'annual-1',
          receiptNumber: '',
          emailError: 'tax_receipt_missing_email_or_amount',
        }),
        false,
        false,
        false,
        true,
        true
      )
    ).toMatchObject({
      summaryMissingAssignedReceiptNumber: true,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks receipt-manager resends for unsupported-jurisdiction annual summaries', () => {
    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'sent',
          emailError: 'tax_receipt_unsupported_jurisdiction',
        }),
        false,
        false,
        false,
        true,
        true
      )
    ).toMatchObject({
      summaryUnsupportedJurisdiction: true,
      summarySettled: false,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks receipt-manager annual summary resends from mirrored summary jurisdiction', () => {
    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'sent',
          jurisdiction: 'CA',
        }),
        false,
        false,
        false,
        true,
        false
      )
    ).toMatchObject({
      summaryUnsupportedJurisdiction: true,
      summarySettled: false,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks receipt-manager legacy annual resends when church receipt jurisdiction is unsupported', () => {
    expect(
      annualReceiptActionAvailability(
        annualSummary({ status: 'sent' }),
        false,
        false,
        false,
        true,
        true,
        { taxReceiptIssuanceUnsupported: true }
      )
    ).toMatchObject({
      summaryUnsupportedJurisdiction: true,
      summarySettled: false,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('keeps donor-profile annual errors retryable only when issuance setup is ready', () => {
    const summary = annualSummary({
      status: 'error',
      receiptId: '',
      receiptNumber: '',
      emailError: 'tax_receipt_donor_profile_incomplete',
    });

    expect(annualReceiptActionAvailability(summary, false, false, false, true, false))
      .toMatchObject({
        summarySettled: false,
        summaryNeedsReview: false,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    expect(annualReceiptActionAvailability(summary, false, false, false, true, true))
      .toMatchObject({
        summarySettled: false,
        summaryNeedsReview: false,
        canSendAnnualReceipt: true,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('keeps verified-email annual retry summaries sendable after account verification', () => {
    const summary = annualSummary({
      status: 'error',
      receiptId: '',
      receiptNumber: '',
      emailError: 'tax_receipt_missing_email_or_amount',
    });

    expect(annualReceiptActionAvailability(summary, false, false, false, true, false))
      .toMatchObject({
        summaryMissingAssignedReceiptNumber: false,
        summaryDeliveryFailureRetryable: false,
        summarySettled: false,
        summaryNeedsReview: false,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    expect(annualReceiptActionAvailability(summary, false, false, false, true, true))
      .toMatchObject({
        summaryMissingAssignedReceiptNumber: false,
        summaryDeliveryFailureRetryable: false,
        summarySettled: false,
        summaryNeedsReview: false,
        canSendAnnualReceipt: true,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('keeps donor-profile corrected annual errors on the corrected-send path', () => {
    const summary = annualSummary({
      status: 'error',
      receiptId: '',
      receiptNumber: '',
      emailError: 'tax_receipt_donor_profile_incomplete',
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });

    expect(annualReceiptActionAvailability(summary, true, false, true, true, true))
      .toMatchObject({
        summarySettled: false,
        summaryNeedsReview: false,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: true,
      });
  });

  it('keeps verified-email corrected annual retry summaries on the corrected-send path', () => {
    const summary = annualSummary({
      status: 'error',
      receiptId: '',
      receiptNumber: '',
      emailError: 'tax_receipt_missing_email_or_amount',
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });

    expect(annualReceiptActionAvailability(summary, true, false, true, true, true))
      .toMatchObject({
        summaryMissingAssignedReceiptNumber: false,
        summarySettled: false,
        summaryNeedsReview: false,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: true,
      });
  });

  it('allows retrying existing annual receipt delivery failures after provider or PDF setup is fixed', () => {
    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'error',
          receiptId: 'annual-1',
          receiptNumber: 'STN-2025-000001',
          emailError: 'tax_receipt_provider_rejected',
        }),
        false,
        false,
        false,
        true,
        false
      )
    ).toMatchObject({
      summarySettled: false,
      summaryDeliveryFailureRetryable: true,
      summaryNeedsReview: false,
      canSendAnnualReceipt: true,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks non-retryable annual error summaries instead of treating them as settled resends', () => {
    expect(annualReceiptActionAvailability(annualSummary({ status: 'error' }), false, false, false, true, false))
      .toMatchObject({
        summarySettled: false,
        summaryDeliveryFailureRetryable: false,
        summaryNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('blocks retryable annual delivery errors when no stored receipt id exists', () => {
    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'error',
          receiptId: '',
          emailError: 'tax_receipt_provider_rejected',
        }),
        false,
        false,
        false,
        true,
        false
      )
    ).toMatchObject({
      summarySettled: false,
      summaryDeliveryFailureRetryable: false,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks settled annual summary resends when current donor-year giving now needs review', () => {
    const summary = annualSummary({ status: 'sent' });

    expect(annualReceiptActionAvailability(summary, true, false, true, true, false))
      .toMatchObject({
        summarySettled: true,
        summaryNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    expect(annualReceiptActionAvailability(summary, true, false, true, true, true))
      .toMatchObject({
        summarySettled: true,
        summaryNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: true,
      });
  });

  it('keeps settled annual partial-refund corrections resendable when they match the current net amount', () => {
    const summary = annualSummary({
      status: 'sent',
      amountCents: 10000,
      eligibleAmountCents: 10000,
      correctionRequired: false,
      correctionReason: '',
    });

    expect(annualReceiptActionAvailability(summary, true, false, true, true, false, {
      candidateAmountCents: 12000,
      candidateEligibleAmountCents: 10000,
    })).toMatchObject({
      summarySettled: true,
      summaryNeedsReview: false,
      canSendAnnualReceipt: true,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('keeps stale annual partial-refund corrections in review when the current net amount changed', () => {
    const summary = annualSummary({
      status: 'sent',
      amountCents: 10000,
      eligibleAmountCents: 10000,
      correctionRequired: false,
      correctionReason: '',
    });

    expect(annualReceiptActionAvailability(summary, true, false, true, true, true, {
      candidateAmountCents: 12000,
      candidateEligibleAmountCents: 9000,
    })).toMatchObject({
      summarySettled: true,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: true,
    });
  });

  it('allows reissuing annual summaries voided by a full refund when eligible gifts remain', () => {
    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'voided',
          voidReason: 'stripe_full_refund',
        }),
        false,
        false,
        false,
        true,
        true
      )
    ).toMatchObject({
      summaryVoided: true,
      summaryReissueAvailable: true,
      summaryNeedsReview: false,
      canSendAnnualReceipt: true,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('keeps voided annual summaries blocked when no current eligible gifts remain', () => {
    expect(
      annualReceiptActionAvailability(
        annualSummary({
          status: 'voided',
          voidReason: 'stripe_full_refund',
        }),
        false,
        false,
        false,
        false,
        true
      )
    ).toMatchObject({
      summaryVoided: true,
      summaryReissueAvailable: false,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('requires current receipt setup before corrected annual summary issuance', () => {
    const summary = annualSummary({
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });

    expect(annualReceiptActionAvailability(summary, true, false, true, true, false)).toMatchObject({
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
    expect(annualReceiptActionAvailability(summary, true, false, true, true, true)).toMatchObject({
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: true,
    });
  });

  it('trusts stored partial-refund annual summaries only when current giving is not loaded', () => {
    const summary = annualSummary({
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });

    expect(annualReceiptActionAvailability(summary, false, false, false, false, true))
      .toMatchObject({
        summaryNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: true,
      });
    expect(annualReceiptActionAvailability(summary, true, false, false, true, true))
      .toMatchObject({
        summaryNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('does not show corrected annual issuance for generic review states the backend cannot correct', () => {
    const summary = annualSummary({
      correctionRequired: true,
      correctionReason: 'manual_review_required',
    });

    expect(annualReceiptActionAvailability(summary, true, false, false, true, true)).toMatchObject({
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks annual receipt actions for mixed-currency donor years before calling the backend', () => {
    expect(annualReceiptActionAvailability(undefined, false, true, false, true, true)).toMatchObject({
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });

    expect(
      annualReceiptActionAvailability(
        annualSummary({ status: 'sent' }),
        false,
        true,
        false,
        true,
        false
      )
    ).toMatchObject({
      summarySettled: true,
      summaryNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks annual receipt actions when stored summary currency is missing or unsupported', () => {
    for (const currency of ['', 'EUR']) {
      expect(
        annualReceiptActionAvailability(
          annualSummary({ currency }),
          false,
          false,
          false,
          true,
          true
        )
      ).toMatchObject({
        summaryInvalidCurrency: true,
        summarySettled: false,
        summaryNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    }
  });
});
