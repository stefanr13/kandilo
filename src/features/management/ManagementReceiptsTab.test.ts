import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FirestoreGivingRecord, FirestoreTaxReceiptSummaryRecord } from '../../lib/db/giving';
import ManagementReceiptsTab from './ManagementReceiptsTab';

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
    createdAt: new Date('2025-02-01T12:00:00Z'),
    completedAt: new Date('2025-02-01T12:00:00Z'),
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
    includesPreviouslyReceipted: true,
    issuedAt: new Date('2026-01-05T12:00:00Z'),
    emailSentAt: new Date('2026-01-05T12:00:00Z'),
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

function requiredSourceSlice(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function renderReceiptsTab(
  overrides: Partial<Parameters<typeof ManagementReceiptsTab>[0]> = {}
): string {
  return renderToStaticMarkup(createElement(ManagementReceiptsTab, {
    records: [givingRecord({ taxReceiptId: 'giving-1', taxReceiptStatus: 'sent' })],
    annualSummaries: [annualSummary()],
    loading: false,
    error: '',
    notice: '',
    sendingReceiptId: null,
    sendingAnnualReceiptKey: null,
    sendingBulkAnnualReceiptYear: null,
    sendingBulkCorrectedAnnualReceiptYear: null,
    stripeOnboardingLoading: false,
    stripeConnectSetupStatus: {
      churchId: 'church-1',
      stripeConnectAccountConfigured: true,
      stripeConnectRoutingEnabled: false,
      stripeConnectAccountApi: 'v2',
    },
    stripeConnectSetupStatusLoading: false,
    canManageReceipts: true,
    taxReceiptIssuanceState: 'ready',
    taxReceiptIssuanceReady: true,
    onOpenStripeConnectOnboarding: vi.fn(),
    onSendReceipt: vi.fn(),
    onSendCorrectedReceipt: vi.fn(),
    onSendAnnualReceipt: vi.fn(),
    onSendCorrectedAnnualReceipt: vi.fn(),
    onSendChurchAnnualReceipts: vi.fn(),
    onSendChurchCorrectedAnnualReceipts: vi.fn(),
    language: 'English',
    churchTimezone: 'America/New_York',
    ...overrides,
  }));
}

describe('ManagementReceiptsTab', () => {
  it('renders send-focused receipt rows without exposing donor email values', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptId: 'giving-1',
          taxReceiptStatus: 'sent',
          donorEmail: 'member.one@example.com',
        }),
        givingRecord({
          id: 'giving-2',
          taxReceiptId: 'giving-2',
          taxReceiptStatus: 'sent',
        }),
      ],
    });

    expect(html).toContain('Tax Receipts');
    expect(html).toContain('Open Stripe onboarding');
    expect(html).toContain('Stripe connected account is configured');
    expect(html).toContain('Receipt managers can send and resend official receipts by email');
    expect(html).toContain('donor account email, legal name/address, and retained PDFs stay donor-only');
    expect(html).toContain('Member One');
    expect(html).toContain('Email hidden in parish views');
    expect(html).toContain('Annual summaries');
    expect(html).toContain('Bulk annual and corrected annual sends also include eligible privacy-protected donor-years');
    expect(html).toContain('STN-2025-000001');
    expect(html).toContain('Includes individually receipted gifts');
    expect(html).not.toContain('giving-1');
    expect(html).not.toContain('member.one@example.com');
  });

  it('keeps receipt manager send-focused without full receipt view or download hooks', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/management/ManagementReceiptsTab.tsx'),
      'utf8'
    );
    const managementHookSource = readFileSync(
      resolve(process.cwd(), 'src/features/management/useManagementView.ts'),
      'utf8'
    );
    const managementSendHookSource = requiredSourceSlice(
      managementHookSource,
      'const handleSendTaxReceipt',
      'const handleSendChurchAnnualTaxReceipts'
    );
    const html = renderReceiptsTab();

    expect(source).toContain('onSendReceipt: (givingId: string) => void;');
    expect(source).toContain('onSendAnnualReceipt: (userId: string, year: number');
    expect(managementSendHookSource).toContain('await sendTaxReceipt({ givingId });');
    expect(managementSendHookSource).toContain('await sendCorrectedTaxReceipt({ givingId });');
    expect(managementSendHookSource).toContain(
      'await sendAnnualTaxReceipt({ churchId, userId, year, acknowledgePreviouslyReceipted });'
    );
    expect(managementSendHookSource).toContain(
      'await sendCorrectedAnnualTaxReceipt({ churchId, userId, year, acknowledgePreviouslyReceipted });'
    );
    expect(managementSendHookSource).not.toContain('result.receiptId');
    expect(managementSendHookSource).not.toContain('getTaxReceipt(');
    expect(managementSendHookSource).not.toContain('downloadTaxReceiptPdf(');
    expect(source).not.toContain('getTaxReceipt');
    expect(source).not.toContain('downloadTaxReceiptPdf');
    expect(source).not.toContain('onViewReceipt');
    expect(source).not.toContain('onDownloadReceipt');
    expect(source).not.toContain('Eye,');
    expect(source).not.toContain('Download,');
    expect(source).not.toContain('Printer,');
    expect(source).toContain('unsupportedJurisdiction: recordUnsupportedJurisdiction');
    expect(source).toContain('summaryUnsupportedJurisdiction');
    expect(source).toContain("taxReceiptIssuanceState === 'unsupported_jurisdiction'");
    expect(source).toContain('taxReceiptIssuanceUnsupported: taxReceiptIssuanceState === \'unsupported_jurisdiction\'');
    expect(source).toContain('formatTaxReceiptAmount(amountCents, currency)');
    expect(source).toContain('? t.unsupportedJurisdiction');
    expect(html).toContain('Full receipt records');
    expect(html).toContain('stay donor-only');
    expect(html).not.toContain('View tax receipt');
    expect(html).not.toContain('Download tax receipt');
    expect(html).not.toContain('Print');
  });

  it('labels repeat receipt delivery as resend actions for receipt managers', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptId: 'giving-1',
          taxReceiptNumber: 'STN-2025-000777',
          taxReceiptStatus: 'sent',
        }),
      ],
      annualSummaries: [
        annualSummary({
          status: 'sent',
          receiptNumber: 'STN-2025-000888',
        }),
      ],
    });

    expect(html).toContain('Resend');
    expect(html).toContain('Resend annual');
    expect(html).toContain('STN-2025-000777');
    expect(html).toContain('STN-2025-000888');
  });

  it('renders annual summary rows even when recent giving records are capped out', () => {
    const html = renderReceiptsTab({
      records: [],
      annualSummaries: [
        annualSummary({
          receiptId: 'annual-capped-history',
          donorLabel: 'Historic Donor',
          receiptYear: 2024,
          receiptNumber: 'STN-2024-000042',
          amountCents: 18000,
          eligibleAmountCents: 18000,
          donationCount: 4,
        }),
      ],
    });

    expect(html).toContain('Annual summaries');
    expect(html).toContain('Historic Donor');
    expect(html).toContain('2024 Annual summary');
    expect(html).toContain('STN-2024-000042');
    expect(html).toContain('$180.00 / 4');
    expect(html).toContain('Resend annual');
  });

  it('labels settled corrected annual summaries as corrected resends without full receipt details', () => {
    const html = renderReceiptsTab({
      annualSummaries: [
        annualSummary({
          correctedReceipt: true,
          receiptId: 'annual-corrected-private-id',
          receiptNumber: 'STN-2025-000889',
        }),
      ],
    });

    expect(html).toContain('Resend corrected annual');
    expect(html).toContain('STN-2025-000889');
    expect(html).not.toContain('annual-corrected-private-id');
  });

  it('keeps existing annual delivery failures retryable without exposing full receipt details', () => {
    const html = renderReceiptsTab({
      annualSummaries: [
        annualSummary({
          status: 'error',
          receiptId: 'annual-provider-error',
          receiptNumber: 'STN-2025-000999',
          emailError: 'tax_receipt_provider_rejected',
        }),
      ],
    });

    expect(html).toContain('Review - STN-2025-000999');
    expect(html).toContain('email provider rejected');
    expect(html).toContain('Retry send');
    expect(html).toContain('STN-2025-000999');
    expect(html).not.toContain('annual-provider-error');
  });

  it('labels donor-profile-incomplete receipt rows as retryable without exposing donor details', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          id: 'giving-profile-needed',
          taxReceiptId: '',
          taxReceiptNumber: '',
          taxReceiptStatus: 'ready',
          taxReceiptError: 'tax_receipt_donor_profile_incomplete',
        }),
      ],
    });

    expect(html).toContain('Donor profile needed');
    expect(html).toContain('Retry send');
    expect(html).toContain('The donor must complete their private legal receipt name and mailing address');
    expect(html).toContain('Email hidden in parish views');
    expect(html).not.toContain('tax_receipt_donor_profile_incomplete');
    expect(html).not.toContain('member.one@example.com');
  });

  it('labels donor-profile-incomplete annual summaries as retryable without exposing receipt contents', () => {
    const html = renderReceiptsTab({
      records: [],
      annualSummaries: [
        annualSummary({
          id: 'annual-profile-needed',
          receiptId: '',
          status: 'error',
          receiptNumber: '',
          emailError: 'tax_receipt_donor_profile_incomplete',
          includesPreviouslyReceipted: false,
        }),
      ],
    });

    expect(html).toContain('Donor profile needed');
    expect(html).toContain('Retry send');
    expect(html).toContain('The donor must complete their private legal receipt name and mailing address');
    expect(html).toContain('Email hidden in parish views');
    expect(html).not.toContain('tax_receipt_donor_profile_incomplete');
    expect(html).not.toContain('View tax receipt');
    expect(html).not.toContain('Download tax receipt');
  });

  it('labels verified-email annual summaries as retryable without exposing receipt contents', () => {
    const html = renderReceiptsTab({
      records: [],
      annualSummaries: [
        annualSummary({
          id: 'annual-verified-email-needed',
          receiptId: '',
          status: 'error',
          receiptNumber: '',
          emailError: 'tax_receipt_missing_email_or_amount',
          includesPreviouslyReceipted: false,
        }),
      ],
    });

    expect(html).toContain('Ready');
    expect(html).toContain('Retry send');
    expect(html).toContain('Ask the donor to verify their account email');
    expect(html).toContain('Email hidden in parish views');
    expect(html).not.toContain('tax_receipt_missing_email_or_amount');
    expect(html).not.toContain('View tax receipt');
    expect(html).not.toContain('Download tax receipt');
  });

  it('does not offer settled annual resends when visible donor-year giving now needs correction', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptId: 'giving-1',
          taxReceiptNumber: 'STN-2025-000777',
          taxReceiptStatus: 'sent',
          taxReceiptCorrectionRequired: true,
          taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 2000,
        }),
      ],
      annualSummaries: [
        annualSummary({
          status: 'sent',
          receiptNumber: 'STN-2025-000888',
          correctionRequired: false,
          correctionReason: '',
        }),
      ],
    });

    expect(html).toContain('Send corrected');
    expect(html).toContain('Review');
    expect(html).not.toContain('Resend annual');
  });

  it('shows matching corrected annual partial-refund receipts as resendable instead of review-only', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          amountCents: 5000,
          amount: 50,
          taxReceiptId: 'giving-1',
          taxReceiptNumber: 'STN-2025-000777',
          taxReceiptStatus: 'sent',
          taxReceiptCorrectionRequired: true,
          taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 2000,
        }),
      ],
      annualSummaries: [
        annualSummary({
          status: 'sent',
          receiptNumber: 'STN-2025-000999',
          amountCents: 3000,
          eligibleAmountCents: 3000,
          correctionRequired: false,
          correctionReason: '',
        }),
      ],
    });

    expect(html).toContain('STN-2025-000999');
    expect(html).toContain('Resend annual');
  });

  it('shows the corrected annual batch action when settled annual donor-years now need partial-refund correction', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptId: 'giving-1',
          taxReceiptNumber: 'STN-2025-000777',
          taxReceiptStatus: 'sent',
          taxReceiptCorrectionRequired: true,
          taxReceiptCorrectionReason: 'stripe_partial_refund_review_required',
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 2000,
        }),
      ],
      annualSummaries: [
        annualSummary({
          status: 'sent',
          receiptNumber: 'STN-2025-000888',
          correctionRequired: false,
          correctionReason: '',
        }),
      ],
    });

    expect(html).toContain('Send corrected annual 2025');
    expect(html).toContain('Send corrected');
    expect(html).toContain('Review');
    expect(html).not.toContain('Resend annual');
  });

  it('keeps corrected annual batch actions available without staff-visible partial-refund rows', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/management/ManagementReceiptsTab.tsx'),
      'utf8'
    );
    const html = renderReceiptsTab({
      records: [],
      annualSummaries: [
        annualSummary({
          donorLabel: 'Annual Donor',
          correctionRequired: false,
          correctionReason: '',
        }),
      ],
    });

    expect(source).toContain('The corrected annual batch is year-wide and privacy-preserving');
    expect(source).not.toContain('annualCorrectionYears.has(year)');
    expect(html).toContain('Send all annual 2025');
    expect(html).toContain('Send corrected annual 2025');
    expect(html).toContain('Annual Donor');
    expect(html).not.toContain('Hidden Donor');
  });

  it('keeps individual annual confirmation labels separate from batch confirmation labels', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/management/ManagementReceiptsTab.tsx'),
      'utf8'
    );

    expect(source).toContain('? `${t.confirmSendAllAnnual} ${year}`');
    expect(source).toContain('? `${t.confirmSendAllCorrectedAnnual} ${year}`');
    expect(source.match(/\? t\.confirmAnnualSend/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source.match(/\? t\.confirmCorrectedAnnualSend/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(source).not.toContain('confirmingAnnual\n                              ? t.confirmSendAllAnnual');
    expect(source).not.toContain('confirmingCorrectedAnnual\n                            ? t.confirmSendAllCorrectedAnnual');
  });

  it('uses Stripe partial-refund metadata for corrected annual actions before the review code is mirrored', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptStatus: 'ready',
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 2000,
        }),
      ],
      annualSummaries: [
        annualSummary({
          status: 'sent',
          receiptNumber: 'STN-2025-000888',
          correctionRequired: false,
          correctionReason: '',
        }),
      ],
    });

    expect(html).toContain('Send corrected annual 2025');
    expect(html).toContain('Send corrected');
    expect(html).toContain('Review');
    expect(html).not.toContain('Resend annual');
  });

  it('keeps invalid partial-refund metadata review-only instead of advertising corrected sends', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptStatus: 'ready',
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 0,
        }),
      ],
      annualSummaries: [
        annualSummary({
          status: 'sent',
          receiptNumber: 'STN-2025-000888',
          correctionRequired: false,
          correctionReason: '',
        }),
      ],
    });

    expect(html).toContain('Review');
    expect(html).toContain('Send corrected annual 2025');
    expect(html).not.toMatch(/Send corrected<\/button>/);
    expect(html).not.toContain('Resend annual');
  });

  it('does not trust annual summary correction reasons over invalid current refund metadata', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptStatus: 'ready',
          stripeRefundStatus: 'partially_refunded',
          stripeAmountRefundedCents: 0,
        }),
      ],
      annualSummaries: [
        annualSummary({
          status: 'error',
          receiptNumber: '',
          correctionRequired: true,
          correctionReason: 'stripe_partial_refund_review_required',
        }),
      ],
    });

    expect(html).toContain('Review');
    expect(html).toContain('Send corrected annual 2025');
    expect(html).not.toMatch(/Send corrected<\/button>/);
    expect(html).not.toContain('Retry send');
  });

  it('keeps Stripe onboarding disabled until a connected account is configured', () => {
    const html = renderReceiptsTab({
      stripeConnectSetupStatus: {
        churchId: 'church-1',
        stripeConnectAccountConfigured: false,
        stripeConnectRoutingEnabled: false,
        stripeConnectAccountApi: 'not_configured',
      },
    });

    expect(html).toContain('Ask a SuperAdmin to create or attach a Stripe connected account');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('acct_');
  });

  it('keeps Stripe onboarding disabled while connected account setup status is loading', () => {
    const html = renderReceiptsTab({
      stripeConnectSetupStatus: null,
      stripeConnectSetupStatusLoading: true,
    });

    expect(html).toContain('Checking Stripe connected-account setup');
    expect(html).toContain('disabled=""');
  });

  it('keeps Stripe onboarding disabled when connected account setup status is unknown', () => {
    const html = renderReceiptsTab({
      stripeConnectSetupStatus: null,
      stripeConnectSetupStatusLoading: false,
    });

    expect(html).toContain('Stripe connected-account setup could not be confirmed yet');
    expect(html).toContain('Ask a SuperAdmin to confirm setup');
    expect(html).toContain('disabled=""');
  });

  it('surfaces the Canada/CRA blocker instead of generic not-enabled receipt copy', () => {
    const html = renderReceiptsTab({
      taxReceiptIssuanceState: 'unsupported_jurisdiction',
      taxReceiptIssuanceReady: false,
      records: [
        givingRecord({
          taxReceiptStatus: 'ready',
        }),
      ],
      annualSummaries: [],
    });

    expect(html).toContain('Canadian/CRA official receipts are not available yet');
    expect(html).toContain('Canadian receipts unavailable');
    expect(html).not.toContain('Tax receipt settings need to be enabled');
  });

  it('keeps the receipt tab restricted when the viewer lacks receipt permissions', () => {
    const html = renderReceiptsTab({ canManageReceipts: false });

    expect(html).toContain('Finance access required');
    expect(html).not.toContain('member.one@example.com');
    expect(html).not.toContain('STN-2025-000001');
  });

  it('flags receipt-number-only annual candidates as previously receipted', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptNumber: 'STN-2025-000123',
          taxReceiptStatus: 'ready',
        }),
      ],
      annualSummaries: [],
    });

    expect(html).toContain('STN-2025-000123');
    expect(html).toContain('Includes individually receipted gifts');
  });

  it('does not flag unassigned receipt-number annual candidates as previously receipted', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptId: 'receipt-private-id',
          taxReceiptNumber: 'unassigned',
          taxReceiptStatus: 'sent',
        }),
      ],
      annualSummaries: [],
    });

    expect(html).not.toContain('Includes individually receipted gifts');
  });

  it('shows the annual duplicate-claim warning when only the summary mirror has the flag', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptId: '',
          taxReceiptNumber: '',
          taxReceiptStatus: 'ready',
        }),
      ],
      annualSummaries: [
        annualSummary({
          includesPreviouslyReceipted: true,
        }),
      ],
    });

    expect(html).toContain('Includes individually receipted gifts');
  });

  it('does not infer exact single-donation annual coverage from a summary mirror alone', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          taxReceiptId: '',
          taxReceiptNumber: '',
          taxReceiptStatus: 'ready',
        }),
      ],
      annualSummaries: [
        annualSummary({
          status: 'sent',
          correctionRequired: false,
          correctionReason: '',
        }),
      ],
    });

    expect(html).not.toContain('Included in annual');
    expect(html).toContain('STN-2025-000001');
  });

  it('marks mixed-currency annual donor years for review instead of offering a consolidated send', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({
          id: 'giving-usd',
          currency: 'USD',
          amountCents: 5000,
          amount: 50,
        }),
        givingRecord({
          id: 'giving-cad',
          currency: 'CAD',
          amountCents: 7000,
          amount: 70,
        }),
      ],
      annualSummaries: [],
    });

    expect(html).toContain('Mixed currency');
    expect(html).toContain('missing, unsupported, or mixed currency data');
    expect(html).toContain('Review');
  });

  it('marks missing or unsupported-currency annual donor years for review instead of offering a consolidated send', () => {
    for (const currency of ['', 'EUR']) {
      const html = renderReceiptsTab({
        records: [
          givingRecord({
            id: `giving-${currency || 'missing'}-currency`,
            currency,
            amountCents: 5000,
            amount: 50,
          }),
        ],
        annualSummaries: [],
      });

      expect(html).toContain('Mixed currency');
      expect(html).toContain('missing, unsupported, or mixed currency data');
      expect(html).toContain('Review');
      expect(html).not.toMatch(/Send annual<\/button>/);
    }
  });

  it('defensively excludes private donor rows from church receipt views', () => {
    const html = renderReceiptsTab({
      records: [
        givingRecord({ taxReceiptId: 'giving-1', taxReceiptStatus: 'sent' }),
        givingRecord({
          id: 'giving-legacy-visible',
          userId: 'member-legacy',
          donorName: 'Legacy Donor',
          amountCents: 7700,
          amount: 77,
          anonymous: false,
          churchReceiptVisible: false,
          taxReceiptId: 'giving-legacy-visible',
          taxReceiptNumber: 'STN-2025-HIDDEN-LEGACY',
          taxReceiptStatus: 'sent',
        }),
        givingRecord({
          id: 'giving-email-label-hidden',
          userId: 'member-email-label',
          donorName: 'member-email-label@example.com',
          donorNamePublicSafe: true,
          amountCents: 7700,
          amount: 77,
          anonymous: false,
          churchReceiptVisible: true,
          taxReceiptId: 'giving-email-label-hidden',
          taxReceiptNumber: 'STN-2025-HIDDEN-EMAIL-LABEL',
          taxReceiptStatus: 'sent',
        }),
        givingRecord({
          id: 'giving-reserved-anonymous-label',
          userId: 'member-reserved-label',
          donorName: 'Anonymous donor',
          donorNamePublicSafe: true,
          amountCents: 5500,
          amount: 55,
          anonymous: false,
          churchReceiptVisible: true,
          taxReceiptId: 'giving-reserved-anonymous-label',
          taxReceiptNumber: 'STN-2025-HIDDEN-RESERVED-LABEL',
          taxReceiptStatus: 'sent',
        }),
        givingRecord({
          id: 'giving-anonymous',
          userId: 'member-private',
          donorName: 'Hidden Donor',
          amountCents: 9900,
          amount: 99,
          anonymous: true,
          taxReceiptId: 'giving-anonymous',
          taxReceiptNumber: 'STN-2025-HIDDEN-SINGLE',
          taxReceiptStatus: 'sent',
        }),
        givingRecord({
          id: 'giving-pending',
          userId: 'member-pending',
          donorName: 'Pending Donor',
          amountCents: 8800,
          amount: 88,
          status: 'pending',
          taxReceiptId: '',
          taxReceiptStatus: 'not_configured',
        }),
        givingRecord({
          id: 'giving-failed',
          userId: 'member-failed',
          donorName: 'Failed Donor',
          amountCents: 6600,
          amount: 66,
          status: 'failed',
          taxReceiptId: '',
          taxReceiptStatus: 'not_configured',
        }),
      ],
      annualSummaries: [
        annualSummary(),
        annualSummary({
          id: 'annual-legacy-visible',
          receiptId: 'annual-legacy-visible',
          userId: 'member-legacy',
          donorLabel: 'Legacy Donor',
          donorAnonymous: false,
          churchReceiptVisible: false,
          receiptNumber: 'STN-2025-HIDDEN-LEGACY-ANNUAL',
          amountCents: 7700,
          eligibleAmountCents: 7700,
        }),
        annualSummary({
          id: 'annual-hidden',
          receiptId: 'annual-hidden',
          userId: 'member-private',
          donorLabel: 'Hidden Donor',
          donorAnonymous: true,
          receiptNumber: 'STN-2025-HIDDEN-ANNUAL',
          amountCents: 9900,
          eligibleAmountCents: 9900,
        }),
        annualSummary({
          id: 'annual-marker-only-hidden',
          receiptId: 'annual-marker-only-hidden',
          userId: 'member-marker-only',
          donorLabel: 'Marker Only Donor',
          donorAnonymous: false,
          churchReceiptVisible: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 0,
          receiptNumber: 'STN-2025-HIDDEN-MARKER',
          amountCents: 8800,
          eligibleAmountCents: 8800,
        }),
        annualSummary({
          id: 'annual-blank-label-hidden',
          receiptId: 'annual-blank-label-hidden',
          userId: 'member-blank-label',
          donorLabel: '',
          donorAnonymous: false,
          churchReceiptVisible: true,
          donorLabelPublicSafe: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 2,
          receiptNumber: 'STN-2025-HIDDEN-BLANK-LABEL',
          amountCents: 6600,
          eligibleAmountCents: 6600,
        }),
        annualSummary({
          id: 'annual-email-label-hidden',
          receiptId: 'annual-email-label-hidden',
          userId: 'member-email-label',
          donorLabel: 'member-email-label@example.com',
          donorAnonymous: false,
          churchReceiptVisible: true,
          donorLabelPublicSafe: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 2,
          receiptNumber: 'STN-2025-HIDDEN-EMAIL-LABEL-ANNUAL',
          amountCents: 5500,
          eligibleAmountCents: 5500,
        }),
        annualSummary({
          id: 'annual-reserved-anonymous-label',
          receiptId: 'annual-reserved-anonymous-label',
          userId: 'member-reserved-label',
          donorLabel: 'Anonymous donor',
          donorAnonymous: false,
          churchReceiptVisible: true,
          donorLabelPublicSafe: true,
          receiptManagerSummarySafe: true,
          receiptManagerSummarySafeVersion: 2,
          receiptNumber: 'STN-2025-HIDDEN-RESERVED-LABEL-ANNUAL',
          amountCents: 5500,
          eligibleAmountCents: 5500,
        }),
      ],
    });

    expect(html).toContain('Member One');
    expect(html).toContain('STN-2025-000001');
    expect(html).not.toContain('Legacy Donor');
    expect(html).not.toContain('Hidden Donor');
    expect(html).not.toContain('Marker Only Donor');
    expect(html).not.toContain('Pending Donor');
    expect(html).not.toContain('Failed Donor');
    expect(html).not.toContain('Anonymous donor');
    expect(html).not.toContain('STN-2025-HIDDEN-LEGACY');
    expect(html).not.toContain('STN-2025-HIDDEN-EMAIL-LABEL');
    expect(html).not.toContain('STN-2025-HIDDEN-RESERVED-LABEL');
    expect(html).not.toContain('STN-2025-HIDDEN-LEGACY-ANNUAL');
    expect(html).not.toContain('STN-2025-HIDDEN-SINGLE');
    expect(html).not.toContain('STN-2025-HIDDEN-ANNUAL');
    expect(html).not.toContain('STN-2025-HIDDEN-MARKER');
    expect(html).not.toContain('STN-2025-HIDDEN-BLANK-LABEL');
    expect(html).not.toContain('STN-2025-HIDDEN-EMAIL-LABEL-ANNUAL');
    expect(html).not.toContain('STN-2025-HIDDEN-RESERVED-LABEL-ANNUAL');
    expect(html).not.toContain('member-email-label@example.com');
  });

  it('requires explicit confirmation before acknowledging previously receipted annual sends', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/management/ManagementReceiptsTab.tsx'),
      'utf8'
    );
    const localizationSource = readFileSync(
      resolve(process.cwd(), 'src/localization/extra.ts'),
      'utf8'
    );

    expect(source).toContain('pendingAnnualSend');
    expect(source).toContain('const confirmAnnualSend =');
    expect(source).toContain('needsPreviouslyReceiptedAcknowledgement');
    expect(source).toContain('setPendingAnnualSend({ kind, key: annualKey });');
    expect(source).toContain('onSendAnnualReceipt(userId, year, needsPreviouslyReceiptedAcknowledgement);');
    expect(source).toContain('onSendCorrectedAnnualReceipt(userId, year, needsPreviouslyReceiptedAcknowledgement);');
    expect(source).toContain('onSendChurchAnnualReceipts(year, true);');
    expect(source).toContain('onSendChurchCorrectedAnnualReceipts(year, true);');
    expect(source).toContain('pendingBulkSend &&');
    expect(source).toContain('{t.previouslyReceiptedAckRequired}');
    expect(source).toContain('aria-pressed={confirmingCurrentAction}');
    expect(localizationSource).toContain("confirmAnnualSend: 'Confirm annual send'");
    expect(localizationSource).toContain("confirmCorrectedAnnualSend: 'Confirm corrected send'");
    expect(localizationSource).toContain("confirmSendAllAnnual: 'Confirm all annual'");
    expect(localizationSource).toContain("confirmSendAllCorrectedAnnual: 'Confirm all corrected'");
  });
});
