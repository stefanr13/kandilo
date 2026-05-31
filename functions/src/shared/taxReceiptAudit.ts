export const GENERIC_TAX_RECEIPT_AUDIT_CODE = 'receipt_audit_issue';

const PUBLIC_TAX_RECEIPT_AUDIT_CODES = new Set([
  GENERIC_TAX_RECEIPT_AUDIT_CODE,
  'church_inactive',
  'church_tax_receipts_not_enabled',
  'receipt_followup_failed',
  'receipt_missing_amount',
  'receipt_missing_email',
  'receipt_missing_metadata',
  'receipt_send_failed',
  'resend_api_key_invalid_format',
  'resend_api_key_missing',
  'stripe_full_refund',
  'stripe_full_refund_annual_reissue',
  'stripe_partial_refund_corrected_reissue',
  'stripe_partial_refund_review_required',
  'tax_receipt_annual_giving_changed_review_required',
  'tax_receipt_annual_mixed_currency_review_required',
  'tax_receipt_donor_profile_incomplete',
  'tax_receipt_issue_failed',
  'tax_receipt_invalid_currency',
  'tax_receipt_missing_church',
  'tax_receipt_missing_email_or_amount',
  'tax_receipt_missing_receipt_number',
  'tax_receipt_pdf_failed',
  'tax_receipt_pdf_retention_failed',
  'tax_receipt_preparation_failed',
  'tax_receipt_previously_receipted_ack_required',
  'tax_receipt_provider_rejected',
  'tax_receipt_send_failed',
  'tax_receipt_setup_required',
  'tax_receipt_single_giving_changed_review_required',
  'tax_receipt_single_included_in_annual',
  'tax_receipt_unsupported_jurisdiction',
]);

export function publicTaxReceiptAuditCode(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const code = value.trim();
  if (!code) {
    return '';
  }

  return PUBLIC_TAX_RECEIPT_AUDIT_CODES.has(code) ? code : GENERIC_TAX_RECEIPT_AUDIT_CODE;
}
