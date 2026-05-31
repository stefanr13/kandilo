import { describe, expect, it } from 'vitest';
import type {
  FirestoreGivingRecord,
  FirestoreTaxReceiptRecord,
  FirestoreTaxReceiptSummaryRecord,
} from '../db/giving';
import {
  donorAnnualReceiptRows,
  donorAnnualReceiptActionAvailability,
  donorGivingReceiptActionAvailability,
  donorTaxReceiptActionAvailability,
} from './donor-receipt-actions';

function givingRecord(overrides: Partial<FirestoreGivingRecord> = {}): FirestoreGivingRecord {
  return {
    id: 'giving-1',
    churchId: 'church-1',
    churchName: 'St. Nicholas',
    userId: 'donor-1',
    donorName: 'Donor One',
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
    taxReceiptStatus: 'unknown',
    taxReceiptError: '',
    taxReceiptEmailError: '',
    taxReceiptCorrectionRequired: false,
    taxReceiptCorrectionReason: '',
    ...overrides,
  };
}

function taxReceipt(overrides: Partial<FirestoreTaxReceiptRecord> = {}): FirestoreTaxReceiptRecord {
  return {
    id: 'receipt-1',
    churchId: 'church-1',
    churchName: 'St. Nicholas',
    userId: 'donor-1',
    givingId: 'giving-1',
    givingIds: [],
    kind: 'single',
    status: 'sent',
    jurisdiction: 'US',
    receiptNumber: 'STN-2026-000001',
    receiptYear: 2026,
    organizationName: 'St. Nicholas Orthodox Church',
    organizationAddress: '1 Main St',
    organizationTaxId: '12-3456789',
    donorName: 'Donor One',
    donorAddress: '2 Main St',
    donorEmail: 'donor@example.com',
    amountCents: 5000,
    eligibleAmountCents: 5000,
    originalAmountCents: null,
    refundedAmountCents: null,
    currency: 'USD',
    purpose: 'General Fund',
    donationCount: null,
    contributions: [],
    coveredPeriodLabel: '',
    duplicateClaimWarning: '',
    includesPreviouslyReceipted: false,
    receivedAt: null,
    receivedDateLabel: '',
    issuedAt: null,
    issuedDateLabel: '',
    goodsServicesStatement: '',
    pdfStoragePath: '',
    pdfSha256: '',
    pdfByteLength: null,
    pdfRetainedAt: null,
    pdfRetentionStatus: '',
    receiptIssueLocation: '',
    authorizedSignerName: '',
    authorizedSignerTitle: '',
    secureElectronicSignatureConfigured: false,
    receiptCopiesRetentionConfirmed: false,
    emailSentAt: null,
    emailFailedAt: null,
    emailError: '',
    correctionRequired: false,
    correctionReason: '',
    correctionForReceiptId: '',
    correctionSourceReason: '',
    correctedAt: null,
    voidedAt: null,
    voidReason: '',
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
    userId: 'donor-1',
    donorLabel: 'Donor One',
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
    correctedReceipt: false,
    issuedAt: null,
    emailSentAt: null,
    emailFailedAt: null,
    emailError: '',
    correctionRequired: false,
    correctionReason: '',
    voidedAt: null,
    voidReason: '',
    ...overrides,
  };
}

const readyContext = {
  activeChurchId: 'church-1',
  activeChurchTaxReceiptReady: true,
};

const notReadyContext = {
  activeChurchId: 'church-1',
  activeChurchTaxReceiptReady: false,
};

const unsupportedContext = {
  activeChurchId: 'church-1',
  activeChurchTaxReceiptReady: false,
  activeChurchTaxReceiptUnsupported: true,
};

describe('donor receipt action availability', () => {
  it('requires active church setup before sending a new receipt', () => {
    expect(donorGivingReceiptActionAvailability(givingRecord(), undefined, notReadyContext))
      .toMatchObject({
        hasExistingSendableReceipt: false,
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });

    expect(donorGivingReceiptActionAvailability(givingRecord(), undefined, readyContext))
      .toMatchObject({
        hasExistingSendableReceipt: false,
        canSendReceipt: true,
        canSendCorrectedReceipt: false,
      });
  });

  it('does not treat historical manual-ready donations as sendable without current setup evidence', () => {
    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          churchId: 'church-2',
          taxReceiptStatus: 'ready',
        }),
        undefined,
        notReadyContext
      )
    ).toMatchObject({
      hasExistingSendableReceipt: false,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('blocks new single-donation sends already covered by a settled annual receipt', () => {
    expect(donorGivingReceiptActionAvailability(givingRecord(), undefined, readyContext, true))
      .toMatchObject({
        hasExistingSendableReceipt: false,
        coveredByAnnualReceipt: true,
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });

    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({ taxReceiptNumber: 'STN-2025-000123', taxReceiptStatus: 'sent' }),
        undefined,
        notReadyContext,
        true
      )
    ).toMatchObject({
      hasExistingSendableReceipt: true,
      coveredByAnnualReceipt: false,
      canSendReceipt: true,
    });
  });

  it('does not treat unknown historical donation receipt state as send-ready', () => {
    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          churchId: 'church-2',
          taxReceiptStatus: 'unknown',
        }),
        undefined,
        notReadyContext
      )
    ).toMatchObject({
      hasExistingSendableReceipt: false,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('allows re-sending an existing single receipt after new setup becomes unavailable', () => {
    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'receipt-1',
          taxReceiptNumber: 'STN-2026-000001',
          taxReceiptStatus: 'sent',
        }),
        undefined,
        notReadyContext
      )
    ).toMatchObject({
      receiptId: 'receipt-1',
      receiptNumber: 'STN-2026-000001',
      hasExistingSendableReceipt: true,
      canSendReceipt: true,
      canSendCorrectedReceipt: false,
    });
  });

  it('does not treat unassigned giving receipt numbers as resendable receipt evidence', () => {
    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'receipt-1',
          taxReceiptNumber: 'unassigned',
          taxReceiptStatus: 'sent',
        }),
        undefined,
        readyContext
      )
    ).toMatchObject({
      receiptId: 'receipt-1',
      receiptNumber: '',
      hasExistingSendableReceipt: false,
      missingAssignedReceiptNumber: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });

    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'receipt-1',
          taxReceiptNumber: 'unassigned',
          taxReceiptStatus: 'sent',
        }),
        taxReceipt({
          id: 'receipt-1',
          receiptNumber: 'STN-2026-000001',
        }),
        notReadyContext
      )
    ).toMatchObject({
      receiptId: 'receipt-1',
      receiptNumber: 'STN-2026-000001',
      hasExistingSendableReceipt: true,
      missingAssignedReceiptNumber: false,
      canSendReceipt: true,
    });
  });

  it('blocks giving-row resends for unsupported-jurisdiction stored receipts', () => {
    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'receipt-ca',
          taxReceiptNumber: 'CA-2026-000001',
          taxReceiptStatus: 'sent',
          taxReceiptError: 'tax_receipt_unsupported_jurisdiction',
        }),
        undefined,
        readyContext
      )
    ).toMatchObject({
      hasExistingSendableReceipt: true,
      unsupportedJurisdiction: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'receipt-ca',
          taxReceiptNumber: 'CA-2026-000001',
          taxReceiptStatus: 'sent',
        }),
        taxReceipt({
          id: 'receipt-ca',
          jurisdiction: 'CA',
        }),
        readyContext
      )
    ).toMatchObject({
      hasExistingSendableReceipt: true,
      unsupportedJurisdiction: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('blocks legacy giving-row resends when the church is currently unsupported jurisdiction', () => {
    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          taxReceiptId: 'receipt-legacy-ca',
          taxReceiptNumber: 'CA-2026-000002',
          taxReceiptStatus: 'sent',
        }),
        undefined,
        unsupportedContext
      )
    ).toMatchObject({
      hasExistingSendableReceipt: true,
      unsupportedJurisdiction: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('uses the donor-only receipt list to recover view and resend actions for capped giving history', () => {
    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({ taxReceiptStatus: 'unknown' }),
        taxReceipt(),
        notReadyContext
      )
    ).toMatchObject({
      receiptId: 'receipt-1',
      receiptNumber: 'STN-2026-000001',
      hasExistingSendableReceipt: true,
      canSendReceipt: true,
      canSendCorrectedReceipt: false,
    });
  });

  it('blocks stale partial-refund receipts until corrected single issuance is available', () => {
    const record = givingRecord({
      taxReceiptId: 'receipt-1',
      taxReceiptStatus: 'issued',
      taxReceiptCorrectionRequired: true,
      taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1000,
    });

    expect(donorGivingReceiptActionAvailability(record, undefined, notReadyContext))
      .toMatchObject({
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });
    expect(donorGivingReceiptActionAvailability(record, undefined, readyContext))
      .toMatchObject({
        canSendReceipt: false,
        canSendCorrectedReceipt: true,
      });
  });

  it('uses Stripe partial-refund metadata as a correction signal before the review code is mirrored', () => {
    const record = givingRecord({
      taxReceiptStatus: 'ready',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1000,
    });

    expect(donorGivingReceiptActionAvailability(record, undefined, notReadyContext))
      .toMatchObject({
        needsCorrection: true,
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });
    expect(donorGivingReceiptActionAvailability(record, undefined, readyContext))
      .toMatchObject({
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
      expect(donorGivingReceiptActionAvailability(record, undefined, readyContext))
        .toMatchObject({
          needsCorrection: true,
          canSendReceipt: false,
          canSendCorrectedReceipt: false,
        });
    }
  });

  it('blocks single-donation receipt actions when the giving currency is missing or unsupported', () => {
    for (const currency of ['', 'EUR']) {
      expect(donorGivingReceiptActionAvailability(givingRecord({ currency }), undefined, readyContext))
        .toMatchObject({
          invalidCurrency: true,
          canSendReceipt: false,
          canSendCorrectedReceipt: false,
        });
    }

    expect(
      donorGivingReceiptActionAvailability(
        givingRecord({
          taxReceiptNumber: 'STN-2026-000001',
          taxReceiptStatus: 'sent',
        }),
        taxReceipt({ currency: '' }),
        readyContext
      )
    ).toMatchObject({
      invalidCurrency: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('uses Stripe partial-refund metadata when building annual corrected receipt candidates', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [
        givingRecord({
          completedAt: new Date('2025-04-01T12:00:00Z'),
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 1000,
        }),
      ],
      taxReceiptRecords: [],
      annualSummaries: [],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'church-1:2025',
        candidateNeedsReview: true,
        candidateHasPartialRefund: true,
        candidateAmountCents: 5000,
        candidateEligibleAmountCents: 4000,
      }),
    ]);
  });

  it('marks invalid partial-refund metadata as annual review without a corrected-send candidate', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [
        givingRecord({
          completedAt: new Date('2025-04-01T12:00:00Z'),
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 0,
        }),
      ],
      taxReceiptRecords: [],
      annualSummaries: [],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'church-1:2025',
        candidateNeedsReview: true,
        candidateHasPartialRefund: false,
      }),
    ]);
    expect(
      donorAnnualReceiptActionAvailability(
        undefined,
        rows[0].candidateNeedsReview,
        rows[0].candidateHasMixedCurrency,
        rows[0].candidateHasPartialRefund,
        rows[0].candidateHasEligibleGiving,
        true
      )
    ).toMatchObject({
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks print, download, and standard resend for voided or review-required full receipt records', () => {
    expect(donorTaxReceiptActionAvailability(taxReceipt({ status: 'voided' }), readyContext))
      .toMatchObject({
        actionBlocked: true,
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });
    expect(
      donorTaxReceiptActionAvailability(
        taxReceipt({
          correctionRequired: true,
          correctionReason: 'stripe_partial_refund_review_required',
        }),
        notReadyContext
      )
    ).toMatchObject({
      needsReview: true,
      actionBlocked: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('blocks print, download, and resend for unsupported-jurisdiction full receipt records', () => {
    expect(donorTaxReceiptActionAvailability(taxReceipt({ jurisdiction: 'CA' }), readyContext))
      .toMatchObject({
        unsupportedJurisdiction: true,
        needsReview: false,
        actionBlocked: true,
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });
    expect(
      donorTaxReceiptActionAvailability(
        taxReceipt({
          jurisdiction: '',
          emailError: 'tax_receipt_unsupported_jurisdiction',
        }),
        readyContext
      )
    ).toMatchObject({
      unsupportedJurisdiction: true,
      actionBlocked: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
    expect(
      donorTaxReceiptActionAvailability(
        taxReceipt({
          jurisdiction: '',
        }),
        unsupportedContext
      )
    ).toMatchObject({
      unsupportedJurisdiction: true,
      actionBlocked: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: false,
    });
  });

  it('blocks print, download, and resend for full receipts without assigned numbers', () => {
    expect(donorTaxReceiptActionAvailability(taxReceipt({ receiptNumber: 'unassigned' }), readyContext))
      .toMatchObject({
        missingAssignedReceiptNumber: true,
        actionBlocked: true,
        canSendReceipt: false,
        canSendCorrectedReceipt: false,
      });
  });

  it('blocks print, download, and resend for full receipts with missing or unsupported currency', () => {
    for (const currency of ['', 'EUR']) {
      expect(donorTaxReceiptActionAvailability(taxReceipt({ currency }), readyContext))
        .toMatchObject({
          invalidCurrency: true,
          actionBlocked: true,
          canSendReceipt: false,
          canSendCorrectedReceipt: false,
        });
    }
  });

  it('requires active setup for corrected standalone single receipts but not settled resends', () => {
    expect(donorTaxReceiptActionAvailability(taxReceipt(), notReadyContext))
      .toMatchObject({
        actionBlocked: false,
        canSendReceipt: true,
        canSendCorrectedReceipt: false,
      });
    expect(
      donorTaxReceiptActionAvailability(
        taxReceipt({
          correctionRequired: true,
          correctionReason: 'stripe_partial_refund_review_required',
        }),
        readyContext
      )
    ).toMatchObject({
      actionBlocked: true,
      canSendReceipt: false,
      canSendCorrectedReceipt: true,
    });
  });

  it('allows re-sending settled annual receipts when new issuance setup is no longer ready', () => {
    expect(donorAnnualReceiptActionAvailability(annualSummary({ status: 'sent' }), false, false, false, false, false))
      .toMatchObject({
        receiptSettled: true,
        receiptNeedsReview: false,
        canSendAnnualReceipt: true,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('does not treat unassigned annual receipt numbers as settled or retryable', () => {
    expect(
      donorAnnualReceiptActionAvailability(
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
      receiptMissingAssignedReceiptNumber: true,
      receiptSettled: false,
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });

    expect(
      donorAnnualReceiptActionAvailability(
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
      receiptMissingAssignedReceiptNumber: true,
      receiptDeliveryFailureRetryable: false,
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
    });

    expect(
      donorAnnualReceiptActionAvailability(
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
      receiptMissingAssignedReceiptNumber: true,
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks settled annual resends for unsupported-jurisdiction receipt records', () => {
    expect(
      donorAnnualReceiptActionAvailability(
        taxReceipt({
          kind: 'annual',
          jurisdiction: 'CA',
          givingIds: ['giving-1'],
        }),
        false,
        false,
        false,
        true,
        true
      )
    ).toMatchObject({
      receiptUnsupportedJurisdiction: true,
      receiptSettled: false,
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks settled annual resends for unsupported-jurisdiction annual summaries', () => {
    expect(
      donorAnnualReceiptActionAvailability(
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
      receiptUnsupportedJurisdiction: true,
      receiptSettled: false,
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks settled annual resends when the church is currently unsupported jurisdiction', () => {
    expect(
      donorAnnualReceiptActionAvailability(
        annualSummary({ status: 'sent' }),
        false,
        false,
        false,
        true,
        true,
        { taxReceiptIssuanceUnsupported: true }
      )
    ).toMatchObject({
      receiptUnsupportedJurisdiction: true,
      receiptSettled: false,
      receiptNeedsReview: true,
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

    expect(donorAnnualReceiptActionAvailability(summary, false, false, false, true, false))
      .toMatchObject({
        receiptSettled: false,
        receiptNeedsReview: false,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    expect(donorAnnualReceiptActionAvailability(summary, false, false, false, true, true))
      .toMatchObject({
        receiptSettled: false,
        receiptNeedsReview: false,
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

    expect(donorAnnualReceiptActionAvailability(summary, false, false, false, true, false))
      .toMatchObject({
        receiptMissingAssignedReceiptNumber: false,
        receiptDeliveryFailureRetryable: false,
        receiptSettled: false,
        receiptNeedsReview: false,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    expect(donorAnnualReceiptActionAvailability(summary, false, false, false, true, true))
      .toMatchObject({
        receiptMissingAssignedReceiptNumber: false,
        receiptDeliveryFailureRetryable: false,
        receiptSettled: false,
        receiptNeedsReview: false,
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

    expect(donorAnnualReceiptActionAvailability(summary, true, false, true, true, true))
      .toMatchObject({
        receiptSettled: false,
        receiptNeedsReview: false,
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

    expect(donorAnnualReceiptActionAvailability(summary, true, false, true, true, true))
      .toMatchObject({
        receiptMissingAssignedReceiptNumber: false,
        receiptSettled: false,
        receiptNeedsReview: false,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: true,
      });
  });

  it('allows retrying existing annual receipt delivery failures after provider or PDF setup is fixed', () => {
    expect(
      donorAnnualReceiptActionAvailability(
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
      receiptSettled: false,
      receiptDeliveryFailureRetryable: true,
      receiptNeedsReview: false,
      canSendAnnualReceipt: true,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks non-retryable annual error records instead of treating them as settled resends', () => {
    expect(donorAnnualReceiptActionAvailability(annualSummary({ status: 'error' }), false, false, false, true, false))
      .toMatchObject({
        receiptSettled: false,
        receiptDeliveryFailureRetryable: false,
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('blocks retryable annual delivery errors when no stored receipt id exists', () => {
    expect(
      donorAnnualReceiptActionAvailability(
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
      receiptSettled: false,
      receiptDeliveryFailureRetryable: false,
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('blocks settled annual receipt resends when current donor-year giving now needs review', () => {
    const summary = annualSummary({ status: 'sent' });

    expect(donorAnnualReceiptActionAvailability(summary, true, false, true, true, false))
      .toMatchObject({
        receiptSettled: true,
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    expect(donorAnnualReceiptActionAvailability(summary, true, false, true, true, true))
      .toMatchObject({
        receiptSettled: true,
        receiptNeedsReview: true,
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

    expect(donorAnnualReceiptActionAvailability(summary, true, false, true, true, false, {
      candidateAmountCents: 12000,
      candidateEligibleAmountCents: 10000,
    })).toMatchObject({
      receiptSettled: true,
      receiptNeedsReview: false,
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

    expect(donorAnnualReceiptActionAvailability(summary, true, false, true, true, true, {
      candidateAmountCents: 12000,
      candidateEligibleAmountCents: 9000,
    })).toMatchObject({
      receiptSettled: true,
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: true,
    });
  });

  it('marks annual donor-year candidates as previously receipted when giving history has individual receipt evidence', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [
        givingRecord({
          completedAt: new Date('2025-04-01T12:00:00Z'),
          taxReceiptNumber: 'STN-2025-000123',
          taxReceiptStatus: 'ready',
        }),
      ],
      taxReceiptRecords: [],
      annualSummaries: [],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'church-1:2025',
        candidateHasEligibleGiving: true,
        candidateIncludesPreviouslyReceipted: true,
      }),
    ]);
  });

  it('does not mark annual donor-year candidates as previously receipted from unassigned receipt numbers', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [
        givingRecord({
          completedAt: new Date('2025-04-01T12:00:00Z'),
          taxReceiptId: 'receipt-1',
          taxReceiptNumber: 'unassigned',
          taxReceiptStatus: 'sent',
        }),
      ],
      taxReceiptRecords: [],
      annualSummaries: [],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'church-1:2025',
        candidateHasEligibleGiving: true,
        candidateIncludesPreviouslyReceipted: false,
      }),
    ]);
  });

  it('marks annual donor-year candidates as previously receipted from standalone single receipt records', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [],
      taxReceiptRecords: [
        taxReceipt({
          id: 'single-prior',
          kind: 'single',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-000123',
          status: 'sent',
        }),
      ],
      annualSummaries: [
        annualSummary({
          receiptId: '',
          receiptYear: 2025,
          status: 'error',
          receiptNumber: '',
          emailError: 'tax_receipt_donor_profile_incomplete',
        }),
      ],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'church-1:2025',
        candidateHasEligibleGiving: false,
        candidateIncludesPreviouslyReceipted: true,
      }),
    ]);
  });

  it('does not create annual donor-year rows only from standalone single receipts', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [],
      taxReceiptRecords: [
        taxReceipt({
          id: 'single-only',
          kind: 'single',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-000123',
          status: 'sent',
        }),
      ],
      annualSummaries: [],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([]);
  });

  it('keeps same-year annual receipts separate by church when no active church is selected', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [],
      taxReceiptRecords: [
        taxReceipt({
          id: 'annual-a',
          churchId: 'church-1',
          churchName: 'St. Nicholas',
          givingId: '',
          kind: 'annual',
          receiptYear: 2025,
        }),
        taxReceipt({
          id: 'annual-b',
          churchId: 'church-2',
          churchName: 'Holy Trinity',
          givingId: '',
          kind: 'annual',
          receiptYear: 2025,
        }),
      ],
      annualSummaries: [],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'church-1:2025',
        churchId: 'church-1',
        year: 2025,
        receipt: expect.objectContaining({ id: 'annual-a' }),
      }),
      expect.objectContaining({
        key: 'church-2:2025',
        churchId: 'church-2',
        year: 2025,
        receipt: expect.objectContaining({ id: 'annual-b' }),
      }),
    ]));
  });

  it('keeps donor annual receipt rows across churches and uses each church timezone', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [
        givingRecord({
          id: 'us-new-year-giving',
          churchId: 'church-1',
          churchName: 'St. Nicholas',
          completedAt: new Date('2026-01-01T04:30:00Z'),
        }),
        givingRecord({
          id: 'ca-giving',
          churchId: 'church-ca-1',
          churchName: 'Holy Trinity',
          completedAt: new Date('2025-05-01T12:00:00Z'),
        }),
      ],
      taxReceiptRecords: [
        taxReceipt({
          id: 'annual-ca',
          churchId: 'church-ca-1',
          churchName: 'Holy Trinity',
          givingId: '',
          kind: 'annual',
          receiptYear: 2025,
        }),
      ],
      annualSummaries: [
        annualSummary({
          id: 'summary-ca',
          receiptId: 'annual-ca',
          churchId: 'church-ca-1',
          receiptYear: 2025,
        }),
      ],
      churchTimezoneForChurch: (churchId) => (
        churchId === 'church-1' ? 'America/Chicago' : 'UTC'
      ),
    });

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'church-1:2025',
        churchId: 'church-1',
        churchName: 'St. Nicholas',
        candidateHasEligibleGiving: true,
      }),
      expect.objectContaining({
        key: 'church-ca-1:2025',
        churchId: 'church-ca-1',
        churchName: 'Holy Trinity',
        candidateHasEligibleGiving: true,
        receipt: expect.objectContaining({ id: 'annual-ca' }),
        summary: expect.objectContaining({ receiptId: 'annual-ca' }),
      }),
    ]));
  });

  it('builds stored annual summary rows without active setup so donors can resend historical receipts', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [],
      taxReceiptRecords: [],
      annualSummaries: [
        annualSummary({
          receiptId: 'annual-inactive',
          churchId: 'inactive-church',
          receiptYear: 2024,
          status: 'sent',
        }),
      ],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'inactive-church:2024',
        churchId: 'inactive-church',
        year: 2024,
        candidateHasEligibleGiving: false,
        summary: expect.objectContaining({ receiptId: 'annual-inactive' }),
      }),
    ]);
    expect(
      donorAnnualReceiptActionAvailability(
        rows[0].summary,
        rows[0].candidateNeedsReview,
        rows[0].candidateHasMixedCurrency,
        rows[0].candidateHasPartialRefund,
        rows[0].candidateHasEligibleGiving,
        false
      )
    ).toMatchObject({
      receiptSettled: true,
      canSendAnnualReceipt: true,
    });
  });

  it('builds donor-only full annual receipt rows without active setup so donors can resend historical receipts', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [],
      taxReceiptRecords: [
        taxReceipt({
          id: 'annual-full-inactive',
          givingId: '',
          givingIds: ['old-giving-1', 'old-giving-2'],
          kind: 'annual',
          churchId: 'inactive-church',
          churchName: 'Dormition Orthodox Church',
          receiptYear: 2024,
          status: 'sent',
          receiptNumber: 'DOR-2024-000042',
        }),
      ],
      annualSummaries: [],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'inactive-church:2024',
        churchId: 'inactive-church',
        churchName: 'Dormition Orthodox Church',
        year: 2024,
        candidateHasEligibleGiving: false,
        receipt: expect.objectContaining({ id: 'annual-full-inactive' }),
      }),
    ]);
    expect(rows[0].summary).toBeUndefined();
    expect(
      donorAnnualReceiptActionAvailability(
        rows[0].receipt,
        rows[0].candidateNeedsReview,
        rows[0].candidateHasMixedCurrency,
        rows[0].candidateHasPartialRefund,
        rows[0].candidateHasEligibleGiving,
        false
      )
    ).toMatchObject({
      receiptSettled: true,
      canSendAnnualReceipt: true,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('allows reissuing annual receipts voided by a full refund when eligible gifts remain', () => {
    expect(
      donorAnnualReceiptActionAvailability(
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
      receiptVoided: true,
      receiptReissueAvailable: true,
      receiptNeedsReview: false,
      canSendAnnualReceipt: true,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('keeps voided annual receipts blocked when no current eligible gifts remain', () => {
    expect(
      donorAnnualReceiptActionAvailability(
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
      receiptVoided: true,
      receiptReissueAvailable: false,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('requires active setup before corrected annual issuance', () => {
    const summary = annualSummary({
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });

    expect(donorAnnualReceiptActionAvailability(summary, true, false, true, true, false))
      .toMatchObject({
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    expect(donorAnnualReceiptActionAvailability(summary, true, false, true, true, true))
      .toMatchObject({
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: true,
      });
  });

  it('trusts stored partial-refund annual summaries only when current giving is not loaded', () => {
    const summary = annualSummary({
      correctionRequired: true,
      correctionReason: 'stripe_partial_refund_review_required',
    });

    expect(donorAnnualReceiptActionAvailability(summary, false, false, false, false, true))
      .toMatchObject({
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: true,
      });
    expect(donorAnnualReceiptActionAvailability(summary, true, false, false, true, true))
      .toMatchObject({
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('does not show corrected annual issuance for generic review states the backend cannot correct', () => {
    const summary = annualSummary({
      correctionRequired: true,
      correctionReason: 'manual_review_required',
    });

    expect(donorAnnualReceiptActionAvailability(summary, true, false, false, true, true))
      .toMatchObject({
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
  });

  it('marks mixed-currency annual donor years and blocks annual receipt actions before backend calls', () => {
    const rows = donorAnnualReceiptRows({
      givingRecords: [
        givingRecord({
          id: 'usd-giving',
          completedAt: new Date('2025-04-01T12:00:00Z'),
          currency: 'USD',
        }),
        givingRecord({
          id: 'cad-giving',
          completedAt: new Date('2025-05-01T12:00:00Z'),
          currency: 'CAD',
        }),
      ],
      taxReceiptRecords: [],
      annualSummaries: [],
      churchTimezoneForChurch: () => 'UTC',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'church-1:2025',
        candidateHasMixedCurrency: true,
        candidateHasEligibleGiving: true,
      }),
    ]);
    expect(
      donorAnnualReceiptActionAvailability(
        undefined,
        rows[0].candidateNeedsReview,
        rows[0].candidateHasMixedCurrency,
        rows[0].candidateHasPartialRefund,
        rows[0].candidateHasEligibleGiving,
        true
      )
    ).toMatchObject({
      receiptNeedsReview: true,
      canSendAnnualReceipt: false,
      canSendCorrectedAnnualReceipt: false,
    });
  });

  it('marks missing or unsupported-currency annual donor years for review before backend calls', () => {
    for (const currency of ['', 'EUR']) {
      const rows = donorAnnualReceiptRows({
        givingRecords: [
          givingRecord({
            completedAt: new Date('2025-04-01T12:00:00Z'),
            currency,
          }),
        ],
        taxReceiptRecords: [],
        annualSummaries: [],
        churchTimezoneForChurch: () => 'UTC',
      });

      expect(rows).toEqual([
        expect.objectContaining({
          key: 'church-1:2025',
          candidateHasMixedCurrency: true,
          candidateHasEligibleGiving: true,
          candidateCurrency: '',
        }),
      ]);
      expect(
        donorAnnualReceiptActionAvailability(
          undefined,
          rows[0].candidateNeedsReview,
          rows[0].candidateHasMixedCurrency,
          rows[0].candidateHasPartialRefund,
          rows[0].candidateHasEligibleGiving,
          true
        )
      ).toMatchObject({
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    }
  });

  it('blocks settled annual receipt actions when stored currency is missing or unsupported', () => {
    for (const currency of ['', 'EUR']) {
      expect(
        donorAnnualReceiptActionAvailability(
          annualSummary({ currency }),
          false,
          false,
          false,
          true,
          true
        )
      ).toMatchObject({
        receiptInvalidCurrency: true,
        receiptSettled: false,
        receiptNeedsReview: true,
        canSendAnnualReceipt: false,
        canSendCorrectedAnnualReceipt: false,
      });
    }
  });
});
