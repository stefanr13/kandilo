import { describe, expect, it } from 'vitest';
import {
  callableReceiptDeliveryErrorCode,
  callableReceiptDeliveryErrorMessage,
  receiptBatchFailureReason,
  receiptDeliveryErrorMessage,
  safeReceiptErrorCode,
  type ReceiptDeliveryErrorMessages,
} from './receipt-errors';

const messages: ReceiptDeliveryErrorMessages = {
  fallback: 'fallback',
  emailNotConfigured: 'email missing',
  emailInvalidConfiguration: 'email invalid',
  missingEmailOrAmount: 'details missing',
  missingDonorProfile: 'profile missing',
  pdfFailed: 'pdf failed',
  providerRejected: 'provider rejected',
  genericIssue: 'receipt issue',
  setupRequired: 'setup required',
  unsupportedJurisdiction: 'unsupported jurisdiction',
  previouslyReceiptedAckRequired: 'confirm warning',
  partialRefundReview: 'partial refund review',
  singleIncludedInAnnual: 'included in annual',
  singleGivingChanged: 'single changed',
  annualGivingChanged: 'annual changed',
  annualMixedCurrency: 'annual mixed currency',
};

describe('receipt delivery error formatting', () => {
  it('accepts only safe backend receipt error codes', () => {
    expect(safeReceiptErrorCode('resend_api_key_missing')).toBe('resend_api_key_missing');
    expect(safeReceiptErrorCode(' resend_api_key_invalid_format ')).toBe('resend_api_key_invalid_format');
    expect(safeReceiptErrorCode('RESEND_API_KEY')).toBe('');
    expect(safeReceiptErrorCode('tax-receipt-send-failed')).toBe('');
    expect(safeReceiptErrorCode({ errorCode: 'resend_api_key_missing' })).toBe('');
  });

  it('maps persisted receipt delivery codes to safe user-facing messages', () => {
    expect(receiptDeliveryErrorMessage('resend_api_key_missing', messages)).toBe('email missing');
    expect(receiptDeliveryErrorMessage('resend_api_key_invalid_format', messages)).toBe('email invalid');
    expect(receiptDeliveryErrorMessage('tax_receipt_missing_email_or_amount', messages)).toBe('details missing');
    expect(receiptDeliveryErrorMessage('tax_receipt_donor_profile_incomplete', messages)).toBe('profile missing');
    expect(receiptDeliveryErrorMessage('tax_receipt_pdf_failed', messages)).toBe('pdf failed');
    expect(receiptDeliveryErrorMessage('tax_receipt_pdf_retention_failed', messages)).toBe('pdf failed');
    expect(receiptDeliveryErrorMessage('tax_receipt_provider_rejected', messages)).toBe('provider rejected');
    expect(receiptDeliveryErrorMessage('church_inactive', messages)).toBe('setup required');
    expect(receiptDeliveryErrorMessage('church_tax_receipts_not_enabled', messages)).toBe('setup required');
    expect(receiptDeliveryErrorMessage('tax_receipt_setup_required', messages)).toBe('setup required');
    expect(receiptDeliveryErrorMessage('tax_receipt_unsupported_jurisdiction', messages))
      .toBe('unsupported jurisdiction');
    expect(receiptDeliveryErrorMessage('receipt_audit_issue', messages)).toBe('receipt issue');
    expect(receiptDeliveryErrorMessage('tax_receipt_issue_failed', messages)).toBe('receipt issue');
    expect(receiptDeliveryErrorMessage('tax_receipt_invalid_currency', messages)).toBe('receipt issue');
    expect(receiptDeliveryErrorMessage('tax_receipt_missing_receipt_number', messages))
      .toBe('receipt issue');
    expect(receiptDeliveryErrorMessage('tax_receipt_previously_receipted_ack_required', messages))
      .toBe('confirm warning');
    expect(receiptDeliveryErrorMessage('stripe_partial_refund_review_required', messages))
      .toBe('partial refund review');
    expect(receiptDeliveryErrorMessage('tax_receipt_single_included_in_annual', messages))
      .toBe('included in annual');
    expect(receiptDeliveryErrorMessage('tax_receipt_single_giving_changed_review_required', messages))
      .toBe('single changed');
    expect(receiptDeliveryErrorMessage('tax_receipt_annual_giving_changed_review_required', messages))
      .toBe('annual changed');
    expect(receiptDeliveryErrorMessage('tax_receipt_annual_mixed_currency_review_required', messages))
      .toBe('annual mixed currency');
    expect(receiptDeliveryErrorMessage('tax_receipt_preparation_failed', messages)).toBe('fallback');
    expect(receiptDeliveryErrorMessage('tax_receipt_send_failed', messages)).toBe('fallback');
    expect(receiptDeliveryErrorMessage('unknown_safe_code', messages)).toBe('');
  });

  it('extracts safe callable error details for immediate send failures', () => {
    const error = {
      code: 'functions/internal',
      details: { errorCode: 'resend_api_key_invalid_format' },
    };

    expect(callableReceiptDeliveryErrorCode(error)).toBe('resend_api_key_invalid_format');
    expect(callableReceiptDeliveryErrorMessage(error, messages)).toBe('email invalid');
    expect(callableReceiptDeliveryErrorMessage(new Error('plain'), messages)).toBe('fallback');
  });

  it('summarizes redacted batch failure codes without donor identifiers', () => {
    expect(receiptBatchFailureReason([{ code: 'internal' }, { code: 'resend_api_key_missing' }], messages))
      .toBe('email missing');
    expect(receiptBatchFailureReason(
      [{ code: 'resend_api_key_invalid_format', userId: 'private-donor' }],
      messages
    )).toBe('email invalid');
    expect(receiptBatchFailureReason([{ code: 'failed-precondition' }], messages)).toBe('');
    expect(receiptBatchFailureReason([{ code: 'receipt_audit_issue' }], messages)).toBe('receipt issue');
    expect(receiptBatchFailureReason([{ code: 'tax_receipt_setup_required' }], messages))
      .toBe('setup required');
    expect(receiptBatchFailureReason([{ code: 'tax_receipt_unsupported_jurisdiction' }], messages))
      .toBe('unsupported jurisdiction');
    expect(receiptBatchFailureReason([{ code: 'stripe_partial_refund_review_required' }], messages))
      .toBe('partial refund review');
    expect(receiptBatchFailureReason([{ code: 'tax_receipt_annual_mixed_currency_review_required' }], messages))
      .toBe('annual mixed currency');
  });
});
