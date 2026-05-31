import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const visibilityAuditScript = await import('../../scripts/audit-tax-receipt-visibility.mjs');
const expectedProjectId = visibilityAuditScript.expectedProjectId as string;

type PlannedRepair = {
  collection?: string;
  id?: string;
  path: string;
  update: Record<string, unknown>;
  deleteFields?: string[];
  reasons: string[];
  paymentMetadataUpdate?: Record<string, unknown>;
};

type VisibilityAuditDoc = {
  id: string;
  data: Record<string, unknown>;
};

type VisibilityAuditReport = {
  repairCount?: number;
  repairs: PlannedRepair[];
  reasonCounts: Record<string, number>;
};

type VisibilityCollectionScan = {
  docs: VisibilityAuditDoc[];
  rawReadCount: number;
  limitReached: boolean;
};

const planTaxReceiptVisibilityRepairs =
  visibilityAuditScript.planTaxReceiptVisibilityRepairs as unknown as (input: {
    givingDocs?: VisibilityAuditDoc[];
    annualSummaryDocs?: VisibilityAuditDoc[];
    annualReceiptDocs?: VisibilityAuditDoc[];
  }) => VisibilityAuditReport;
const readCollectionDocs =
  visibilityAuditScript.readCollectionDocs as unknown as (
    db: { collection: (collectionName: string) => FakeQuery },
    collectionName: string,
    options: { churchId?: string; kind?: string; limit: number; pageSize: number },
  ) => Promise<VisibilityCollectionScan>;
const readCollectionDocsWithFirestoreRest =
  visibilityAuditScript.readCollectionDocsWithFirestoreRest as unknown as (
    fetchImpl: (url: URL, init: { headers: Record<string, string> }) => Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<Record<string, unknown>>;
    }>,
    accessToken: string,
    collectionName: string,
    options: { projectId?: string; churchId?: string; kind?: string; limit: number; pageSize: number },
  ) => Promise<VisibilityCollectionScan>;
const applyTaxReceiptVisibilityRepairsWithFirestoreRest =
  visibilityAuditScript.applyTaxReceiptVisibilityRepairsWithFirestoreRest as unknown as (
    fetchImpl: (url: URL, init: {
      method: string;
      headers: Record<string, string>;
      body: string;
    }) => Promise<{ ok: boolean; status: number }>,
    accessToken: string,
    repairs: PlannedRepair[],
    options: { projectId?: string },
  ) => Promise<number>;
const firestoreRestListDocumentsUrl =
  visibilityAuditScript.firestoreRestListDocumentsUrl as unknown as (
    projectId: string,
    collectionName: string,
    options: { pageSize: number; pageToken?: string },
  ) => URL;
const firestoreRestWriteForRepair =
  visibilityAuditScript.firestoreRestWriteForRepair as unknown as (
    projectId: string,
    repair: PlannedRepair,
  ) => Record<string, unknown>;
const firestoreRestWritesForRepair =
  visibilityAuditScript.firestoreRestWritesForRepair as unknown as (
    projectId: string,
    repair: PlannedRepair,
  ) => Record<string, unknown>[];
const firestoreRestValueToJs =
  visibilityAuditScript.firestoreRestValueToJs as unknown as (value: unknown) => unknown;
const jsValueToFirestoreRestValue =
  visibilityAuditScript.jsValueToFirestoreRestValue as unknown as (value: unknown) => unknown;
const taxReceiptVisibilityAuditFailureReasons =
  visibilityAuditScript.taxReceiptVisibilityAuditFailureReasons as unknown as (
    report: VisibilityAuditReport,
    scan: { limitReached: Record<string, boolean> },
    options: { failOnRepairs: boolean; repair: boolean; limit: number },
  ) => string[];
const taxReceiptVisibilityRepairBlockers =
  visibilityAuditScript.taxReceiptVisibilityRepairBlockers as unknown as (
    scan: { limitReached: Record<string, boolean> },
    options: { limit: number },
  ) => string[];
const taxReceiptVisibilityRepairConfirmationBlockers =
  visibilityAuditScript.taxReceiptVisibilityRepairConfirmationBlockers as unknown as (
    report: { repairCount?: number; repairs?: PlannedRepair[]; reasonCounts?: Record<string, number> },
    options: { repair: boolean; confirmRepairCount?: number | null },
  ) => string[];
const taxReceiptVisibilityRepairCommand =
  visibilityAuditScript.taxReceiptVisibilityRepairCommand as unknown as (
    options: { churchId?: string; limit: number; pageSize: number },
    report: { repairCount?: number; repairs?: PlannedRepair[] },
  ) => string;
const taxReceiptVisibilityReadOnlyCompletionMessage =
  visibilityAuditScript.taxReceiptVisibilityReadOnlyCompletionMessage as unknown as (
    options: { churchId?: string; limit: number; pageSize: number },
    report: { repairCount?: number; repairs?: PlannedRepair[] },
  ) => string;
const taxReceiptVisibilityRepairEffectLines =
  visibilityAuditScript.taxReceiptVisibilityRepairEffectLines as unknown as (
    report: { reasonCounts?: Record<string, number> },
  ) => string[];
const taxReceiptVisibilityPostRepairVerificationFailureReasons =
  visibilityAuditScript.taxReceiptVisibilityPostRepairVerificationFailureReasons as unknown as (
    report: { repairCount?: number; repairs?: PlannedRepair[]; reasonCounts?: Record<string, number> },
    scan: { limitReached: Record<string, boolean> },
    options: { limit: number },
  ) => string[];
const verifyTaxReceiptVisibilityRepairsApplied =
  visibilityAuditScript.verifyTaxReceiptVisibilityRepairsApplied as unknown as (input: {
    db: { collection: (collectionName: string) => FakeQuery };
    accessToken?: string;
    options: { limit: number; pageSize: number };
  }) => Promise<{
    report: VisibilityAuditReport;
    failureReasons: string[];
  }>;
const taxReceiptVisibilityAuditRuntimeErrorMessage =
  visibilityAuditScript.taxReceiptVisibilityAuditRuntimeErrorMessage as unknown as (error: unknown) => string;
const parseTaxReceiptVisibilityAuditArgs =
  visibilityAuditScript.parseArgs as unknown as (args: string[]) => {
    projectId: string;
    churchId: string;
    confirmProject: string;
    confirmRepairCount: number | null;
    limit: number;
    pageSize: number;
    repair: boolean;
    failOnRepairs: boolean;
  };

function repairFor(report: VisibilityAuditReport, path: string) {
  return report.repairs.find((repair) => repair.path === path);
}

class FakeDoc {
  constructor(
    public readonly id: string,
    private readonly value: Record<string, unknown>,
  ) {}

  data() {
    return this.value;
  }
}

class FakeQuery {
  private afterId = '';
  private limitCount = 100;

  constructor(private readonly docs: FakeDoc[]) {}

  orderBy(_field: unknown) {
    return this;
  }

  limit(limitCount: number) {
    this.limitCount = limitCount;
    return this;
  }

  startAfter(doc: FakeDoc) {
    this.afterId = doc.id;
    return this;
  }

  async get() {
    const docs = this.docs
      .filter((doc) => !this.afterId || doc.id > this.afterId)
      .slice(0, this.limitCount);
    return {
      empty: docs.length === 0,
      docs,
    };
  }
}

function fakeDb(collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>>) {
  return {
    collection(collectionName: string) {
      return new FakeQuery(
        (collections[collectionName] ?? [])
          .map((doc) => new FakeDoc(doc.id, doc.data))
          .sort((left, right) => left.id.localeCompare(right.id)),
      );
    },
  };
}

function restDocument(collectionName: string, id: string, fields: Record<string, unknown>) {
  return {
    name: `projects/${expectedProjectId}/databases/(default)/documents/${collectionName}/${id}`,
    fields,
  };
}

describe('tax receipt visibility audit script', () => {
  it('repairs church-visible giving metadata without exposing donor emails', () => {
    const report = planTaxReceiptVisibilityRepairs({
      givingDocs: [
        {
          id: 'giving-public-email',
          data: {
            anonymous: false,
            donorEmail: 'legacy@example.com',
            donorName: 'Contact legacy@example.com',
            donorNamePublicSafe: false,
            churchReceiptVisible: false,
          },
        },
        {
          id: 'giving-anonymous-visible',
          data: {
            anonymous: true,
            donorEmail: 'private@example.com',
            donorName: 'Private Donor',
            donorNamePublicSafe: true,
            churchReceiptVisible: true,
            receiptManagerGivingSafeVersion: 1,
          },
        },
        {
          id: 'giving-safe',
          data: {
            anonymous: false,
            donorEmail: '',
            donorName: 'Michael Petrovic',
            donorNamePublicSafe: true,
            churchReceiptVisible: true,
            receiptManagerGivingSafeVersion: 1,
          },
        },
        {
          id: 'giving-private-payment-fields',
          data: {
            churchId: 'church-1',
            userId: 'member-1',
            amountCents: 2500,
            currency: 'usd',
            anonymous: false,
            donorEmail: '',
            donorName: 'Michael Petrovic',
            donorNamePublicSafe: true,
            churchReceiptVisible: true,
            receiptManagerGivingSafeVersion: 1,
            stripeSessionId: 'cs_live_private_alias',
            stripeCheckoutSessionId: 'cs_live_private',
            stripeCheckoutSessionExpiresAt: '2026-05-24T19:30:00.000Z',
            stripeCheckoutUrl: 'https://checkout.stripe.com/private',
            stripeCheckoutSessionUrl: 'https://checkout.stripe.com/private/session',
            stripePaymentIntentId: 'pi_live_private',
            stripePaymentStatus: 'paid',
            stripePaymentMethodId: 'pm_live_private',
            stripeChargeId: 'ch_live_private_charge',
            stripeCustomerId: 'cus_live_private',
            stripeEventId: 'evt_live_private',
            stripeConnectAccountId: 'acct_live_private',
            stripeRefundId: 're_live_private',
            stripeRefundedChargeId: 'ch_live_private',
            checkoutSessionId: 'cs_live_private_legacy',
            checkoutUrl: 'https://checkout.stripe.com/private/legacy',
            paymentIntentId: 'pi_live_private_legacy',
            paymentStatus: 'paid',
            chargeId: 'ch_live_private_legacy',
            refundId: 're_live_private_legacy',
          },
        },
      ],
    });

    expect(repairFor(report, 'giving/giving-public-email')?.update).toEqual({
      churchReceiptVisible: true,
      donorNamePublicSafe: true,
      donorEmail: '',
      donorName: 'Parishioner',
      receiptManagerGivingSafeVersion: 1,
    });
    expect(repairFor(report, 'giving/giving-anonymous-visible')?.update).toEqual({
      churchReceiptVisible: false,
      donorNamePublicSafe: false,
      donorEmail: '',
      donorName: 'Anonymous donor',
      receiptManagerGivingSafeVersion: 0,
    });
    expect(repairFor(report, 'giving/giving-private-payment-fields')?.update).toEqual({});
    expect(repairFor(report, 'giving/giving-private-payment-fields')?.paymentMetadataUpdate).toEqual({
      churchId: 'church-1',
      userId: 'member-1',
      amountCents: 2500,
      currency: 'USD',
      stripeSessionId: 'cs_live_private_alias',
      stripeCheckoutSessionId: 'cs_live_private',
      stripeCheckoutSessionExpiresAt: '2026-05-24T19:30:00.000Z',
      stripeCheckoutUrl: 'https://checkout.stripe.com/private',
      stripeCheckoutSessionUrl: 'https://checkout.stripe.com/private/session',
      stripePaymentIntentId: 'pi_live_private',
      stripePaymentStatus: 'paid',
      stripePaymentMethodId: 'pm_live_private',
      stripeChargeId: 'ch_live_private_charge',
      stripeCustomerId: 'cus_live_private',
      stripeEventId: 'evt_live_private',
      stripeConnectAccountId: 'acct_live_private',
      stripeRefundId: 're_live_private',
      stripeRefundedChargeId: 'ch_live_private',
      checkoutSessionId: 'cs_live_private_legacy',
      checkoutUrl: 'https://checkout.stripe.com/private/legacy',
      paymentIntentId: 'pi_live_private_legacy',
      paymentStatus: 'paid',
      chargeId: 'ch_live_private_legacy',
      refundId: 're_live_private_legacy',
    });
    expect(repairFor(report, 'giving/giving-private-payment-fields')?.deleteFields).toEqual([
      'stripeSessionId',
      'stripeCheckoutSessionId',
      'stripeCheckoutSessionExpiresAt',
      'stripeCheckoutUrl',
      'stripeCheckoutSessionUrl',
      'stripePaymentIntentId',
      'stripePaymentStatus',
      'stripePaymentMethodId',
      'stripeChargeId',
      'stripeCustomerId',
      'stripeEventId',
      'stripeConnectAccountId',
      'stripeRefundId',
      'stripeRefundedChargeId',
      'checkoutSessionId',
      'checkoutUrl',
      'paymentIntentId',
      'paymentStatus',
      'chargeId',
      'refundId',
    ]);
    expect(repairFor(report, 'giving/giving-safe')).toBeUndefined();
    expect(report.reasonCounts.clear_church_facing_donor_email).toBe(1);
    expect(report.reasonCounts.remove_private_giving_payment_fields).toBe(1);
  });

  it('fails annual summary mirrors closed when covered giving is private, unclassified, or receipt-manager-hidden', () => {
    const report = planTaxReceiptVisibilityRepairs({
      givingDocs: [
        {
          id: 'annual-public-giving',
          data: {
            anonymous: false,
            churchReceiptVisible: true,
            donorNamePublicSafe: true,
            receiptManagerGivingSafeVersion: 1,
            donorEmail: '',
            donorName: 'Michael Petrovic',
          },
        },
        {
          id: 'annual-unclassified-giving',
          data: {},
        },
        {
          id: 'annual-hidden-label-giving',
          data: {
            anonymous: false,
            churchReceiptVisible: true,
            donorNamePublicSafe: false,
            receiptManagerGivingSafeVersion: 0,
            donorEmail: '',
            donorName: 'Contact hidden@example.com',
          },
        },
        {
          id: 'annual-safe-private-field-giving',
          data: {
            anonymous: false,
            churchReceiptVisible: true,
            donorNamePublicSafe: true,
            receiptManagerGivingSafeVersion: 1,
            donorEmail: '',
            donorName: 'Member One',
          },
        },
        {
          id: 'annual-giving-label-fallback-giving',
          data: {
            anonymous: false,
            churchReceiptVisible: true,
            donorNamePublicSafe: true,
            receiptManagerGivingSafeVersion: 1,
            donorEmail: '',
            donorName: 'Sophia Markovic',
          },
        },
      ],
      annualReceiptDocs: [
        {
          id: 'annual-public',
          data: {
            kind: 'annual',
            givingIds: ['annual-public-giving'],
            donorName: 'Michael Petrovic',
            jurisdiction: 'US',
          },
        },
        {
          id: 'annual-private',
          data: {
            kind: 'annual',
            givingIds: ['annual-unclassified-giving'],
            donorName: 'private@example.com',
            jurisdiction: 'CA',
          },
        },
        {
          id: 'annual-hidden-label',
          data: {
            kind: 'annual',
            givingIds: ['annual-hidden-label-giving'],
            donorLabel: 'Hidden Label',
            donorName: 'Hidden Label',
          },
        },
        {
          id: 'annual-missing-giving-ids',
          data: {
            kind: 'annual',
            donorLabel: 'No Giving Proof',
            donorName: 'No Giving Proof',
          },
        },
        {
          id: 'annual-safe-private-field',
          data: {
            kind: 'annual',
            givingIds: ['annual-safe-private-field-giving'],
            donorLabel: 'Member One',
            donorName: 'Member One',
            jurisdiction: 'US',
          },
        },
        {
          id: 'annual-giving-label-fallback',
          data: {
            kind: 'annual',
            givingIds: ['annual-giving-label-fallback-giving'],
          },
        },
      ],
      annualSummaryDocs: [
        {
          id: 'annual-public',
          data: {
            kind: 'annual',
            donorLabel: 'Contact legacy@example.com',
            donorAnonymous: true,
            churchReceiptVisible: false,
            receiptManagerSummarySafe: false,
            receiptManagerSummarySafeVersion: 0,
            givingIds: ['annual-public-giving'],
            donorEmail: 'legacy@example.com',
            organizationTaxId: '12-3456789',
            emailSendingAt: '2026-01-15T12:19:00.000Z',
            emailSendAttemptId: 'private-send-attempt-id-20260115',
            pdfStoragePath: 'taxReceipts/church-1/2025/annual-public.pdf',
          },
        },
        {
          id: 'annual-private',
          data: {
            kind: 'annual',
            donorLabel: 'private@example.com',
            donorAnonymous: false,
            churchReceiptVisible: true,
            receiptManagerSummarySafe: true,
            receiptManagerSummarySafeVersion: 1,
            donorName: 'Private Donor',
            contributions: [{ amountCents: 5000 }],
          },
        },
        {
          id: 'annual-safe-private-field',
          data: {
            kind: 'annual',
            donorLabel: 'Member One',
            donorAnonymous: false,
            churchReceiptVisible: true,
            receiptManagerSummarySafe: true,
            receiptManagerSummarySafeVersion: 1,
            donorEmail: 'member@example.com',
            taxReceiptLegalName: 'Member Legal Name',
            taxReceiptAddress: {
              line1: '10 Donor Street',
              city: 'Chicago',
              region: 'IL',
              postalCode: '60601',
              country: 'US',
            },
            issuedBy: 'system',
            emailSendingAt: '2026-01-15T12:24:00.000Z',
            emailSendAttemptId: 'private-send-attempt-id-20260115-safe',
            stripeCheckoutSessionUrl: 'https://checkout.stripe.com/private/session',
            stripePaymentIntentId: 'pi_live_private',
            stripeRefundStatus: 'partially_refunded',
            stripeAmountRefundedCents: 1000,
            stripeConnectAccountId: 'acct_private',
            checkoutSessionExpiresAt: '2026-05-24T19:30:00.000Z',
            checkoutUrl: 'https://checkout.stripe.com/private/legacy',
            eventId: 'evt_private',
            pdfTemplateVersion: 'tax-receipt-pdf-v1',
            partialRefundGivingIds: ['giving-private-refund'],
            correctionForGivingId: 'giving-private-correction',
            correctedBy: 'treasurer-1',
            correctionMarkedAt: '2026-05-24T19:31:00.000Z',
            correctionMarkedBy: 'treasurer-2',
            voidedBy: 'stripe',
          },
        },
        {
          id: 'annual-giving-label-fallback',
          data: {
            kind: 'annual',
            donorLabel: 'fallback@example.com',
            donorAnonymous: true,
            churchReceiptVisible: false,
            receiptManagerSummarySafe: false,
            receiptManagerSummarySafeVersion: 0,
          },
        },
        {
          id: 'annual-hidden-label',
          data: {
            kind: 'annual',
            donorLabel: 'Hidden Label',
            donorAnonymous: false,
            churchReceiptVisible: true,
            receiptManagerSummarySafe: true,
            receiptManagerSummarySafeVersion: 1,
            donorLabelPublicSafe: true,
          },
        },
        {
          id: 'annual-missing-giving-ids',
          data: {
            kind: 'annual',
            donorLabel: 'No Giving Proof',
            donorAnonymous: false,
            churchReceiptVisible: true,
            receiptManagerSummarySafe: true,
            receiptManagerSummarySafeVersion: 1,
            donorLabelPublicSafe: true,
          },
        },
      ],
    });

    expect(repairFor(report, 'taxReceiptSummaries/annual-public')?.update).toEqual({
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      donorLabel: 'Michael Petrovic',
      jurisdiction: 'US',
    });
    expect(repairFor(report, 'taxReceiptSummaries/annual-public')?.deleteFields).toEqual([
      'givingIds',
      'donorEmail',
      'organizationTaxId',
      'emailSendingAt',
      'emailSendAttemptId',
      'pdfStoragePath',
    ]);
    expect(repairFor(report, 'taxReceiptSummaries/annual-giving-label-fallback')?.update).toEqual({
      donorAnonymous: false,
      churchReceiptVisible: true,
      donorLabelPublicSafe: true,
      receiptManagerSummarySafe: true,
      receiptManagerSummarySafeVersion: 2,
      donorLabel: 'Sophia Markovic',
    });
    expect(repairFor(report, 'taxReceiptSummaries/annual-private')?.update).toEqual({
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
      donorLabel: 'Anonymous donor',
      jurisdiction: 'CA',
    });
    expect(repairFor(report, 'taxReceiptSummaries/annual-private')?.deleteFields).toEqual([
      'donorName',
      'contributions',
    ]);
    expect(repairFor(report, 'taxReceiptSummaries/annual-hidden-label')?.update).toEqual({
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
      donorLabel: 'Anonymous donor',
    });
    expect(repairFor(report, 'taxReceiptSummaries/annual-missing-giving-ids')?.update).toEqual({
      donorAnonymous: true,
      churchReceiptVisible: false,
      donorLabelPublicSafe: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
      donorLabel: 'Anonymous donor',
    });
    expect(repairFor(report, 'taxReceiptSummaries/annual-safe-private-field')?.update).toEqual({
      donorLabelPublicSafe: true,
      receiptManagerSummarySafeVersion: 2,
      jurisdiction: 'US',
    });
    expect(repairFor(report, 'taxReceiptSummaries/annual-safe-private-field')?.deleteFields).toEqual([
      'donorEmail',
      'taxReceiptLegalName',
      'taxReceiptAddress',
      'issuedBy',
      'emailSendingAt',
      'emailSendAttemptId',
      'stripeCheckoutSessionUrl',
      'stripePaymentIntentId',
      'stripeConnectAccountId',
      'stripeRefundStatus',
      'stripeAmountRefundedCents',
      'checkoutSessionExpiresAt',
      'checkoutUrl',
      'eventId',
      'pdfTemplateVersion',
      'partialRefundGivingIds',
      'correctionForGivingId',
      'correctedBy',
      'correctionMarkedAt',
      'correctionMarkedBy',
      'voidedBy',
    ]);
    expect(report.reasonCounts.mirror_annual_summary_jurisdiction).toBe(3);
    expect(report.reasonCounts.remove_private_annual_summary_fields).toBe(3);
  });

  it('preserves only marker-safe annual issuance-gap retry summaries without covered-giving proof', () => {
    const report = planTaxReceiptVisibilityRepairs({
      annualSummaryDocs: [
        {
          id: 'annual-profile-required-safe',
          data: {
            kind: 'annual',
            status: 'error',
            receiptId: '',
            receiptNumber: '',
            emailError: 'tax_receipt_donor_profile_incomplete',
            donorLabel: 'Member One',
            donorAnonymous: false,
            churchReceiptVisible: true,
            donorLabelPublicSafe: true,
            receiptManagerSummarySafe: true,
            receiptManagerSummarySafeVersion: 2,
          },
        },
        {
          id: 'annual-verified-email-required-safe',
          data: {
            kind: 'annual',
            status: 'error',
            receiptId: '',
            receiptNumber: '',
            emailError: 'tax_receipt_missing_email_or_amount',
            donorLabel: 'Member One',
            donorAnonymous: false,
            churchReceiptVisible: true,
            donorLabelPublicSafe: true,
            receiptManagerSummarySafe: true,
            receiptManagerSummarySafeVersion: 2,
          },
        },
        {
          id: 'annual-profile-required-private-fields',
          data: {
            kind: 'annual',
            status: 'error',
            receiptId: '',
            receiptNumber: 'SHOULD-NOT-EXIST',
            emailError: 'tax_receipt_donor_profile_incomplete',
            donorLabel: 'member@example.com',
            donorAnonymous: false,
            churchReceiptVisible: true,
            donorLabelPublicSafe: true,
            receiptManagerSummarySafe: true,
            receiptManagerSummarySafeVersion: 2,
            givingIds: ['giving-private'],
            donorEmail: 'member@example.com',
            contributions: [{ amountCents: 5000 }],
          },
        },
        {
          id: 'annual-profile-required-unsafe-marker',
          data: {
            kind: 'annual',
            status: 'error',
            receiptId: '',
            receiptNumber: '',
            emailError: 'tax_receipt_donor_profile_incomplete',
            donorLabel: 'Member One',
            donorAnonymous: false,
            churchReceiptVisible: true,
            donorLabelPublicSafe: false,
            receiptManagerSummarySafe: true,
            receiptManagerSummarySafeVersion: 2,
          },
        },
      ],
    });

    expect(repairFor(report, 'taxReceiptSummaries/annual-profile-required-safe')).toBeUndefined();
    expect(repairFor(report, 'taxReceiptSummaries/annual-verified-email-required-safe')).toBeUndefined();
    expect(repairFor(report, 'taxReceiptSummaries/annual-profile-required-private-fields')?.update).toEqual({
      donorLabel: 'Parishioner',
      receiptNumber: '',
    });
    expect(repairFor(report, 'taxReceiptSummaries/annual-profile-required-private-fields')?.deleteFields).toEqual([
      'givingIds',
      'donorEmail',
      'contributions',
    ]);
    expect(repairFor(report, 'taxReceiptSummaries/annual-profile-required-unsafe-marker')?.update).toEqual({
      donorAnonymous: true,
      churchReceiptVisible: false,
      receiptManagerSummarySafe: false,
      receiptManagerSummarySafeVersion: 0,
      donorLabel: 'Anonymous donor',
    });
    expect(report.reasonCounts.clear_unissued_annual_retry_receipt_number).toBe(1);
  });

  it('keeps the repair mode guarded behind explicit production confirmation', () => {
    const scriptPath = resolve(process.cwd(), 'scripts/audit-tax-receipt-visibility.mjs');
    const result = spawnSync(process.execPath, [scriptPath, '--repair'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Refusing to repair without --confirm-project ${expectedProjectId}.`);
    expect(result.stderr).toContain('Default mode is read-only');
  });

  it('can fail a read-only release gate when repairs remain or the scan is incomplete', () => {
    const reasons = taxReceiptVisibilityAuditFailureReasons(
      {
        repairs: [{
          path: 'giving/giving-public-email',
          update: { donorEmail: '' },
          reasons: ['clear_church_facing_donor_email'],
        }],
        reasonCounts: { clear_church_facing_donor_email: 1 },
      },
      {
        limitReached: {
          giving: true,
          annualSummaries: false,
          annualReceipts: false,
        },
      },
      {
        failOnRepairs: true,
        repair: false,
        limit: 5000,
      },
    );

    expect(reasons).toEqual([
      '1 legacy receipt visibility repair(s) are still needed.',
      'Audit reached --limit=5000 for: giving.',
    ]);
    expect(taxReceiptVisibilityAuditFailureReasons(
      { repairs: [], reasonCounts: {} },
      { limitReached: { giving: false } },
      { failOnRepairs: true, repair: false, limit: 5000 },
    )).toEqual([]);
    expect(taxReceiptVisibilityAuditFailureReasons(
      { repairs: [{
        path: 'giving/giving-public-email',
        update: { donorEmail: '' },
        reasons: ['clear_church_facing_donor_email'],
      }], reasonCounts: { clear_church_facing_donor_email: 1 } },
      { limitReached: { giving: false } },
      { failOnRepairs: true, repair: true, limit: 5000 },
    )).toEqual([]);
  });

  it('prints actionable credential guidance instead of a raw stack trace', () => {
    const message = taxReceiptVisibilityAuditRuntimeErrorMessage(
      new Error('Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.'),
    );

    expect(message).toContain('Google Application Default Credentials are not available');
    expect(message).toContain('Firebase CLI auth as a fallback');
    expect(message).toContain('gcloud auth application-default login');
    expect(message).toContain('GOOGLE_APPLICATION_CREDENTIALS');
    expect(message).toContain('Do not run repair mode');
    expect(message).not.toContain('node:internal');
  });

  it('decodes Firestore REST values for the read-only CLI-auth audit fallback', () => {
    expect(firestoreRestValueToJs({
      mapValue: {
        fields: {
          churchReceiptVisible: { booleanValue: true },
          amountCents: { integerValue: '2500' },
          donorLabel: { stringValue: 'Michael Petrovic' },
          stripeCheckoutSessionExpiresAt: { timestampValue: '2026-05-24T19:30:00.000Z' },
          givingIds: {
            arrayValue: {
              values: [{ stringValue: 'giving-1' }, { stringValue: 'giving-2' }],
            },
          },
        },
      },
    })).toEqual({
      churchReceiptVisible: true,
      amountCents: 2500,
      donorLabel: 'Michael Petrovic',
      stripeCheckoutSessionExpiresAt: {
        __firestoreTimestampValue: '2026-05-24T19:30:00.000Z',
      },
      givingIds: ['giving-1', 'giving-2'],
    });
  });

  it('encodes Firestore REST repair values without broad document replacement', () => {
    expect(jsValueToFirestoreRestValue({
      churchReceiptVisible: true,
      donorName: 'Parishioner',
      stripeCheckoutSessionExpiresAt: {
        __firestoreTimestampValue: '2026-05-24T19:30:00.000Z',
      },
      givingIds: ['giving-1'],
    })).toEqual({
      mapValue: {
        fields: {
          churchReceiptVisible: { booleanValue: true },
          donorName: { stringValue: 'Parishioner' },
          stripeCheckoutSessionExpiresAt: { timestampValue: '2026-05-24T19:30:00.000Z' },
          givingIds: { arrayValue: { values: [{ stringValue: 'giving-1' }] } },
        },
      },
    });

    expect(firestoreRestWriteForRepair(expectedProjectId, {
      collection: 'giving',
      id: 'giving-public-email',
      path: 'giving/giving-public-email',
      update: {
        churchReceiptVisible: true,
        donorEmail: '',
        donorNamePublicSafe: true,
        donorName: 'Parishioner',
      },
      reasons: ['make_explicit_non_anonymous_giving_visible'],
    })).toEqual({
      update: {
        name: `projects/${expectedProjectId}/databases/(default)/documents/giving/giving-public-email`,
        fields: {
          churchReceiptVisible: { booleanValue: true },
          donorEmail: { stringValue: '' },
          donorNamePublicSafe: { booleanValue: true },
          donorName: { stringValue: 'Parishioner' },
        },
      },
      updateMask: {
        fieldPaths: ['churchReceiptVisible', 'donorEmail', 'donorNamePublicSafe', 'donorName'],
      },
      updateTransforms: [{
        fieldPath: 'updatedAt',
        setToServerValue: 'REQUEST_TIME',
      }],
      currentDocument: {
        exists: true,
      },
    });

    expect(firestoreRestWriteForRepair(expectedProjectId, {
      collection: 'taxReceiptSummaries',
      id: 'annual-safe-private-field',
      path: 'taxReceiptSummaries/annual-safe-private-field',
      update: {},
      deleteFields: ['donorEmail', 'emailSendingAt', 'emailSendAttemptId', 'pdfStoragePath'],
      reasons: ['remove_private_annual_summary_fields'],
    })).toEqual({
      update: {
        name: `projects/${expectedProjectId}/databases/(default)/documents/taxReceiptSummaries/annual-safe-private-field`,
        fields: {},
      },
      updateMask: {
        fieldPaths: ['donorEmail', 'emailSendingAt', 'emailSendAttemptId', 'pdfStoragePath'],
      },
      updateTransforms: [{
        fieldPath: 'updatedAt',
        setToServerValue: 'REQUEST_TIME',
      }],
      currentDocument: {
        exists: true,
      },
    });

    expect(firestoreRestWriteForRepair(expectedProjectId, {
      collection: 'giving',
      id: 'giving-private-payment-fields',
      path: 'giving/giving-private-payment-fields',
      update: {},
      deleteFields: ['stripeCheckoutSessionId', 'stripePaymentIntentId', 'stripeRefundedChargeId'],
      reasons: ['remove_private_giving_payment_fields'],
    })).toMatchObject({
      update: {
        name: `projects/${expectedProjectId}/databases/(default)/documents/giving/giving-private-payment-fields`,
        fields: {},
      },
      updateMask: {
        fieldPaths: ['stripeCheckoutSessionId', 'stripePaymentIntentId', 'stripeRefundedChargeId'],
      },
    });

    expect(firestoreRestWritesForRepair(expectedProjectId, {
      collection: 'giving',
      id: 'giving-private-payment-fields',
      path: 'giving/giving-private-payment-fields',
      update: {},
      paymentMetadataUpdate: {
        churchId: 'church-1',
        userId: 'member-1',
        amountCents: 2500,
        currency: 'USD',
        stripeCheckoutSessionId: 'cs_live_private',
        stripeCheckoutSessionExpiresAt: {
          __firestoreTimestampValue: '2026-05-24T19:30:00.000Z',
        },
        stripePaymentIntentId: 'pi_live_private',
      },
      deleteFields: ['stripeCheckoutSessionId', 'stripeCheckoutSessionExpiresAt', 'stripePaymentIntentId'],
      reasons: ['remove_private_giving_payment_fields'],
    })).toMatchObject([
      {
        update: {
          name: `projects/${expectedProjectId}/databases/(default)/documents/givingPaymentMetadata/giving-private-payment-fields`,
          fields: {
            churchId: { stringValue: 'church-1' },
            userId: { stringValue: 'member-1' },
            amountCents: { integerValue: '2500' },
            currency: { stringValue: 'USD' },
            stripeCheckoutSessionId: { stringValue: 'cs_live_private' },
            stripeCheckoutSessionExpiresAt: { timestampValue: '2026-05-24T19:30:00.000Z' },
            stripePaymentIntentId: { stringValue: 'pi_live_private' },
          },
        },
        updateMask: {
          fieldPaths: [
            'churchId',
            'userId',
            'amountCents',
            'currency',
            'stripeCheckoutSessionId',
            'stripeCheckoutSessionExpiresAt',
            'stripePaymentIntentId',
          ],
        },
        updateTransforms: [{
          fieldPath: 'updatedAt',
          setToServerValue: 'REQUEST_TIME',
        }],
      },
      {
        update: {
          name: `projects/${expectedProjectId}/databases/(default)/documents/giving/giving-private-payment-fields`,
        },
        currentDocument: {
          exists: true,
        },
      },
    ]);
  });

  it('builds Firestore REST list URLs with field masks and page tokens', () => {
    const url = firestoreRestListDocumentsUrl(expectedProjectId, 'giving', {
      pageSize: 50,
      pageToken: 'next-page',
    });

    expect(url.origin).toBe('https://firestore.googleapis.com');
    expect(url.pathname).toBe(`/v1/projects/${expectedProjectId}/databases/(default)/documents/giving`);
    expect(url.searchParams.get('pageSize')).toBe('50');
    expect(url.searchParams.get('pageToken')).toBe('next-page');
    expect(url.searchParams.getAll('mask.fieldPaths')).toEqual([
      'churchId',
      'userId',
      'amountCents',
      'currency',
      'anonymous',
      'donorEmail',
      'donorName',
      'donorNamePublicSafe',
      'churchReceiptVisible',
      'receiptManagerGivingSafeVersion',
      'stripeSessionId',
      'stripeCheckoutSessionId',
      'stripeCheckoutSessionExpiresAt',
      'stripeCheckoutUrl',
      'stripeCheckoutSessionUrl',
      'stripePaymentIntentId',
      'stripePaymentStatus',
      'stripePaymentMethodId',
      'stripeChargeId',
      'stripeCustomerId',
      'stripeEventId',
      'stripeConnectAccountId',
      'stripeConnectTransferId',
      'stripeTransferId',
      'stripeDestinationAccountId',
      'stripeRefundId',
      'stripeRefundedChargeId',
      'checkoutSessionId',
      'checkoutSessionExpiresAt',
      'checkoutSessionUrl',
      'checkoutUrl',
      'paymentIntentId',
      'paymentStatus',
      'paymentMethodId',
      'chargeId',
      'customerId',
      'eventId',
      'refundId',
    ]);

    const annualSummaryUrl = firestoreRestListDocumentsUrl(expectedProjectId, 'taxReceiptSummaries', {
      pageSize: 50,
    });
    expect(annualSummaryUrl.searchParams.getAll('mask.fieldPaths')).toEqual(
      expect.arrayContaining([
        'churchId',
        'kind',
        'donorAnonymous',
        'churchReceiptVisible',
        'receiptId',
        'receiptNumber',
        'status',
        'emailError',
        'receiptManagerSummarySafe',
        'receiptManagerSummarySafeVersion',
        'donorLabel',
        'jurisdiction',
        'givingIds',
        'donorEmail',
        'donorName',
        'organizationTaxId',
        'emailSendingAt',
        'emailSendAttemptId',
        'stripeCheckoutSessionUrl',
        'checkoutUrl',
        'correctionForGivingId',
        'correctionMarkedAt',
        'correctionMarkedBy',
        'pdfStoragePath',
      ]),
    );
  });

  it('paginates Firestore REST collection scans without leaking the access token', async () => {
    const pages = [
      {
        documents: [
          restDocument('taxReceipts', 'receipt-a', {
            churchId: { stringValue: 'church-1' },
            kind: { stringValue: 'annual' },
            givingIds: { arrayValue: { values: [{ stringValue: 'giving-a' }] } },
          }),
          restDocument('taxReceipts', 'receipt-b', {
            churchId: { stringValue: 'church-2' },
            kind: { stringValue: 'annual' },
          }),
        ],
        nextPageToken: 'page-2',
      },
      {
        documents: [
          restDocument('taxReceipts', 'receipt-c', {
            churchId: { stringValue: 'church-1' },
            kind: { stringValue: 'single' },
          }),
        ],
      },
    ];
    const urls: URL[] = [];
    const fetchImpl = async (url: URL, init: { headers: Record<string, string> }) => {
      urls.push(url);
      expect(init.headers.Authorization).toBe('Bearer ya29.audit-token');
      return {
        ok: true,
        status: 200,
        json: async () => pages.shift() ?? {},
      };
    };

    await expect(readCollectionDocsWithFirestoreRest(
      fetchImpl,
      'ya29.audit-token',
      'taxReceipts',
      {
        projectId: expectedProjectId,
        churchId: 'church-1',
        kind: 'annual',
        limit: 3,
        pageSize: 2,
      },
    )).resolves.toMatchObject({
      docs: [
        {
          id: 'receipt-a',
          data: {
            churchId: 'church-1',
            kind: 'annual',
            givingIds: ['giving-a'],
          },
        },
      ],
      rawReadCount: 3,
      limitReached: false,
    });

    expect(urls).toHaveLength(2);
    expect(urls[0].search).not.toContain('ya29.audit-token');
    expect(urls[0].searchParams.get('pageSize')).toBe('2');
    expect(urls[0].searchParams.getAll('mask.fieldPaths')).toEqual([
      'churchId',
      'kind',
      'givingIds',
      'donorLabel',
      'donorName',
      'jurisdiction',
    ]);
    expect(urls[1].searchParams.get('pageToken')).toBe('page-2');
  });

  it('marks Firestore REST scans incomplete when the read cap stops before the next page', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        documents: [
          restDocument('giving', 'giving-a', { churchId: { stringValue: 'church-1' } }),
          restDocument('giving', 'giving-b', { churchId: { stringValue: 'church-1' } }),
        ],
        nextPageToken: 'still-more',
      }),
    });

    await expect(readCollectionDocsWithFirestoreRest(
      fetchImpl,
      'ya29.audit-token',
      'giving',
      {
        projectId: expectedProjectId,
        limit: 2,
        pageSize: 2,
      },
    )).resolves.toMatchObject({
      rawReadCount: 2,
      limitReached: true,
    });
  });

  it('applies Firestore REST repairs through commit batches without leaking the access token', async () => {
    const requests: Array<{
      url: URL;
      body: Record<string, unknown>;
    }> = [];
    const fetchImpl = async (url: URL, init: {
      method: string;
      headers: Record<string, string>;
      body: string;
    }) => {
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer ya29.repair-token');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.body).not.toContain('ya29.repair-token');
      requests.push({
        url,
        body: JSON.parse(init.body) as Record<string, unknown>,
      });
      return { ok: true, status: 200 };
    };

    await expect(applyTaxReceiptVisibilityRepairsWithFirestoreRest(
      fetchImpl,
      'ya29.repair-token',
      [
        {
          collection: 'giving',
          id: 'giving-public-email',
          path: 'giving/giving-public-email',
          update: {
            churchReceiptVisible: true,
            donorEmail: '',
            donorNamePublicSafe: true,
            donorName: 'Parishioner',
          },
          reasons: ['make_explicit_non_anonymous_giving_visible'],
        },
      ],
      { projectId: expectedProjectId },
    )).resolves.toBe(1);

    expect(requests).toHaveLength(1);
    expect(requests[0].url.origin).toBe('https://firestore.googleapis.com');
    expect(requests[0].url.pathname).toBe(
      `/v1/projects/${expectedProjectId}/databases/(default)/documents:commit`,
    );
    expect(JSON.stringify(requests[0].body)).not.toContain('ya29.repair-token');
    expect(requests[0].body).toMatchObject({
      writes: [{
        updateMask: {
          fieldPaths: ['churchReceiptVisible', 'donorEmail', 'donorNamePublicSafe', 'donorName'],
        },
        updateTransforms: [{
          fieldPath: 'updatedAt',
          setToServerValue: 'REQUEST_TIME',
        }],
        currentDocument: {
          exists: true,
        },
      }],
    });
  });

  it('blocks repair mode when the scan is incomplete', () => {
    expect(taxReceiptVisibilityRepairBlockers(
      {
        limitReached: {
          giving: true,
          annualSummaries: false,
          annualReceipts: true,
        },
      },
      { limit: 5000 },
    )).toEqual([
      'Repair mode refuses to write after incomplete scans. Rerun with --limit above 5000 for: giving, annualReceipts.',
    ]);

    expect(taxReceiptVisibilityRepairBlockers(
      { limitReached: { giving: false, annualSummaries: false } },
      { limit: 5000 },
    )).toEqual([]);
  });

  it('requires the reviewed repair count before production repair writes', () => {
    const report = {
      repairs: [
        {
          path: 'giving/giving-public-email',
          update: { churchReceiptVisible: true },
          reasons: ['make_explicit_non_anonymous_giving_visible'],
        },
      ],
      reasonCounts: {
        make_explicit_non_anonymous_giving_visible: 1,
      },
    };

    expect(taxReceiptVisibilityRepairConfirmationBlockers(
      report,
      { repair: true, confirmRepairCount: null },
    )).toEqual([
      'Repair mode requires --confirm-repair-count 1 after reviewing the read-only audit output.',
    ]);
    expect(taxReceiptVisibilityRepairConfirmationBlockers(
      report,
      { repair: true, confirmRepairCount: 2 },
    )).toEqual([
      'Repair count confirmation 2 does not match current repair count 1. Rerun the read-only audit and review the current counts before repairing.',
    ]);
    expect(taxReceiptVisibilityRepairConfirmationBlockers(
      report,
      { repair: true, confirmRepairCount: 1 },
    )).toEqual([]);
    expect(taxReceiptVisibilityRepairConfirmationBlockers(
      { repairs: [], reasonCounts: {} },
      { repair: true, confirmRepairCount: null },
    )).toEqual([]);
    expect(taxReceiptVisibilityRepairConfirmationBlockers(
      report,
      { repair: false, confirmRepairCount: null },
    )).toEqual([]);
  });

  it('keeps suggested production repair commands scoped to the reviewed scan', () => {
    expect(taxReceiptVisibilityRepairCommand(
      {
        churchId: 'church-1',
        limit: 250000,
        pageSize: 750,
      },
      { repairCount: 3 },
    )).toBe(
      'npm run audit:tax-receipts -- --repair --confirm-project kandilo-2f7a9 --church church-1 --limit 250000 --page-size 750 --confirm-repair-count 3',
    );

    expect(taxReceiptVisibilityRepairCommand(
      {
        churchId: 'church with space',
        limit: 100000,
        pageSize: 500,
      },
      {
        repairs: [{
          path: 'giving/giving-public-email',
          update: { churchReceiptVisible: true },
          reasons: ['make_explicit_non_anonymous_giving_visible'],
        }],
      },
    )).toBe(
      "npm run audit:tax-receipts -- --repair --confirm-project kandilo-2f7a9 --church 'church with space' --confirm-repair-count 1",
    );
  });

  it('does not print a repair command after a clean read-only production audit', () => {
    const options = {
      churchId: '',
      limit: 100000,
      pageSize: 500,
    };

    expect(taxReceiptVisibilityReadOnlyCompletionMessage(options, { repairCount: 0 })).toBe(
      'Read-only audit complete. No legacy receipt visibility repairs are needed.',
    );

    expect(taxReceiptVisibilityReadOnlyCompletionMessage(options, { repairCount: 1 })).toBe(
      'Read-only audit complete. To apply these repairs after review, run: npm run audit:tax-receipts -- --repair --confirm-project kandilo-2f7a9 --confirm-repair-count 1',
    );
  });

  it('prints redacted repair effect descriptions without private identifiers', () => {
    expect(taxReceiptVisibilityRepairEffectLines({
      reasonCounts: {
        make_explicit_non_anonymous_giving_visible: 1,
        sanitize_public_donor_label: 1,
        set_giving_label_safe_marker: 1,
        remove_private_annual_summary_fields: 2,
        remove_private_giving_payment_fields: 1,
      },
    })).toEqual([
      '  make_explicit_non_anonymous_giving_visible: 1 - marks explicitly non-anonymous giving visible for receipt-manager send-focused reads.',
      '  remove_private_annual_summary_fields: 2 - deletes private full-receipt fields from annual summary mirrors before any staff-safe marker is trusted.',
      '  remove_private_giving_payment_fields: 1 - preserves raw Stripe session, payment, charge, refund, customer, and Connect account aliases in backend-only payment metadata before removing them from staff-readable giving rows.',
      '  sanitize_public_donor_label: 1 - uses Parishioner when a church-facing giving donor label is missing, private, or includes email-shaped text.',
      '  set_giving_label_safe_marker: 1 - sets the giving public-label safety marker after replacing embedded email-shaped labels with a safe public label.',
    ]);
  });

  it('rejects mistyped audit arguments before production reads or repairs', () => {
    expect(parseTaxReceiptVisibilityAuditArgs([
      '--church',
      'church-1',
      '--limit=250000',
      '--page-size',
      '750',
      '--repair',
      '--confirm-project',
      expectedProjectId,
      '--confirm-repair-count',
      '3',
    ])).toMatchObject({
      churchId: 'church-1',
      confirmProject: expectedProjectId,
      confirmRepairCount: 3,
      limit: 250000,
      pageSize: 750,
      repair: true,
    });

    expect(() => parseTaxReceiptVisibilityAuditArgs(['--church-id', 'church-1'])).toThrow(
      'Unknown argument --church-id.',
    );
    expect(() => parseTaxReceiptVisibilityAuditArgs(['church-1'])).toThrow(
      'Unexpected positional argument: church-1',
    );
    expect(() => parseTaxReceiptVisibilityAuditArgs(['--confirm-repair-count'])).toThrow(
      'Missing value for --confirm-repair-count.',
    );
    expect(() => parseTaxReceiptVisibilityAuditArgs(['--limit', '5000extra'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseTaxReceiptVisibilityAuditArgs(['--page-size=100.5'])).toThrow(
      '--page-size must be a positive integer',
    );
    expect(() => parseTaxReceiptVisibilityAuditArgs(['--confirm-repair-count', '1repair'])).toThrow(
      '--confirm-repair-count must be an integer',
    );
    expect(() => parseTaxReceiptVisibilityAuditArgs(['--repair=true'])).toThrow(
      '--repair does not accept a value.',
    );
  });

  it('verifies repair mode before treating production visibility metadata as clean', async () => {
    expect(taxReceiptVisibilityPostRepairVerificationFailureReasons(
      {
        repairCount: 1,
        repairs: [{
          path: 'giving/giving-public-email',
          update: { churchReceiptVisible: true },
          reasons: ['make_explicit_non_anonymous_giving_visible'],
        }],
        reasonCounts: {
          make_explicit_non_anonymous_giving_visible: 1,
        },
      },
      {
        limitReached: {
          giving: false,
          annualSummaries: true,
        },
      },
      { limit: 5000 },
    )).toEqual([
      '1 legacy receipt visibility repair(s) still remain after repair.',
      'Post-repair verification reached --limit=5000 for: annualSummaries.',
    ]);

    await expect(verifyTaxReceiptVisibilityRepairsApplied({
      db: fakeDb({
        giving: [{
          id: 'giving-clean',
          data: {
            anonymous: false,
            donorEmail: '',
            donorName: 'Michael Petrovic',
            donorNamePublicSafe: true,
            churchReceiptVisible: true,
            receiptManagerGivingSafeVersion: 1,
          },
        }],
      }),
      options: { limit: 10, pageSize: 5 },
    })).resolves.toMatchObject({
      report: {
        repairCount: 0,
      },
      failureReasons: [],
    });

    await expect(verifyTaxReceiptVisibilityRepairsApplied({
      db: fakeDb({
        giving: [{
          id: 'giving-still-unsafe',
          data: {
            anonymous: false,
            donorEmail: 'legacy@example.com',
            donorName: 'legacy@example.com',
            donorNamePublicSafe: false,
            churchReceiptVisible: false,
          },
        }],
      }),
      options: { limit: 10, pageSize: 5 },
    })).resolves.toMatchObject({
      report: {
        repairCount: 1,
      },
      failureReasons: [
        '1 legacy receipt visibility repair(s) still remain after repair.',
      ],
    });
  });

  it('paginates collection scans and only reports the safety cap when more raw docs remain', async () => {
    const db = fakeDb({
      taxReceipts: [
        { id: 'receipt-c', data: { kind: 'annual', churchId: 'church-1' } },
        { id: 'receipt-a', data: { kind: 'single', churchId: 'church-1' } },
        { id: 'receipt-b', data: { kind: 'annual', churchId: 'church-2' } },
      ],
    });

    await expect(readCollectionDocs(db, 'taxReceipts', {
      churchId: 'church-1',
      kind: 'annual',
      limit: 3,
      pageSize: 2,
    })).resolves.toMatchObject({
      docs: [{ id: 'receipt-c', data: { kind: 'annual', churchId: 'church-1' } }],
      rawReadCount: 3,
      limitReached: false,
    });

    await expect(readCollectionDocs(db, 'taxReceipts', {
      limit: 2,
      pageSize: 2,
    })).resolves.toMatchObject({
      docs: [
        { id: 'receipt-a' },
        { id: 'receipt-b' },
      ],
      rawReadCount: 2,
      limitReached: true,
    });
  });
});
