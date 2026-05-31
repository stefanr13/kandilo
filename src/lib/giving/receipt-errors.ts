const SAFE_RECEIPT_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,119}$/;

export interface ReceiptDeliveryErrorMessages {
  fallback: string;
  emailNotConfigured: string;
  emailInvalidConfiguration: string;
  missingEmailOrAmount: string;
  missingDonorProfile: string;
  pdfFailed: string;
  providerRejected: string;
  genericIssue: string;
  setupRequired: string;
  unsupportedJurisdiction: string;
  previouslyReceiptedAckRequired: string;
  partialRefundReview: string;
  singleIncludedInAnnual: string;
  singleGivingChanged: string;
  annualGivingChanged: string;
  annualMixedCurrency: string;
}

export function safeReceiptErrorCode(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const code = value.trim();
  return SAFE_RECEIPT_ERROR_CODE_PATTERN.test(code) ? code : '';
}

export function receiptDeliveryErrorMessage(
  errorCode: unknown,
  messages: ReceiptDeliveryErrorMessages
): string {
  switch (safeReceiptErrorCode(errorCode)) {
    case 'resend_api_key_missing':
      return messages.emailNotConfigured;
    case 'resend_api_key_invalid_format':
      return messages.emailInvalidConfiguration;
    case 'tax_receipt_missing_email_or_amount':
      return messages.missingEmailOrAmount;
    case 'tax_receipt_donor_profile_incomplete':
      return messages.missingDonorProfile;
    case 'tax_receipt_pdf_failed':
    case 'tax_receipt_pdf_retention_failed':
      return messages.pdfFailed;
    case 'tax_receipt_provider_rejected':
      return messages.providerRejected;
    case 'church_inactive':
    case 'church_tax_receipts_not_enabled':
    case 'tax_receipt_setup_required':
      return messages.setupRequired;
    case 'tax_receipt_unsupported_jurisdiction':
      return messages.unsupportedJurisdiction;
    case 'receipt_audit_issue':
    case 'tax_receipt_issue_failed':
    case 'tax_receipt_invalid_currency':
    case 'tax_receipt_missing_receipt_number':
      return messages.genericIssue;
    case 'tax_receipt_previously_receipted_ack_required':
      return messages.previouslyReceiptedAckRequired;
    case 'stripe_partial_refund_review_required':
      return messages.partialRefundReview;
    case 'tax_receipt_single_included_in_annual':
      return messages.singleIncludedInAnnual;
    case 'tax_receipt_single_giving_changed_review_required':
      return messages.singleGivingChanged;
    case 'tax_receipt_annual_giving_changed_review_required':
      return messages.annualGivingChanged;
    case 'tax_receipt_annual_mixed_currency_review_required':
      return messages.annualMixedCurrency;
    case 'tax_receipt_preparation_failed':
    case 'tax_receipt_send_failed':
    case 'receipt_send_failed':
      return messages.fallback;
    default:
      return '';
  }
}

export function callableReceiptDeliveryErrorMessage(
  error: unknown,
  messages: ReceiptDeliveryErrorMessages
): string {
  const errorCode = callableReceiptDeliveryErrorCode(error);
  return receiptDeliveryErrorMessage(errorCode, messages) || messages.fallback;
}

export function callableReceiptDeliveryErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('details' in error)) {
    return '';
  }
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return '';
  }
  return safeReceiptErrorCode((details as Record<string, unknown>).errorCode);
}

export function receiptBatchFailureReason(
  failures: Array<{ code?: string; [key: string]: unknown }>,
  messages: ReceiptDeliveryErrorMessages
): string {
  for (const failure of failures) {
    const message = receiptDeliveryErrorMessage(failure.code, messages);
    if (message && message !== messages.fallback) {
      return message;
    }
  }
  return '';
}
