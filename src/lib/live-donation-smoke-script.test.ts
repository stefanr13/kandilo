import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateLiveDonationSmoke,
  firestoreRestDocumentUrl,
  firestoreRestRunQueryUrl,
  liveCompletedCheckoutEventsQuery,
  liveWebhookIssueEventsQuery,
  loadLiveDonationSmokeState,
  main,
  parseArgs,
  readDocumentWithFirestoreRest,
  readLiveCompletedCheckoutEventsWithFirestoreRest,
  readLiveWebhookIssueEventsWithFirestoreRest,
  readRecentWebhookEventsWithFirestoreRest,
  readRetainedPdfObjectMetadataWithStorageRest,
  readTaxReceiptEventsForReceiptWithFirestoreRest,
  recentWebhookEventsQuery,
  retainedPdfStorageObjectMetadataUrl,
  taxReceiptEventsForReceiptQuery,
} from '../../scripts/check-live-donation-smoke.mjs';

type SmokeDoc = {
  id: string;
  data: Record<string, unknown>;
};

const smokeNow = new Date('2026-05-25T20:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(smokeNow);
});

afterEach(() => {
  vi.useRealTimers();
});

function writer() {
  let output = '';
  return {
    sink: {
      write(value: string) {
        output += value;
      },
    },
    output: () => output,
  };
}

function restDocument(collectionName: string, documentId: string, fields: Record<string, unknown>) {
  return {
    name: `projects/kandilo-2f7a9/databases/(default)/documents/${collectionName}/${documentId}`,
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        if (typeof value === 'string') return [key, { stringValue: value }];
        if (typeof value === 'boolean') return [key, { booleanValue: value }];
        if (typeof value === 'number') return [key, { integerValue: String(value) }];
        return [key, { nullValue: null }];
      })
    ),
  };
}

function webhookEvent(overrides: Partial<SmokeDoc['data']> = {}): SmokeDoc {
  return {
    id: 'evt_private_live_checkout',
    data: {
      type: 'checkout.session.completed',
      status: 'processed',
      livemode: true,
      givingId: 'giving-private-smoke',
      processedAt: '2026-05-25T18:00:00Z',
      ...overrides,
    },
  };
}

function giving(overrides: Partial<SmokeDoc['data']> = {}): SmokeDoc {
  return {
    id: 'giving-private-smoke',
    data: {
      status: 'completed',
      taxReceiptStatus: 'sent',
      taxReceiptId: 'receipt-private-smoke',
      taxReceiptNumber: 'STN-2026-0001',
      taxReceiptSentAt: '2026-05-25T18:00:20Z',
      anonymous: false,
      donorEmail: '',
      donorName: 'Parishioner',
      donorNamePublicSafe: true,
      receiptManagerGivingSafeVersion: 1,
      churchReceiptVisible: true,
      churchId: 'church-private-smoke',
      userId: 'user-private-smoke',
      amountCents: 2500,
      currency: 'USD',
      ...overrides,
    },
  };
}

function receipt(overrides: Partial<SmokeDoc['data']> = {}): SmokeDoc {
  return {
    id: 'receipt-private-smoke',
    data: {
      kind: 'single',
      status: 'sent',
      givingId: 'giving-private-smoke',
      churchId: 'church-private-smoke',
      userId: 'user-private-smoke',
      amountCents: 2500,
      eligibleAmountCents: 2500,
      currency: 'USD',
      receiptNumber: 'STN-2026-0001',
      issuedAt: '2026-05-25T18:00:10Z',
      emailSentAt: '2026-05-25T18:00:20Z',
      pdfStoragePath: 'taxReceipts/church-1/2026/receipt-private-smoke.pdf',
      pdfSha256: 'a'.repeat(64),
      pdfByteLength: 2048,
      pdfRetentionStatus: 'retained',
      pdfRetainedAt: '2026-05-25T18:00:15Z',
      emailError: '',
      emailFailedAt: null,
      ...overrides,
    },
  };
}

function taxReceiptEvent(overrides: Partial<SmokeDoc['data']> = {}): SmokeDoc {
  return {
    id: 'event-private-tax-receipt-email-sent',
    data: {
      action: 'email_sent',
      receiptId: 'receipt-private-smoke',
      givingId: 'giving-private-smoke',
      churchId: 'church-private-smoke',
      userId: 'user-private-smoke',
      kind: 'single',
      receiptYear: 2026,
      createdAt: '2026-05-25T18:00:30Z',
      ...overrides,
    },
  };
}

function retainedPdfObject(overrides: Record<string, unknown> = {}) {
  return {
    name: 'taxReceipts/church-1/2026/receipt-private-smoke.pdf',
    size: '2048',
    metadata: {
      pdfSha256: 'a'.repeat(64),
      retentionPurpose: 'official_tax_receipt_copy',
    },
    ...overrides,
  };
}

describe('live donation smoke checker', () => {
  it('accepts a live processed Checkout webhook, completed giving record, and stored sent receipt', () => {
    const result = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
    });

    expect(result.ok).toBe(true);
    expect(result.receiptStatus).toBe('sent');
    expect(result.liveIssueCount).toBe(0);
  });

  it('accepts Firestore REST timestamp markers from live reads', () => {
    const timestamp = { __firestoreTimestampValue: '2026-05-25T18:00:00Z' };
    const result = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent({ processedAt: timestamp })],
      liveCheckoutEvents: [webhookEvent({ processedAt: timestamp })],
      giving: giving({ taxReceiptSentAt: { __firestoreTimestampValue: '2026-05-25T18:00:20Z' } }),
      taxReceipt: receipt({
        issuedAt: { __firestoreTimestampValue: '2026-05-25T18:00:10Z' },
        emailSentAt: { __firestoreTimestampValue: '2026-05-25T18:00:20Z' },
        pdfRetainedAt: { __firestoreTimestampValue: '2026-05-25T18:00:15Z' },
      }),
      taxReceiptEvents: [
        taxReceiptEvent({ createdAt: { __firestoreTimestampValue: '2026-05-25T18:00:30Z' } }),
      ],
      retainedPdfObject: retainedPdfObject(),
      requireSentReceipt: true,
    });

    expect(result.ok).toBe(true);
  });

  it('keeps the live Checkout smoke visible when newer non-Checkout webhooks fill the recent activity window', () => {
    const newerNonCheckoutEvents = Array.from({ length: 100 }, (_, index) => webhookEvent({
      id: `evt_newer_non_checkout_${index}`,
      type: index % 2 === 0 ? 'charge.refunded' : 'checkout.session.expired',
      status: 'processed',
      givingId: `non-checkout-giving-${index}`,
      processedAt: `2026-05-25T19:${String(index % 60).padStart(2, '0')}:00Z`,
    }));

    const result = evaluateLiveDonationSmoke({
      webhookEvents: newerNonCheckoutEvents,
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
    });

    expect(result.ok).toBe(true);
    expect(result.inspectedWebhookCount).toBe(100);
    expect(result.inspectedLiveCheckoutCount).toBe(1);
  });

  it('keeps the live Checkout smoke visible when newer test-mode Checkout completions fill the recent activity window', () => {
    const newerTestCheckoutEvents = Array.from({ length: 100 }, (_, index) => webhookEvent({
      id: `evt_newer_test_checkout_${index}`,
      type: 'checkout.session.completed',
      status: 'processed',
      livemode: false,
      givingId: `test-checkout-giving-${index}`,
      processedAt: `2026-05-25T19:${String(index % 60).padStart(2, '0')}:00Z`,
    }));

    const result = evaluateLiveDonationSmoke({
      webhookEvents: newerTestCheckoutEvents,
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
    });

    expect(result.ok).toBe(true);
    expect(result.inspectedWebhookCount).toBe(100);
    expect(result.inspectedLiveCheckoutCount).toBe(1);
    expect(result.liveIssueCount).toBe(0);
  });

  it('keeps live webhook issues visible when newer test-mode Checkout completions fill the recent activity window', () => {
    const newerTestCheckoutEvents = Array.from({ length: 100 }, (_, index) => webhookEvent({
      id: `evt_newer_test_checkout_${index}`,
      type: 'checkout.session.completed',
      status: 'processed',
      livemode: false,
      givingId: `test-checkout-giving-${index}`,
      processedAt: `2026-05-25T19:${String(index % 60).padStart(2, '0')}:00Z`,
    }));

    const result = evaluateLiveDonationSmoke({
      webhookEvents: newerTestCheckoutEvents,
      liveCheckoutEvents: [webhookEvent()],
      liveIssueEvents: [
        webhookEvent({
          id: 'evt_hidden_live_validation_failure',
          status: 'validation_failed',
          processedAt: '2026-05-25T18:30:00Z',
        }),
      ],
      giving: giving(),
      taxReceipt: receipt(),
    });

    expect(result.ok).toBe(false);
    expect(result.inspectedWebhookCount).toBe(100);
    expect(result.inspectedLiveCheckoutCount).toBe(1);
    expect(result.inspectedLiveIssueCount).toBe(1);
    expect(result.liveIssueCount).toBe(1);
    expect(result.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Direct live webhook issue lookup has no validation/missing-giving/unpaid-session issues'
    );
  });

  it('fails when live Checkout smoke evidence is stale', () => {
    const staleCheckout = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent({ processedAt: '2026-05-20T18:00:00Z' })],
      giving: giving(),
      taxReceipt: receipt(),
    });

    expect(staleCheckout.ok).toBe(false);
    expect(staleCheckout.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Live Checkout smoke was processed within the 72-hour freshness window'
    );
  });

  it('fails strict sent-receipt smoke when backend email audit evidence is stale', () => {
    const staleEmailAudit = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent({ createdAt: '2026-05-20T18:00:00Z' })],
      requireSentReceipt: true,
    });

    expect(staleEmailAudit.ok).toBe(false);
    expect(staleEmailAudit.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt email audit is within the 72-hour freshness window'
    );
  });

  it('fails strict sent-receipt smoke when receipt, mirror, or retained PDF timestamps are stale', () => {
    const staleReceiptIssuedAt = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt({ issuedAt: '2026-05-20T18:00:00Z' }),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const staleReceiptEmailSentAt = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt({ emailSentAt: '2026-05-20T18:00:00Z' }),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const staleGivingTaxReceiptSentAt = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving({ taxReceiptSentAt: '2026-05-20T18:00:00Z' }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const staleRetainedPdfAt = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt({ pdfRetainedAt: '2026-05-20T18:00:00Z' }),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });

    expect(staleReceiptIssuedAt.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt issue timestamp is within the 72-hour freshness window'
    );
    expect(staleReceiptEmailSentAt.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt email timestamp is within the 72-hour freshness window'
    );
    expect(staleGivingTaxReceiptSentAt.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation giving receipt-sent timestamp is within the 72-hour freshness window'
    );
    expect(staleRetainedPdfAt.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt retained PDF timestamp is within the 72-hour freshness window'
    );
  });

  it('accepts manual-mode completed donations that are ready for receipt sending without a stored receipt yet', () => {
    const result = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'ready', taxReceiptId: '' }),
      taxReceipt: null,
    });

    expect(result.ok).toBe(true);
    expect(result.receiptStatus).toBe('ready');
    expect(result.checks.map((check) => check.label)).not.toContain(
      'Stored official receipt status is issued or sent'
    );
  });

  it('requires privacy-safe church-facing giving mirror state before receipt email smoke', () => {
    const readyState = { taxReceiptStatus: 'ready', taxReceiptId: '' };
    const leakedDonorEmail = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ ...readyState, donorEmail: 'private@example.com' }),
      taxReceipt: null,
    });
    const hiddenNonAnonymousGiving = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ ...readyState, churchReceiptVisible: false }),
      taxReceipt: null,
    });
    const reservedAnonymousDonorLabel = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ ...readyState, donorName: 'Anonymous donor' }),
      taxReceipt: null,
    });
    const rawStripePaymentFields = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({
        ...readyState,
        stripeCheckoutSessionId: 'cs_live_private',
        stripePaymentIntentId: 'pi_live_private',
        checkoutUrl: 'https://checkout.stripe.com/private/legacy',
      }),
      taxReceipt: null,
    });

    expect(leakedDonorEmail.ok).toBe(false);
    expect(leakedDonorEmail.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing donor email is blank'
    );
    expect(hiddenNonAnonymousGiving.ok).toBe(false);
    expect(hiddenNonAnonymousGiving.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church receipt visibility matches donor anonymity'
    );
    expect(reservedAnonymousDonorLabel.ok).toBe(false);
    expect(reservedAnonymousDonorLabel.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing donor label is non-empty and not the reserved anonymous label'
    );
    expect(rawStripePaymentFields.ok).toBe(false);
    expect(rawStripePaymentFields.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing giving mirror omits raw Stripe payment fields'
    );
  });

  it('requires an emailed official receipt when the strict announcement flag is enabled', () => {
    const readyOnly = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'ready', taxReceiptId: '' }),
      taxReceipt: null,
      requireSentReceipt: true,
    });
    const issuedOnly = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'issued' }),
      taxReceipt: receipt({ status: 'issued', emailSentAt: '', pdfStoragePath: '' }),
      requireSentReceipt: true,
    });
    const sent = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      retainedPdfObject: retainedPdfObject(),
      requireSentReceipt: true,
    });

    expect(readyOnly.ok).toBe(false);
    expect(readyOnly.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation official tax receipt was emailed'
    );
    expect(issuedOnly.ok).toBe(false);
    expect(issuedOnly.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation official tax receipt was emailed'
    );
    expect(sent.ok).toBe(true);
  });

  it('requires backend audit evidence when strict sent-receipt smoke is enabled', () => {
    const missingAudit = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [],
      requireSentReceipt: true,
    });
    const mismatchedAudit = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent({ givingId: 'other-giving' })],
      requireSentReceipt: true,
    });
    const matchingAudit = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      retainedPdfObject: retainedPdfObject(),
      requireSentReceipt: true,
    });

    expect(missingAudit.ok).toBe(false);
    expect(mismatchedAudit.ok).toBe(false);
    expect(missingAudit.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt has backend email-sent audit evidence'
    );
    expect(mismatchedAudit.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt has backend email-sent audit evidence'
    );
    expect(matchingAudit.ok).toBe(true);
  });

  it('requires portal mirror and audit timestamps for strict sent-receipt smoke', () => {
    const missingGivingSentAt = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptSentAt: '' }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const missingAuditCreatedAt = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent({ createdAt: '' })],
      requireSentReceipt: true,
    });

    expect(missingGivingSentAt.ok).toBe(false);
    expect(missingGivingSentAt.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation giving record includes receipt-sent timestamp evidence'
    );
    expect(missingAuditCreatedAt.ok).toBe(false);
    expect(missingAuditCreatedAt.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt email audit has timestamp evidence'
    );
  });

  it('requires the retained official PDF object in Storage for strict sent-receipt smoke', () => {
    const missingStorageObject = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      retainedPdfObject: null,
      requireSentReceipt: true,
    });
    const wrongStorageObjectPath = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      retainedPdfObject: retainedPdfObject({ name: 'taxReceipts/church-1/2026/other-receipt.pdf' }),
      requireSentReceipt: true,
    });
    const wrongStorageObjectSize = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      retainedPdfObject: retainedPdfObject({ size: '1024' }),
      requireSentReceipt: true,
    });
    const wrongStorageObjectHash = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      retainedPdfObject: retainedPdfObject({
        metadata: {
          pdfSha256: 'b'.repeat(64),
          retentionPurpose: 'official_tax_receipt_copy',
        },
      }),
      requireSentReceipt: true,
    });
    const wrongStorageObjectPurpose = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      liveCheckoutEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      retainedPdfObject: retainedPdfObject({
        metadata: {
          pdfSha256: 'a'.repeat(64),
          retentionPurpose: 'temporary_preview',
        },
      }),
      requireSentReceipt: true,
    });

    expect(missingStorageObject.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Retained official receipt PDF object exists in Firebase Storage'
    );
    expect(wrongStorageObjectPath.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Retained official receipt PDF object matches stored path metadata'
    );
    expect(wrongStorageObjectSize.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Retained official receipt PDF object byte length matches stored metadata'
    );
    expect(wrongStorageObjectHash.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Retained official receipt PDF object hash metadata matches stored metadata'
    );
    expect(wrongStorageObjectPurpose.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Retained official receipt PDF object is marked as an official receipt copy'
    );
  });

  it('requires privacy-safe church-facing giving mirror state for strict sent-receipt smoke', () => {
    const leakedDonorEmail = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ donorEmail: 'private@example.com' }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const hiddenNonAnonymousGiving = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ churchReceiptVisible: false }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const visibleAnonymousGiving = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({
        anonymous: true,
        donorName: 'Anonymous donor',
        churchReceiptVisible: true,
      }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const emailShapedDonorLabel = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ donorName: 'Contact private@example.com' }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const reservedAnonymousDonorLabel = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ donorName: 'Anonymous donor' }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const blankNonAnonymousDonorLabel = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ donorName: '' }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const unsafeDonorLabelMarker = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ donorNamePublicSafe: false }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const staleGivingSafeVersion = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ receiptManagerGivingSafeVersion: 0 }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });
    const rawStripePaymentFields = evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({
        stripeSessionId: 'cs_live_private_alias',
        stripeCheckoutSessionId: 'cs_live_private',
        stripeCheckoutSessionExpiresAt: '2026-05-25T18:30:00Z',
        stripeCheckoutUrl: 'https://checkout.stripe.com/private',
        stripeCheckoutSessionUrl: 'https://checkout.stripe.com/private/session',
        stripePaymentIntentId: 'pi_live_private',
        stripePaymentStatus: 'paid',
        stripeChargeId: 'ch_live_private_charge',
        stripeCustomerId: 'cus_live_private',
        stripeConnectAccountId: 'acct_live_private',
        stripeRefundId: 're_live_private',
        stripeRefundedChargeId: 'ch_live_private',
        checkoutSessionId: 'cs_live_private_legacy',
        checkoutUrl: 'https://checkout.stripe.com/private/legacy',
        paymentIntentId: 'pi_live_private_legacy',
        chargeId: 'ch_live_private_legacy',
        refundId: 're_live_private_legacy',
      }),
      taxReceipt: receipt(),
      taxReceiptEvents: [taxReceiptEvent()],
      requireSentReceipt: true,
    });

    expect(leakedDonorEmail.ok).toBe(false);
    expect(leakedDonorEmail.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing donor email is blank'
    );
    expect(hiddenNonAnonymousGiving.ok).toBe(false);
    expect(hiddenNonAnonymousGiving.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church receipt visibility matches donor anonymity'
    );
    expect(visibleAnonymousGiving.ok).toBe(false);
    expect(visibleAnonymousGiving.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church receipt visibility matches donor anonymity'
    );
    expect(emailShapedDonorLabel.ok).toBe(false);
    expect(emailShapedDonorLabel.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing donor label is not an email address'
    );
    expect(reservedAnonymousDonorLabel.ok).toBe(false);
    expect(reservedAnonymousDonorLabel.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing donor label is non-empty and not the reserved anonymous label'
    );
    expect(blankNonAnonymousDonorLabel.ok).toBe(false);
    expect(blankNonAnonymousDonorLabel.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing donor label is non-empty and not the reserved anonymous label'
    );
    expect(unsafeDonorLabelMarker.ok).toBe(false);
    expect(unsafeDonorLabelMarker.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing donor label safety marker matches donor anonymity'
    );
    expect(staleGivingSafeVersion.ok).toBe(false);
    expect(staleGivingSafeVersion.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing giving safe version matches donor anonymity'
    );
    expect(rawStripePaymentFields.ok).toBe(false);
    expect(rawStripePaymentFields.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation church-facing giving mirror omits raw Stripe payment fields'
    );
  });

  it('fails closed when the live Checkout webhook, completed giving, receipt-ready state, or stored receipt evidence is missing', () => {
    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent({ livemode: false })],
      giving: giving(),
      taxReceipt: receipt(),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Recent live checkout.session.completed webhook was processed'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ status: 'pending' }),
      taxReceipt: receipt(),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation giving record is completed'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'not_configured', taxReceiptId: '' }),
      taxReceipt: null,
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation reached a tax receipt-ready state'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptError: 'church_tax_receipts_not_enabled' }),
      taxReceipt: receipt(),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation has no tax receipt setup error'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptEmailError: 'tax_receipt_provider_rejected' }),
      taxReceipt: receipt(),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation has no tax receipt email error'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: null,
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt record exists when the smoke donation is issued or sent'
    );
  });

  it('fails when an issued or sent smoke donation points to an unusable stored official receipt', () => {
    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ status: 'voided' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toEqual(expect.arrayContaining([
      'Stored official receipt status is issued or sent',
      'Stored official receipt status matches the giving receipt state',
    ]));

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ status: 'issued' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt status matches the giving receipt state'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'issued' }),
      taxReceipt: receipt({ status: 'issued', receiptNumber: '' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt includes an official receipt number'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'issued' }),
      taxReceipt: receipt({ status: 'issued', receiptNumber: 'unassigned' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt includes an official receipt number'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'issued', taxReceiptNumber: '' }),
      taxReceipt: receipt({ status: 'issued' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toEqual(expect.arrayContaining([
      'Smoke donation giving mirror includes the official receipt number',
      'Smoke donation giving mirror receipt number matches the stored receipt',
    ]));

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'issued', taxReceiptNumber: 'unassigned' }),
      taxReceipt: receipt({ status: 'issued' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toEqual(expect.arrayContaining([
      'Smoke donation giving mirror includes the official receipt number',
      'Smoke donation giving mirror receipt number matches the stored receipt',
    ]));

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'issued', taxReceiptNumber: 'STN-2026-9999' }),
      taxReceipt: receipt({ status: 'issued' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Smoke donation giving mirror receipt number matches the stored receipt'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ kind: 'annual' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt is a single-donation receipt'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'issued' }),
      taxReceipt: receipt({ status: 'issued', issuedAt: '' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt includes issue timestamp evidence'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ emailError: 'tax_receipt_provider_rejected' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt has no delivery error'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ emailFailedAt: '2026-05-25T18:01:00Z' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt has no failed-delivery timestamp'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ emailSentAt: '' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt includes email delivery timestamp evidence'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ pdfStoragePath: '' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt includes retained PDF storage metadata'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ pdfSha256: 'not-a-sha' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt includes retained PDF hash evidence'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ pdfByteLength: 0 }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt includes retained PDF byte-length evidence'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ pdfRetainedAt: '' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt includes retained PDF timestamp evidence'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ taxReceiptStatus: 'sent' }),
      taxReceipt: receipt({ pdfRetentionStatus: 'failed' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored sent receipt PDF retention status is retained'
    );
  });

  it('fails when an issued or sent stored receipt does not match the live giving document', () => {
    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt({ givingId: 'other-giving' }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt matches the smoke giving document'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ churchId: 'other-church' }),
      taxReceipt: receipt(),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt matches the smoke church'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ userId: 'other-user' }),
      taxReceipt: receipt(),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt matches the smoke donor account'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ amountCents: 0 }),
      taxReceipt: receipt(),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toEqual(expect.arrayContaining([
      'Smoke donation giving record includes positive amount evidence',
      'Stored official receipt amount matches the smoke donation',
    ]));

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving(),
      taxReceipt: receipt({ eligibleAmountCents: 2400 }),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt amount matches the smoke donation'
    );

    expect(evaluateLiveDonationSmoke({
      webhookEvents: [webhookEvent()],
      giving: giving({ currency: 'CAD' }),
      taxReceipt: receipt(),
    }).checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored official receipt currency matches the smoke donation'
    );
  });

  it('fails when the direct live webhook issue lookup includes validation or missing-giving issues', () => {
    const result = evaluateLiveDonationSmoke({
      webhookEvents: [
        webhookEvent(),
        webhookEvent({ status: 'validation_failed', givingId: 'private-invalid-giving' }),
      ],
      giving: giving(),
      taxReceipt: receipt(),
    });

    expect(result.ok).toBe(false);
    expect(result.liveIssueCount).toBe(1);
    expect(result.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Direct live webhook issue lookup has no validation/missing-giving/unpaid-session issues'
    );
  });

  it('builds redacted Firestore REST query and document URLs with masks', () => {
    const query = recentWebhookEventsQuery(10);
    const liveCheckoutQuery = liveCompletedCheckoutEventsQuery(10);
    const liveIssueQuery = liveWebhookIssueEventsQuery(10);
    const eventQuery = taxReceiptEventsForReceiptQuery('receipt-private-smoke');
    const queryUrl = firestoreRestRunQueryUrl('kandilo-2f7a9');
    const docUrl = firestoreRestDocumentUrl('kandilo-2f7a9', 'giving', 'giving-private-smoke', ['status', 'taxReceiptStatus']);
    const storageObjectUrl = retainedPdfStorageObjectMetadataUrl(
      'kandilo-2f7a9.firebasestorage.app',
      'taxReceipts/church-1/2026/receipt-private-smoke.pdf'
    );

    expect(query.structuredQuery.from[0].collectionId).toBe('stripeWebhookEvents');
    expect(query.structuredQuery.orderBy[0].field.fieldPath).toBe('processedAt');
    expect(query.structuredQuery.limit).toBe(10);
    expect(liveCheckoutQuery.structuredQuery.from[0].collectionId).toBe('stripeWebhookEvents');
    expect(liveCheckoutQuery.structuredQuery.where.compositeFilter.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldFilter: expect.objectContaining({
          field: { fieldPath: 'type' },
          value: { stringValue: 'checkout.session.completed' },
        }),
      }),
      expect.objectContaining({
        fieldFilter: expect.objectContaining({
          field: { fieldPath: 'status' },
          value: { stringValue: 'processed' },
        }),
      }),
      expect.objectContaining({
        fieldFilter: expect.objectContaining({
          field: { fieldPath: 'livemode' },
          value: { booleanValue: true },
        }),
      }),
    ]));
    expect(liveCheckoutQuery.structuredQuery.orderBy[0].field.fieldPath).toBe('processedAt');
    expect(liveCheckoutQuery.structuredQuery.limit).toBe(10);
    expect(liveIssueQuery.structuredQuery.from[0].collectionId).toBe('stripeWebhookEvents');
    expect(liveIssueQuery.structuredQuery.where.compositeFilter.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldFilter: expect.objectContaining({
          field: { fieldPath: 'status' },
          op: 'IN',
          value: {
            arrayValue: {
              values: [
                { stringValue: 'validation_failed' },
                { stringValue: 'missing_giving' },
                { stringValue: 'unpaid_session' },
              ],
            },
          },
        }),
      }),
      expect.objectContaining({
        fieldFilter: expect.objectContaining({
          field: { fieldPath: 'livemode' },
          value: { booleanValue: true },
        }),
      }),
    ]));
    expect(liveIssueQuery.structuredQuery.orderBy[0].field.fieldPath).toBe('processedAt');
    expect(liveIssueQuery.structuredQuery.limit).toBe(10);
    expect(eventQuery.structuredQuery.from[0].collectionId).toBe('taxReceiptEvents');
    expect(eventQuery.structuredQuery.where.compositeFilter.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldFilter: expect.objectContaining({
          field: { fieldPath: 'receiptId' },
          value: { stringValue: 'receipt-private-smoke' },
        }),
      }),
      expect.objectContaining({
        fieldFilter: expect.objectContaining({
          field: { fieldPath: 'action' },
          value: { stringValue: 'email_sent' },
        }),
      }),
    ]));
    expect(eventQuery.structuredQuery.orderBy[0].field.fieldPath).toBe('createdAt');
    expect(eventQuery.structuredQuery.orderBy[0].direction).toBe('DESCENDING');
    expect(queryUrl.toString()).toBe('https://firestore.googleapis.com/v1/projects/kandilo-2f7a9/databases/(default)/documents:runQuery');
    expect(docUrl.searchParams.getAll('mask.fieldPaths')).toEqual(['status', 'taxReceiptStatus']);
    expect(storageObjectUrl.toString()).toBe(
      'https://storage.googleapis.com/storage/v1/b/kandilo-2f7a9.firebasestorage.app/o/taxReceipts%2Fchurch-1%2F2026%2Freceipt-private-smoke.pdf?fields=name%2Csize%2Cmetadata'
    );
  });

  it('reads recent webhooks and masked documents through Firestore REST without logging access tokens', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes(':runQuery')) {
        const body = typeof init?.body === 'string' ? init.body : '';
        if (body.includes('taxReceiptEvents')) {
          return new Response(JSON.stringify([
            { document: restDocument('taxReceiptEvents', 'event-private-tax-receipt-email-sent', taxReceiptEvent().data) },
          ]), { status: 200 });
        }
        if (body.includes('"validation_failed"')) {
          return new Response(JSON.stringify([
            { document: restDocument('stripeWebhookEvents', 'evt_private_live_issue', webhookEvent({
              status: 'validation_failed',
            }).data) },
          ]), { status: 200 });
        }
        return new Response(JSON.stringify([
          { document: restDocument('stripeWebhookEvents', 'evt_private_live_checkout', webhookEvent().data) },
        ]), { status: 200 });
      }
      if (String(url).includes('storage.googleapis.com')) {
        return new Response(JSON.stringify(retainedPdfObject()), { status: 200 });
      }
      return new Response(JSON.stringify(restDocument('giving', 'giving-private-smoke', giving().data)), { status: 200 });
    };

    const events = await readRecentWebhookEventsWithFirestoreRest(fetchImpl, 'ya29.private-token', {
      limit: 1,
    });
    const liveCheckoutEvents = await readLiveCompletedCheckoutEventsWithFirestoreRest(fetchImpl, 'ya29.private-token', {
      limit: 1,
    });
    const liveIssueEvents = await readLiveWebhookIssueEventsWithFirestoreRest(fetchImpl, 'ya29.private-token', {
      limit: 1,
    });
    const doc = await readDocumentWithFirestoreRest(fetchImpl, 'ya29.private-token', {
      collectionName: 'giving',
      documentId: 'giving-private-smoke',
      fieldMasks: ['status'],
    });
    const receiptEvents = await readTaxReceiptEventsForReceiptWithFirestoreRest(fetchImpl, 'ya29.private-token', {
      receiptId: 'receipt-private-smoke',
    });
    const pdfObject = await readRetainedPdfObjectMetadataWithStorageRest(fetchImpl, 'ya29.private-token', {
      storagePath: 'taxReceipts/church-1/2026/receipt-private-smoke.pdf',
    });

    expect(events[0].data.givingId).toBe('giving-private-smoke');
    expect(liveCheckoutEvents[0].data.type).toBe('checkout.session.completed');
    expect(liveIssueEvents[0].data.status).toBe('validation_failed');
    expect(doc?.data.status).toBe('completed');
    expect(receiptEvents[0].data.action).toBe('email_sent');
    expect(pdfObject?.metadata?.pdfSha256).toBe('a'.repeat(64));
    expect(calls).toHaveLength(6);
    const taxReceiptEventBody = calls
      .map((call) => (typeof call.init?.body === 'string' ? call.init.body : ''))
      .find((body) => body.includes('taxReceiptEvents')) ?? '';
    expect(taxReceiptEventBody).toContain('"receiptId"');
    expect(taxReceiptEventBody).toContain('"receipt-private-smoke"');
    expect(taxReceiptEventBody).toContain('"action"');
    expect(taxReceiptEventBody).toContain('"email_sent"');
    expect(taxReceiptEventBody).toContain('"createdAt"');
    expect(calls.every((call) => call.init?.headers && JSON.stringify(call.init.headers).includes('ya29.private-token'))).toBe(true);
    expect(calls.map((call) => call.url).join('\n')).not.toContain('ya29.private-token');
  });

  it('loads smoke state without exposing identifiers in CLI output', async () => {
    const responses = [
      new Response(JSON.stringify([
        { document: restDocument('stripeWebhookEvents', 'evt_newer_refund_noise', webhookEvent({
          type: 'charge.refunded',
          givingId: 'newer-refund-noise',
          processedAt: '2026-05-25T19:00:00Z',
        }).data) },
      ]), { status: 200 }),
      new Response(JSON.stringify([
        { document: restDocument('stripeWebhookEvents', 'evt_private_live_checkout', webhookEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify([]), { status: 200 }),
      new Response(JSON.stringify(restDocument('giving', 'giving-private-smoke', giving().data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', 'receipt-private-smoke', receipt().data)), { status: 200 }),
      new Response(JSON.stringify([
        { document: restDocument('taxReceiptEvents', 'event-private-tax-receipt-email-sent', taxReceiptEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify(retainedPdfObject()), { status: 200 }),
    ];
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      const body = typeof init?.body === 'string' ? init.body : '';
      if (String(url).includes(':runQuery') && body.includes('taxReceiptEvents')) {
        return new Response(JSON.stringify([
          { document: restDocument('taxReceiptEvents', 'event-private-tax-receipt-email-sent', taxReceiptEvent().data) },
        ]), { status: 200 });
      }
      if (String(url).includes('storage.googleapis.com')) {
        return new Response(JSON.stringify(retainedPdfObject()), { status: 200 });
      }
      return responses.shift() ?? new Response('{}', { status: 404 });
    };

    const state = await loadLiveDonationSmokeState({
      accessToken: 'ya29.private-token',
      fetchImpl,
      requireSentReceipt: true,
    });

    expect(state.webhookEvents).toHaveLength(1);
    expect(state.liveCheckoutEvents).toHaveLength(1);
    expect(state.liveIssueEvents).toHaveLength(0);
    expect(state.giving?.data.status).toBe('completed');
    expect(state.taxReceipt?.data.status).toBe('sent');
    expect(state.taxReceiptEvents[0].data.action).toBe('email_sent');
    expect(state.retainedPdfObject?.metadata?.pdfSha256).toBe('a'.repeat(64));
    const givingReadUrl = calls.find((url) => url.includes('/giving/giving-private-smoke')) ?? '';
    expect(givingReadUrl).toContain('mask.fieldPaths=churchId');
    expect(givingReadUrl).toContain('mask.fieldPaths=userId');
    expect(givingReadUrl).toContain('mask.fieldPaths=amountCents');
    expect(givingReadUrl).toContain('mask.fieldPaths=currency');
    expect(givingReadUrl).toContain('mask.fieldPaths=taxReceiptNumber');
    expect(givingReadUrl).toContain('mask.fieldPaths=taxReceiptSentAt');
    expect(givingReadUrl).toContain('mask.fieldPaths=anonymous');
    expect(givingReadUrl).toContain('mask.fieldPaths=donorEmail');
    expect(givingReadUrl).toContain('mask.fieldPaths=donorName');
    expect(givingReadUrl).toContain('mask.fieldPaths=donorNamePublicSafe');
    expect(givingReadUrl).toContain('mask.fieldPaths=receiptManagerGivingSafeVersion');
    expect(givingReadUrl).toContain('mask.fieldPaths=churchReceiptVisible');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeSessionId');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeCheckoutSessionId');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeCheckoutSessionExpiresAt');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeCheckoutUrl');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeCheckoutSessionUrl');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripePaymentIntentId');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripePaymentStatus');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeChargeId');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeCustomerId');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeConnectAccountId');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeRefundId');
    expect(givingReadUrl).toContain('mask.fieldPaths=stripeRefundedChargeId');
    expect(givingReadUrl).toContain('mask.fieldPaths=checkoutSessionId');
    expect(givingReadUrl).toContain('mask.fieldPaths=checkoutUrl');
    expect(givingReadUrl).toContain('mask.fieldPaths=paymentIntentId');
    expect(givingReadUrl).toContain('mask.fieldPaths=chargeId');
    expect(givingReadUrl).toContain('mask.fieldPaths=refundId');
    const receiptReadUrl = calls.find((url) => url.includes('/taxReceipts/receipt-private-smoke')) ?? '';
    expect(receiptReadUrl).toContain('mask.fieldPaths=givingId');
    expect(receiptReadUrl).toContain('mask.fieldPaths=churchId');
    expect(receiptReadUrl).toContain('mask.fieldPaths=userId');
    expect(receiptReadUrl).toContain('mask.fieldPaths=amountCents');
    expect(receiptReadUrl).toContain('mask.fieldPaths=eligibleAmountCents');
    expect(receiptReadUrl).toContain('mask.fieldPaths=currency');
    expect(receiptReadUrl).toContain('mask.fieldPaths=emailSentAt');
    expect(receiptReadUrl).toContain('mask.fieldPaths=pdfStoragePath');
    expect(receiptReadUrl).toContain('mask.fieldPaths=pdfSha256');
    expect(receiptReadUrl).toContain('mask.fieldPaths=pdfByteLength');
    expect(receiptReadUrl).toContain('mask.fieldPaths=pdfRetentionStatus');
    expect(receiptReadUrl).toContain('mask.fieldPaths=pdfRetainedAt');
    expect(receiptReadUrl).toContain('mask.fieldPaths=emailError');
    expect(receiptReadUrl).toContain('mask.fieldPaths=emailFailedAt');
    expect(receiptReadUrl).not.toContain('mask.fieldPaths=sentAt');
    expect(calls.filter((url) => url.includes(':runQuery'))).toHaveLength(4);

    const stdout = writer();
    const stderr = writer();
    const exitCode = await main([], {
      accessTokenReader: () => 'ya29.private-token',
      fetchImpl: async () => new Response(JSON.stringify([
        { document: restDocument('stripeWebhookEvents', 'evt_private_live_checkout', webhookEvent().data) },
      ]), { status: 200 }),
      stdout: stdout.sink,
      stderr: stderr.sink,
    });

    expect(exitCode).toBe(1);
    expect(stdout.output()).not.toContain('evt_private_live_checkout');
    expect(stdout.output()).not.toContain('giving-private-smoke');
    expect(stdout.output()).not.toContain('receipt-private-smoke');
    expect(stderr.output()).toBe('');
  });

  it('prints a passing smoke result without exposing receipt identifiers or proof metadata', async () => {
    const responses = [
      new Response(JSON.stringify([
        { document: restDocument('stripeWebhookEvents', 'evt_newer_refund_noise', webhookEvent({
          type: 'charge.refunded',
          givingId: 'newer-refund-noise',
          processedAt: '2026-05-25T19:00:00Z',
        }).data) },
      ]), { status: 200 }),
      new Response(JSON.stringify([
        { document: restDocument('stripeWebhookEvents', 'evt_private_live_checkout', webhookEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify([]), { status: 200 }),
      new Response(JSON.stringify(restDocument('giving', 'giving-private-smoke', giving().data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', 'receipt-private-smoke', receipt().data)), { status: 200 }),
      new Response(JSON.stringify([
        { document: restDocument('taxReceiptEvents', 'event-private-tax-receipt-email-sent', taxReceiptEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify(retainedPdfObject()), { status: 200 }),
    ];
    const stdout = writer();
    const stderr = writer();

    const exitCode = await main([], {
      accessTokenReader: () => 'ya29.private-token',
      fetchImpl: async () => responses.shift() ?? new Response('{}', { status: 404 }),
      stdout: stdout.sink,
      stderr: stderr.sink,
    });

    const output = stdout.output();
    expect(exitCode).toBe(0);
    expect(output).toContain(
      'Result: live donation smoke check passed without exposing donor, church, giving, receipt, Stripe event, tax receipt event, payment, PDF metadata, amount, currency, or access-token values.'
    );
    expect(output).not.toContain('evt_private_live_checkout');
    expect(output).not.toContain('giving-private-smoke');
    expect(output).not.toContain('receipt-private-smoke');
    expect(output).not.toContain('church-private-smoke');
    expect(output).not.toContain('user-private-smoke');
    expect(output).not.toContain('2500');
    expect(output).not.toContain('USD');
    expect(output).not.toContain('taxReceipts/church-1/2026/receipt-private-smoke.pdf');
    expect(output).not.toContain('aaaaaaaaaaaaaaaa');
    expect(output).not.toContain('ya29.private-token');
    expect(stderr.output()).toBe('');
  });

  it('passes the strict sent-receipt flag through the CLI without exposing receipt identifiers', async () => {
    const responses = [
      new Response(JSON.stringify([
        { document: restDocument('stripeWebhookEvents', 'evt_newer_refund_noise', webhookEvent({
          type: 'charge.refunded',
          givingId: 'newer-refund-noise',
          processedAt: '2026-05-25T19:00:00Z',
        }).data) },
      ]), { status: 200 }),
      new Response(JSON.stringify([
        { document: restDocument('stripeWebhookEvents', 'evt_private_live_checkout', webhookEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify([]), { status: 200 }),
      new Response(JSON.stringify(restDocument('giving', 'giving-private-smoke', giving().data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', 'receipt-private-smoke', receipt().data)), { status: 200 }),
      new Response(JSON.stringify([
        { document: restDocument('taxReceiptEvents', 'event-private-tax-receipt-email-sent', taxReceiptEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify(retainedPdfObject()), { status: 200 }),
    ];
    const stdout = writer();
    const stderr = writer();

    const exitCode = await main(['--require-sent-receipt'], {
      accessTokenReader: () => 'ya29.private-token',
      fetchImpl: async () => responses.shift() ?? new Response('{}', { status: 404 }),
      stdout: stdout.sink,
      stderr: stderr.sink,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output()).toContain('Require sent tax receipt: yes');
    expect(stdout.output()).toContain('Smoke freshness window: 72 hours');
    expect(stdout.output()).toContain('OK   Smoke donation official tax receipt was emailed');
    expect(stdout.output()).toContain('OK   Live Checkout smoke was processed within the 72-hour freshness window');
    expect(stdout.output()).toContain('OK   Smoke donation giving record includes receipt-sent timestamp evidence');
    expect(stdout.output()).toContain('OK   Stored official receipt issue timestamp is within the 72-hour freshness window');
    expect(stdout.output()).toContain('OK   Stored sent receipt email timestamp is within the 72-hour freshness window');
    expect(stdout.output()).toContain('OK   Smoke donation giving receipt-sent timestamp is within the 72-hour freshness window');
    expect(stdout.output()).toContain('OK   Stored sent receipt retained PDF timestamp is within the 72-hour freshness window');
    expect(stdout.output()).toContain('OK   Stored sent receipt PDF retention status is retained');
    expect(stdout.output()).toContain('OK   Retained official receipt PDF object exists in Firebase Storage');
    expect(stdout.output()).toContain('OK   Retained official receipt PDF object byte length matches stored metadata');
    expect(stdout.output()).toContain('OK   Retained official receipt PDF object hash metadata matches stored metadata');
    expect(stdout.output()).toContain('OK   Smoke donation church-facing donor email is blank');
    expect(stdout.output()).toContain('OK   Smoke donation church receipt visibility matches donor anonymity');
    expect(stdout.output()).toContain('OK   Smoke donation church-facing donor label is not an email address');
    expect(stdout.output()).toContain('OK   Smoke donation church-facing giving mirror omits raw Stripe payment fields');
    expect(stdout.output()).toContain('OK   Stored sent receipt has backend email-sent audit evidence');
    expect(stdout.output()).toContain('OK   Stored sent receipt email audit has timestamp evidence');
    expect(stdout.output()).toContain('OK   Stored sent receipt email audit is within the 72-hour freshness window');
    expect(stdout.output()).not.toContain('receipt-private-smoke');
    expect(stdout.output()).not.toContain('event-private-tax-receipt-email-sent');
    expect(stdout.output()).not.toContain('Parishioner');
    expect(stderr.output()).toBe('');
  });

  it('parses and rejects CLI arguments before reading live Firestore', () => {
    expect(parseArgs(['--limit', '50'])).toMatchObject({ limit: 50, projectId: 'kandilo-2f7a9' });
    expect(parseArgs(['--max-age-hours', '96'])).toMatchObject({ maxAgeHours: 96 });
    expect(parseArgs(['--project', 'kandilo-2f7a9'])).toMatchObject({ projectId: 'kandilo-2f7a9' });
    expect(parseArgs(['--require-sent-receipt'])).toMatchObject({ requireSentReceipt: true });
    expect(() => parseArgs(['--limit', '0'])).toThrow('--limit must be a positive integer');
    expect(() => parseArgs(['--limit', '50abc'])).toThrow('--limit must be a positive integer');
    expect(() => parseArgs(['--limit=1.5'])).toThrow('--limit must be a positive integer');
    expect(() => parseArgs(['--max-age-hours', '0'])).toThrow('--max-age-hours must be a positive integer');
    expect(() => parseArgs(['--max-age-hours', '96hours'])).toThrow(
      '--max-age-hours must be a positive integer'
    );
    expect(() => parseArgs(['--project', 'staging-project'])).toThrow('--project must be kandilo-2f7a9');
    expect(() => parseArgs(['--church', 'church-1'])).toThrow('Unknown argument --church');
  });
});
