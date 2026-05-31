import { describe, expect, it } from 'vitest';
import { receiptAuditIssueLabel, receiptAuditReviewCountLabel } from './receipt-audit';

describe('receipt audit labels', () => {
  it('renders safe operator labels without exposing raw unknown codes', () => {
    expect(receiptAuditIssueLabel('tax_receipt_send_failed', '')).toBe('Receipt email failed');
    expect(receiptAuditIssueLabel('tax_receipt_setup_required', '')).toBe('Receipt setup required');
    expect(receiptAuditIssueLabel('tax_receipt_missing_receipt_number', '')).toBe('Receipt number missing');
    expect(receiptAuditIssueLabel('', 'stripe_partial_refund_review_required')).toBe(
      'Partial refund review needed'
    );
    expect(receiptAuditIssueLabel('sk_live_private', '')).toBe('Receipt issue');
    expect(receiptAuditIssueLabel('', 'whsec_private')).toBe('Receipt issue');
    expect(receiptAuditIssueLabel('', '')).toBe('');
  });

  it('renders aggregate scheduled review counts without donor identifiers', () => {
    expect(receiptAuditReviewCountLabel('annual_scheduled_review_summary', 1)).toBe(
      '1 donor-year needs review'
    );
    expect(receiptAuditReviewCountLabel('annual_scheduled_review_summary', 4)).toBe(
      '4 donor-years need review'
    );
    expect(receiptAuditReviewCountLabel('annual_scheduled_review_summary', 1200)).toBe(
      '1,200 donor-years need review'
    );
    expect(receiptAuditReviewCountLabel('email_sent', 4)).toBe('');
    expect(receiptAuditReviewCountLabel('annual_scheduled_review_summary', 0)).toBe('');
    expect(receiptAuditReviewCountLabel('annual_scheduled_review_summary', 1.5)).toBe('');
  });
});
