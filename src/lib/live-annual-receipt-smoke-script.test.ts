import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateLiveAnnualReceiptSmoke,
  loadLiveAnnualReceiptSmokeState,
  main,
  parseArgs,
  recentAnnualEmailSentEventsQuery,
  readRecentAnnualEmailSentEventsWithFirestoreRest,
} from '../../scripts/check-live-annual-receipt-smoke.mjs';

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

function restValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } };
  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { __firestoreTimestampValue?: unknown }).__firestoreTimestampValue === 'string'
  ) {
    return { timestampValue: (value as { __firestoreTimestampValue: string }).__firestoreTimestampValue };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, restValue(entry)])
        ),
      },
    };
  }
  return { nullValue: null };
}

function restDocument(collectionName: string, documentId: string, fields: Record<string, unknown>) {
  return {
    name: `projects/kandilo-2f7a9/databases/(default)/documents/${collectionName}/${documentId}`,
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, restValue(value)])
    ),
  };
}

function timestamp(value: string) {
  return { __firestoreTimestampValue: value };
}

function annualEmailEvent(overrides: Partial<SmokeDoc['data']> = {}): SmokeDoc {
  return {
    id: 'event-private-annual-email-sent',
    data: {
      action: 'email_sent',
      receiptId: 'annual_private_smoke',
      churchId: 'church-private-smoke',
      userId: 'user-private-smoke',
      kind: 'annual',
      receiptYear: 2025,
      createdAt: '2026-05-25T18:00:30Z',
      ...overrides,
    },
  };
}

function annualReceipt(overrides: Partial<SmokeDoc['data']> = {}): SmokeDoc {
  return {
    id: 'annual_private_smoke',
    data: {
      kind: 'annual',
      status: 'sent',
      givingId: '',
      givingIds: ['giving-private-smoke-a', 'giving-private-smoke-b'],
      churchId: 'church-private-smoke',
      userId: 'user-private-smoke',
      amountCents: 5000,
      eligibleAmountCents: 5000,
      currency: 'USD',
      contributions: [
        {
          dateLabel: 'March 10, 2025',
          purpose: 'Candles',
          amountCents: 2000,
          eligibleAmountCents: 2000,
          currency: 'USD',
        },
        {
          dateLabel: 'November 20, 2025',
          purpose: 'General Fund',
          amountCents: 3000,
          eligibleAmountCents: 3000,
          currency: 'USD',
        },
      ],
      receiptNumber: 'STN-2025-0003',
      receiptYear: 2025,
      annualYear: 2025,
      donationCount: 2,
      issuedAt: '2026-05-25T18:00:10Z',
      emailSentAt: '2026-05-25T18:00:20Z',
      pdfStoragePath: 'taxReceipts/church-1/2025/annual_private_smoke.pdf',
      pdfSha256: 'b'.repeat(64),
      pdfByteLength: 4096,
      pdfRetentionStatus: 'retained',
      pdfRetainedAt: '2026-05-25T18:00:15Z',
      emailError: '',
      emailFailedAt: null,
      correctionRequired: false,
      correctionReason: '',
      voidedAt: null,
      voidReason: '',
      includesPreviouslyReceipted: false,
      donorAnonymous: false,
      ...overrides,
    },
  };
}

function annualSummary(overrides: Partial<SmokeDoc['data']> = {}): SmokeDoc {
  return {
    id: 'annual_private_smoke',
    data: {
      receiptId: 'annual_private_smoke',
      churchId: 'church-private-smoke',
      userId: 'user-private-smoke',
      kind: 'annual',
      status: 'sent',
      jurisdiction: 'US',
      receiptYear: 2025,
      annualYear: 2025,
      receiptNumber: 'STN-2025-0003',
      amountCents: 5000,
      eligibleAmountCents: 5000,
      currency: 'USD',
      donationCount: 2,
      includesPreviouslyReceipted: false,
      donorLabel: 'Parishioner',
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      issuedAt: '2026-05-25T18:00:10Z',
      emailSentAt: '2026-05-25T18:00:20Z',
      emailFailedAt: null,
      emailError: '',
      correctedReceipt: false,
      correctionRequired: false,
      correctionReason: '',
      voidedAt: null,
      voidReason: '',
      ...overrides,
    },
  };
}

function retainedPdfObject(overrides: Record<string, unknown> = {}) {
  return {
    name: 'taxReceipts/church-1/2025/annual_private_smoke.pdf',
    size: '4096',
    metadata: {
      pdfSha256: 'b'.repeat(64),
      retentionPurpose: 'official_tax_receipt_copy',
    },
    ...overrides,
  };
}

describe('live annual receipt smoke checker', () => {
  it('accepts a fresh sent annual receipt with a staff-safe summary and retained PDF evidence', () => {
    const result = evaluateLiveAnnualReceiptSmoke({
      annualEmailEvents: [annualEmailEvent()],
      taxReceipt: annualReceipt(),
      taxReceiptSummary: annualSummary(),
      retainedPdfObject: retainedPdfObject(),
    });

    expect(result.ok).toBe(true);
    expect(result.receiptStatus).toBe('sent');
    expect(result.summaryVisibility).toBe('staff-visible');
  });

  it('accepts Firestore REST timestamp markers from live annual reads', () => {
    const result = evaluateLiveAnnualReceiptSmoke({
      annualEmailEvents: [
        annualEmailEvent({ createdAt: timestamp('2026-05-25T18:00:30Z') }),
      ],
      taxReceipt: annualReceipt({
        issuedAt: timestamp('2026-05-25T18:00:10Z'),
        emailSentAt: timestamp('2026-05-25T18:00:20Z'),
        pdfRetainedAt: timestamp('2026-05-25T18:00:15Z'),
      }),
      taxReceiptSummary: annualSummary({
        issuedAt: timestamp('2026-05-25T18:00:10Z'),
        emailSentAt: timestamp('2026-05-25T18:00:20Z'),
      }),
      retainedPdfObject: retainedPdfObject(),
    });

    expect(result.ok).toBe(true);
  });

  it('fails closed when the annual smoke does not prove multi-contribution, itemized detail, or staff-safe summary evidence', () => {
    const singleContribution = evaluateLiveAnnualReceiptSmoke({
      annualEmailEvents: [annualEmailEvent()],
      taxReceipt: annualReceipt({ givingIds: ['giving-private-smoke-a'], donationCount: 1 }),
      taxReceiptSummary: annualSummary({ donationCount: 1 }),
      retainedPdfObject: retainedPdfObject(),
    });
    expect(singleContribution.ok).toBe(false);
    expect(singleContribution.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored annual receipt covers at least 2 contribution(s) with exact giving evidence'
    );

    const missingContributionLines = evaluateLiveAnnualReceiptSmoke({
      annualEmailEvents: [annualEmailEvent()],
      taxReceipt: annualReceipt({ contributions: [] }),
      taxReceiptSummary: annualSummary(),
      retainedPdfObject: retainedPdfObject(),
    });
    expect(missingContributionLines.ok).toBe(false);
    expect(missingContributionLines.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored annual receipt has itemized contribution lines matching the receipt totals'
    );

    const mismatchedContributionTotals = evaluateLiveAnnualReceiptSmoke({
      annualEmailEvents: [annualEmailEvent()],
      taxReceipt: annualReceipt({
        contributions: [
          {
            dateLabel: 'March 10, 2025',
            purpose: 'Candles',
            amountCents: 2000,
            eligibleAmountCents: 2000,
            currency: 'USD',
          },
          {
            dateLabel: 'November 20, 2025',
            purpose: 'General Fund',
            amountCents: 2999,
            eligibleAmountCents: 2999,
            currency: 'USD',
          },
        ],
      }),
      taxReceiptSummary: annualSummary(),
      retainedPdfObject: retainedPdfObject(),
    });
    expect(mismatchedContributionTotals.ok).toBe(false);
    expect(mismatchedContributionTotals.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored annual receipt has itemized contribution lines matching the receipt totals'
    );

    const privateSummary = evaluateLiveAnnualReceiptSmoke({
      annualEmailEvents: [annualEmailEvent()],
      taxReceipt: annualReceipt(),
      taxReceiptSummary: annualSummary({
        donorAnonymous: true,
        churchReceiptVisible: false,
        donorEmail: 'private@example.com',
        taxReceiptLegalName: 'Private Legal Name',
        issuedBy: 'system',
        pdfTemplateVersion: 'tax-receipt-pdf-v1',
        stripeCheckoutSessionUrl: 'https://checkout.stripe.com/private/session',
        stripePaymentIntentId: 'pi_live_private',
        stripeRefundStatus: 'partially_refunded',
        stripeConnectAccountId: 'acct_private',
        partialRefundGivingIds: ['giving-private-refund'],
        correctionForGivingId: 'giving-private-correction',
        checkoutSessionExpiresAt: '2026-05-25T18:30:00Z',
        checkoutUrl: 'https://checkout.stripe.com/private/legacy',
        eventId: 'evt_private',
        correctedBy: 'treasurer-1',
        correctionMarkedAt: '2026-05-25T18:31:00Z',
        correctionMarkedBy: 'treasurer-2',
        voidedBy: 'stripe',
      }),
      retainedPdfObject: retainedPdfObject(),
    });
    expect(privateSummary.ok).toBe(false);
    expect(privateSummary.checks.filter((check) => !check.ok).map((check) => check.label)).toEqual(
      expect.arrayContaining([
        'Annual summary is for an explicitly non-anonymous donor-year',
        'Annual summary is visible to receipt managers',
        'Annual summary mirror omits private full-receipt fields',
      ])
    );

    const reservedAnonymousSummaryLabel = evaluateLiveAnnualReceiptSmoke({
      annualEmailEvents: [annualEmailEvent()],
      taxReceipt: annualReceipt(),
      taxReceiptSummary: annualSummary({ donorLabel: 'Anonymous donor' }),
      retainedPdfObject: retainedPdfObject(),
    });
    expect(reservedAnonymousSummaryLabel.ok).toBe(false);
    expect(reservedAnonymousSummaryLabel.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Annual summary donor label is non-empty, not an email address, and not the reserved anonymous label'
    );
  });

  it('loads annual smoke state with field masks and without exposing identifiers in CLI output', async () => {
    const calls: string[] = [];
    const responses = [
      new Response(JSON.stringify([
        { document: restDocument('taxReceiptEvents', 'event-private-annual-email-sent', annualEmailEvent({
          createdAt: timestamp('2026-05-25T18:00:30Z'),
        }).data) },
      ]), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', 'annual_private_smoke', annualReceipt({
        issuedAt: timestamp('2026-05-25T18:00:10Z'),
        emailSentAt: timestamp('2026-05-25T18:00:20Z'),
        pdfRetainedAt: timestamp('2026-05-25T18:00:15Z'),
      }).data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceiptSummaries', 'annual_private_smoke', annualSummary({
        issuedAt: timestamp('2026-05-25T18:00:10Z'),
        emailSentAt: timestamp('2026-05-25T18:00:20Z'),
      }).data)), { status: 200 }),
      new Response(JSON.stringify(retainedPdfObject()), { status: 200 }),
    ];
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return responses.shift() ?? new Response('{}', { status: 404 });
    };

    const state = await loadLiveAnnualReceiptSmokeState({
      accessToken: 'ya29.private-token',
      fetchImpl,
    });

    expect(state.annualEmailEvents).toHaveLength(1);
    expect(state.taxReceipt?.data.status).toBe('sent');
    expect(state.taxReceiptSummary?.data.churchReceiptVisible).toBe(true);
    expect(state.retainedPdfObject?.metadata?.pdfSha256).toBe('b'.repeat(64));
    expect(calls.filter((url) => url.includes(':runQuery'))).toHaveLength(1);
    const receiptReadUrl = calls.find((url) => url.includes('/taxReceipts/annual_private_smoke')) ?? '';
    expect(receiptReadUrl).toContain('mask.fieldPaths=givingIds');
    expect(receiptReadUrl).toContain('mask.fieldPaths=contributions');
    expect(receiptReadUrl).toContain('mask.fieldPaths=donationCount');
    expect(receiptReadUrl).toContain('mask.fieldPaths=pdfStoragePath');
    expect(receiptReadUrl).toContain('mask.fieldPaths=correctionForReceiptId');
    expect(receiptReadUrl).toContain('mask.fieldPaths=correctionSourceReason');
    expect(receiptReadUrl).toContain('mask.fieldPaths=correctedAt');
    expect(receiptReadUrl).not.toContain('mask.fieldPaths=donorEmail');
    expect(receiptReadUrl).not.toContain('mask.fieldPaths=donorName');
    const summaryReadUrl = calls.find((url) => url.includes('/taxReceiptSummaries/annual_private_smoke')) ?? '';
    expect(summaryReadUrl).toContain('mask.fieldPaths=receiptManagerSummarySafeVersion');
    expect(summaryReadUrl).toContain('mask.fieldPaths=donorEmail');
    expect(summaryReadUrl).toContain('mask.fieldPaths=taxReceiptLegalName');
    expect(summaryReadUrl).toContain('mask.fieldPaths=issuedBy');
    expect(summaryReadUrl).toContain('mask.fieldPaths=pdfTemplateVersion');
    expect(summaryReadUrl).toContain('mask.fieldPaths=stripeCheckoutSessionUrl');
    expect(summaryReadUrl).toContain('mask.fieldPaths=stripePaymentIntentId');
    expect(summaryReadUrl).toContain('mask.fieldPaths=stripeRefundStatus');
    expect(summaryReadUrl).toContain('mask.fieldPaths=stripeConnectAccountId');
    expect(summaryReadUrl).toContain('mask.fieldPaths=partialRefundGivingIds');
    expect(summaryReadUrl).toContain('mask.fieldPaths=correctionForGivingId');
    expect(summaryReadUrl).toContain('mask.fieldPaths=checkoutSessionExpiresAt');
    expect(summaryReadUrl).toContain('mask.fieldPaths=checkoutUrl');
    expect(summaryReadUrl).toContain('mask.fieldPaths=eventId');
    expect(summaryReadUrl).toContain('mask.fieldPaths=correctedBy');
    expect(summaryReadUrl).toContain('mask.fieldPaths=correctionMarkedAt');
    expect(summaryReadUrl).toContain('mask.fieldPaths=correctionMarkedBy');
    expect(summaryReadUrl).toContain('mask.fieldPaths=voidedBy');
    expect(summaryReadUrl).toContain('mask.fieldPaths=givingIds');
    expect(summaryReadUrl).toContain('mask.fieldPaths=pdfStoragePath');

    const cliResponses = [
      new Response(JSON.stringify([
        { document: restDocument('taxReceiptEvents', 'event-private-annual-email-sent', annualEmailEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', 'annual_private_smoke', annualReceipt().data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceiptSummaries', 'annual_private_smoke', annualSummary().data)), { status: 200 }),
      new Response(JSON.stringify(retainedPdfObject()), { status: 200 }),
    ];
    const stdout = writer();
    const stderr = writer();
    const exitCode = await main([], {
      accessTokenReader: () => 'ya29.private-token',
      fetchImpl: async () => cliResponses.shift() ?? new Response('{}', { status: 404 }),
      stdout: stdout.sink,
      stderr: stderr.sink,
    });

    const output = stdout.output();
    expect(exitCode).toBe(0);
    expect(output).toContain(
      'Result: live annual receipt smoke check passed without exposing donor, church, receipt, giving, tax receipt event, PDF metadata, amount, currency, or access-token values.'
    );
    expect(output).not.toContain('annual_private_smoke');
    expect(output).not.toContain('event-private-annual-email-sent');
    expect(output).not.toContain('church-private-smoke');
    expect(output).not.toContain('user-private-smoke');
    expect(output).not.toContain('giving-private-smoke-a');
    expect(output).not.toContain('5000');
    expect(output).not.toContain('USD');
    expect(output).not.toContain('taxReceipts/church-1/2025/annual_private_smoke.pdf');
    expect(output).not.toContain('bbbbbbbbbbbbbbbb');
    expect(output).not.toContain('ya29.private-token');
    expect(stderr.output()).toBe('');
  });

  it('fails closed when annual smoke evidence is corrected or a refund reissue', () => {
    const correctedReceiptId = 'annual_correction_private_smoke';
    const result = evaluateLiveAnnualReceiptSmoke({
      annualEmailEvents: [
        annualEmailEvent({
          receiptId: correctedReceiptId,
        }),
      ],
      annualEmailEvent: annualEmailEvent({
        receiptId: correctedReceiptId,
      }),
      taxReceipt: {
        ...annualReceipt({
          correctionForReceiptId: 'annual_original_private_smoke',
          correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
          correctedAt: '2026-05-25T18:00:05Z',
        }),
        id: correctedReceiptId,
      },
      taxReceiptSummary: {
        ...annualSummary({
          receiptId: correctedReceiptId,
          correctedReceipt: true,
        }),
        id: correctedReceiptId,
      },
      retainedPdfObject: retainedPdfObject(),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.filter((check) => !check.ok).map((check) => check.label)).toContain(
      'Stored annual receipt is an original year-end receipt'
    );
  });

  it('scans recent annual events until a staff-safe annual smoke candidate passes', async () => {
    const calls: string[] = [];
    const responses = [
      new Response(JSON.stringify([
        { document: restDocument('taxReceiptEvents', 'event-private-newer', annualEmailEvent({
          receiptId: 'annual_private_newer',
          createdAt: '2026-05-25T18:01:00Z',
        }).data) },
        { document: restDocument('taxReceiptEvents', 'event-private-annual-email-sent', annualEmailEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', 'annual_private_newer', annualReceipt({
        pdfStoragePath: '',
        pdfSha256: '',
        pdfByteLength: 0,
      }).data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceiptSummaries', 'annual_private_newer', annualSummary({
        receiptId: 'annual_private_newer',
        donorAnonymous: true,
        churchReceiptVisible: false,
        donorLabelPublicSafe: false,
        receiptManagerSummarySafe: false,
        receiptManagerSummarySafeVersion: 0,
      }).data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', 'annual_private_smoke', annualReceipt().data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceiptSummaries', 'annual_private_smoke', annualSummary().data)), { status: 200 }),
      new Response(JSON.stringify(retainedPdfObject()), { status: 200 }),
    ];
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return responses.shift() ?? new Response('{}', { status: 404 });
    };

    const state = await loadLiveAnnualReceiptSmokeState({
      accessToken: 'ya29.private-token',
      fetchImpl,
      nowMillis: smokeNow.getTime(),
    });
    const result = evaluateLiveAnnualReceiptSmoke(state);

    expect(state.annualEmailEvent?.data.receiptId).toBe('annual_private_smoke');
    expect(state.taxReceipt?.id).toBe('annual_private_smoke');
    expect(result.ok).toBe(true);
    expect(calls.filter((url) => url.includes('/taxReceipts/'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/taxReceiptSummaries/'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/b/'))).toHaveLength(1);
  });

  it('scans past newer corrected annual smoke events until an original annual candidate passes', async () => {
    const calls: string[] = [];
    const correctedReceiptId = 'annual_correction_newer';
    const correctedPdfPath = 'taxReceipts/church-1/2025/annual_correction_newer.pdf';
    const responses = [
      new Response(JSON.stringify([
        { document: restDocument('taxReceiptEvents', 'event-corrected-newer', annualEmailEvent({
          receiptId: correctedReceiptId,
          createdAt: '2026-05-25T18:02:00Z',
        }).data) },
        { document: restDocument('taxReceiptEvents', 'event-private-annual-email-sent', annualEmailEvent().data) },
      ]), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', correctedReceiptId, annualReceipt({
        pdfStoragePath: correctedPdfPath,
        correctionForReceiptId: 'annual_original_newer',
        correctionSourceReason: 'stripe_partial_refund_corrected_reissue',
        correctedAt: '2026-05-25T18:01:00Z',
      }).data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceiptSummaries', correctedReceiptId, annualSummary({
        receiptId: correctedReceiptId,
        correctedReceipt: true,
      }).data)), { status: 200 }),
      new Response(JSON.stringify(retainedPdfObject({ name: correctedPdfPath })), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceipts', 'annual_private_smoke', annualReceipt().data)), { status: 200 }),
      new Response(JSON.stringify(restDocument('taxReceiptSummaries', 'annual_private_smoke', annualSummary().data)), { status: 200 }),
      new Response(JSON.stringify(retainedPdfObject()), { status: 200 }),
    ];
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return responses.shift() ?? new Response('{}', { status: 404 });
    };

    const state = await loadLiveAnnualReceiptSmokeState({
      accessToken: 'ya29.private-token',
      fetchImpl,
      nowMillis: smokeNow.getTime(),
    });
    const result = evaluateLiveAnnualReceiptSmoke(state);

    expect(state.annualEmailEvent?.data.receiptId).toBe('annual_private_smoke');
    expect(result.ok).toBe(true);
    expect(calls.filter((url) => url.includes('/taxReceipts/'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/taxReceiptSummaries/'))).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/b/'))).toHaveLength(2);
  });

  it('builds the annual email query and validates CLI arguments', async () => {
    expect(recentAnnualEmailSentEventsQuery(7).structuredQuery.limit).toBe(7);
    expect(recentAnnualEmailSentEventsQuery().structuredQuery.where).toMatchObject({
      compositeFilter: {
        op: 'AND',
        filters: expect.arrayContaining([
          {
            fieldFilter: {
              field: { fieldPath: 'action' },
              op: 'EQUAL',
              value: { stringValue: 'email_sent' },
            },
          },
          {
            fieldFilter: {
              field: { fieldPath: 'kind' },
              op: 'EQUAL',
              value: { stringValue: 'annual' },
            },
          },
        ]),
      },
    });
    const rows = await readRecentAnnualEmailSentEventsWithFirestoreRest(
      async () => new Response(JSON.stringify([
        { document: restDocument('taxReceiptEvents', 'event-private-annual-email-sent', annualEmailEvent().data) },
      ]), { status: 200 }),
      'ya29.private-token',
      { limit: 1 }
    );
    expect(rows[0].data.kind).toBe('annual');

    expect(parseArgs(['--project', 'kandilo-2f7a9'])).toMatchObject({ projectId: 'kandilo-2f7a9' });
    expect(parseArgs(['--receipt-id', 'annual_abc123', '--min-contributions', '3'])).toMatchObject({
      receiptId: 'annual_abc123',
      minContributions: 3,
    });
    expect(() => parseArgs(['--project', 'staging-project'])).toThrow('--project must be kandilo-2f7a9');
    expect(() => parseArgs(['--receipt-id', 'receipt_abc123'])).toThrow('--receipt-id must be an annual');
    expect(() => parseArgs(['--min-contributions', '1'])).toThrow('--min-contributions must be an integer from 2 to 100');
    expect(() => parseArgs(['--min-contributions', '0'])).toThrow('--min-contributions must be an integer from 2 to 100');
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown argument --unknown');
  });
});
