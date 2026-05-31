import { Timestamp } from 'firebase/firestore';
import { describe, expect, it, vi } from 'vitest';
import { mapFirestoreEvent } from './events';
import { mapGivingRecord, mapTaxReceiptRecord, mapTaxReceiptSummaryRecord } from './giving';
import { mapFirestoreMember } from './memberships';
import { mapFirestoreNewsletter } from './newsletters';
import { mapFirestorePost } from './posts';

vi.mock('../firebase/firestore', () => ({ db: {} }));

function docSnapshot(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  };
}

describe('Firestore document mappers', () => {
  it('maps event timestamps and defaults', () => {
    const start = new Date('2026-05-18T10:00:00Z');
    const end = new Date('2026-05-18T11:00:00Z');

    expect(
      mapFirestoreEvent(
        docSnapshot('event-1', {
          churchId: 'church-1',
          title: 'Liturgy',
          description: 'Sunday service',
          startTime: Timestamp.fromDate(start),
          endTime: Timestamp.fromDate(end),
          location: 'Nave',
          createdBy: 'user-1',
          notificationSent: true,
        })
      )
    ).toMatchObject({
      id: 'event-1',
      churchId: 'church-1',
      title: 'Liturgy',
      startTime: start,
      endTime: end,
      category: 'Divine Liturgy',
      notificationSent: true,
    });
  });

  it('maps church members with safe public-directory defaults', () => {
    expect(
      mapFirestoreMember(
        docSnapshot('user-1', {
          displayName: 'Ana Member',
          email: 'ana@example.com',
          role: 'admin',
          status: 'active',
          joinedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          showInDirectory: true,
        })
      )
    ).toMatchObject({
      id: 'user-1',
      displayName: 'Ana Member',
      email: 'ana@example.com',
      role: 'admin',
      status: 'active',
      joinedAt: 'May 2026',
      invitedBy: null,
      showInDirectory: true,
    });
  });

  it('maps newsletters and post publication dates', () => {
    const publishedAt = new Date('2026-05-17T12:00:00Z');

    expect(
      mapFirestoreNewsletter(
        docSnapshot('newsletter-1', {
          churchId: 'church-1',
          title: 'Weekly Bulletin',
          status: 'published',
          publishedAt: Timestamp.fromDate(publishedAt),
          emailSent: true,
        })
      )
    ).toMatchObject({
      id: 'newsletter-1',
      churchId: 'church-1',
      title: 'Weekly Bulletin',
      status: 'published',
      publishedAt,
      emailSent: true,
    });

    expect(
      mapFirestorePost(
        docSnapshot('post-1', {
          title: 'Parish Update',
          status: 'draft',
          createdAt: Timestamp.fromDate(publishedAt),
          updatedAt: Timestamp.fromDate(publishedAt),
          publishedAt: Timestamp.fromDate(publishedAt),
        }),
        'church-1',
        'published'
      )
    ).toMatchObject({
      id: 'post-1',
      churchId: 'church-1',
      title: 'Parish Update',
      status: 'published',
      createdAt: publishedAt,
      updatedAt: publishedAt,
      publishedAt,
    });
  });

  it('maps full donor-only tax receipt details', () => {
    const issuedAt = new Date('2026-05-24T16:00:00Z');
    const receivedAt = new Date('2026-05-23T16:00:00Z');

    expect(
      mapTaxReceiptRecord(
        docSnapshot('receipt-1', {
          churchId: 'church-1',
          churchName: 'St. Nicholas',
          userId: 'member-1',
          givingId: 'giving-1',
          givingIds: [' giving-1 ', 12, '', 'giving-2'],
          kind: 'single',
          status: 'sent',
          receiptNumber: 'STN-2026-000001',
          receiptYear: 2026,
          organizationName: 'St. Nicholas Orthodox Church',
          organizationAddress: '123 Church Street, Chicago, IL',
          organizationTaxId: '12-3456789',
          donorName: 'Mira Legal Donor',
          donorAddress: '10 Donor Street, Chicago, IL 60601, US',
          donorEmail: 'member@example.com',
          amountCents: 7500,
          originalAmountCents: 10000,
          refundedAmountCents: 2500,
          currency: 'USD',
          purpose: 'General Fund',
          correctionForReceiptId: 'receipt-original',
          correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
          correctedAt: Timestamp.fromDate(issuedAt),
          contributions: [
            {
              dateLabel: 'May 23, 2026',
              purpose: 'General Fund',
              amountCents: 7500,
              eligibleAmountCents: 7500,
              currency: 'USD',
            },
          ],
          receivedAt: Timestamp.fromDate(receivedAt),
          issuedAt: Timestamp.fromDate(issuedAt),
          pdfStoragePath: 'taxReceipts/church-1/2026/receipt-1.pdf',
          pdfSha256: 'a'.repeat(64),
          pdfByteLength: 24812,
          pdfRetainedAt: Timestamp.fromDate(issuedAt),
          pdfRetentionStatus: 'retained',
          receiptIssueLocation: 'Edmonton, Alberta',
          authorizedSignerName: 'Fr. Nicholas',
          authorizedSignerTitle: 'Rector',
          secureElectronicSignatureConfigured: true,
          receiptCopiesRetentionConfirmed: true,
          emailError: 'tax_receipt_provider_rejected',
        })
      )
    ).toMatchObject({
      id: 'receipt-1',
      receiptNumber: 'STN-2026-000001',
      givingIds: ['giving-1', 'giving-2'],
      donorName: 'Mira Legal Donor',
      donorAddress: '10 Donor Street, Chicago, IL 60601, US',
      donorEmail: 'member@example.com',
      organizationTaxId: '12-3456789',
      amountCents: 7500,
      eligibleAmountCents: 7500,
      originalAmountCents: 10000,
      refundedAmountCents: 2500,
      correctionForReceiptId: 'receipt-original',
      correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
      correctedAt: issuedAt,
      pdfStoragePath: 'taxReceipts/church-1/2026/receipt-1.pdf',
      pdfSha256: 'a'.repeat(64),
      pdfByteLength: 24812,
      pdfRetainedAt: issuedAt,
      pdfRetentionStatus: 'retained',
      receiptIssueLocation: 'Edmonton, Alberta',
      authorizedSignerName: 'Fr. Nicholas',
      authorizedSignerTitle: 'Rector',
      secureElectronicSignatureConfigured: true,
      receiptCopiesRetentionConfirmed: true,
      emailError: 'tax_receipt_provider_rejected',
      contributions: [
        {
          dateLabel: 'May 23, 2026',
          purpose: 'General Fund',
          amountCents: 7500,
          eligibleAmountCents: 7500,
          currency: 'USD',
        },
      ],
      receivedAt,
      issuedAt,
    });
  });

  it('maps minimal annual tax receipt summaries without donor-private receipt fields', () => {
    const issuedAt = new Date('2026-05-24T16:00:00Z');

    expect(
      mapTaxReceiptSummaryRecord(
        docSnapshot('summary-1', {
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
          jurisdiction: 'CA',
          receiptYear: 2025,
          receiptNumber: 'STN-2025-A000001',
          amountCents: 25000,
          eligibleAmountCents: 24000,
          currency: 'USD',
          donationCount: 4,
          includesPreviouslyReceipted: true,
          correctedReceipt: true,
          emailError: 'resend_api_key_invalid_format',
          issuedAt: Timestamp.fromDate(issuedAt),
        })
      )
    ).toMatchObject({
      id: 'summary-1',
      receiptId: 'annual-1',
      donorLabel: 'Member One',
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      kind: 'annual',
      status: 'sent',
      jurisdiction: 'CA',
      receiptYear: 2025,
      receiptNumber: 'STN-2025-A000001',
      amountCents: 25000,
      eligibleAmountCents: 24000,
      donationCount: 4,
      includesPreviouslyReceipted: true,
      correctedReceipt: true,
      emailError: 'resend_api_key_invalid_format',
      issuedAt,
    });
  });

  it('hides public fallback receipt numbers from mapped portal records', () => {
    expect(
      mapGivingRecord(
        docSnapshot('giving-unassigned', {
          taxReceiptNumber: 'unassigned',
        })
      )
    ).toMatchObject({
      taxReceiptNumber: '',
    });

    expect(
      mapTaxReceiptRecord(
        docSnapshot('receipt-unassigned', {
          receiptNumber: 'unassigned',
        })
      )
    ).toMatchObject({
      receiptNumber: '',
    });

    expect(
      mapTaxReceiptSummaryRecord(
        docSnapshot('summary-unassigned', {
          receiptNumber: 'unassigned',
        })
      )
    ).toMatchObject({
      receiptNumber: '',
    });
  });

  it('does not default missing or unsupported receipt currencies into USD', () => {
    expect(
      mapGivingRecord(
        docSnapshot('giving-missing-currency', {
          amountCents: 5000,
          status: 'completed',
        })
      )
    ).toMatchObject({
      currency: '',
    });

    expect(
      mapTaxReceiptRecord(
        docSnapshot('receipt-unsupported-currency', {
          amountCents: 5000,
          currency: 'EUR',
          contributions: [
            {
              amountCents: 5000,
              currency: 'EUR',
            },
          ],
        })
      )
    ).toMatchObject({
      currency: '',
      contributions: [
        expect.objectContaining({
          currency: '',
        }),
      ],
    });

    expect(
      mapTaxReceiptSummaryRecord(
        docSnapshot('summary-missing-currency', {
          amountCents: 5000,
        })
      )
    ).toMatchObject({
      currency: '',
    });
  });

  it('strips embedded email-shaped values and legacy donor email from public giving and summary donor labels', () => {
    expect(
      mapGivingRecord(
        docSnapshot('giving-1', {
          churchId: 'church-1',
          userId: 'member-1',
          donorName: 'Contact member@example.com',
          donorEmail: 'legacy@example.com',
          donorNamePublicSafe: false,
          churchReceiptVisible: true,
          amountCents: 5000,
          currency: 'USD',
          status: 'completed',
          taxReceiptEmailError: 'resend_api_key_missing',
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 1250,
        })
      )
    ).toMatchObject({
      donorName: '',
      donorEmail: '',
      donorNamePublicSafe: false,
      churchReceiptVisible: false,
      anonymous: true,
      taxReceiptEmailError: 'resend_api_key_missing',
      stripeRefundStatus: 'partially_refunded',
      stripeAmountRefundedCents: 1250,
    });

    expect(
      mapTaxReceiptSummaryRecord(
        docSnapshot('summary-legacy-email', {
          receiptId: 'annual-legacy-email',
          churchId: 'church-1',
          userId: 'member-1',
          donorLabel: 'Contact member@example.com',
          donorAnonymous: false,
          churchReceiptVisible: false,
          donorLabelPublicSafe: true,
          kind: 'annual',
          status: 'sent',
          receiptYear: 2025,
          amountCents: 5000,
        })
      )
    ).toMatchObject({
      donorLabel: '',
      donorAnonymous: false,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
    });
  });

  it('strips reserved anonymous labels from explicitly non-anonymous public receipt labels', () => {
    expect(
      mapGivingRecord(
        docSnapshot('giving-reserved-anonymous-label', {
          churchId: 'church-1',
          userId: 'member-1',
          anonymous: false,
          donorName: 'Anonymous donor',
          donorEmail: '',
          donorNamePublicSafe: true,
          churchReceiptVisible: true,
          receiptManagerGivingSafeVersion: 1,
          amountCents: 5000,
          currency: 'USD',
          status: 'completed',
        })
      )
    ).toMatchObject({
      donorName: '',
      donorEmail: '',
      donorNamePublicSafe: false,
      churchReceiptVisible: false,
      receiptManagerGivingSafeVersion: 0,
      anonymous: false,
    });

    expect(
      mapTaxReceiptSummaryRecord(
        docSnapshot('summary-reserved-anonymous-label', {
          receiptId: 'annual-reserved-anonymous-label',
          churchId: 'church-1',
          userId: 'member-1',
          donorLabel: 'Anonymous donor',
          donorAnonymous: false,
          churchReceiptVisible: true,
          donorLabelPublicSafe: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 2,
          kind: 'annual',
          status: 'sent',
          receiptYear: 2025,
          amountCents: 5000,
        })
      )
    ).toMatchObject({
      donorLabel: '',
      donorAnonymous: false,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
    });
  });

  it('treats missing anonymity metadata as donor-private in public giving and annual summary mappers', () => {
    expect(
      mapGivingRecord(
        docSnapshot('giving-unclassified', {
          churchId: 'church-1',
          userId: 'member-1',
          donorName: 'Member One',
          donorEmail: 'legacy@example.com',
          donorNamePublicSafe: true,
          amountCents: 5000,
          currency: 'USD',
          status: 'completed',
        })
      )
    ).toMatchObject({
      donorName: '',
      donorEmail: '',
      donorNamePublicSafe: false,
      churchReceiptVisible: false,
      anonymous: true,
    });

    expect(
      mapTaxReceiptSummaryRecord(
        docSnapshot('summary-unclassified', {
          receiptId: 'annual-unclassified',
          churchId: 'church-1',
          userId: 'member-1',
          donorLabel: 'Member One',
          kind: 'annual',
          status: 'sent',
          receiptYear: 2025,
          amountCents: 5000,
        })
      )
    ).toMatchObject({
      donorLabel: '',
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
    });
  });
});
