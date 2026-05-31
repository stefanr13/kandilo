import { describe, expect, it } from 'vitest';
import {
  GENERIC_TAX_RECEIPT_AUDIT_CODE,
  publicTaxReceiptAuditCode,
} from '../../functions/src/shared/taxReceiptAudit';

describe('tax receipt audit helpers', () => {
  it('keeps only public audit issue codes and redacts unknown strings', () => {
    expect(publicTaxReceiptAuditCode('tax_receipt_send_failed')).toBe('tax_receipt_send_failed');
    expect(publicTaxReceiptAuditCode('tax_receipt_setup_required')).toBe('tax_receipt_setup_required');
    expect(publicTaxReceiptAuditCode('tax_receipt_missing_receipt_number')).toBe(
      'tax_receipt_missing_receipt_number'
    );
    expect(publicTaxReceiptAuditCode('tax_receipt_invalid_currency')).toBe('tax_receipt_invalid_currency');
    expect(publicTaxReceiptAuditCode(' stripe_partial_refund_review_required ')).toBe(
      'stripe_partial_refund_review_required'
    );
    expect(publicTaxReceiptAuditCode('sk_live_private')).toBe(GENERIC_TAX_RECEIPT_AUDIT_CODE);
    expect(publicTaxReceiptAuditCode('whsec_private')).toBe(GENERIC_TAX_RECEIPT_AUDIT_CODE);
    expect(publicTaxReceiptAuditCode('failed-precondition')).toBe(GENERIC_TAX_RECEIPT_AUDIT_CODE);
    expect(publicTaxReceiptAuditCode('')).toBe('');
    expect(publicTaxReceiptAuditCode(null)).toBe('');
  });
});
