import { safeReceiptErrorCode } from './receipt-errors';

const receiptAuditIssueLabels: Record<string, string> = {
  receipt_audit_issue: 'Receipt issue',
  church_inactive: 'Church inactive',
  church_tax_receipts_not_enabled: 'Tax receipts not enabled',
  receipt_followup_failed: 'Receipt follow-up failed',
  receipt_missing_amount: 'Receipt amount missing',
  receipt_missing_email: 'Receipt email missing',
  receipt_missing_metadata: 'Receipt metadata missing',
  receipt_send_failed: 'Receipt send failed',
  resend_api_key_invalid_format: 'Email provider key invalid',
  resend_api_key_missing: 'Email provider key missing',
  stripe_full_refund: 'Full refund voided receipt',
  stripe_full_refund_annual_reissue: 'Annual receipt reissued after refund',
  stripe_partial_refund_corrected_reissue: 'Corrected after partial refund',
  stripe_partial_refund_review_required: 'Partial refund review needed',
  tax_receipt_annual_giving_changed_review_required: 'Annual giving changed',
  tax_receipt_annual_mixed_currency_review_required: 'Mixed-currency annual review',
  tax_receipt_donor_profile_incomplete: 'Donor profile needed',
  tax_receipt_issue_failed: 'Receipt issuance failed',
  tax_receipt_missing_church: 'Receipt church missing',
  tax_receipt_missing_email_or_amount: 'Receipt email or amount missing',
  tax_receipt_missing_receipt_number: 'Receipt number missing',
  tax_receipt_pdf_failed: 'Receipt PDF failed',
  tax_receipt_pdf_retention_failed: 'Receipt PDF retention failed',
  tax_receipt_preparation_failed: 'Receipt preparation failed',
  tax_receipt_previously_receipted_ack_required: 'Duplicate-claim confirmation needed',
  tax_receipt_provider_rejected: 'Email provider rejected receipt',
  tax_receipt_send_failed: 'Receipt email failed',
  tax_receipt_setup_required: 'Receipt setup required',
  tax_receipt_single_giving_changed_review_required: 'Donation changed since receipt',
  tax_receipt_single_included_in_annual: 'Single receipt included in annual',
  tax_receipt_unsupported_jurisdiction: 'Jurisdiction unsupported',
};

export function receiptAuditIssueLabel(errorCode: unknown, reasonCode: unknown): string {
  const code = safeReceiptErrorCode(errorCode) || safeReceiptErrorCode(reasonCode);
  if (!code) {
    return '';
  }
  return receiptAuditIssueLabels[code] ?? 'Receipt issue';
}

export function receiptAuditReviewCountLabel(action: unknown, reviewCount: unknown): string {
  if (action !== 'annual_scheduled_review_summary') {
    return '';
  }
  if (typeof reviewCount !== 'number' || !Number.isInteger(reviewCount) || reviewCount <= 0) {
    return '';
  }
  return `${reviewCount.toLocaleString('en-US')} donor-year${reviewCount === 1 ? ' needs' : 's need'} review`;
}
