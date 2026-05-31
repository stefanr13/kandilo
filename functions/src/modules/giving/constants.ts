

export const DEFAULT_APP_URL = 'https://app.kandilo.org';
export const MIN_DONATION_CENTS = 50;
export const MAX_DONATION_CENTS = 1_000_000;
export const ALLOWED_CURRENCIES = new Set(['usd', 'cad']);
export const RECEIPT_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
export const TAX_RECEIPT_COUNTERS_COLLECTION = 'taxReceiptCounters';
export const TAX_RECEIPTS_COLLECTION = 'taxReceipts';
export const TAX_RECEIPT_SUMMARIES_COLLECTION = 'taxReceiptSummaries';
export const TAX_RECEIPT_EVENTS_COLLECTION = 'taxReceiptEvents';
export const GIVING_PAYMENT_METADATA_COLLECTION = 'givingPaymentMetadata';
export const RECEIPT_MANAGER_GIVING_SAFE_VERSION = 1;
export const TAX_RECEIPT_MANAGER_SUMMARY_SAFE_VERSION = 2;
export const GIVING_PRIVATE_PAYMENT_FIELDS = [
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
] as const;
export const TAX_RECEIPT_SUMMARY_PRIVATE_FIELDS = [
  'givingId',
  'givingIds',
  'donorEmail',
  'donorName',
  'donorAddress',
  'donorLegalName',
  'donorMailingAddress',
  'taxReceiptLegalName',
  'taxReceiptAddress',
  'legalName',
  'mailingAddress',
  'address',
  'email',
  'memberEmail',
  'receiptEmail',
  'organizationName',
  'organizationAddress',
  'organizationTaxId',
  'purpose',
  'contributions',
  'coveredPeriodLabel',
  'duplicateClaimWarning',
  'issuedBy',
  'emailSendingAt',
  'emailSendAttemptId',
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
  'stripeRefundStatus',
  'stripeRefundedChargeId',
  'stripeAmountRefundedCents',
  'stripeRefundedAt',
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
  'refundStatus',
  'amountRefundedCents',
  'receivedAt',
  'receivedDateLabel',
  'goodsServicesStatement',
  'pdfTemplateVersion',
  'pdfStoragePath',
  'pdfSha256',
  'pdfByteLength',
  'pdfRetainedAt',
  'pdfRetentionStatus',
  'receiptIssueLocation',
  'authorizedSignerName',
  'authorizedSignerTitle',
  'secureElectronicSignatureConfigured',
  'receiptCopiesRetentionConfirmed',
  'partialRefundGivingIds',
  'originalAmountCents',
  'refundedAmountCents',
  'correctionForGivingId',
  'correctionForReceiptId',
  'correctionSourceReason',
  'correctedAt',
  'correctedBy',
  'correctionMarkedAt',
  'correctionMarkedBy',
  'voidedBy',
] as const;
export const STRIPE_CONNECT_SETTLEMENT = 'connected_account';
export const STRIPE_PLATFORM_SETTLEMENT = 'platform';
export const DEFAULT_TAX_GOODS_SERVICES_STATEMENT =
  'No goods or services were provided in exchange for this contribution other than intangible religious benefits.';
export const ANNUAL_TAX_RECEIPT_WARNING =
  'This annual summary may include contributions that also have individual receipts. Keep one record set and do not claim the same contribution twice.';
export const PREVIOUSLY_RECEIPTED_ACK_REQUIRED_CODE = 'tax_receipt_previously_receipted_ack_required';
export const CORRECTED_TAX_RECEIPT_NOTE =
  'This corrected receipt replaces a prior receipt after a partial refund or adjustment. Use this corrected receipt for the eligible amount shown.';
export const ANONYMOUS_DONOR_LABEL = 'Anonymous donor';
export const STRIPE_FULL_REFUND_VOID_REASON = 'stripe_full_refund';
export const STRIPE_FULL_REFUND_ANNUAL_REISSUE_REASON = 'stripe_full_refund_annual_reissue';
export const STRIPE_PARTIAL_REFUND_REVIEW_REASON = 'stripe_partial_refund_review_required';
export const STRIPE_PARTIAL_REFUND_CORRECTED_REASON = 'stripe_partial_refund_corrected_reissue';
export const ANNUAL_RECEIPT_GIVING_CHANGED_REVIEW_CODE = 'tax_receipt_annual_giving_changed_review_required';
export const ANNUAL_RECEIPT_MIXED_CURRENCY_REVIEW_CODE = 'tax_receipt_annual_mixed_currency_review_required';
export const SINGLE_RECEIPT_GIVING_CHANGED_REVIEW_CODE = 'tax_receipt_single_giving_changed_review_required';
export const SINGLE_RECEIPT_INCLUDED_IN_ANNUAL_CODE = 'tax_receipt_single_included_in_annual';
export const TAX_RECEIPT_UNSUPPORTED_JURISDICTION_CODE = 'tax_receipt_unsupported_jurisdiction';
export const TAX_RECEIPT_DONOR_PROFILE_INCOMPLETE_CODE = 'tax_receipt_donor_profile_incomplete';
export const TAX_RECEIPT_MISSING_EMAIL_OR_AMOUNT_CODE = 'tax_receipt_missing_email_or_amount';
export const TAX_RECEIPT_MISSING_RECEIPT_NUMBER_CODE = 'tax_receipt_missing_receipt_number';
export const TAX_RECEIPT_INVALID_CURRENCY_CODE = 'tax_receipt_invalid_currency';
export const TAX_RECEIPT_SETUP_REQUIRED_CODE = 'tax_receipt_setup_required';
export const TAX_RECEIPT_ISSUE_FAILED_CODE = 'tax_receipt_issue_failed';
export const CHURCH_INACTIVE_CODE = 'church_inactive';
export const CHURCH_TAX_RECEIPTS_NOT_ENABLED_CODE = 'church_tax_receipts_not_enabled';
export const CANADA_CRA_ELECTRONIC_RECEIPT_BLOCKER =
  'Tax receipts are currently implemented for U.S. cash donations only. Canada/CRA receipt fields can be staged, but issuance requires read-only/non-editable PDF receipts that are protected from unauthorized access, encrypted, electronically signed under authorized parish control, retained, and printable on request.';
export const TAX_RECEIPT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const SAFE_ERROR_DETAIL_CODE_PATTERN = /^[a-z][a-z0-9_]{0,119}$/;
export const ANNUAL_BULK_DONOR_LIMIT = 250;
export const ANNUAL_BULK_DONOR_SOURCE_PAGE_SIZE = 1_000;
export const ANNUAL_BULK_DONOR_SOURCE_SCAN_LIMIT = 50_000;
export const SCHEDULED_ANNUAL_RECEIPT_ACTOR_UID = 'system';
export const SCHEDULED_ANNUAL_CHURCH_PAGE_SIZE = 200;
export const SCHEDULED_ANNUAL_CHURCH_SCAN_LIMIT = 5_000;
export const SCHEDULED_ANNUAL_DONOR_LIMIT_PER_CHURCH = 50;
