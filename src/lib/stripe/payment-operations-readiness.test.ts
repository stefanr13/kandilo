import { describe, expect, it } from 'vitest';
import type { SuperAdminPaymentOperationsReadiness } from '../../types';
import {
  firstIncompletePaymentOperationsLaunchStep,
  paymentOperationsLaunchSteps,
  paymentOperationsReadinessWarningLabel,
  paymentOperationsRecentWebhookIssueCount,
  paymentOperationsLiveWebhookIssueCount,
  paymentOperationsWebhookIssueCount,
  paymentOperationsWebhookIssueSummary,
} from './payment-operations-readiness';

function readiness(
  overrides: Partial<SuperAdminPaymentOperationsReadiness> = {}
): SuperAdminPaymentOperationsReadiness {
  return {
    checkedAtMillis: Date.now(),
    appUrl: {
      configured: true,
      value: 'https://app.kandilo.org',
      usesHttps: true,
      runtimeValid: true,
      errorCode: '',
    },
    stripeSecretKey: {
      configured: true,
      mode: 'live',
    },
    stripeWebhookSecret: {
      configured: true,
      formatValid: true,
    },
    stripeApiVersion: '2026-04-22.dahlia',
    stripeWebhookEndpoint: {
      checked: true,
      ready: true,
      configured: true,
      liveMode: true,
      enabled: true,
      duplicateCount: 0,
      apiVersionMatches: true,
      requiredEventsConfigured: true,
      explicitEventsOnly: true,
      noUnexpectedEvents: true,
      missingEventCount: 0,
      unexpectedEventCount: 0,
      errorCode: '',
    },
    resendApiKey: {
      configured: true,
      formatValid: true,
    },
    resendDomain: {
      checked: true,
      domain: 'kandilo.org',
      configured: true,
      verified: true,
      status: 'verified',
      duplicateCount: 0,
      errorCode: '',
    },
    stripeAccount: {
      checked: true,
      ready: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      country: 'US',
      defaultCurrency: 'usd',
      disabledReason: '',
      currentlyDueCount: 0,
      pastDueCount: 0,
      eventuallyDueCount: 0,
      futureCurrentlyDueCount: 0,
      futurePastDueCount: 0,
      futureEventuallyDueCount: 0,
      errorCode: '',
    },
    webhookUrl: 'https://us-central1-kandilo-2f7a9.cloudfunctions.net/stripeWebhook',
    webhookActivity: {
      checkedEventCount: 1,
      checkedLiveEventCount: 1,
      smokeFreshnessWindowHours: 72,
      latestProcessedAtMillis: Date.now(),
      latestLiveProcessedAtMillis: Date.now(),
      latestCheckoutCompletedAtMillis: Date.now(),
      latestLiveCheckoutCompletedAtMillis: Date.now(),
      latestType: 'checkout.session.completed',
      latestStatus: 'processed',
      latestLivemode: true,
      latestLiveType: 'checkout.session.completed',
      latestLiveStatus: 'processed',
      processedCount: 1,
      liveProcessedCount: 1,
      testProcessedCount: 0,
      processedCheckoutCompletedCount: 1,
      liveProcessedCheckoutCompletedCount: 1,
      testProcessedCheckoutCompletedCount: 0,
      checkoutSmokeFresh: true,
      liveCheckoutSmokeFresh: true,
      validationFailedCount: 0,
      missingGivingCount: 0,
      unpaidSessionCount: 0,
      liveIssueCount: 0,
      liveValidationFailedCount: 0,
      liveMissingGivingCount: 0,
      liveUnpaidSessionCount: 0,
      latestLiveIssueAtMillis: null,
    },
    taxReceiptEmailSmoke: {
      checkedEventCount: 1,
      smokeFreshnessWindowHours: 72,
      checkedLiveCheckoutGivingCount: 1,
      emailSentCount: 1,
      liveEmailSentCount: 1,
      latestEmailSentAtMillis: Date.now(),
      latestLiveEmailSentAtMillis: Date.now(),
      latestLiveCheckoutEmailSentAtMillis: Date.now(),
      latestLiveCheckoutGivingSentAtMillis: Date.now(),
      latestLiveCheckoutReceiptIssuedAtMillis: Date.now(),
      latestLiveCheckoutReceiptEmailSentAtMillis: Date.now(),
      latestLiveCheckoutReceiptPdfRetainedAtMillis: Date.now(),
      latestLiveCheckoutReceiptPdfObjectReady: true,
      emailSentFresh: true,
      liveEmailSentFresh: true,
      latestLiveCheckoutEmailSentFresh: true,
      latestLiveCheckoutReceiptArtifactReady: true,
      latestLiveCheckoutReceiptArtifactFresh: true,
      ready: true,
    },
    taxReceiptAnnualSmoke: {
      checkedEventCount: 1,
      smokeFreshnessWindowHours: 72,
      annualEmailSentCount: 1,
      latestAnnualEmailSentAtMillis: Date.now(),
      latestAnnualReceiptIssuedAtMillis: Date.now(),
      latestAnnualReceiptEmailSentAtMillis: Date.now(),
      latestAnnualReceiptPdfRetainedAtMillis: Date.now(),
      latestAnnualReceiptPdfObjectReady: true,
      latestAnnualReceiptSummaryReady: true,
      latestAnnualReceiptContributionDetailReady: true,
      latestAnnualReceiptOriginalYearEndReady: true,
      latestAnnualReceiptCorrectedOrReissue: false,
      latestAnnualEmailSentFresh: true,
      latestAnnualReceiptArtifactReady: true,
      latestAnnualReceiptArtifactFresh: true,
      ready: true,
    },
    donationFlowReady: true,
    taxReceiptDeliveryReady: true,
    productionReady: true,
    warnings: [],
    ...overrides,
  };
}

describe('payment operations readiness launch steps', () => {
  it('returns the production setup checklist in launch order', () => {
    const steps = paymentOperationsLaunchSteps(readiness());

    expect(steps.map((step) => step.id)).toEqual([
      'app_url',
      'stripe_secret_key',
      'stripe_account',
      'stripe_webhook',
      'receipt_email',
      'live_checkout_smoke',
      'receipt_email_smoke',
      'annual_receipt_smoke',
    ]);
    expect(steps.every((step) => step.ready)).toBe(true);
    expect(firstIncompletePaymentOperationsLaunchStep(readiness())).toBeNull();
  });

  it('points to the first incomplete setup action', () => {
    const incomplete = readiness({
      appUrl: {
        configured: false,
        value: '',
        usesHttps: false,
        runtimeValid: false,
        errorCode: 'app_url_missing',
      },
      stripeSecretKey: {
        configured: true,
        mode: 'test',
      },
      productionReady: false,
    });

    const steps = paymentOperationsLaunchSteps(incomplete);
    expect(steps.find((step) => step.id === 'app_url')?.ready).toBe(false);
    expect(steps.find((step) => step.id === 'stripe_secret_key')?.ready).toBe(false);
    expect(firstIncompletePaymentOperationsLaunchStep(incomplete)?.id).toBe('app_url');
  });

  it('labels non-blocking Stripe future requirement warnings', () => {
    const accountStep = paymentOperationsLaunchSteps(readiness({
      stripeAccount: {
        ...readiness().stripeAccount,
        futureCurrentlyDueCount: 1,
      },
      warnings: ['stripe_account_upcoming_requirements_due'],
    })).find((step) => step.id === 'stripe_account');

    expect(accountStep?.ready).toBe(true);
    expect(accountStep?.warningCodes).toContain('stripe_account_upcoming_requirements_due');
    expect(paymentOperationsReadinessWarningLabel('stripe_account_upcoming_requirements_due')).toBe(
      'Stripe future requirements queued'
    );
  });

  it('labels non-blocking Stripe eventual requirement warnings', () => {
    const accountStep = paymentOperationsLaunchSteps(readiness({
      stripeAccount: {
        ...readiness().stripeAccount,
        eventuallyDueCount: 2,
      },
      warnings: ['stripe_account_eventual_needs_due'],
    })).find((step) => step.id === 'stripe_account');

    expect(accountStep?.ready).toBe(true);
    expect(accountStep?.warningCodes).toContain('stripe_account_eventual_needs_due');
    expect(paymentOperationsReadinessWarningLabel('stripe_account_eventual_needs_due')).toBe(
      'Stripe eventual requirements queued'
    );
  });

  it('requires a clean live completed-Checkout webhook smoke result', () => {
    const smokeMissing = readiness({
      webhookActivity: {
        ...readiness().webhookActivity,
        liveProcessedCheckoutCompletedCount: 0,
        processedCheckoutCompletedCount: 0,
      },
      donationFlowReady: false,
      productionReady: false,
    });

    const smokeStep = paymentOperationsLaunchSteps(smokeMissing).find(
      (step) => step.id === 'live_checkout_smoke'
    );

    expect(smokeStep?.ready).toBe(false);
    expect(smokeStep?.warningCodes).toContain('stripe_webhook_live_checkout_smoke_missing');
  });

  it('uses explicit latest live webhook status for live smoke readiness', () => {
    const newerTestNoise = readiness({
      webhookActivity: {
        ...readiness().webhookActivity,
        latestType: 'checkout.session.completed',
        latestStatus: 'processed',
        latestLivemode: false,
        latestLiveType: 'checkout.session.completed',
        latestLiveStatus: 'processed',
        liveProcessedCheckoutCompletedCount: 1,
        liveCheckoutSmokeFresh: true,
      },
    });
    const latestLiveIssue = readiness({
      webhookActivity: {
        ...readiness().webhookActivity,
        latestType: 'charge.refunded',
        latestStatus: 'validation_failed',
        latestLivemode: true,
        latestLiveType: 'charge.refunded',
        latestLiveStatus: 'validation_failed',
      },
      donationFlowReady: false,
      productionReady: false,
      warnings: ['stripe_webhook_latest_live_not_processed'],
    });

    expect(
      paymentOperationsLaunchSteps(newerTestNoise).find((step) => step.id === 'live_checkout_smoke')?.ready
    ).toBe(true);
    expect(
      paymentOperationsLaunchSteps(latestLiveIssue).find((step) => step.id === 'live_checkout_smoke')?.ready
    ).toBe(false);
    expect(paymentOperationsReadinessWarningLabel('stripe_webhook_latest_live_not_processed')).toBe(
      'Latest live webhook not processed'
    );
  });

  it('requires the direct live webhook issue lookup to be clean', () => {
    const liveIssue = readiness({
      webhookActivity: {
        ...readiness().webhookActivity,
        validationFailedCount: 0,
        missingGivingCount: 0,
        unpaidSessionCount: 0,
        liveIssueCount: 1,
        liveValidationFailedCount: 1,
        latestLiveIssueAtMillis: Date.now(),
      },
      donationFlowReady: false,
      productionReady: false,
      warnings: ['stripe_webhook_live_issues'],
    });

    const smokeStep = paymentOperationsLaunchSteps(liveIssue).find(
      (step) => step.id === 'live_checkout_smoke'
    );

    expect(paymentOperationsWebhookIssueCount(liveIssue)).toBe(1);
    expect(paymentOperationsRecentWebhookIssueCount(liveIssue)).toBe(0);
    expect(paymentOperationsLiveWebhookIssueCount(liveIssue)).toBe(1);
    expect(paymentOperationsWebhookIssueSummary(liveIssue)).toBe('1 live / 0 recent');
    expect(smokeStep?.ready).toBe(false);
    expect(smokeStep?.warningCodes).toContain('stripe_webhook_live_issues');
    expect(firstIncompletePaymentOperationsLaunchStep(liveIssue)?.id).toBe('live_checkout_smoke');
  });

  it('keeps recent and direct live webhook issue counts visible separately in live mode', () => {
    const recentOnlyIssue = readiness({
      webhookActivity: {
        ...readiness().webhookActivity,
        validationFailedCount: 1,
        missingGivingCount: 1,
        unpaidSessionCount: 0,
        liveIssueCount: 0,
      },
      donationFlowReady: false,
      productionReady: false,
      warnings: ['stripe_webhook_recent_issues'],
    });

    expect(paymentOperationsRecentWebhookIssueCount(recentOnlyIssue)).toBe(2);
    expect(paymentOperationsLiveWebhookIssueCount(recentOnlyIssue)).toBe(0);
    expect(paymentOperationsWebhookIssueCount(recentOnlyIssue)).toBe(2);
    expect(paymentOperationsWebhookIssueSummary(recentOnlyIssue)).toBe('0 live / 2 recent');
    expect(
      paymentOperationsLaunchSteps(recentOnlyIssue).find((step) => step.id === 'live_checkout_smoke')?.ready
    ).toBe(false);
  });

  it('requires the live Stripe webhook endpoint configuration before webhook smoke', () => {
    const endpointMissing = readiness({
      stripeWebhookEndpoint: {
        ...readiness().stripeWebhookEndpoint,
        ready: false,
        configured: false,
        liveMode: false,
        enabled: false,
        apiVersionMatches: false,
        requiredEventsConfigured: false,
        explicitEventsOnly: false,
        missingEventCount: 4,
      },
      donationFlowReady: false,
      productionReady: false,
      warnings: ['stripe_webhook_endpoint_missing'],
    });

    const webhookStep = paymentOperationsLaunchSteps(endpointMissing).find(
      (step) => step.id === 'stripe_webhook'
    );

    expect(webhookStep?.ready).toBe(false);
    expect(webhookStep?.warningCodes).toContain('stripe_webhook_endpoint_missing');
    expect(firstIncompletePaymentOperationsLaunchStep(endpointMissing)?.id).toBe('stripe_webhook');
  });

  it('requires an official receipt email smoke result after the live checkout smoke', () => {
    const smokeMissing = readiness({
      taxReceiptEmailSmoke: {
        ...readiness().taxReceiptEmailSmoke,
        emailSentCount: 0,
        liveEmailSentCount: 0,
        latestEmailSentAtMillis: null,
        latestLiveEmailSentAtMillis: null,
        latestLiveCheckoutEmailSentAtMillis: null,
        ready: false,
      },
      productionReady: false,
    });

    const receiptSmokeStep = paymentOperationsLaunchSteps(smokeMissing).find(
      (step) => step.id === 'receipt_email_smoke'
    );

    expect(receiptSmokeStep?.ready).toBe(false);
    expect(receiptSmokeStep?.warningCodes).toContain('tax_receipt_live_email_smoke_missing');
    expect(firstIncompletePaymentOperationsLaunchStep(smokeMissing)?.id).toBe('receipt_email_smoke');
  });

  it('keeps receipt email smoke incomplete until the latest live Checkout donation has email evidence', () => {
    const latestCheckoutMissingEmail = readiness({
      taxReceiptEmailSmoke: {
        ...readiness().taxReceiptEmailSmoke,
        liveEmailSentCount: 1,
        latestLiveEmailSentAtMillis: Date.now(),
        liveEmailSentFresh: true,
        latestLiveCheckoutEmailSentAtMillis: null,
        latestLiveCheckoutEmailSentFresh: false,
        ready: false,
      },
      productionReady: false,
      warnings: ['tax_receipt_live_email_smoke_missing'],
    });

    const receiptSmokeStep = paymentOperationsLaunchSteps(latestCheckoutMissingEmail).find(
      (step) => step.id === 'receipt_email_smoke'
    );

    expect(receiptSmokeStep?.ready).toBe(false);
    expect(firstIncompletePaymentOperationsLaunchStep(latestCheckoutMissingEmail)?.id).toBe(
      'receipt_email_smoke'
    );
  });

  it('keeps receipt email smoke incomplete until the latest live receipt artifacts are verified', () => {
    const latestCheckoutMissingArtifacts = readiness({
      taxReceiptEmailSmoke: {
        ...readiness().taxReceiptEmailSmoke,
        latestLiveCheckoutReceiptPdfObjectReady: false,
        latestLiveCheckoutReceiptArtifactReady: false,
        latestLiveCheckoutReceiptArtifactFresh: false,
        ready: false,
      },
      productionReady: false,
      warnings: ['tax_receipt_live_receipt_artifacts_missing'],
    });

    const receiptSmokeStep = paymentOperationsLaunchSteps(latestCheckoutMissingArtifacts).find(
      (step) => step.id === 'receipt_email_smoke'
    );

    expect(receiptSmokeStep?.ready).toBe(false);
    expect(receiptSmokeStep?.warningCodes).toContain('tax_receipt_live_receipt_artifacts_missing');
    expect(firstIncompletePaymentOperationsLaunchStep(latestCheckoutMissingArtifacts)?.id).toBe(
      'receipt_email_smoke'
    );
  });

  it('marks stale live smoke evidence incomplete even when historical counts exist', () => {
    const staleSmoke = readiness({
      webhookActivity: {
        ...readiness().webhookActivity,
        checkoutSmokeFresh: false,
        liveCheckoutSmokeFresh: false,
      },
      taxReceiptEmailSmoke: {
        ...readiness().taxReceiptEmailSmoke,
        emailSentFresh: false,
        liveEmailSentFresh: false,
        latestLiveCheckoutEmailSentFresh: false,
        latestLiveCheckoutReceiptArtifactFresh: false,
        ready: false,
      },
      taxReceiptAnnualSmoke: {
        ...readiness().taxReceiptAnnualSmoke,
        latestAnnualEmailSentFresh: false,
        latestAnnualReceiptArtifactFresh: false,
        ready: false,
      },
      donationFlowReady: false,
      productionReady: false,
      warnings: [
        'stripe_webhook_live_checkout_smoke_stale',
        'tax_receipt_live_email_smoke_stale',
        'tax_receipt_live_receipt_artifacts_stale',
        'tax_receipt_annual_smoke_stale',
        'tax_receipt_annual_artifacts_stale',
      ],
    });

    const steps = paymentOperationsLaunchSteps(staleSmoke);
    expect(steps.find((step) => step.id === 'live_checkout_smoke')?.ready).toBe(false);
    expect(steps.find((step) => step.id === 'live_checkout_smoke')?.warningCodes).toContain(
      'stripe_webhook_live_checkout_smoke_stale'
    );
    expect(steps.find((step) => step.id === 'receipt_email_smoke')?.ready).toBe(false);
    expect(steps.find((step) => step.id === 'receipt_email_smoke')?.warningCodes).toContain(
      'tax_receipt_live_email_smoke_stale'
    );
    expect(steps.find((step) => step.id === 'receipt_email_smoke')?.warningCodes).toContain(
      'tax_receipt_live_receipt_artifacts_stale'
    );
    expect(steps.find((step) => step.id === 'annual_receipt_smoke')?.ready).toBe(false);
    expect(steps.find((step) => step.id === 'annual_receipt_smoke')?.warningCodes).toContain(
      'tax_receipt_annual_smoke_stale'
    );
    expect(steps.find((step) => step.id === 'annual_receipt_smoke')?.warningCodes).toContain(
      'tax_receipt_annual_artifacts_stale'
    );
  });

  it('requires an annual receipt smoke after the receipt email smoke', () => {
    const annualSmokeMissing = readiness({
      taxReceiptAnnualSmoke: {
        ...readiness().taxReceiptAnnualSmoke,
        annualEmailSentCount: 0,
        latestAnnualEmailSentAtMillis: null,
        latestAnnualReceiptIssuedAtMillis: null,
        latestAnnualReceiptEmailSentAtMillis: null,
        latestAnnualReceiptPdfRetainedAtMillis: null,
        latestAnnualReceiptPdfObjectReady: false,
        latestAnnualReceiptSummaryReady: false,
        latestAnnualReceiptContributionDetailReady: false,
        latestAnnualEmailSentFresh: false,
        latestAnnualReceiptArtifactReady: false,
        latestAnnualReceiptArtifactFresh: false,
        ready: false,
      },
      productionReady: false,
      warnings: ['tax_receipt_annual_smoke_missing'],
    });

    const annualSmokeStep = paymentOperationsLaunchSteps(annualSmokeMissing).find(
      (step) => step.id === 'annual_receipt_smoke'
    );

    expect(annualSmokeStep?.ready).toBe(false);
    expect(annualSmokeStep?.warningCodes).toContain('tax_receipt_annual_smoke_missing');
    expect(annualSmokeStep?.warningCodes).toContain('tax_receipt_annual_contribution_detail_missing');
    expect(firstIncompletePaymentOperationsLaunchStep(annualSmokeMissing)?.id).toBe(
      'annual_receipt_smoke'
    );
  });

  it('keeps checkout smoke ahead of receipt and annual smoke in launch order', () => {
    const smokeMissing = readiness({
      webhookActivity: {
        ...readiness().webhookActivity,
        liveProcessedCheckoutCompletedCount: 0,
        processedCheckoutCompletedCount: 0,
      },
      taxReceiptEmailSmoke: {
        ...readiness().taxReceiptEmailSmoke,
        ready: false,
      },
      taxReceiptAnnualSmoke: {
        ...readiness().taxReceiptAnnualSmoke,
        ready: false,
      },
      donationFlowReady: false,
      productionReady: false,
    });

    expect(firstIncompletePaymentOperationsLaunchStep(smokeMissing)?.id).toBe('live_checkout_smoke');
  });

  it('requires the live Resend sending domain before receipt email readiness', () => {
    const missingDomain = readiness({
      resendDomain: {
        checked: true,
        domain: 'kandilo.org',
        configured: true,
        verified: false,
        status: 'pending',
        duplicateCount: 0,
        errorCode: '',
      },
      taxReceiptDeliveryReady: false,
      productionReady: false,
    });

    const receiptEmailStep = paymentOperationsLaunchSteps(missingDomain).find(
      (step) => step.id === 'receipt_email'
    );

    expect(receiptEmailStep?.ready).toBe(false);
    expect(receiptEmailStep?.warningCodes).toContain('resend_domain_unverified');
    expect(firstIncompletePaymentOperationsLaunchStep(missingDomain)?.id).toBe('receipt_email');
  });

  it('keeps duplicate Resend sending domains out of receipt email readiness', () => {
    const duplicateDomain = readiness({
      resendDomain: {
        checked: true,
        domain: 'kandilo.org',
        configured: true,
        verified: true,
        status: 'verified',
        duplicateCount: 1,
        errorCode: '',
      },
      taxReceiptDeliveryReady: false,
      productionReady: false,
      warnings: ['resend_domain_duplicate'],
    });

    const receiptEmailStep = paymentOperationsLaunchSteps(duplicateDomain).find(
      (step) => step.id === 'receipt_email'
    );

    expect(receiptEmailStep?.ready).toBe(false);
    expect(receiptEmailStep?.warningCodes).toContain('resend_domain_duplicate');
    expect(firstIncompletePaymentOperationsLaunchStep(duplicateDomain)?.id).toBe('receipt_email');
  });

  it('formats operator-facing warning labels without leaking unknown values', () => {
    expect(paymentOperationsReadinessWarningLabel('stripe_webhook_live_issues')).toBe(
      'Live webhook issue found'
    );
    expect(paymentOperationsReadinessWarningLabel('stripe_webhook_recent_issues')).toBe(
      'Recent webhook issue found'
    );
    expect(paymentOperationsReadinessWarningLabel('tax_receipt_live_receipt_artifacts_missing')).toBe(
      'Live receipt artifacts missing'
    );
    expect(paymentOperationsReadinessWarningLabel('tax_receipt_annual_smoke_missing')).toBe(
      'Annual receipt smoke missing'
    );
    expect(paymentOperationsReadinessWarningLabel('tax_receipt_annual_original_smoke_missing')).toBe(
      'Original annual receipt smoke missing'
    );
    expect(paymentOperationsReadinessWarningLabel('tax_receipt_annual_contribution_detail_missing')).toBe(
      'Annual contribution detail missing'
    );
    expect(paymentOperationsReadinessWarningLabel('tax_receipt_annual_artifacts_stale')).toBe(
      'Annual receipt artifacts stale'
    );
    expect(paymentOperationsReadinessWarningLabel('sk_live_private')).toBe('Unknown setup warning');
    expect(paymentOperationsReadinessWarningLabel('whsec_private')).not.toContain('whsec');
  });

  it('keeps checklist output free of private runtime values', () => {
    const output = JSON.stringify(paymentOperationsLaunchSteps(readiness({
      appUrl: {
        configured: true,
        value: 'https://private-user:private-pass@app.kandilo.org',
        usesHttps: true,
        runtimeValid: false,
        errorCode: 'app_url_not_base_url',
      },
      webhookUrl: 'https://example.com/stripeWebhook/acct_private',
      warnings: ['sk_live_private', 'whsec_private', 're_private', 'acct_private'],
    })));

    expect(output).not.toContain('private');
    expect(output).not.toContain('sk_live');
    expect(output).not.toContain('whsec');
    expect(output).not.toContain('re_');
    expect(output).not.toContain('acct_');
  });
});
