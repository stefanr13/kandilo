import type { SuperAdminPaymentOperationsReadiness } from '../../types';

export type PaymentOperationsLaunchStepId =
  | 'app_url'
  | 'stripe_secret_key'
  | 'stripe_account'
  | 'stripe_webhook'
  | 'receipt_email'
  | 'live_checkout_smoke'
  | 'receipt_email_smoke'
  | 'annual_receipt_smoke';

export interface PaymentOperationsLaunchStep {
  id: PaymentOperationsLaunchStepId;
  label: string;
  detail: string;
  ready: boolean;
  warningCodes: string[];
}

const paymentOperationsReadinessWarningLabels: Record<string, string> = {
  app_url_missing: 'Return URL missing',
  app_url_invalid: 'Return URL invalid',
  app_url_not_base_url: 'Return URL must be base URL',
  app_url_not_https: 'Return URL must use HTTPS',
  stripe_secret_key_missing: 'Stripe live key missing',
  stripe_secret_key_test_mode: 'Stripe key is test mode',
  stripe_secret_key_unrecognized_mode: 'Stripe key format unknown',
  stripe_account_status_unavailable: 'Stripe account check unavailable',
  stripe_account_charges_disabled: 'Stripe charges disabled',
  stripe_account_payouts_disabled: 'Stripe payouts disabled',
  stripe_account_details_missing: 'Stripe business details missing',
  stripe_account_requirements_due: 'Stripe requirements due',
  stripe_account_eventual_needs_due: 'Stripe eventual requirements queued',
  stripe_account_upcoming_requirements_due: 'Stripe future requirements queued',
  stripe_account_disabled: 'Stripe account disabled',
  stripe_webhook_secret_missing: 'Webhook secret missing',
  stripe_webhook_secret_invalid_format: 'Webhook secret invalid',
  stripe_webhook_endpoint_status_unavailable: 'Webhook endpoint check unavailable',
  stripe_webhook_endpoint_missing: 'Webhook endpoint missing',
  stripe_webhook_endpoint_not_live: 'Webhook endpoint not live',
  stripe_webhook_endpoint_disabled: 'Webhook endpoint disabled',
  stripe_webhook_endpoint_duplicate: 'Duplicate webhook endpoints',
  stripe_webhook_endpoint_api_version_mismatch: 'Webhook API version mismatch',
  stripe_webhook_endpoint_missing_events: 'Webhook events missing',
  stripe_webhook_endpoint_wildcard_events: 'Webhook wildcard events enabled',
  stripe_webhook_endpoint_extra_events: 'Webhook has extra events',
  resend_api_key_missing: 'Resend API key missing',
  resend_api_key_invalid_format: 'Resend API key invalid',
  resend_domain_status_unavailable: 'Resend domain check unavailable',
  resend_domain_missing: 'Receipt email domain missing',
  resend_domain_unverified: 'Receipt email domain unverified',
  resend_domain_duplicate: 'Duplicate receipt email domains',
  stripe_webhook_smoke_missing: 'Webhook smoke missing',
  stripe_webhook_checkout_smoke_missing: 'Checkout smoke missing',
  stripe_webhook_live_smoke_missing: 'Live webhook smoke missing',
  stripe_webhook_live_checkout_smoke_missing: 'Live Checkout smoke missing',
  stripe_webhook_checkout_smoke_stale: 'Checkout smoke stale',
  stripe_webhook_live_checkout_smoke_stale: 'Live Checkout smoke stale',
  stripe_webhook_latest_not_live: 'Latest webhook is not live',
  stripe_webhook_latest_live_not_processed: 'Latest live webhook not processed',
  stripe_webhook_recent_issues: 'Recent webhook issue found',
  stripe_webhook_live_issues: 'Live webhook issue found',
  tax_receipt_email_smoke_missing: 'Receipt email smoke missing',
  tax_receipt_live_email_smoke_missing: 'Live receipt email smoke missing',
  tax_receipt_email_smoke_stale: 'Receipt email smoke stale',
  tax_receipt_live_email_smoke_stale: 'Live receipt email smoke stale',
  tax_receipt_live_receipt_artifacts_missing: 'Live receipt artifacts missing',
  tax_receipt_live_receipt_artifacts_stale: 'Live receipt artifacts stale',
  tax_receipt_annual_smoke_missing: 'Annual receipt smoke missing',
  tax_receipt_annual_smoke_stale: 'Annual receipt smoke stale',
  tax_receipt_annual_original_smoke_missing: 'Original annual receipt smoke missing',
  tax_receipt_annual_contribution_detail_missing: 'Annual contribution detail missing',
  tax_receipt_annual_artifacts_missing: 'Annual receipt artifacts missing',
  tax_receipt_annual_artifacts_stale: 'Annual receipt artifacts stale',
};

export function paymentOperationsReadinessWarningLabel(value: string): string {
  return paymentOperationsReadinessWarningLabels[value] ?? 'Unknown setup warning';
}

export function paymentOperationsRecentWebhookIssueCount(readiness: SuperAdminPaymentOperationsReadiness): number {
  return (
    readiness.webhookActivity.validationFailedCount
      + readiness.webhookActivity.missingGivingCount
      + readiness.webhookActivity.unpaidSessionCount
  );
}

export function paymentOperationsLiveWebhookIssueCount(readiness: SuperAdminPaymentOperationsReadiness): number {
  return readiness.webhookActivity.liveIssueCount ?? 0;
}

export function paymentOperationsWebhookIssueCount(readiness: SuperAdminPaymentOperationsReadiness): number {
  return Math.max(
    paymentOperationsRecentWebhookIssueCount(readiness),
    paymentOperationsLiveWebhookIssueCount(readiness)
  );
}

export function paymentOperationsWebhookIssueSummary(readiness: SuperAdminPaymentOperationsReadiness): string {
  const recentIssueCount = paymentOperationsRecentWebhookIssueCount(readiness);
  if (readiness.stripeSecretKey.mode === 'live') {
    return `${paymentOperationsLiveWebhookIssueCount(readiness)} live / ${recentIssueCount} recent`;
  }
  return String(recentIssueCount);
}

function liveCheckoutSmokeReady(readiness: SuperAdminPaymentOperationsReadiness): boolean {
  return (
    readiness.stripeSecretKey.mode === 'live'
    && readiness.webhookActivity.liveProcessedCheckoutCompletedCount > 0
    && readiness.webhookActivity.liveCheckoutSmokeFresh === true
    && readiness.webhookActivity.latestLiveStatus === 'processed'
    && paymentOperationsWebhookIssueCount(readiness) === 0
  );
}

function receiptEmailSmokeReady(readiness: SuperAdminPaymentOperationsReadiness): boolean {
  return readiness.taxReceiptEmailSmoke.ready === true;
}

function annualReceiptSmokeReady(readiness: SuperAdminPaymentOperationsReadiness): boolean {
  return readiness.taxReceiptAnnualSmoke.ready === true;
}

export function paymentOperationsLaunchSteps(
  readiness: SuperAdminPaymentOperationsReadiness | null
): PaymentOperationsLaunchStep[] {
  if (!readiness) {
    return [];
  }

  const liveMode = readiness.stripeSecretKey.mode === 'live';

  return [
    {
      id: 'app_url',
      label: 'Configure return URL',
      detail: 'Set APP_URL to the production HTTPS app URL and redeploy Functions.',
      ready: readiness.appUrl.configured && readiness.appUrl.runtimeValid,
      warningCodes: ['app_url_missing', 'app_url_invalid', 'app_url_not_base_url', 'app_url_not_https'],
    },
    {
      id: 'stripe_secret_key',
      label: 'Switch Stripe to live mode',
      detail: 'Set the live Stripe secret or restricted key in Firebase Secret Manager.',
      ready: readiness.stripeSecretKey.configured && liveMode,
      warningCodes: [
        'stripe_secret_key_missing',
        'stripe_secret_key_test_mode',
        'stripe_secret_key_unrecognized_mode',
      ],
    },
    {
      id: 'stripe_account',
      label: 'Finish Stripe account activation',
      detail: 'Complete corporate, tax, bank, and verification requirements in Stripe.',
      ready: liveMode && readiness.stripeAccount.ready,
      warningCodes: [
        'stripe_account_status_unavailable',
        'stripe_account_charges_disabled',
        'stripe_account_payouts_disabled',
        'stripe_account_details_missing',
        'stripe_account_requirements_due',
        'stripe_account_eventual_needs_due',
        'stripe_account_upcoming_requirements_due',
        'stripe_account_disabled',
      ],
    },
    {
      id: 'stripe_webhook',
      label: 'Connect the live webhook',
      detail: 'Create the production webhook endpoint, store its signing secret, and verify the live endpoint configuration.',
      ready:
        liveMode
        && readiness.stripeWebhookSecret.configured
        && readiness.stripeWebhookSecret.formatValid
        && readiness.stripeWebhookEndpoint.ready,
      warningCodes: [
        'stripe_webhook_secret_missing',
        'stripe_webhook_secret_invalid_format',
        'stripe_webhook_endpoint_status_unavailable',
        'stripe_webhook_endpoint_missing',
        'stripe_webhook_endpoint_not_live',
        'stripe_webhook_endpoint_disabled',
        'stripe_webhook_endpoint_duplicate',
        'stripe_webhook_endpoint_api_version_mismatch',
        'stripe_webhook_endpoint_missing_events',
        'stripe_webhook_endpoint_wildcard_events',
        'stripe_webhook_endpoint_extra_events',
      ],
    },
    {
      id: 'receipt_email',
      label: 'Enable receipt email delivery',
      detail: 'Set the live Resend API key and verify exactly one kandilo.org sending domain.',
      ready: readiness.taxReceiptDeliveryReady,
      warningCodes: [
        'resend_api_key_missing',
        'resend_api_key_invalid_format',
        'resend_domain_status_unavailable',
        'resend_domain_missing',
        'resend_domain_unverified',
        'resend_domain_duplicate',
      ],
    },
    {
      id: 'live_checkout_smoke',
      label: 'Pass the live donation smoke test',
      detail: 'Complete one small live Checkout donation and confirm the live webhook/receipt path.',
      ready: liveCheckoutSmokeReady(readiness),
      warningCodes: [
        'stripe_webhook_smoke_missing',
        'stripe_webhook_checkout_smoke_missing',
        'stripe_webhook_live_smoke_missing',
        'stripe_webhook_live_checkout_smoke_missing',
        'stripe_webhook_checkout_smoke_stale',
        'stripe_webhook_live_checkout_smoke_stale',
        'stripe_webhook_latest_not_live',
        'stripe_webhook_latest_live_not_processed',
        'stripe_webhook_recent_issues',
        'stripe_webhook_live_issues',
      ],
    },
    {
      id: 'receipt_email_smoke',
      label: 'Send the official receipt smoke',
      detail: 'Email the official receipt for the live smoke donation and confirm backend audit plus assigned stored receipt and portal mirror artifact evidence.',
      ready: receiptEmailSmokeReady(readiness),
      warningCodes: [
        'tax_receipt_email_smoke_missing',
        'tax_receipt_live_email_smoke_missing',
        'tax_receipt_email_smoke_stale',
        'tax_receipt_live_email_smoke_stale',
        'tax_receipt_live_receipt_artifacts_missing',
        'tax_receipt_live_receipt_artifacts_stale',
      ],
    },
    {
      id: 'annual_receipt_smoke',
      label: 'Verify annual receipt smoke',
      detail: 'Send a non-anonymous closed-year annual receipt covering at least two donations and confirm itemized contribution detail, staff-safe summary, and retained PDF evidence.',
      ready: annualReceiptSmokeReady(readiness),
      warningCodes: [
        'tax_receipt_annual_smoke_missing',
        'tax_receipt_annual_smoke_stale',
        'tax_receipt_annual_original_smoke_missing',
        'tax_receipt_annual_contribution_detail_missing',
        'tax_receipt_annual_artifacts_missing',
        'tax_receipt_annual_artifacts_stale',
      ],
    },
  ];
}

export function firstIncompletePaymentOperationsLaunchStep(
  readiness: SuperAdminPaymentOperationsReadiness | null
): PaymentOperationsLaunchStep | null {
  return paymentOperationsLaunchSteps(readiness).find((step) => !step.ready) ?? null;
}
